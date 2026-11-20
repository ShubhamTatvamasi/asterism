/**
 * Asterism — browser game controller.
 *
 * Pure game logic lives in src/lib; this file owns the DOM, the clock,
 * persistence, dialogs and interaction polish.
 */

import { generatePuzzle, type Puzzle } from '../lib/generator';
import {
  CELL_MARK,
  CELL_STAR,
  analyze,
  buildShareText,
  computeHint,
  dailyNumber,
  dailySeed,
  dateKey,
  formatCountdown,
  formatTime,
  formattedDate,
  freeSeed,
  isSolved,
  msUntilNextDaily,
  nextCellState,
  puzzleLabel,
  ratingFor,
  skyCode,
  unitCounts,
  type Mode,
} from '../lib/game';
import { findRuleViolations } from '../lib/solver';
import {
  clearProgress,
  effectiveStreak,
  loadStore,
  markDailyPlayed,
  recordSolve,
  saveStore,
  type Store,
} from '../lib/storage';
import { Chimes } from './audio';
import { initSky, type SkyController } from './sky';

interface Session {
  mode: Mode;
  seed: string;
  number: number;
  puzzle: Puzzle;
  cells: Uint8Array;
  history: Uint8Array[];
  future: Uint8Array[];
  hints: number;
  checks: number;
  elapsedBase: number;
  runStart: number | null;
  solved: boolean;
  rating: number;
}

const REGION_COLOURS = [
  '#4f7fd0',
  '#9b63d6',
  '#2f9e8f',
  '#d1647f',
  '#cf9a45',
  '#6aa95f',
  '#c1774f',
  '#5b8ea8',
];

const STAR_SVG =
  '<svg class="glyph glyph--star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.2c.9 6.2 4.6 9.9 10.8 10.8-6.2.9-9.9 4.6-10.8 10.8C11.1 16.6 7.4 12.9 1.2 12 7.4 11.1 11.1 7.4 12 1.2Z"/></svg>';

const MARK_SVG =
  '<svg class="glyph glyph--mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/></svg>';

const SMALL_STAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.2c.9 6.2 4.6 9.9 10.8 10.8-6.2.9-9.9 4.6-10.8 10.8C11.1 16.6 7.4 12.9 1.2 12 7.4 11.1 11.1 7.4 12 1.2Z"/></svg>';

function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

class Asterism {
  private store: Store;
  private readonly sound = new Chimes();
  private readonly sky: SkyController;
  private readonly base: string;

  private mode: Mode = 'daily';
  private active!: Session;
  private daily: Session | null = null;
  private free: Session | null = null;

  private today = dateKey();
  private todayNumber = dailyNumber();

  private cellEls: HTMLButtonElement[] = [];
  private colPips: HTMLElement[] = [];
  private rowPips: HTMLElement[] = [];
  private regionAnchors = new Map<number, HTMLButtonElement>();

  private analysisConflicts = new Set<number>();
  private messageTimer = 0;
  private resizeFrame = 0;

  private pointerDown = false;
  private dragging = false;
  private dragSnapshot: Uint8Array | null = null;
  private dragChanged = false;
  private lastPainted = -1;
  private startX = 0;
  private startY = 0;
  private hovered = -1;

  private readonly el = {
    app: must<HTMLElement>('#app'),
    board: must<HTMLDivElement>('#board'),
    wrap: must<HTMLDivElement>('#board-wrap'),
    lines: must<SVGSVGElement>('#lines'),
    constellations: must<SVGSVGElement>('#constellations'),
    colPips: must<HTMLDivElement>('#col-pips'),
    rowPips: must<HTMLDivElement>('#row-pips'),
    timer: must<HTMLElement>('#timer'),
    starTotal: must<HTMLElement>('#star-total'),
    message: must<HTMLElement>('#message'),
    puzzleTitle: must<HTMLElement>('#puzzle-title'),
    puzzleSub: must<HTMLElement>('#puzzle-sub'),
    modeLabel: must<HTMLElement>('#mode-label'),
    topDate: must<HTMLElement>('#top-date'),
    topNumber: must<HTMLElement>('#top-number'),
    chart: must<HTMLElement>('#chart'),
    solvedPanel: must<HTMLElement>('#solved-panel'),
    solvedRating: must<HTMLElement>('#solved-rating'),
    solvedMeta: must<HTMLElement>('#solved-meta'),
    countdown: must<HTMLElement>('#countdown'),
    countdownValue: must<HTMLElement>('#countdown-value'),
    statStreak: must<HTMLElement>('#stat-streak'),
    statSolved: must<HTMLElement>('#stat-solved'),
    statBest: must<HTMLElement>('#stat-best'),
    soundToggle: must<HTMLButtonElement>('#sound-toggle'),
    toast: must<HTMLElement>('#toast'),
    help: must<HTMLDialogElement>('#help-dialog'),
    win: must<HTMLDialogElement>('#win-dialog'),
    winStars: must<HTMLElement>('#win-stars'),
    winMeta: must<HTMLElement>('#win-meta'),
    winNote: must<HTMLElement>('#win-note'),
    nextSky: must<HTMLButtonElement>('#next-sky'),
    stats: must<HTMLDialogElement>('#stats-dialog'),
    settings: must<HTMLDialogElement>('#settings-dialog'),
    statsSolved: must<HTMLElement>('#stats-solved'),
    statsStreak: must<HTMLElement>('#stats-streak'),
    statsBest: must<HTMLElement>('#stats-best'),
    statsStars: must<HTMLElement>('#stats-stars'),
    statsPlayed: must<HTMLElement>('#stats-played'),
    settingSound: must<HTMLButtonElement>('#setting-sound'),
    settingPatterns: must<HTMLButtonElement>('#setting-patterns'),
    settingMotion: must<HTMLButtonElement>('#setting-motion'),
    resetProgress: must<HTMLButtonElement>('#reset-progress'),
  };

