import { describe, expect, it } from 'vitest';
import { generatePuzzle, type Puzzle } from '../src/lib/generator';
import {
  countSolutions,
  findRuleViolations,
  isCompleteSolution,
} from '../src/lib/solver';
import {
  analyze,
  archiveDayFor,
  computeHint,
  buildShareText,
  dailyNumber,
  dailyNumberFor,
  dailySeed,
  dailySeedFor,
  dateFromKey,
  dateKey,
  freeSeed,
  freeSeedCode,
  freeSeedFromCode,
  isSolved,
  isValidDayKey,
  ratingFor,
  nextCellState,
  pluralize,
  CELL_EMPTY,
  CELL_MARK,
  CELL_STAR,
} from '../src/lib/game';
import { effectiveStreak, loadStore, recordSolve } from '../src/lib/storage';

function regionSizes(puzzle: Puzzle): number[] {
  const sizes = new Array<number>(puzzle.size).fill(0);
  for (const region of puzzle.regions) sizes[region] = (sizes[region] ?? 0) + 1;
  return sizes;
}

function connected(puzzle: Puzzle, region: number): boolean {
  const { size, regions } = puzzle;
  const cells: number[] = [];
  for (let i = 0; i < regions.length; i++) if (regions[i] === region) cells.push(i);
  const seen = new Set<number>([cells[0] as number]);
  const queue = [cells[0] as number];
  while (queue.length) {
    const cell = queue.pop() as number;
    const x = cell % size;
    const y = (cell / size) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (regions[next] !== region || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === cells.length;
}

// Naive reference counter used to validate the fast solver.
function bruteCount(regions: Uint8Array, size: number, starsPerUnit: number, limit = 3): number {
  const state = new Uint8Array(size * size);
  const colCount = new Uint8Array(size);
  const regionCount = new Uint8Array(size);
  let count = 0;

  const compatible = (index: number): boolean => {
    const x = index % size;
    const y = (index / size) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && state[ny * size + nx] === 1) {
          return false;
        }
      }
    }
    return true;
  };

  const placeRow = (y: number, start: number, placed: number): void => {
    if (count >= limit) return;
    if (placed === starsPerUnit) {
      if (y === size - 1) {
        count++;
        return;
      }
      placeRow(y + 1, 0, 0);
      return;
    }
    for (let x = start; x < size; x++) {
      const index = y * size + x;
      const region = regions[index] as number;
      if ((colCount[x] ?? 0) >= starsPerUnit || (regionCount[region] ?? 0) >= starsPerUnit) continue;
      if (!compatible(index)) continue;
      state[index] = 1;
      colCount[x] = (colCount[x] ?? 0) + 1;
      regionCount[region] = (regionCount[region] ?? 0) + 1;
      placeRow(y, x + 1, placed + 1);
      state[index] = 0;
      colCount[x] = (colCount[x] ?? 0) - 1;
      regionCount[region] = (regionCount[region] ?? 0) - 1;
      if (count >= limit) return;
    }
  };

  placeRow(0, 0, 0);
  return count;
}

describe('generator', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => `test.seed.${i}`);

  it('produces deterministic puzzles', () => {
    const a = generatePuzzle('same.seed');
    const b = generatePuzzle('same.seed');
    expect([...a.regions]).toEqual([...b.regions]);
    expect([...a.solution]).toEqual([...b.solution]);
  });

  it('produces valid, unique 8x8 puzzles', () => {
    for (const seed of seeds) {
      const puzzle = generatePuzzle(seed);
      expect(puzzle.size).toBe(8);
      expect(puzzle.starsPerUnit).toBe(2);
      expect(puzzle.regions.length).toBe(64);

      const sizes = regionSizes(puzzle);
      expect(sizes).toHaveLength(8);
      for (const size of sizes) expect(size).toBeGreaterThan(0);

      for (let region = 0; region < 8; region++) {
        expect(connected(puzzle, region)).toBe(true);
        const stars = [...puzzle.regions].filter(
          (value, index) => value === region && puzzle.solution[index] === 1,
        ).length;
        expect(stars).toBe(2);
      }

      expect(isCompleteSolution(puzzle.regions, 8, 2, puzzle.solution)).toBe(true);

      const solutions = countSolutions(puzzle.regions, 8, 2, { limit: 2 });
      expect(solutions.count, `seed ${seed} should have exactly one solution`).toBe(1);
    }
  });

  it('keeps generation time reasonable', () => {
    const started = performance.now();
    for (const seed of seeds) generatePuzzle(seed);
    const perPuzzle = (performance.now() - started) / seeds.length;
    expect(perPuzzle).toBeLessThan(500);
  });

  it('rejects malformed solution states', () => {
    const puzzle = generatePuzzle('validity.check');
    const broken = Uint8Array.from(puzzle.solution);
    // Remove one star: no longer complete.
    const star = broken.indexOf(1);
    broken[star] = 0;
    expect(isCompleteSolution(puzzle.regions, 8, 2, broken)).toBe(false);
  });
});

