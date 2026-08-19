// Boots the game, loads the reference vehicle and launches far enough to make
// the engines light, purely to confirm every shader compiles. Seconds, not the
// fifteen minutes a full visual pass costs.
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  server: { port: 5211, host: '127.0.0.1', hmr: false, watch: null },
  logLevel: 'error',
});
await server.listen();
const url = server.resolvedUrls?.local?.[0];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox',
         '--disable-dev-shm-usage', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

page.on('requestfailed', (r) => errors.push(`requestfailed ${r.url()}`));

await page.goto(url, { waitUntil: 'networkidle' });
// If the app fails to boot, the selector wait below just times out with no clue
// why — so surface whatever the page reported first.
await page.waitForTimeout(3000);
if (errors.length) {
  console.log('--- errors during boot ---');
  for (const e of errors) console.log('  -', e.slice(0, 600));
}
// Wait on the DOM rather than a fixed delay: the title screen builds a 3D
// scene now, and under a software renderer that takes a while to appear.
await page.waitForSelector('.mission-card', { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelectorAll('.mission-card')[2]
  .dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForSelector('#build-actions button', { timeout: 60_000 });
await page.waitForTimeout(2000);
await page.evaluate(() => [...document.querySelectorAll('#build-actions button')]
  .find((b) => b.textContent.includes('Load reference'))?.click());
await page.waitForTimeout(3000);
await page.evaluate(() => [...document.querySelectorAll('#build-actions button')]
  .find((b) => b.textContent.includes('System check'))?.click());
await page.waitForTimeout(800);
await page.evaluate(() => [...document.querySelectorAll('#check-footer button')]
  .find((b) => b.textContent.includes('Proceed'))?.click());

// Wait for the engines to actually be burning, which is what forces the plume
// material to compile.
const deadline = Date.now() + 240_000;
let lit = false;
while (Date.now() < deadline) {
  const phase = await page.evaluate(
    () => document.querySelector('#mission-state .phase')?.textContent ?? '');
  // ASCENT specifically, not IGNITION: at the instant the count reaches zero
  // the flame has not built yet and the engine section is still down among the
  // hold-downs, so the frame proves nothing about whether the plume renders.
  if (/ASCENT/.test(phase)) { lit = true; break; }
  await page.waitForTimeout(500);
}
// Let it climb clear of the pad so the jet is against open sky.
await page.waitForTimeout(9000);

// One frame of the burning engine, so a shader that compiles but renders
// nothing is still caught by eye.
const shotPath = process.argv[2] ?? '/tmp/orbital-shader-check.png';
await page.screenshot({ path: shotPath });
console.log(`wrote ${shotPath}`);
console.log(`engines lit: ${lit}`);
const shader = errors.filter((e) => /Shader Error|not compiled/i.test(e));
console.log(`console errors: ${errors.length}  (shader: ${shader.length})`);
for (const e of errors.slice(0, 5)) console.log('  -', e.slice(0, 400));

await browser.close();
await server.close();
process.exit(shader.length > 0 || !lit ? 1 : 0);