  constructor() {
    this.store = loadStore();
    this.base = this.el.app.dataset.base ?? '/';
    this.sky = initSky(must<HTMLCanvasElement>('#sky'), this.store.settings.motion);
    this.sound.setEnabled(this.store.settings.sound);
    this.daily = this.restoreDaily();
    this.active = this.daily;
    this.applySettings();
    this.bindEvents();
    this.rebuild();
    this.updateStats();
    this.startTickers();
    this.maybeOnboard();
  }

  /* ---------------------------------------------------------------- */
  /* Sessions                                                         */
  /* ---------------------------------------------------------------- */

  private safeGenerate(seed: string): Puzzle {
    try {
      return generatePuzzle(seed);
    } catch {
      try {
        return generatePuzzle(`${seed}.open`, { allowNonUnique: true });
      } catch {
        return generatePuzzle('asterism.fallback.chart', { allowNonUnique: true });
      }
    }
  }

  private createSession(mode: Mode, seed: string, number: number): Session {
    const puzzle = this.safeGenerate(seed);
    return {
      mode,
      seed,
      number,
      puzzle,
      cells: new Uint8Array(puzzle.size * puzzle.size),
      history: [],
      future: [],
      hints: 0,
      checks: 0,
      elapsedBase: 0,
      runStart: null,
      solved: false,
      rating: 0,
    };
  }

  private restoreDaily(): Session {
    const saved = this.store.daily;
    const seed = dailySeed();
    const size = 8;

    if (
      saved &&
      saved.date === this.today &&
      saved.seed === seed &&
      saved.cells.length === size * size
    ) {
      const puzzle = this.safeGenerate(seed);
      const cells = Uint8Array.from(saved.cells.map((value) => Math.min(2, Math.max(0, value))));
      const solved = saved.solved && isSolved(puzzle, cells);
      return {
        mode: 'daily',
        seed,
        number: this.todayNumber,
        puzzle,
        cells,
        history: [],
        future: [],
        hints: Math.max(0, saved.hints),
        checks: Math.max(0, saved.checks),
        elapsedBase: Math.max(0, saved.elapsed),
        runStart: null,
        solved,
        rating: solved ? saved.rating || ratingFor(saved.hints, saved.checks) : 0,
      };
    }

    if (this.store.daily?.date !== this.today) {
      this.store = markDailyPlayed(this.store);
    }

    const session = this.createSession('daily', seed, this.todayNumber);
    this.persistDaily(session);
    return session;
  }

