/**
 * Game rules, player-state analysis, hints, daily schedule and sharing helpers.
 */

import type { Puzzle } from './generator';
import { countSolutions, findRuleViolations, isCompleteSolution } from './solver';
import { shortCode } from './rng';

export const CELL_EMPTY = 0;
export const CELL_STAR = 1;
export const CELL_MARK = 2;

export type CellState = typeof CELL_EMPTY | typeof CELL_STAR | typeof CELL_MARK;
export type Mode = 'daily' | 'free';

export const LAUNCH_DATE = Date.UTC(2026, 10, 20); // 20 Nov 2026
export const PUZZLE_VERSION = 1;

export interface UnitCounts {
  rows: number[];
  cols: number[];
  regions: number[];
}

export function createEmptyState(size: number): Uint8Array {
  return new Uint8Array(size * size);
}

export function nextCellState(value: number): CellState {
  if (value === CELL_EMPTY) return CELL_STAR;
  if (value === CELL_STAR) return CELL_MARK;
  return CELL_EMPTY;
}

export function countStars(cells: Uint8Array): number {
  let total = 0;
  for (const value of cells) if (value === CELL_STAR) total++;
  return total;
}

export function unitCounts(puzzle: Puzzle, cells: Uint8Array): UnitCounts {
  const { size, regions } = puzzle;
  const rows = new Array<number>(size).fill(0);
  const cols = new Array<number>(size).fill(0);
  const regionCounts = new Array<number>(size).fill(0);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== CELL_STAR) continue;
    const x = i % size;
    const y = (i / size) | 0;
    rows[y] = (rows[y] ?? 0) + 1;
    cols[x] = (cols[x] ?? 0) + 1;
    const region = regions[i] as number;
    regionCounts[region] = (regionCounts[region] ?? 0) + 1;
  }
  return { rows, cols, regions: regionCounts };
}

export function isSolved(puzzle: Puzzle, cells: Uint8Array): boolean {
  return isCompleteSolution(puzzle.regions, puzzle.size, puzzle.starsPerUnit, cells);
}

function toSolverState(cells: Uint8Array): Uint8Array {
  const state = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const value = cells[i];
    if (value === CELL_STAR) state[i] = 1;
    else if (value === CELL_MARK) state[i] = 2;
  }
  return state;
}

export interface Analysis {
  /** True when the current marks can still lead to a valid completion. */
  ok: boolean;
  /** Cells involved in a contradiction or rule break. */
  conflicts: number[];
  /** Every placed star is consistent with at least one solution. */
  solvable: boolean;
}

/**
 * Checks a player's marks. If the position is contradictory, tries to find
 * the smallest set of marks that caused it.
 */
export function analyze(puzzle: Puzzle, cells: Uint8Array): Analysis {
  const initial = toSolverState(cells);
  const base = countSolutions(puzzle.regions, puzzle.size, puzzle.starsPerUnit, {
    initial,
    limit: 1,
  });
  if (base.count > 0) return { ok: true, conflicts: [], solvable: true };

  const violations = findRuleViolations(
    puzzle.regions,
    puzzle.size,
    puzzle.starsPerUnit,
    initial,
  );
  if (violations.length > 0) return { ok: false, conflicts: violations, solvable: false };

  const culprits: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== CELL_STAR) continue;
    const relaxed = Uint8Array.from(initial);
    relaxed[i] = 2;
    const result = countSolutions(puzzle.regions, puzzle.size, puzzle.starsPerUnit, {
      initial: relaxed,
      limit: 1,
    });
    if (result.count > 0) culprits.push(i);
  }
  if (culprits.length > 0) return { ok: false, conflicts: culprits, solvable: false };

  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== CELL_MARK) continue;
    const relaxed = Uint8Array.from(initial);
    relaxed[i] = 0;
    const result = countSolutions(puzzle.regions, puzzle.size, puzzle.starsPerUnit, {
      initial: relaxed,
      limit: 1,
    });
    if (result.count > 0) culprits.push(i);
  }
  return { ok: false, conflicts: culprits, solvable: false };
}

