/**
 * Runs the headless simulation harness in a browser and prints the report.
 * This is the fast balance loop — no rendering, no waiting for real-time flight.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  server: { port: 5198, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// The harness runs synchronously on module load, which can block the load
// event; wait for the DOM only and let waitForFunction do the real waiting.
await page.goto('http://127.0.0.1:5198/tools/sim-harness.html', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});

try {
  await page.waitForFunction(() => window.harnessDone === true, { timeout: 300_000 });
} catch {
  console.error('harness did not finish');
}

const results = await page.evaluate(() => window.harnessResults ?? null);

if (results) {
  for (const r of results) {
    console.log(`\n=== ${r.mission} ===`);
    console.log(
      `  parts ${r.parts}  height ${r.height} m  mass ${r.massT} t  TWR ${r.twr}`,
    );
    console.log(`  stage Δv ${JSON.stringify(r.stageDv)}  total ${r.totalDv} m/s`);
    if (r.deployables) console.log(`  deployables: ${r.deployables}`);
    console.log(`  launchable: ${r.launchable}`);
    if (r.warnings.length) console.log(`  warnings: ${r.warnings.join(' | ')}`);
    console.log(
      `  peak: Q ${(r.peakQ / 1000).toFixed(1)} kPa  ${r.peakG} g  alt ${(r.peakAlt / 1000).toFixed(1)} km`,
    );
    console.log(
      `  final orbit: ${(r.periapsis / 1000).toFixed(0)} x ${(r.apoapsis / 1000).toFixed(0)} km`,
    );
    console.log(`  FINAL: ${r.finalState}${r.failure ? ` — ${r.failure}` : ''}`);
    if (r.touchdown > 0) console.log(`  touchdown: ${r.touchdown} m/s`);
    if (r.marsAlt >= 0) {
      console.log(
        `  mars: alt ${(r.marsAlt / 1000).toFixed(1)} km  speed ${r.marsSpeed} m/s  ` +
          `heat ${r.marsHeat} MJ/m²  chute ${r.chute}`,
      );
    }
    if (r.descentLog?.length) {
      console.log('  descent:');
      for (const d of r.descentLog) console.log(`    ${d}`);
    }
    console.log(`  MET ${r.simSeconds}s, events:`);
    for (const e of r.events) console.log(`    ${e}`);
  }
} else {
  console.log('no results');
}

if (errors.length) {
  console.log(`\nerrors (${errors.length}):`);
  for (const e of errors.slice(0, 15)) console.log('  -', e.slice(0, 400));
}

await browser.close();
await server.close();
