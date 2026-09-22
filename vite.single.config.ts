/**
 * Single-file build. Produces one self-contained .html with the JS, CSS and
 * sprite sheets inlined, so the whole game can be shared or opened from disk
 * with no server and no sibling assets.
 *
 *   npm run build:single
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';

export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: 'dist-single',
      // Fold every asset into the bundle as a data URI. The sprite sheets are
      // ~12 kB total, so this costs almost nothing.
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      sourcemap: false,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          // The atlas is loaded with a dynamic import; a single file cannot
          // fetch a sibling chunk, so it has to be folded in.
          inlineDynamicImports: true,
        },
      },
    },
  }),
);
