/**
 * Local persistence. Everything stays in the browser; there is no account.
 */

import { dateKey } from './game';

const KEY = 'asterism.v1';
const DAY_MS = 86_400_000;

export interface Stats {
  played: number;
  solved: number;
  streak: number;
  best: number | null;
  totalStars: number;
  lastSolvedDate: string | null;
}

export interface DailySave {
  date: string;
  seed: string;
  cells: number[];
  elapsed: number;
  hints: number;
  checks: number;
  solved: boolean;
  rating: number;
}

export interface Settings {
  sound: boolean;
  patterns: boolean;
  motion: boolean;
}

export interface Store {
  version: 1;
  onboarded: boolean;
  stats: Stats;
  daily: DailySave | null;
  settings: Settings;
}

const DEFAULTS: Store = {
  version: 1,
  onboarded: false,
  stats: {
    played: 0,
    solved: 0,
    streak: 0,
    best: null,
    totalStars: 0,
    lastSolvedDate: null,
  },
  daily: null,
  settings: {
    sound: true,
    patterns: false,
    motion: true,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function loadStore(): Store {
  if (typeof localStorage === 'undefined') return structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return structuredClone(DEFAULTS);

    const stats = isRecord(parsed.stats) ? parsed.stats : {};
    const settings = isRecord(parsed.settings) ? parsed.settings : {};
    const daily = isRecord(parsed.daily) ? parsed.daily : null;

    return {
      version: 1,
      onboarded: parsed.onboarded === true,
      stats: {
        played: numberOr(stats.played, 0),
        solved: numberOr(stats.solved, 0),
        streak: numberOr(stats.streak, 0),
        best:
          typeof stats.best === 'number' && Number.isFinite(stats.best)
            ? Math.max(1, Math.ceil(stats.best))
            : null,
        totalStars: numberOr(stats.totalStars, 0),
        lastSolvedDate: typeof stats.lastSolvedDate === 'string' ? stats.lastSolvedDate : null,
      },
      daily:
        daily && typeof daily.date === 'string'
          ? {
              date: daily.date,
              seed: typeof daily.seed === 'string' ? daily.seed : '',
              cells: Array.isArray(daily.cells) ? daily.cells.map((v) => numberOr(v, 0)) : [],
              elapsed: numberOr(daily.elapsed, 0),
              hints: numberOr(daily.hints, 0),
              checks: numberOr(daily.checks, 0),
              solved: daily.solved === true,
              rating: numberOr(daily.rating, 0),
            }
          : null,
      settings: {
        sound: settings.sound !== false,
        patterns: settings.patterns === true,
        motion: settings.motion !== false,
      },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveStore(store: Store): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private mode or full quota: the game still works without persistence.
  }
}

/**
 * Streaks survive a day of rest only if the last solve was today or yesterday.
 */
export function effectiveStreak(stats: Stats, now = new Date()): number {
  if (!stats.lastSolvedDate) return 0;
  const today = dateKey(now);
  const yesterday = dateKey(new Date(now.getTime() - DAY_MS));
  if (stats.lastSolvedDate === today || stats.lastSolvedDate === yesterday) {
    return stats.streak;
  }
  return 0;
}

export function recordSolve(
  store: Store,
  options: { mode: 'daily' | 'free'; rating: number; elapsed: number; date?: string },
): Store {
  const date = options.date ?? dateKey();
  const stats: Stats = {
    ...store.stats,
    solved: store.stats.solved + 1,
    totalStars: store.stats.totalStars + options.rating,
  };

  if (options.mode === 'daily') {
    const last = store.stats.lastSolvedDate;
    if (last !== date) {
      const yesterday = dateKey(new Date(new Date(date).getTime() - DAY_MS));
      stats.streak = last === yesterday ? store.stats.streak + 1 : 1;
      stats.lastSolvedDate = date;
    }
  }

  const seconds = Math.max(1, Math.ceil(options.elapsed));
  if (stats.best === null || seconds < stats.best) {
    stats.best = seconds;
  }

  return { ...store, stats };
}

/** Marks today's puzzle as played once, even if it is not finished. */
export function markDailyPlayed(store: Store): Store {
  return { ...store, stats: { ...store.stats, played: store.stats.played + 1 } };
}

export function clearProgress(): Store {
  const next = structuredClone(DEFAULTS);
  next.settings = loadStore().settings;
  return next;
}
