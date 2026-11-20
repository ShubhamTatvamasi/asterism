# Asterism

A calm daily logic puzzle in the Star Battle tradition, built with Astro.

**Play:** https://shubhamtatvamasi.com/astro-game/

Eight rows, eight columns, eight shaded constellations. Place **two stars in every row, column and region** without letting any two stars touch — not even diagonally. Every chart is generated backwards from a finished sky and verified to have exactly one solution, so it never requires guessing.

## Features

- **Daily chart** — one deterministic 8 × 8 puzzle per UTC day, numbered from No. 001.
- **Free sky** — endless randomly seeded charts.
- **Assists** — Check finds contradictions; Hint places a solver-verified star. Each assist lowers the end-of-game star rating, never the streak.
- **Persistence** — daily progress, stats, streaks, settings and onboarding stay in `localStorage`. No account, no network calls, no tracking.
- **Input** — tap to cycle star → cross → empty, drag to pencil crosses, right-click to erase. Full keyboard support: arrows, `Space`, `1`/`2`/`0`, `Z`, `Shift+Z`, `H`, `R`.
- **Craft** — canvas starfield, seeded region palette, constellation lines on completion, WebAudio chimes, reduced-motion and pattern toggles.
- **Share** — native share sheet where available, with a clipboard fallback.

## Stack

- [Astro](https://astro.build) 7, static output
- TypeScript, no UI framework
- Vitest for the puzzle engine
- Vanilla DOM controller and CSS

## Local development

Requires Node 22.23.4 or newer.

```bash
npm install
npm run dev       # http://localhost:4321/astro-game/
npm test          # engine tests
npm run check     # Astro + TypeScript diagnostics
npm run build     # type-check and produce dist/
npm run preview   # preview the production build
```

The dev server serves the site under `/astro-game/` because that is the configured base path. Run with an empty `BASE_PATH` to serve from `/`:

```bash
BASE_PATH=/ npm run dev
```

## Deployment

Deployment is handled by `.github/workflows/deploy.yml`:

1. Install dependencies with `npm ci`.
2. Run the puzzle-engine tests.
3. Build with `BASE_PATH=/astro-game`.
4. Upload `dist/` and deploy it with GitHub Pages.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The workflow runs on every push to `main` and can also be started manually with **Run workflow**.

`astro.config.mjs` sets:

```js
site: 'https://shubhamtatvamasi.com'
base: process.env.BASE_PATH ?? '/astro-game'
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
