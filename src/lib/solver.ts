/**
 * Constraint solver for the puzzle.
 *
 * Rules encoded here:
 *  - exactly `starsPerUnit` stars in every row, column and region
 *  - no two stars touch, not even diagonally
 *
 * The solver is also used for hints and for checking a player's marks, so it
 * accepts an initial board state (1 = star, 2 = marked empty).
 */

export interface SolveOptions {
  /** Stop after this many solutions. Default 2 (enough for a uniqueness test). */
  limit?: number;
  /** Initial board state. 0 = unknown, 1 = star, 2 = empty. */
  initial?: Uint8Array;
  /** Safety valve for pathological boards. */
  maxNodes?: number;
}

export interface SolveResult {
  count: number;
  /** First solution found, as a board state (1 = star, 2 = empty). */
  solution: Uint8Array | null;
  /** Up to `limit` solutions, useful for computing forced cells. */
  solutions: Uint8Array[];
  aborted: boolean;
  nodes: number;
}

export interface BoardGeometry {
  size: number;
  total: number;
  rowCells: number[][];
  colCells: number[][];
  regionCells: number[][];
  neighbours: number[][];
}

export function buildGeometry(regions: Uint8Array | number[], size: number): BoardGeometry {
  const total = size * size;
  const rowCells: number[][] = Array.from({ length: size }, () => []);
  const colCells: number[][] = Array.from({ length: size }, () => []);
  const regionCells: number[][] = Array.from({ length: size }, () => []);
  const neighbours: number[][] = new Array(total);
  const regionCount = size;

  for (let i = 0; i < total; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const region = regions[i] ?? 0;
    rowCells[y]?.push(i);
    colCells[x]?.push(i);
    if (region < 0 || region >= regionCount) {
      throw new Error(`Cell ${i} has invalid region ${region}`);
    }
    regionCells[region]?.push(i);

    const adjacent: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
          adjacent.push(ny * size + nx);
        }
      }
    }
    neighbours[i] = adjacent;
  }

  return { size, total, rowCells, colCells, regionCells, neighbours };
}

