// Bundles the engine into dist/engine.mjs (no TypeScript or tsx at runtime) and copies the UI to dist/ui.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'engine', 'main.ts')],
  outfile: join(dist, 'engine.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  // CommonJS dependencies that call require() / use __dirname inside an ESM bundle need these shims.
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __fu(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join('\n'),
  },
});
cpSync(join(root, 'ui'), join(dist, 'ui'), { recursive: true });
console.log('bundled engine and UI into dist/');
