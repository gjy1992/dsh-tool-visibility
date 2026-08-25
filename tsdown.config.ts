import { defineConfig } from 'tsdown';

/**
 * Bundle the browser half (`src/client.js`) into `lib/client.js`, the artifact
 * the web `dsh.client` table loads. The host half (`src/index.js`) is plain
 * ESM shipped as-is — no build step needed.
 */
export default defineConfig({
  entry: ['src/client.js'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'lib',
  dts: false,
  clean: true,
});
