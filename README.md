# Asterism

A calm daily logic puzzle in the Star Battle tradition, built with Astro.

**Play:** https://shubhamtatvamasi.com/asterism/

Eight rows, eight columns, eight shaded constellations. Place **two stars in every row, column and region** without letting any two stars touch — not even diagonally. Every chart is generated backwards from a finished sky and verified to have exactly one solution, so it never requires guessing.

## Features

- **Daily chart** — one deterministic 8 × 8 puzzle per UTC day, numbered from No. 001.
- **Free sky** — endless randomly seeded charts.
- **Assists** — Check finds contradictions; Hint places a solver-verified star. A hint or a flagged mistake lowers the end-of-game star rating, never the streak.
- **Persistence** — daily progress, stats, streaks, settings and onboarding stay in `localStorage`. No account, no network calls, no tracking.
- **Input** — tap to cycle star → cross → empty, drag to pencil crosses (including the cell where the drag starts), right-click to erase. Full keyboard support: arrows, `Space`, `1`/`2`/`0`, `Z`, `Shift+Z`, `H`, `R`.
- **Reset and new skies** — **Reset** clears the current chart, undoable with **Undo**. Free-sky mode also has a **New sky** button.
- **Craft** — canvas starfield, region colours assigned per chart so neighbouring constellations stay perceptually distinct, constellation lines on completion, WebAudio chimes, reduced-motion and pattern toggles.
- **Share** — a share dialog with native Web Share where supported, a clipboard fallback, and a readable result. Free skies carry their seed in the link (`?sky=<code>`), so a shared link rebuilds the exact same chart.

## Stack

- [Astro](https://astro.build) 7, static output
- TypeScript, no UI framework
- Vitest for the puzzle engine
- Vanilla DOM controller and CSS

## Local development

Requires Node 22.23.4 or newer.

```bash
npm install
npm run dev       # http://localhost:4321/asterism/
npm test          # engine tests
npm run check     # Astro + TypeScript diagnostics
npm run build     # type-check and produce dist/
npm run preview   # preview the production build
```

The dev server serves the site under `/asterism/` because that is the configured base path. Run with an empty `BASE_PATH` to serve from `/`:

```bash
BASE_PATH=/ npm run dev
```

## Static hosting, storage and sharing

There is no backend, but that does not make the game read-only:

- **Progress** is stored client-side in `localStorage` under `asterism.v1`, scoped to this origin. It survives reloads and browser restarts unless the browser clears site data.
- **Sharing** does not need storage. A solved result is built into text on demand; `navigator.share()` opens the native share sheet on supported mobile devices, and `navigator.clipboard.writeText()` copies the same text elsewhere. The share dialog is the final fallback, so every browser gets a working action.
- **Free-sky links** carry the deterministic seed in `?sky=<code>`. Opening the link rebuilds the puzzle without a server or a database. Daily charts are already deterministic from the UTC date.
- **Reset** is client-side too: the toolbar Reset clears the board (Undo restores it), and Settings → Reset progress clears the local record.

These are the same patterns used by static browser games: put personal state in browser storage, put shareable state in the URL, and use browser APIs for the share step. See MDN's Web Share API, Clipboard API and Web Storage documentation for the platform constraints (HTTPS/secure context, user activation, per-origin storage).

## Deployment

Deployment is handled by `.github/workflows/deploy.yml`:

1. Install dependencies with `npm ci`.
2. Run the puzzle-engine tests.
3. Build with `BASE_PATH=/asterism`.
4. Upload `dist/` and deploy it with GitHub Pages.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The workflow runs on every push to `main` and can also be started manually with **Run workflow**.

`astro.config.mjs` sets:

```js
site: 'https://shubhamtatvamasi.com'
base: process.env.BASE_PATH ?? '/asterism'
```

Change `BASE_PATH` in the workflow if the game moves to a different path or to the domain root.

## How the puzzles are made

`src/lib/generator.ts` works in three stages:

1. Generate a valid non-touching layout of 16 stars on an 8 × 8 grid (two per row and column).
2. Group the stars into eight regions, then grow each region into a connected block around its two stars.
3. Count solutions with the constraint solver in `src/lib/solver.ts`. Keep the chart only when exactly one solution exists; otherwise reseed deterministically.

The daily seed is `asterism.v1.YYYY-MM-DD`, so every client draws the same chart for a given UTC date. Free-sky seeds are random hex strings.

## Project layout

```text
src/
  components/Game.astro   game markup and dialogs
  layouts/Base.astro      document shell, fonts, meta tags
  lib/
    rng.ts                deterministic PRNG and short codes
    generator.ts          seeded puzzle generation
    solver.ts             constraint solver, solution counting, rule checks
    game.ts               hints, analysis, daily schedule, sharing
    storage.ts            localStorage schema and stats
  scripts/
    main.ts               DOM controller, clock, input, persistence
    audio.ts              WebAudio chimes
    sky.ts                canvas starfield
  styles/global.css       full visual system
tests/puzzle.test.ts      engine and solver tests
public/                   icons, manifest, OG image, robots.txt
scripts/                  source HTML for the OG image and app icon
```

## Assets

`public/og.png` and `public/apple-touch-icon.png` were rendered from the HTML sources in `scripts/` with headless Chrome. Re-render them after changing the brand if needed:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot=public/og.png "file://$PWD/scripts/og.html"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=180,180 \
  --screenshot=public/apple-touch-icon.png "file://$PWD/scripts/icon.html"
```

## License

The source is private to the repository owner. The game is free to play.