export function countSolutions(
  regions: Uint8Array | number[],
  size: number,
  starsPerUnit: number,
  options: SolveOptions = {},
): SolveResult {
  const limit = options.limit ?? 2;
  const maxNodes = options.maxNodes ?? 2_000_000;
  const geometry = buildGeometry(regions, size);
  const { total, rowCells, colCells, regionCells, neighbours } = geometry;
  const need = starsPerUnit;

  interface Unit {
    type: 'row' | 'col' | 'region';
    id: number;
    cells: number[];
  }
  const units: Unit[] = [];
  for (let i = 0; i < size; i++) {
    units.push({ type: 'row', id: i, cells: rowCells[i] as number[] });
    units.push({ type: 'col', id: i, cells: colCells[i] as number[] });
    units.push({ type: 'region', id: i, cells: regionCells[i] as number[] });
  }

  const solutions: Uint8Array[] = [];
  let nodes = 0;
  let aborted = false;

  function propagate(state: Uint8Array): boolean {
    let changed = true;
    while (changed) {
      changed = false;

      // Stars erase their whole neighbourhood.
      for (let i = 0; i < total; i++) {
        if (state[i] !== 1) continue;
        for (const j of neighbours[i] as number[]) {
          const value = state[j];
          if (value === 1) return false;
          if (value === 0) {
            state[j] = 2;
            changed = true;
          }
        }
      }

      // Unit counts.
      for (const unit of units) {
        let stars = 0;
        const candidates: number[] = [];
        for (const i of unit.cells) {
          const value = state[i];
          if (value === 1) stars++;
          else if (value === 0) candidates.push(i);
        }
        if (stars > need || stars + candidates.length < need) return false;

        if (stars === need) {
          if (candidates.length > 0) {
            for (const i of candidates) state[i] = 2;
            changed = true;
          }
        } else if (candidates.length === need - stars) {
          for (const i of candidates) state[i] = 1;
          changed = true;
        }
      }
    }
    return true;
  }

  function combinations(cells: number[], choose: number): number[][] {
    const out: number[][] = [];
    const current: number[] = [];
    const walk = (start: number): void => {
      if (current.length === choose) {
        out.push(current.slice());
        return;
      }
      for (let i = start; i < cells.length; i++) {
        current.push(cells[i] as number);
        walk(i + 1);
        current.pop();
      }
    };
    walk(0);
    return out;
  }

  function search(state: Uint8Array): void {
    if (solutions.length >= limit || aborted) return;
    if (++nodes > maxNodes) {
      aborted = true;
      return;
    }
    if (!propagate(state)) return;

    // Most-constrained unit: smallest slack between candidates and stars needed.
    let bestUnit: Unit | null = null;
    let bestCandidates: number[] = [];
    let bestSlack = Number.POSITIVE_INFINITY;
    let bestStars = 0;

    for (const unit of units) {
      let stars = 0;
      const candidates: number[] = [];
      for (const i of unit.cells) {
        const value = state[i];
        if (value === 1) stars++;
        else if (value === 0) candidates.push(i);
      }
      if (stars >= need) continue;
      const slack = candidates.length - (need - stars);
      if (slack < bestSlack || (slack === bestSlack && candidates.length < bestCandidates.length)) {
        bestSlack = slack;
        bestUnit = unit;
        bestCandidates = candidates;
        bestStars = stars;
      }
    }

    if (!bestUnit) {
      solutions.push(Uint8Array.from(state));
      return;
    }

    const remaining = need - bestStars;
    if (bestCandidates.length === remaining) {
      const next = Uint8Array.from(state);
      for (const i of bestCandidates) next[i] = 1;
      search(next);
      return;
    }

    // Branches are "exactly `remaining` of this unit's candidates are stars".
    const choices = combinations(bestCandidates, remaining);
    for (const choice of choices) {
      const next = Uint8Array.from(state);
      const chosen = new Set(choice);
      for (const i of bestCandidates) next[i] = chosen.has(i) ? 1 : 2;
      search(next);
      if (solutions.length >= limit || aborted) return;
    }
  }

  const initial = options.initial ? Uint8Array.from(options.initial) : new Uint8Array(total);
  search(initial);

  return {
    count: solutions.length,
    solution: solutions[0] ?? null,
    solutions,
    aborted,
    nodes,
  };
}

/** True when a completed board satisfies every rule. */
export function isCompleteSolution(
  regions: Uint8Array | number[],
  size: number,
  starsPerUnit: number,
  state: Uint8Array,
): boolean {
  const geometry = buildGeometry(regions, size);
  const { total, rowCells, colCells, regionCells, neighbours } = geometry;

  let stars = 0;
  for (let i = 0; i < total; i++) {
    if (state[i] === 1) stars++;
  }
  if (stars !== size * starsPerUnit) return false;

  for (const unit of [...rowCells, ...colCells, ...regionCells]) {
    let count = 0;
    for (const i of unit) if (state[i] === 1) count++;
    if (count !== starsPerUnit) return false;
  }

  for (let i = 0; i < total; i++) {
    if (state[i] !== 1) continue;
    for (const j of neighbours[i] as number[]) {
      if (j > i && state[j] === 1) return false;
    }
  }
  return true;
}

/** Cells that already break a rule (overfull units and touching stars). */
export function findRuleViolations(
  regions: Uint8Array | number[],
  size: number,
  starsPerUnit: number,
  state: Uint8Array,
): number[] {
  const geometry = buildGeometry(regions, size);
  const { total, rowCells, colCells, regionCells, neighbours } = geometry;
  const flagged = new Set<number>();

  for (const unit of [...rowCells, ...colCells, ...regionCells]) {
    const stars = unit.filter((i) => state[i] === 1);
    if (stars.length > starsPerUnit) {
      for (const i of stars) flagged.add(i);
    }
  }

  for (let i = 0; i < total; i++) {
    if (state[i] !== 1) continue;
    for (const j of neighbours[i] as number[]) {
      if (j > i && state[j] === 1) {
        flagged.add(i);
        flagged.add(j);
      }
    }
  }
  return [...flagged];
}
