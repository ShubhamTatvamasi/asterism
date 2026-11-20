import { defineConfig } from 'astro/config';

// Deployed as a GitHub Pages project site at
// https://shubhamtatvamasi.com/asterism/
const base = process.env.BASE_PATH ?? '/asterism';

export default defineConfig({
  site: 'https://shubhamtatvamasi.com',
  base,
  trailingSlash: 'ignore',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    server: {
      fs: { strict: true },
    },
  },
});
