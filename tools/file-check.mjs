// Opens the packed single file the way the user will: straight off disk, no
// server. A bundle that works under Vite can still fail here (module CSP,
// asset paths), so this has to be checked, not assumed.
import { chromium } from 'playwright';
const file = process.argv[2];
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
await page.goto(`file://${file}`);
await page.waitForSelector('.mission-card', { timeout: 60_000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: process.argv[3] ?? '/tmp/file-check.png' });
const cards = await page.evaluate(() => document.querySelectorAll('.mission-card').length);
console.log(`booted from file://  mission cards: ${cards}  console errors: ${errors.length}`);
for (const e of errors.slice(0, 4)) console.log('  -', e.slice(0, 300));
await browser.close();
process.exit(errors.length || cards !== 3 ? 1 : 0);
