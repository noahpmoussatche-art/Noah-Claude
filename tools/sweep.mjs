/**
 * Sweeps the gravity-turn pitch exponent and reports which value gets the
 * reference vehicles to orbit with the most propellant left over. Balance
 * tuning by measurement rather than by guesswork.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const EXPONENTS = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

const server = await createServer({
  server: { port: 5197, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});

for (const exp of EXPONENTS) {
  const page = await browser.newPage();
  await page.addInitScript((e) => {
    globalThis.__osaTurnExponent = e;
  }, exp);

  await page.goto('http://127.0.0.1:5197/tools/sim-harness.html');
  try {
    await page.waitForFunction(() => window.harnessDone === true, { timeout: 180_000 });
  } catch {
    console.log(`exp ${exp}: TIMEOUT`);
    await page.close();
    continue;
  }

  const results = await page.evaluate(() => window.harnessResults);
  const line = results
    .map(
      (r) =>
        `${r.mission}: ${r.finalState === 'MISSION_COMPLETE' ? 'OK ' : r.finalState === 'ASCENT' ? 'STUCK' : 'FAIL'} ` +
        `${(r.periapsis / 1000).toFixed(0)}x${(r.apoapsis / 1000).toFixed(0)}km`,
    )
    .join('  |  ');
  console.log(`exp ${exp.toFixed(2)}  ${line}`);
  await page.close();
}

await browser.close();
await server.close();