  private setMode(mode: Mode, fresh = false): void {
    if (mode === this.mode && !fresh) return;

    if (this.active) this.stopClock(this.active);
    if (this.mode === 'daily') this.persistDaily();

    if (mode === 'daily') {
      if (this.daily && this.daily.seed !== dailySeed()) this.daily = null;
      this.active = this.daily ?? this.restoreDaily();
      this.daily = this.active;
    } else {
      if (fresh || !this.free) {
        this.free = this.createSession('free', freeSeed(), 0);
      }
      this.active = this.free;
    }

    this.mode = mode;
    this.analysisConflicts.clear();
    this.clearMessage();
    this.rebuild();
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private rebuild(): void {
    const puzzle = this.active.puzzle;
    const size = puzzle.size;
    this.el.wrap.style.setProperty('--n', String(size));
    this.buildBoard();
    this.buildPips();
    this.buildLines();
    this.buildConstellations();
    this.updateMeta();
    this.render();
    this.updateSolvedPanel();
  }

  private buildBoard(): void {
    const puzzle = this.active.puzzle;
    const { size, regions } = puzzle;
    this.el.board.replaceChildren();
    this.cellEls = [];
    this.regionAnchors = new Map();

    let row: HTMLDivElement | null = null;
    for (let i = 0; i < size * size; i++) {
      const region = regions[i] ?? 0;
      const x = i % size;
      const y = (i / size) | 0;
      if (x === 0) {
        row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.className = 'board-row';
        row.setAttribute('aria-rowindex', String(y + 1));
        this.el.board.append(row);
      }
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.index = String(i);
      cell.dataset.region = String(region);
      cell.dataset.state = 'empty';
      cell.style.setProperty('--c', REGION_COLOURS[region % REGION_COLOURS.length] ?? '#5b7ab8');
      cell.style.setProperty('--i', String(i));
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', String(x + 1));
      cell.setAttribute('aria-rowindex', String(y + 1));
      cell.tabIndex = i === 0 ? 0 : -1;

      const isAnchor = !this.regionAnchors.has(region);
      cell.innerHTML =
        STAR_SVG +
        MARK_SVG +
        (isAnchor ? '<span class="tally" aria-hidden="true"><i></i><i></i></span>' : '');

      if (isAnchor) this.regionAnchors.set(region, cell);
      this.cellEls.push(cell);
      row?.append(cell);
    }
  }

  private buildPips(): void {
    const size = this.active.puzzle.size;
    this.el.colPips.replaceChildren();
    this.el.rowPips.replaceChildren();
    this.colPips = [];
    this.rowPips = [];

    for (let i = 0; i < size; i++) {
      const col = document.createElement('span');
      col.className = 'pip';
      col.innerHTML = '<i></i><i></i>';
      this.el.colPips.append(col);
      this.colPips.push(col);

      const row = document.createElement('span');
      row.className = 'pip';
      row.innerHTML = '<i></i><i></i>';
      this.el.rowPips.append(row);
      this.rowPips.push(row);
    }
  }

  private buildLines(): void {
    const puzzle = this.active.puzzle;
    const { size, regions } = puzzle;
    const parts: string[] = [];

    const differs = (x: number, y: number, index: number): boolean => {
      if (x < 0 || y < 0 || x >= size || y >= size) return true;
      return regions[y * size + x] !== regions[index];
    };

    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = (i / size) | 0;
      if (differs(x, y - 1, i)) parts.push(`M${x} ${y}H${x + 1}`);
      if (differs(x, y + 1, i)) parts.push(`M${x} ${y + 1}H${x + 1}`);
      if (differs(x - 1, y, i)) parts.push(`M${x} ${y}V${y + 1}`);
      if (differs(x + 1, y, i)) parts.push(`M${x + 1} ${y}V${y + 1}`);
    }

    this.el.lines.replaceChildren();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', parts.join(''));
    path.setAttribute('fill', 'none');
    this.el.lines.append(path);
  }

