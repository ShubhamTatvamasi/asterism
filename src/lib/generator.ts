/**
 * Puzzle generator.
 *
 * Strategy: build a valid star layout first, then carve the board into
 * connected regions around those stars, then accept the result only if the
 * clues have exactly one solution. Generation is deterministic from a seed.
 */

import { randomInt, rngFromString, shuffle, type Rng } from './rng';
import { countSolutions } from './solver';

export interface Puzzle {
  /** Deterministic seed used to build this puzzle. */
  seed: string;
  /** Grid width/height. */
  size: number;
  /** Stars required in every row, column and region. */
  starsPerUnit: number;
  /** Region id per cell (row-major). */
  regions: Uint8Array;
  /** One valid solution (1 = star) used as a safety net for hints. */
  solution: Uint8Array;
}

export interface GenerateOptions {
  size?: number;
  starsPerUnit?: number;
  /** Tries before giving up on a unique puzzle. */
  maxAttempts?: number;
  /** Accept a non-unique puzzle rather than failing (used as a fallback). */
  allowNonUnique?: boolean;
}

const DEFAULT_SIZE = 8;
const DEFAULT_STARS = 2;

function starDistance(a: number, b: number, size: number): number {
  const ax = a % size;
  const ay = (a / size) | 0;
  const bx = b % size;
  const by = (b / size) | 0;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Backtracking placement of `starsPerUnit` non-touching stars per row/column. */
function generateStarLayout(size: number, starsPerUnit: number, rng: Rng): Uint8Array | null {
  const total = size * size;
  const stars = new Uint8Array(total);
  const columnCount = new Uint8Array(size);

  const placeRow = (y: number): boolean => {
    if (y === size) return true;
    const columns = shuffle([...Array(size).keys()], rng);
    const chosen: number[] = [];

    const place = (startIndex: number): boolean => {
      if (chosen.length === starsPerUnit) {
        for (const c of chosen) {
          stars[y * size + c] = 1;
          columnCount[c] = (columnCount[c] ?? 0) + 1;
        }
        if (placeRow(y + 1)) return true;
        for (const c of chosen) {
          stars[y * size + c] = 0;
          columnCount[c] = (columnCount[c] ?? 0) - 1;
        }
        return false;
      }

      for (let i = startIndex; i < columns.length; i++) {
        const c = columns[i] as number;
        if ((columnCount[c] ?? 0) >= starsPerUnit) continue;

        let ok = true;
        for (const pc of chosen) {
          if (Math.abs(pc - c) <= 1) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        // Check the row above for diagonal/vertical touching.
        if (y > 0) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = c + dx;
            if (nx >= 0 && nx < size && stars[(y - 1) * size + nx] === 1) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;

        chosen.push(c);
        if (place(i + 1)) return true;
        chosen.pop();
      }
      return false;
    };

    return place(0);
  };

  return placeRow(0) ? stars : null;
}

/** Group the stars into `size` groups of `starsPerUnit`, nearest-first with jitter. */
function groupStars(stars: Uint8Array, size: number, starsPerUnit: number, rng: Rng): number[][] {
  const starCells: number[] = [];
  for (let i = 0; i < stars.length; i++) if (stars[i] === 1) starCells.push(i);

  const remaining = new Set(starCells);
  const groups: number[][] = [];

  while (remaining.size > 0) {
    const pool = [...remaining];
    const start = pool[randomInt(rng, pool.length)] as number;
    remaining.delete(start);
    const group = [start];

    while (group.length < starsPerUnit) {
      let best: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of remaining) {
        for (const member of group) {
          const distance = starDistance(candidate, member, size) + rng() * 2.5;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
      }
      if (best === null) return [];
      remaining.delete(best);
      group.push(best);
    }
    groups.push(group);
  }
  return groups;
}

interface GrownRegions {
  regions: Uint8Array;
  sizes: number[];
}

/** Grow regions from the star groups, always expanding the smallest region. */
function growRegions(
  stars: Uint8Array,
  groups: number[][],
  size: number,
  rng: Rng,
): GrownRegions | null {
  const total = size * size;
  const regions = new Uint8Array(total).fill(255);
  const sizes = groups.map(() => 0);
  const frontiers: Set<number>[] = groups.map(() => new Set<number>());

  groups.forEach((group, region) => {
    for (const cell of group) {
      regions[cell] = region;
      sizes[region] = (sizes[region] ?? 0) + 1;
    }
  });

  const directions: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const addFrontier = (region: number, cell: number): void => {
    const x = cell % size;
    const y = (cell / size) | 0;
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (regions[next] !== 255 || stars[next] === 1) continue;
      frontiers[region]?.add(next);
    }
  };

  groups.forEach((group, region) => {
    for (const cell of group) addFrontier(region, cell);
  });

  let remaining = total - groups.length * groups[0]!.length;
  while (remaining > 0) {
    let chosenRegion = -1;
    let smallest = Number.POSITIVE_INFINITY;
    for (let region = 0; region < groups.length; region++) {
      const frontier = frontiers[region];
      if (!frontier || frontier.size === 0) continue;
      const regionSize = sizes[region] ?? 0;
      if (regionSize < smallest) {
        smallest = regionSize;
        chosenRegion = region;
      }
    }
    if (chosenRegion === -1) return null;

    const frontier = frontiers[chosenRegion];
    if (!frontier) return null;
    const cells = [...frontier];
    const cell = cells[randomInt(rng, cells.length)] as number;
    regions[cell] = chosenRegion;
    sizes[chosenRegion] = (sizes[chosenRegion] ?? 0) + 1;
    remaining--;

    for (const other of frontiers) other.delete(cell);
    addFrontier(chosenRegion, cell);
  }

  return { regions, sizes };
}

function connectivityOk(regions: Uint8Array, size: number): boolean {
  const total = size * size;
  const counts = new Map<number, number>();
  for (let i = 0; i < total; i++) {
    const region = regions[i] as number;
    if (region > size) return false;
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }

  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (const [region, expected] of counts) {
    let start = -1;
    for (let i = 0; i < total; i++) {
      if (regions[i] === region) {
        start = i;
        break;
      }
    }
    if (start === -1) return false;

    const visited = new Set<number>([start]);
    const queue = [start];
    while (queue.length) {
      const cell = queue.pop() as number;
      const x = cell % size;
      const y = (cell / size) | 0;
      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (regions[next] !== region || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    if (visited.size !== expected) return false;
  }
  return counts.size === size;
}

/**
 * Build a puzzle from a seed. Retries until the clues are unique.
 */
export function generatePuzzle(seed: string, options: GenerateOptions = {}): Puzzle {
  const size = options.size ?? DEFAULT_SIZE;
  const starsPerUnit = options.starsPerUnit ?? DEFAULT_STARS;
  const maxAttempts = options.maxAttempts ?? 120;
  const rng = rngFromString(seed);

  let fallback: Puzzle | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stars = generateStarLayout(size, starsPerUnit, rng);
    if (!stars) continue;

    const groups = groupStars(stars, size, starsPerUnit, rng);
    if (groups.length !== size) continue;

    const grown = growRegions(stars, groups, size, rng);
    if (!grown) continue;

    // Reject cramped or sprawling regions; they read badly on screen.
    const tooSmall = grown.sizes.some((value) => value < Math.max(5, Math.floor(size * 0.65)));
    const tooLarge = grown.sizes.some((value) => value > Math.ceil(size * 1.8));
    if (tooSmall || tooLarge) continue;
    if (!connectivityOk(grown.regions, size)) continue;

    const solve = countSolutions(grown.regions, size, starsPerUnit, { limit: 2 });
    if (solve.count === 0) continue;

    const puzzle: Puzzle = {
      seed,
      size,
      starsPerUnit,
      regions: grown.regions,
      solution: stars,
    };

    if (solve.count === 1) return puzzle;
    if (!fallback) fallback = puzzle;
    if (options.allowNonUnique) return puzzle;
  }

  if (options.allowNonUnique && fallback) return fallback;
  throw new Error(`Could not generate a unique puzzle for seed "${seed}"`);
}
