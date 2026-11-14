// Builds the open edition into dist-open/: a static site with no backend, where people bring their
// own OpenRouter key. Same page code as the CAIL build, with open/edition.js bundled in place of
// edition.js and open/index.html as the page.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const openEdition = fileURLToPath(new URL('../open/edition.js', import.meta.url));
const swapEdition = {
  name: 'open-edition',
  setup(builder) { builder.onResolve({ filter: /^\.\/edition\.js$/ }, args => args.importer.endsWith('/browser.js') ? { path: openEdition } : undefined); },
};

await rm('dist-open', { recursive: true, force: true });
await mkdir('dist-open/vendor', { recursive: true });
await cp('open/index.html', 'dist-open/index.html');
await cp('open/styles.css', 'dist-open/styles.css');
await cp('LICENSE', 'dist-open/LICENSE.txt');
await cp('node_modules/pdfjs-dist/build/pdf.mjs', 'dist-open/vendor/pdf.mjs');
await cp('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'dist-open/vendor/pdf.worker.mjs');
const result = await build({ entryPoints: ['app.js'], bundle: true, format: 'esm', platform: 'browser', outfile: 'dist-open/app.js', sourcemap: true, target: ['es2022'], minify: false, plugins: [swapEdition], metafile: true });
// The open bundle must not carry the CAIL client, identity code or Worker.
const bundled = Object.keys(result.metafile.inputs);
const leaked = bundled.filter(path => /(^|\/)(api\.js|edition\.js|server\/worker\.js)$|@cuny-ai-lab/.test(path) && !path.startsWith('open/'));
if (leaked.length) throw new Error(`Open build includes CAIL-only modules: ${leaked.join(', ')}`);
if (!bundled.includes('open/edition.js')) throw new Error('Open build did not use open/edition.js.');