  private buildConstellations(): void {
    const { size, regions, solution } = this.active.puzzle;
    const byRegion = new Map<number, number[]>();
    for (let i = 0; i < size * size; i++) {
      if (solution[i] !== 1) continue;
      const region = regions[i] ?? 0;
      const list = byRegion.get(region) ?? [];
      list.push(i);
      byRegion.set(region, list);
    }

    this.el.constellations.replaceChildren();
    let delay = 0;
    for (const stars of byRegion.values()) {
      if (stars.length < 2) continue;
      const a = stars[0] as number;
      const b = stars[1] as number;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String((a % size) + 0.5));
      line.setAttribute('y1', String(((a / size) | 0) + 0.5));
      line.setAttribute('x2', String((b % size) + 0.5));
      line.setAttribute('y2', String(((b / size) | 0) + 0.5));
      line.style.animationDelay = `${delay}ms`;
      delay += 90;
      this.el.constellations.append(line);
    }
  }

  private updateMeta(): void {
    const session = this.active;
    const daily = session.mode === 'daily';
    this.el.topDate.textContent = formattedDate();
    this.el.topNumber.textContent = daily
      ? puzzleLabel(session.number)
      : `Sky ${skyCode(session.seed)}`;
    this.el.modeLabel.textContent = daily ? 'Daily chart' : 'Free sky';
    this.el.puzzleTitle.textContent = daily
      ? puzzleLabel(session.number)
      : `Sky ${skyCode(session.seed)}`;
    this.el.puzzleSub.textContent = daily
      ? `${formattedDate()} · 8 × 8 · two per line`
      : 'Free play · 8 × 8 · two per line';

    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === session.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  private render(): void {
    const session = this.active;
    const puzzle = session.puzzle;
    const { size, starsPerUnit, regions } = puzzle;
    const counts = unitCounts(puzzle, session.cells);
    const violations = new Set(
      findRuleViolations(regions, size, starsPerUnit, session.cells),
    );
    const conflicts = new Set<number>([...violations, ...this.analysisConflicts]);

    for (let i = 0; i < this.cellEls.length; i++) {
      const cell = this.cellEls[i] as HTMLButtonElement;
      const value = session.cells[i] ?? 0;
      const x = i % size;
      const y = (i / size) | 0;
      const region = (regions[i] ?? 0) + 1;
      const state = value === CELL_STAR ? 'star' : value === CELL_MARK ? 'mark' : 'empty';
      cell.dataset.state = state;
      cell.classList.toggle('is-conflict', conflicts.has(i));
      cell.classList.toggle('is-wrong', conflicts.has(i));
      cell.setAttribute(
        'aria-label',
        `Row ${y + 1}, column ${x + 1}, region ${region}: ${state}`,
      );
      cell.setAttribute('aria-disabled', String(session.solved));
    }

    for (let i = 0; i < this.colPips.length; i++) {
      const count = counts.cols[i] ?? 0;
      const pip = this.colPips[i] as HTMLElement;
      pip.classList.toggle('is-full', count === starsPerUnit);
      pip.classList.toggle('is-over', count > starsPerUnit);
    }
    for (let i = 0; i < this.rowPips.length; i++) {
      const count = counts.rows[i] ?? 0;
      const pip = this.rowPips[i] as HTMLElement;
      pip.classList.toggle('is-full', count === starsPerUnit);
      pip.classList.toggle('is-over', count > starsPerUnit);
    }

    for (const [region, anchor] of this.regionAnchors) {
      const tally = anchor.querySelector<HTMLElement>('.tally');
      if (!tally) continue;
      const count = counts.regions[region] ?? 0;
      tally.classList.toggle('is-over', count > starsPerUnit);
      const marks = tally.querySelectorAll<HTMLElement>('i');
      marks.forEach((mark, index) => {
        mark.classList.toggle('is-on', index < Math.min(count, starsPerUnit));
      });
    }

    const stars = [...session.cells].filter((value) => value === CELL_STAR).length;
    const total = size * starsPerUnit;
    this.el.starTotal.innerHTML = `${stars} <span>/ ${total} stars</span>`;
    this.el.timer.textContent = formatTime(this.elapsed(session));
    this.el.board.classList.toggle('is-solved', session.solved);
    this.el.wrap.classList.toggle('is-solved', session.solved);
    this.updateToolbar();
  }

  private updateToolbar(): void {
    const session = this.active;
    const undo = this.el.app.querySelector<HTMLButtonElement>('[data-action="undo"]');
    if (undo) undo.disabled = session.solved || session.history.length === 0;
    for (const action of ['check', 'hint', 'reset']) {
      const button = this.el.app.querySelector<HTMLButtonElement>(
        `[data-action="${action}"]`,
      );
      if (button) button.disabled = session.solved;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Clock                                                            */
  /* ---------------------------------------------------------------- */

  private elapsed(session: Session): number {
    const running = session.runStart === null ? 0 : (performance.now() - session.runStart) / 1000;
    return session.elapsedBase + running;
  }

  private startClock(session: Session): void {
    if (session.solved || session.runStart !== null) return;
    session.runStart = performance.now();
  }

  private stopClock(session: Session): void {
    if (session.runStart === null) return;
    session.elapsedBase += (performance.now() - session.runStart) / 1000;
    session.runStart = null;
  }

  private startTickers(): void {
    window.setInterval(() => {
      const session = this.active;
      if (!session) return;
      this.el.timer.textContent = formatTime(this.elapsed(session));
      if (session.solved) this.updateCountdown();
    }, 500);

    window.setInterval(() => {
      if (this.mode === 'daily' && !this.active.solved && this.active.runStart !== null) {
        this.persistDaily();
      }
      const key = dateKey();
      if (key !== this.today) {
        this.today = key;
        this.todayNumber = dailyNumber();
        if (this.mode === 'free') this.updateMeta();
        this.showMessage(
          this.mode === 'daily'
            ? 'A new daily chart is ready — reload to play it.'
            : 'A new daily chart is ready — switch to Daily chart.',
        );
      }
    }, 15_000);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopClock(this.active);
        this.persistDaily();
      }
    });
    window.addEventListener('pagehide', () => {
      this.stopClock(this.active);
      this.persistDaily();
    });
    window.addEventListener('resize', () => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => {
        const width = this.el.chart.clientWidth;
        this.el.chart.style.setProperty('--chart-width', `${width}px`);
      });
    });
  }

  private updateCountdown(): void {
    const ms = msUntilNextDaily();
    const text = formatCountdown(ms);
    this.el.countdownValue.textContent = text;
    if (this.el.win.open) {
      this.el.winNote.textContent =
        this.active.mode === 'daily'
          ? `Next chart in ${text}`
          : 'A fresh free sky is always waiting.';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Small UI helpers                                                 */
  /* ---------------------------------------------------------------- */

  private showMessage(text: string, error = false): void {
    window.clearTimeout(this.messageTimer);
    this.el.message.textContent = text;
    this.el.message.classList.add('is-visible');
    this.el.message.classList.toggle('is-error', error);
    this.messageTimer = window.setTimeout(() => {
      this.el.message.classList.remove('is-visible');
    }, 5200);
  }

  private clearMessage(): void {
    window.clearTimeout(this.messageTimer);
    this.el.message.classList.remove('is-visible', 'is-error');
  }

  private starMarkup(rating: number): string {
    return [0, 1, 2]
      .map((index) =>
        SMALL_STAR.replace('<svg ', `<svg class="${index < rating ? '' : 'is-dim'}" `),
      )
      .join('');
  }

  private assistsLabel(session: Session): string {
    const assists = session.hints + session.checks;
    if (assists === 0) return 'No assists';
    return `${assists} assist${assists === 1 ? '' : 's'} · ${session.hints} hint${session.hints === 1 ? '' : 's'}`;
  }

  private updateSolvedPanel(): void {
    const session = this.active;
    this.el.solvedPanel.hidden = !session.solved;
    this.el.countdown.hidden = !session.solved || session.mode === 'free';

    if (!session.solved) return;

    this.el.solvedRating.innerHTML = this.starMarkup(session.rating);
    this.el.solvedMeta.textContent = `${formatTime(this.elapsed(session))} · ${this.assistsLabel(session)}`;
    this.updateCountdown();
  }

  private updateStats(): void {
    const stats = this.store.stats;
    const streak = effectiveStreak(stats);
    this.el.statStreak.textContent = String(streak);
    this.el.statSolved.textContent = String(stats.solved);
    this.el.statBest.textContent = stats.best === null ? '—' : formatTime(stats.best);

    this.el.statsSolved.textContent = String(stats.solved);
    this.el.statsStreak.textContent = `${streak} day${streak === 1 ? '' : 's'}`;
    this.el.statsBest.textContent = stats.best === null ? '—' : formatTime(stats.best);
    this.el.statsStars.textContent = `${stats.totalStars} / ${stats.solved * 3}`;
    this.el.statsPlayed.textContent = String(stats.played);
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                      */
  /* ---------------------------------------------------------------- */

  private persistDaily(session: Session | null = this.daily): void {
    if (!session || session.mode !== 'daily') return;
    this.store.daily = {
      date: this.today,
      seed: session.seed,
      cells: [...session.cells],
      elapsed: Math.round(this.elapsed(session)),
      hints: session.hints,
      checks: session.checks,
      solved: session.solved,
      rating: session.rating,
    };
    saveStore(this.store);
  }

  /* ---------------------------------------------------------------- */
  /* Moves                                                            */
  /* ---------------------------------------------------------------- */

  private pushHistory(session: Session): void {
    session.history.push(Uint8Array.from(session.cells));
    if (session.history.length > 200) session.history.shift();
    session.future.length = 0;
  }

  private pulseCell(index: number): void {
    const cell = this.cellEls[index];
    if (!cell) return;
    cell.classList.remove('is-new');
    void cell.offsetWidth;
    cell.classList.add('is-new');
    window.setTimeout(() => cell.classList.remove('is-new'), 620);
  }

  private afterChange(): void {
    this.analysisConflicts.clear();
    this.render();
    this.persistDaily();
    if (isSolved(this.active.puzzle, this.active.cells)) this.complete();
  }

  private cycleCell(index: number): void {
    const session = this.active;
    if (session.solved) return;
    this.startClock(session);
    this.pushHistory(session);
    const current = session.cells[index] ?? 0;
    const next = nextCellState(current);
    session.cells[index] = next;
    if (next === CELL_STAR) this.sound.star(index % session.puzzle.size);
    else if (next === CELL_MARK) this.sound.mark();
    else this.sound.clear();
    if (next === CELL_STAR) this.pulseCell(index);
    this.afterChange();
  }

  private setCell(index: number, value: number): void {
    const session = this.active;
    if (session.solved) return;
    this.startClock(session);
    this.pushHistory(session);
    session.cells[index] = value;
    if (value === CELL_STAR) this.sound.star(index % session.puzzle.size);
    else if (value === CELL_MARK) this.sound.mark();
    else this.sound.clear();
    if (value === CELL_STAR) this.pulseCell(index);
    this.afterChange();
  }

  private paintMark(index: number): void {
    const session = this.active;
    if (session.solved) return;
    if ((session.cells[index] ?? 0) !== 0) return;
    if (!this.dragChanged) {
      session.history.push(this.dragSnapshot ?? Uint8Array.from(session.cells));
      session.future.length = 0;
      this.dragChanged = true;
    }
    session.cells[index] = CELL_MARK;
    this.analysisConflicts.clear();
    this.render();
  }

  private undo(): void {
    const session = this.active;
    if (session.solved) return;
    const previous = session.history.pop();
    if (!previous) return;
    session.future.push(Uint8Array.from(session.cells));
    session.cells = previous;
    this.analysisConflicts.clear();
    this.sound.undo();
    this.render();
    this.persistDaily();
    this.showMessage('Undone.');
  }

  private redo(): void {
    const session = this.active;
    if (session.solved) return;
    const next = session.future.pop();
    if (!next) return;
    session.history.push(Uint8Array.from(session.cells));
    session.cells = next;
    this.analysisConflicts.clear();
    this.sound.mark();
    this.render();
    this.persistDaily();
  }

  private check(): void {
    const session = this.active;
    if (session.solved) return;
    this.startClock(session);

    if (session.hints + session.checks > 400) return;
    const result = analyze(session.puzzle, session.cells);
    if (result.ok) {
      this.sound.mark();
      this.showMessage('No contradictions so far. Keep going.');
      return;
    }

    session.checks++;
    this.analysisConflicts = new Set(result.conflicts);
    this.sound.error();
    this.render();
    this.persistDaily();
    this.showMessage('A highlighted mark cannot be part of the solution.', true);
  }

  private hint(): void {
    const session = this.active;
    if (session.solved) return;
    this.startClock(session);

    const result = computeHint(session.puzzle, session.cells);
    if (result.kind === 'conflict') {
      this.analysisConflicts = new Set(result.cells);
      this.sound.error();
      this.render();
      this.showMessage('Your marks contradict each other. Try Check.', true);
      return;
    }
    if (result.kind === 'complete') {
      if (isSolved(session.puzzle, session.cells)) this.complete();
      return;
    }

    this.pushHistory(session);
    session.cells[result.cell] = CELL_STAR;
    session.hints++;
    this.analysisConflicts.clear();
    this.sound.hint();
    this.pulseCell(result.cell);
    this.render();
    this.persistDaily();
    this.showMessage(
      result.certain
        ? 'A star that must be here.'
        : 'One star that fits every remaining possibility.',
    );
    if (isSolved(session.puzzle, session.cells)) this.complete();
  }

  private resetBoard(): void {
    const session = this.active;
    if (session.solved) return;
    this.pushHistory(session);
    session.cells.fill(0);
    this.analysisConflicts.clear();
    this.render();
    this.persistDaily();
    this.showMessage('Chart cleared — Undo restores it.');
  }

  private complete(): void {
    const session = this.active;
    if (session.solved) return;

    session.solved = true;
    this.stopClock(session);
    session.rating = ratingFor(session.hints, session.checks);

    this.store = recordSolve(this.store, {
      mode: session.mode,
      rating: session.rating,
      elapsed: this.elapsed(session),
    });
    if (session.mode === 'daily') this.persistDaily(session);
    else saveStore(this.store);

    this.analysisConflicts.clear();
    this.render();
    this.updateSolvedPanel();
    this.updateStats();
    this.sound.win();

    window.setTimeout(() => {
      if (this.active === session && !this.el.win.open) this.openWin();
    }, 900);
  }

  private openWin(): void {
    const session = this.active;
    this.el.winStars.innerHTML = this.starMarkup(session.rating);
    this.el.winMeta.textContent = `${formatTime(this.elapsed(session))} · ${this.assistsLabel(session)}`;
    this.el.winNote.textContent =
      session.mode === 'daily'
        ? `Next chart in ${formatCountdown(msUntilNextDaily())}`
        : 'A fresh free sky is always waiting.';
    this.el.nextSky.textContent =
      session.mode === 'daily' ? 'Play a free sky' : 'Draw another sky';
    if (!this.el.win.open) this.el.win.showModal();
  }

  private share(): void {
    const session = this.active;
    if (!session.solved) {
      this.showMessage('Finish the chart first — then share it.');
      return;
    }
    const path = this.base.endsWith('/') ? this.base : `${this.base}/`;
    const url = new URL(path, window.location.origin).href;
    const text = buildShareText({
      mode: session.mode,
      number: session.number,
      seed: session.seed,
      rating: session.rating,
      elapsed: this.elapsed(session),
      hints: session.hints,
      checks: session.checks,
      url,
    });
    void this.deliverShare(text, url);
  }

  private async deliverShare(text: string, url: string): Promise<void> {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Asterism', text });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      this.showMessage('Result copied to your clipboard.');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      this.showMessage(ok ? 'Result copied to your clipboard.' : text);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Settings                                                         */
  /* ---------------------------------------------------------------- */

  private applySettings(): void {
    const settings = this.store.settings;
    this.sound.setEnabled(settings.sound);
    this.sky.setMotion(settings.motion);
    document.documentElement.classList.toggle('reduce-motion', !settings.motion);
    this.el.board.classList.toggle('patterns', settings.patterns);

    this.el.soundToggle.setAttribute('aria-pressed', String(settings.sound));
    this.el.soundToggle.setAttribute(
      'aria-label',
      settings.sound ? 'Mute sound' : 'Enable sound',
    );
    this.el.settingSound.setAttribute('aria-checked', String(settings.sound));
    this.el.settingPatterns.setAttribute('aria-checked', String(settings.patterns));
    this.el.settingMotion.setAttribute('aria-checked', String(settings.motion));
  }

  private updateSetting(key: 'sound' | 'patterns' | 'motion', value: boolean): void {
    this.store.settings = { ...this.store.settings, [key]: value };
    saveStore(this.store);
    this.applySettings();
    if (key === 'sound' && value) this.sound.hint();
    if (key === 'motion') this.sky.refresh();
  }

  private toggleSound(): void {
    this.updateSetting('sound', !this.store.settings.sound);
  }

  private maybeOnboard(): void {
    if (this.store.onboarded) return;
    window.setTimeout(() => {
      if (!this.el.help.open) this.el.help.showModal();
    }, 900);
  }

  private openStats(): void {
    this.updateStats();
    if (!this.el.stats.open) this.el.stats.showModal();
  }

  /* ---------------------------------------------------------------- */
  /* Board interaction                                                */
  /* ---------------------------------------------------------------- */

  private cellAt(event: Event): HTMLButtonElement | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLButtonElement>('.cell');
  }

  private highlight(index: number): void {
    if (this.hovered === index) return;
    this.hovered = index;
    const puzzle = this.active.puzzle;
    const size = puzzle.size;
    const region = puzzle.regions[index] ?? 0;
    const x = index % size;
    const y = (index / size) | 0;

    for (let i = 0; i < this.cellEls.length; i++) {
      const cell = this.cellEls[i] as HTMLButtonElement;
      const cx = i % size;
      const cy = (i / size) | 0;
      const peer =
        i !== index &&
        (cy === y || cx === x || (puzzle.regions[i] ?? 0) === region);
      cell.classList.toggle('is-active', i === index);
      cell.classList.toggle('is-peer', peer);
    }
  }

  private clearHighlight(): void {
    if (this.hovered === -1) return;
    this.hovered = -1;
    for (const cell of this.cellEls) {
      cell.classList.remove('is-active', 'is-peer');
    }
  }

  private focusCell(index: number, scroll = false): void {
    const cell = this.cellEls[index];
    if (!cell) return;
    for (const other of this.cellEls) other.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus({ preventScroll: !scroll });
    if (scroll) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private bindBoard(): void {
    const board = this.el.board;

    board.addEventListener('pointerdown', (event) => {
      const cell = this.cellAt(event);
      if (!cell || event.button !== 0) return;
      if (this.active.solved) return;

      const index = Number(cell.dataset.index);
      this.startClock(this.active);
      this.pointerDown = true;
      this.dragging = false;
      this.dragChanged = false;
      this.lastPainted = index;
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.dragSnapshot = Uint8Array.from(this.active.cells);
      try {
        board.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a nicety, not a requirement.
      }
    });

    board.addEventListener('pointermove', (event) => {
      if (!this.pointerDown) return;
      const distance = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
      if (!this.dragging && distance < 8) return;
      this.dragging = true;

      const element = document.elementFromPoint(event.clientX, event.clientY);
      const cell = element?.closest<HTMLButtonElement>('.cell') ?? null;
      if (!cell) return;
      const index = Number(cell.dataset.index);
      if (index === this.lastPainted) return;
      this.lastPainted = index;
      this.paintMark(index);
    });

    const endDrag = (): void => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (this.dragging) {
        this.suppressClickUntil = performance.now() + 350;
        if (this.dragChanged) {
          this.persistDaily();
          this.showMessage('Crosses pencilled in. Tap for a star.');
        }
      }
      this.dragging = false;
      this.dragSnapshot = null;
      this.dragChanged = false;
    };

    board.addEventListener('pointerup', endDrag);
    board.addEventListener('pointercancel', endDrag);

    board.addEventListener('click', (event) => {
      if (performance.now() < this.suppressClickUntil) return;
      const cell = this.cellAt(event);
      if (!cell) return;
      const index = Number(cell.dataset.index);
      this.focusCell(index);
      this.cycleCell(index);
    });

    board.addEventListener('contextmenu', (event) => {
      const cell = this.cellAt(event);
      if (!cell) return;
      event.preventDefault();
      if (this.active.solved) return;
      const index = Number(cell.dataset.index);
      if ((this.active.cells[index] ?? 0) !== 0) {
        this.setCell(index, 0);
      }
    });

    board.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'mouse' || this.pointerDown) return;
      const cell = this.cellAt(event);
      if (!cell) return;
      this.highlight(Number(cell.dataset.index));
    });

    board.addEventListener('pointerleave', () => this.clearHighlight());

    board.addEventListener('focusin', (event) => {
      const cell = this.cellAt(event);
      if (!cell) return;
      for (const other of this.cellEls) other.tabIndex = -1;
      cell.tabIndex = 0;
    });

    board.addEventListener('keydown', (event) => {
      const cell = this.cellAt(event);
      if (!cell) return;
      const size = this.active.puzzle.size;
      const index = Number(cell.dataset.index);
      const x = index % size;
      const y = (index / size) | 0;
      const key = event.key;
      let next = index;
      let handled = true;

      if (key === 'ArrowRight' || key === 'd') next = y * size + ((x + 1) % size);
      else if (key === 'ArrowLeft' || key === 'a') next = y * size + ((x - 1 + size) % size);
      else if (key === 'ArrowDown' || key === 's') next = ((y + 1) % size) * size + x;
      else if (key === 'ArrowUp' || key === 'w') next = ((y - 1 + size) % size) * size + x;
      else if (key === 'Home') next = y * size;
      else if (key === 'End') next = y * size + size - 1;
      else if (key === ' ' || key === 'Enter') this.cycleCell(index);
      else if (key === '1') this.setCell(index, CELL_STAR);
      else if (key === '2') this.setCell(index, CELL_MARK);
      else if (key === '0' || key === 'Backspace' || key === 'Delete') this.setCell(index, 0);
      else if (key === 'z' || key === 'Z') {
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if (key === 'h' || key === 'H') this.hint();
      else if (key === 'r' || key === 'R') this.resetBoard();
      else handled = false;

      if (!handled) return;
      event.preventDefault();
      if (next !== index) this.focusCell(next, true);
    });
  }

  private suppressClickUntil = 0;

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */

  private bindEvents(): void {
    this.bindBoard();

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const close = target.closest<HTMLElement>('[data-close]');
      if (close) {
        close.closest('dialog')?.close();
        return;
      }

      const modeButton = target.closest<HTMLElement>('[data-mode]');
      if (modeButton) {
        const mode = modeButton.dataset.mode;
        if (mode === 'daily' || mode === 'free') this.setMode(mode);
        return;
      }

      const actionButton = target.closest<HTMLElement>('[data-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.action;
      switch (action) {
        case 'undo':
          this.undo();
          break;
        case 'check':
          this.check();
          break;
        case 'hint':
          this.hint();
          break;
        case 'reset':
          this.resetBoard();
          break;
        case 'share':
          this.share();
          break;
        case 'next-sky':
          this.el.win.close();
          this.setMode('free', true);
          break;
        default:
          break;
      }
    });

    this.el.soundToggle.addEventListener('click', () => this.toggleSound());

    must<HTMLButtonElement>('#open-help').addEventListener('click', () => {
      if (!this.el.help.open) this.el.help.showModal();
    });
    must<HTMLButtonElement>('#open-settings').addEventListener('click', () => {
      if (!this.el.settings.open) this.el.settings.showModal();
    });
    for (const id of ['#open-stats', '#open-stats-2', '#open-stats-3']) {
      must<HTMLButtonElement>(id).addEventListener('click', () => this.openStats());
    }

    this.el.settingSound.addEventListener('click', () => {
      this.updateSetting('sound', !this.store.settings.sound);
    });
    this.el.settingPatterns.addEventListener('click', () => {
      this.updateSetting('patterns', !this.store.settings.patterns);
    });
    this.el.settingMotion.addEventListener('click', () => {
      this.updateSetting('motion', !this.store.settings.motion);
    });

    let resetArmed = false;
    let resetTimer = 0;
    this.el.resetProgress.addEventListener('click', () => {
      if (!resetArmed) {
        resetArmed = true;
        this.el.resetProgress.textContent = 'Confirm reset';
        this.el.resetProgress.classList.add('is-armed');
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          resetArmed = false;
          this.el.resetProgress.textContent = 'Reset';
          this.el.resetProgress.classList.remove('is-armed');
        }, 4000);
        return;
      }
      this.store = clearProgress();
      saveStore(this.store);
      window.location.reload();
    });

    for (const dialog of [this.el.help, this.el.win, this.el.stats, this.el.settings]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    this.el.help.addEventListener('close', () => {
      if (!this.store.onboarded) {
        this.store.onboarded = true;
        saveStore(this.store);
      }
    });

    this.el.win.addEventListener('close', () => {
      this.updateCountdown();
    });

    // A tap anywhere starts the clock, including the toolbar.
    this.el.app.addEventListener(
      'pointerdown',
      () => {
        if (!this.active.solved) this.startClock(this.active);
      },
      { passive: true },
    );
  }
}

let booted = false;

export function initGame(): void {
  if (booted) return;
  booted = true;
  new Asterism();
}






