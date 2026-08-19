// Boots a built copy of the game the way someone will actually reach it and
// asserts it comes up clean.
//
// Takes either a path to the packed single file, or an http(s) URL — a deployed
// site, or a local static server standing in for one. Both matter: a bundle
// that works under Vite can still fail over file:// (module CSP) or over a
// plain static host (asset paths, MIME types), and those are different
// failures. This checks rather than assumes.
//
// Usage: node tools/file-check.mjs <file-or-url> [screenshot.png]
import { chromium } from 'playwright';
const target = process.argv[2];
if (!target) throw new Error('usage: file-check.mjs <file-or-url> [screenshot.png]');
const url = /^https?:\/\//.test(target) ? target : `file://${target}`;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
         '--enable-webgl','--ignore-gpu-blocklist','--no-sandbox',
         '--disable-dev-shm-usage','--mute-audio','--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForSelector('.mission-card', { timeout: 60_000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: process.argv[3] ?? '/tmp/file-check.png' });
const cards = await page.evaluate(() => document.querySelectorAll('.mission-card').length);
console.log(`booted ${url}\n  mission cards: ${cards}  console errors: ${errors.length}`);
for (const e of errors.slice(0, 4)) console.log('  -', e.slice(0, 300));
await browser.close();
process.exit(errors.length || cards !== 3 ? 1 : 0);