export type Hint =
  | { kind: 'star'; cell: number; certain: boolean }
  | { kind: 'conflict'; cells: number[] }
  | { kind: 'complete' };

/**
 * Suggests a star. When several completions exist, prefers a cell that is a
 * star in every completion ("certain").
 */
export function computeHint(puzzle: Puzzle, cells: Uint8Array): Hint {
  const initial = toSolverState(cells);
  const result = countSolutions(puzzle.regions, puzzle.size, puzzle.starsPerUnit, {
    initial,
    limit: 24,
    maxNodes: 600_000,
  });

  if (result.count === 0) {
    return { kind: 'conflict', cells: analyze(puzzle, cells).conflicts };
  }

  const starCount = new Map<number, number>();
  for (const solution of result.solutions) {
    for (let i = 0; i < solution.length; i++) {
      if (solution[i] === 1) starCount.set(i, (starCount.get(i) ?? 0) + 1);
    }
  }

  const candidates = [...starCount.entries()].filter(([cell]) => cells[cell] !== CELL_STAR);
  if (candidates.length === 0) return { kind: 'complete' };

  const total = result.solutions.length;
  candidates.sort((a, b) => {
    const aCertain = a[1] === total ? 1 : 0;
    const bCertain = b[1] === total ? 1 : 0;
    return bCertain - aCertain || b[1] - a[1];
  });

  const best = candidates[0] as [number, number];
  return { kind: 'star', cell: best[0], certain: best[1] === total };
}

/** Assist level for the end-of-game star rating. */
export function ratingFor(hints: number, checks: number): 1 | 2 | 3 {
  const assists = hints + checks;
  if (assists === 0) return 3;
  if (assists <= 2) return 2;
  return 1;
}

export function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Daily schedule                                                      */
/* ------------------------------------------------------------------ */

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** UTC date key, e.g. 2026-11-20. */
export function dateKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailyNumber(date = new Date()): number {
  return Math.floor((utcMidnight(date) - LAUNCH_DATE) / 86_400_000) + 1;
}

export function dailySeed(date = new Date()): string {
  return `asterism.v${PUZZLE_VERSION}.${dateKey(date)}`;
}

export function puzzleLabel(number: number): string {
  return `No. ${String(Math.max(1, number)).padStart(3, '0')}`;
}

export function formattedDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Milliseconds until the next daily puzzle (00:00 UTC). */
export function msUntilNextDaily(now = new Date()): number {
  const next = utcMidnight(now) + 86_400_000;
  return Math.max(0, next - now.getTime());
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function freeSeed(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const code = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `asterism.free.${code}`;
}

export function skyCode(seed: string): string {
  return shortCode(seed);
}

/**
 * Free skies carry their random seed in the share URL. The code is the
 * seed suffix, so a shared link rebuilds exactly the same chart without
 * any server or database.
 */
export function freeSeedCode(seed: string): string | null {
  const match = /^asterism\.free\.([a-z0-9]{6,32})$/i.exec(seed);
  return match ? (match[1] as string).toLowerCase() : null;
}

export function freeSeedFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const clean = code.trim().toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(clean)) return null;
  return `asterism.free.${clean}`;
}

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

export interface ShareInput {
  mode: Mode;
  number: number;
  seed: string;
  rating: number;
  elapsed: number;
  hints: number;
  checks: number;
  url: string;
}

export function buildShareText(input: ShareInput): string {
  const stars = '★'.repeat(input.rating) + '☆'.repeat(3 - input.rating);
  const title =
    input.mode === 'daily'
      ? `Asterism ${puzzleLabel(input.number)}`
      : `Asterism · free sky ${skyCode(input.seed)}`;
  const assists =
    input.hints + input.checks === 0
      ? 'no assists'
      : `${input.hints + input.checks} assist${input.hints + input.checks === 1 ? '' : 's'}`;
  return `${title}  ${stars}\n${formatTime(input.elapsed)} · ${assists}\n${input.url}`;
}
