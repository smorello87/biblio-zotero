import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/vendor', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('styles.css', 'dist/styles.css');
await cp('assets', 'dist/assets', { recursive: true });
await cp('node_modules/pdfjs-dist/build/pdf.mjs', 'dist/vendor/pdf.mjs');
await cp('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'dist/vendor/pdf.worker.mjs');
await build({ entryPoints: ['app.js'], bundle: true, format: 'esm', platform: 'browser', outfile: 'dist/app.js', sourcemap: true, target: ['es2022'], minify: false });