describe('solver', () => {
  it('matches a brute-force counter on small random boards', () => {
    let seed = 1234567;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (const [size, stars] of [
      [5, 1],
      [6, 1],
      [6, 2],
      [7, 2],
    ] as const) {
      for (let round = 0; round < 12; round++) {
        const regions = new Uint8Array(size * size);
        for (let i = 0; i < regions.length; i++) {
          regions[i] = Math.floor(rand() * size);
        }
        const expected = bruteCount(regions, size, stars, 3);
        const actual = countSolutions(regions, size, stars, { limit: 3 }).count;
        expect(actual).toBe(expected);
      }
    }
  });

  it('respects initial marks, including contradictions', () => {
    const puzzle = generatePuzzle('initial.marks');
    const stars = [...puzzle.solution].map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    const initial = new Uint8Array(64);
    for (const cell of stars.slice(0, 4)) initial[cell] = 1;
    for (let i = 0; i < 64; i++) if (initial[i] === 0) initial[i] = 2;

    expect(countSolutions(puzzle.regions, 8, 2, { initial, limit: 1 }).count).toBe(0);

    const partial = new Uint8Array(64);
    for (const cell of stars.slice(0, 3)) partial[cell] = 1;
    expect(countSolutions(puzzle.regions, 8, 2, { initial: partial, limit: 2 }).count).toBe(1);
  });

  it('finds rule violations', () => {
    const puzzle = generatePuzzle('violations');
    const state = new Uint8Array(64);
    const first = puzzle.solution.indexOf(1);
    state[first] = 1;
    const neighbour = first % 8 < 7 ? first + 1 : first - 1;
    state[neighbour] = 1;
    const violations = findRuleViolations(puzzle.regions, 8, 2, state);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('game rules', () => {
  it('cycles cells empty -> star -> mark -> empty', () => {
    expect(nextCellState(CELL_EMPTY)).toBe(CELL_STAR);
    expect(nextCellState(CELL_STAR)).toBe(CELL_MARK);
    expect(nextCellState(CELL_MARK)).toBe(CELL_EMPTY);
  });

  it('pluralises counts for UI labels', () => {
    expect(pluralize(0, 'chart')).toBe('0 charts');
    expect(pluralize(1, 'chart')).toBe('1 chart');
    expect(pluralize(2, 'chart')).toBe('2 charts');
    expect(pluralize(1, 'hint')).toBe('1 hint');
    expect(pluralize(3, 'check')).toBe('3 checks');
  });

  it('round-trips free-sky share codes without a server', () => {
    const seed = freeSeed();
    const code = freeSeedCode(seed);
    expect(code).toBeTruthy();
    expect(freeSeedFromCode(code)).toBe(seed);
    expect(freeSeedFromCode('not a code!')).toBeNull();
    expect(freeSeedFromCode('abc')).toBeNull();
  });

  it('builds share text with the game link', () => {
    const text = buildShareText({
      mode: 'free',
      number: 0,
      seed: 'asterism.free.abc123def456',
      rating: 3,
      elapsed: 125,
      hints: 0,
      checks: 0,
      url: 'https://shubhamtatvamasi.com/asterism/?sky=abc123def456',
    });
    expect(text).toContain('★★★');
    expect(text).toContain('2:05');
    expect(text).toContain('no assists');
    expect(text).toContain('?sky=abc123def456');
  });

  it('dates a daily share result', () => {
    const text = buildShareText({
      mode: 'daily',
      number: 12,
      seed: 'asterism.v1.2026-12-01',
      rating: 2,
      elapsed: 3725,
      hints: 1,
      checks: 2,
      url: 'https://shubhamtatvamasi.com/asterism/',
      date: '1 Dec 2026',
    });
    expect(text).toContain('Asterism No. 012 · 1 Dec 2026');
    expect(text).toContain('★★☆');
    expect(text).toContain('1:02:05');
    expect(text).toContain('3 assists');
  });

  it('recognises the generated solution and nothing else', () => {
    const puzzle = generatePuzzle('solved.checks');
    expect(isSolved(puzzle, puzzle.solution)).toBe(true);
    const altered = Uint8Array.from(puzzle.solution);
    altered[altered.indexOf(1)] = 0;
    expect(isSolved(puzzle, altered)).toBe(false);
  });

  it('analyse accepts a solvable position and flags a wrong star', () => {
    const puzzle = generatePuzzle('analysis');
    const empty = new Uint8Array(64);
    const good = analyze(puzzle, empty);
    expect(good.ok).toBe(true);

    const wrong = new Uint8Array(64);
    const wrongCell = puzzle.solution.indexOf(1) === 0 ? 1 : 0;
    wrong[wrongCell] = 1;
    const result = analyze(puzzle, wrong);
    expect(result.ok).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('never suggests a star that conflicts with the player marks', () => {
    const puzzle = generatePuzzle('hint.consistency');
    const marks = new Uint8Array(64);
    const stars = [...puzzle.solution].map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);

    for (let i = 0; i < 40; i++) {
      const hint = computeHint(puzzle, marks);
      if (hint.kind !== 'star') break;
      expect(marks[hint.cell]).not.toBe(CELL_STAR);
      marks[hint.cell] = CELL_STAR;
      expect(analyze(puzzle, marks).ok).toBe(true);
    }
    expect(isSolved(puzzle, marks)).toBe(true);
    expect(stars.length).toBe(16);
  });

  it('reports a conflict when the player has made a mistake', () => {
    const puzzle = generatePuzzle('hint.conflict');
    const marks = new Uint8Array(64);
    marks[puzzle.solution.indexOf(1) === 0 ? 1 : 0] = CELL_STAR;
    const hint = computeHint(puzzle, marks);
    expect(hint.kind).toBe('conflict');
  });

  it('rates by number of assists', () => {
    expect(ratingFor(0, 0)).toBe(3);
    expect(ratingFor(1, 0)).toBe(2);
    expect(ratingFor(1, 1)).toBe(2);
    expect(ratingFor(2, 2)).toBe(1);
  });
});

describe('daily schedule', () => {
  it('starts at puzzle 1 on launch day', () => {
    expect(dailyNumber(new Date('2026-11-20T12:00:00Z'))).toBe(1);
    expect(dailyNumber(new Date('2026-11-21T12:00:00Z'))).toBe(2);
    expect(dateKey(new Date('2026-11-20T23:59:59Z'))).toBe('2026-11-20');
  });

  it('gives everyone the same daily seed', () => {
    const morning = new Date('2026-11-20T00:01:00Z');
    const evening = new Date('2026-11-20T23:59:00Z');
    expect(dailySeed(morning)).toBe(dailySeed(evening));
  });

  it('keeps a saved chart tied to its own UTC day', () => {
    expect(dailySeedFor('2026-11-20')).toBe('asterism.v1.2026-11-20');
    expect(dailySeedFor('2026-11-20')).toBe(dailySeed(new Date('2026-11-20T23:59:00Z')));
    expect(dailyNumberFor('2026-11-20')).toBe(1);
    expect(dailyNumberFor('2026-11-21')).toBe(2);
    expect(dateFromKey('2026-11-20').toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('accepts only real day keys for archived share links', () => {
    expect(isValidDayKey('2026-11-20')).toBe(true);
    expect(isValidDayKey('2024-02-29')).toBe(true);
    expect(isValidDayKey('2026-02-31')).toBe(false);
    expect(isValidDayKey('2026-11-20T00:00:00Z')).toBe(false);
    expect(isValidDayKey('20-11-2026')).toBe(false);
    expect(isValidDayKey('')).toBe(false);
    expect(isValidDayKey(null)).toBe(false);
  });

  it('opens shared daily links on the chart they were shared from', () => {
    const today = '2026-11-22';
    expect(archiveDayFor('2026-11-21', today)).toBe('2026-11-21');
    expect(archiveDayFor('2026-11-20', today)).toBe('2026-11-20');
    // Today's link is simply today's daily, not an archive.
    expect(archiveDayFor(today, today)).toBeNull();
    expect(archiveDayFor('2026-11-23', today)).toBeNull();
    // Before launch and malformed values are ignored.
    expect(archiveDayFor('2026-11-19', today)).toBeNull();
    expect(archiveDayFor('not-a-day', today)).toBeNull();
    expect(archiveDayFor(null, today)).toBeNull();
  });
});

describe('persistence', () => {
  const solve = (
    store: ReturnType<typeof loadStore>,
    date: string,
    mode: 'daily' | 'free' = 'daily',
  ) => recordSolve(store, { mode, rating: 3, elapsed: 100, date });

  it('builds a streak from consecutive daily solves and resets after a gap', () => {
    let store = loadStore();
    store = solve(store, '2026-11-20');
    expect(store.stats.streak).toBe(1);
    expect(store.stats.lastSolvedDate).toBe('2026-11-20');

    store = solve(store, '2026-11-21');
    expect(store.stats.streak).toBe(2);

    // Solving the same day again must not extend the streak.
    store = solve(store, '2026-11-21');
    expect(store.stats.streak).toBe(2);

    store = solve(store, '2026-11-24');
    expect(store.stats.streak).toBe(1);
    expect(store.stats.solved).toBe(4);
  });

  it('keeps yesterday’s streak alive until today is missed', () => {
    const store = solve(loadStore(), '2026-11-20');
    expect(effectiveStreak(store.stats, new Date('2026-11-20T12:00:00Z'))).toBe(1);
    expect(effectiveStreak(store.stats, new Date('2026-11-21T23:00:00Z'))).toBe(1);
    expect(effectiveStreak(store.stats, new Date('2026-11-22T00:01:00Z'))).toBe(0);
  });

  it('counts free-sky solves without touching the daily streak', () => {
    let store = solve(loadStore(), '2026-11-20');
    store = solve(store, '2026-11-20', 'free');
    expect(store.stats.solved).toBe(2);
    expect(store.stats.streak).toBe(1);
    expect(store.stats.lastSolvedDate).toBe('2026-11-20');
  });

  it('rounds best times up to whole seconds', () => {
    const store = recordSolve(loadStore(), {
      mode: 'free',
      rating: 3,
      elapsed: 125.2,
    });
    expect(store.stats.best).toBe(126);
  });
});
