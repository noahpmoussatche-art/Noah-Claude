/**
 * Packs the production build into one self-contained .html file.
 *
 * Useful for handing someone a playable copy: no server, no `npm install`, no
 * asset paths to get wrong — open the file and the game runs. It is also what
 * lets the game be published as an Artifact, where a strict CSP blocks requests
 * to any external host, so every byte has to be inline.
 *
 * Usage: npm run build && node tools/bundle-single-file.mjs [outFile]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const DIST = new URL('../dist/', import.meta.url);
const out = process.argv[2] ?? 'orbital-engineering.html';

const html = await readFile(new URL('index.html', DIST), 'utf8');
const assets = await readdir(new URL('assets/', DIST));

const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js) throw new Error('no bundled script found in dist/assets');

const jsSource = await readFile(new URL(`assets/${js}`, DIST), 'utf8');
const cssSource = css ? await readFile(new URL(`assets/${css}`, DIST), 'utf8') : '';

let packed = html
  // The bundle is an ES module and must stay one: it uses top-level imports of
  // its own chunks only, but `type="module"` also gives it deferred execution,
  // which the app relies on for #viewport to exist.
  .replace(
    /<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/,
    () => `<script type="module">\n${jsSource}\n</script>`,
  )
  .replace(
    /<link rel="stylesheet"[^>]*href="[^"]*"[^>]*>/,
    () => `<style>\n${cssSource}\n</style>`,
  );

// Nothing may be left pointing at a sibling file.
const leftover = packed.match(/(?:src|href)="\.?\/assets\/[^"]*"/g);
if (leftover) throw new Error(`unpacked asset references remain: ${leftover.join(', ')}`);

await writeFile(out, packed);
const kb = (Buffer.byteLength(packed) / 1024).toFixed(0);
console.log(`wrote ${out} (${kb} kB, self-contained)`);
