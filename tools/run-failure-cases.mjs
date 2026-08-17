/** Runs the failure-case suite and prints the verdicts. */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5196, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:5196/tools/failure-cases.html', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.waitForFunction(() => window.failureDone === true, { timeout: 300_000 });
const results = await page.evaluate(() => window.failureResults);

for (const r of results) {
  console.log(`\n=== ${r.name} ===`);
  console.log(`  expect: ${r.expectation}`);
  console.log(`  TWR ${r.twr}  mass ${r.totalMassT} t  static margin ${r.staticMargin} m`);
  console.log(`  pre-flight launchable: ${r.launchable}`);
  if (r.warnings.length) console.log(`  warnings: ${r.warnings.join(' | ')}`);
  console.log(`  peak altitude ${(r.peakAlt / 1000).toFixed(1)} km  periapsis ${(r.periapsis / 1000).toFixed(0)} km`);
  console.log(`  RESULT: ${r.finalState}${r.failure ? ` — ${r.failure}` : ''}`);
}
if (errors.length) {
  console.log(`\nerrors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log('  -', e.slice(0, 300));
}
await browser.close();
await server.close();
