/**
 * Visual verification harness (spec §67, §68, §70, §71).
 *
 * The spec requires that the result be *looked at*, not merely compiled: the
 * rocket on the pad, a duck beside it for scale, the cinematic, ignition, fire,
 * smoke, liftoff, ascent, separation, space, Mars, entry, parachute, landing.
 * This script drives the real game in a real browser and captures each of those
 * moments to disk so they can be inspected.
 *
 * Usage: node tools/visual-test.mjs [outputDir]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import path from 'node:path';

const OUT = process.argv[2] ?? '/tmp/orbital-shots';
const VIEWPORT = { width: 1600, height: 900 };

const shots = [];
const consoleErrors = [];

async function main() {
  await mkdir(OUT, { recursive: true });

  // Serve the real app.
  const server = await createServer({
    server: { port: 5199, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const url = 'http://127.0.0.1:5199/';
  console.log(`serving ${url}`);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--mute-audio',
    ],
  });

  const page = await browser.newPage({ viewport: VIEWPORT });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log('  [console.error]', msg.text().slice(0, 300));
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err));
    console.log('  [pageerror]', String(err).slice(0, 400));
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const shot = async (name, note = '') => {
    const file = path.join(OUT, `${String(shots.length).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push({ name, file, note });
    console.log(`  captured ${name}`);
  };

  // ---- 1. Main menu ----
  await shot('menu', 'Title screen and mission list');

  // ---- 2. Enter the Mars mission (the full profile) ----
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.mission-card');
    // Third card is the full Mars surface mission.
    cards[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(4000);
  await shot('workshop-empty', 'Workshop interior, no vehicle yet');

  // ---- 3. Load the reference vehicle ----
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#build-actions button')];
    buttons.find((b) => b.textContent.includes('Load reference'))?.click();
  });
  await page.waitForTimeout(3500);
  await shot('workshop-vehicle', 'Reference launcher assembled in the high bay');

  // ---- 4. Diagnostics: CoM / CoT / CoP gizmos ----
  await page.evaluate(() => {
    document.getElementById('diag-toggle')?.click();
  });
  await page.waitForTimeout(1200);
  await shot('diagnostics', 'Centre of mass / thrust / pressure markers');

  // ---- 5. System check ----
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#build-actions button')];
    buttons.find((b) => b.textContent.includes('System check'))?.click();
  });
  await page.waitForTimeout(1200);
  await shot('system-check', 'Pre-flight subsystem report');

  // ---- 6. Launch, then sample the whole opening cinematic ----
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#check-footer button')];
    (buttons.find((b) => b.textContent.includes('Proceed')) ??
      buttons.find((b) => b.textContent.includes('Launch')))?.click();
  });

  // The opening sequence and the flight are driven by the simulation, so wait
  // on actual state rather than fixed delays — the machine running this may be
  // far slower or faster than the one it was written on.
  const phase = async () =>
    page.evaluate(
      () => document.querySelector('#mission-state .phase')?.textContent ?? '',
    );

  const waitForPhase = async (names, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const p = await phase();
      if (names.some((n) => p.includes(n))) return p;
      await page.waitForTimeout(400);
    }
    return `TIMEOUT(${await phase()})`;
  };

  // ---- The opening cinematic, sampled while it plays ----
  for (const [wait, name, note] of [
    [3000, 'cine-establishing', 'Fade-in on the spaceport at dawn'],
    [4000, 'cine-wide', 'Wide establishing shot, vehicle on the pad'],
    [4000, 'cine-crew-walk', 'Both ducks walking toward the pad'],
    [4000, 'cine-scale', 'Over-the-shoulder: duck foreground, rocket behind'],
    [4000, 'cine-tilt-up', 'Tilt up the vehicle from ground level'],
    [4000, 'cine-engines', 'Low angle on the engine section'],
  ]) {
    await page.waitForTimeout(wait);
    await shot(name, note);
  }

  console.log('  waiting for COUNTDOWN…');
  console.log('  phase:', await waitForPhase(['COUNTDOWN'], 90_000));
  await shot('countdown', 'Terminal count');

  console.log('  waiting for IGNITION…');
  console.log('  phase:', await waitForPhase(['IGNITION'], 60_000));
  await page.waitForTimeout(1200);
  await shot('ignition', 'Ignition — fire at the nozzles, pad filling with smoke');

  console.log('  waiting for LIFTOFF…');
  console.log('  phase:', await waitForPhase(['LAUNCH', 'ASCENT'], 60_000));
  await page.waitForTimeout(900);
  await shot('liftoff', 'Liftoff');

  await page.waitForTimeout(3500);
  await shot('ascent-low', 'Early ascent, exhaust column over the pad');

  // Warp so the rest of the flight happens in reasonable wall-clock time.
  const setWarp = async (label) => {
    await page.evaluate((l) => {
      const b = [...document.querySelectorAll('#time-controls button')].find(
        (x) => x.textContent === l,
      );
      b?.click();
    }, label);
  };

  await page.waitForTimeout(6000);
  await shot('ascent-maxq', 'Through maximum dynamic pressure');

  await setWarp('5×');
  await page.waitForTimeout(6000);
  await shot('staging', 'Around stage separation');

  await page.waitForTimeout(8000);
  await shot('ascent-high', 'High altitude — sky darkening toward space');

  await setWarp('50×');
  console.log('  waiting for ORBIT…');
  console.log('  phase:', await waitForPhase(['ORBIT'], 240_000));
  await shot('orbit', 'Orbit achieved');

  await page.waitForTimeout(6000);
  await shot('orbit-payload', 'On station');

  // ---- Interplanetary cruise ----
  await setWarp('1M×');
  console.log('  waiting for TRANSFER…');
  console.log('  phase:', await waitForPhase(['TRANSFER'], 180_000));
  await page.waitForTimeout(4000);
  await shot('cruise', 'Interplanetary transfer: Sun, Earth, Mars, trajectory');

  await page.waitForTimeout(15000);
  await shot('cruise-late', 'Later in the cruise');

  // ---- Mars ----
  console.log('  waiting for ENTRY…');
  console.log('  phase:', await waitForPhase(['ENTRY', 'MARS_APPROACH'], 300_000));
  await shot('mars-approach', 'Mars arrival');

  await page.waitForTimeout(4000);
  await shot('entry', 'Atmospheric entry — plasma');

  console.log('  waiting for DESCENT…');
  console.log('  phase:', await waitForPhase(['DESCENT'], 180_000));
  await page.waitForTimeout(2500);
  await shot('descent', 'Descent under parachute');

  console.log('  waiting for LANDING…');
  console.log('  phase:', await waitForPhase(['LANDING'], 180_000));
  await page.waitForTimeout(2000);
  await shot('landing', 'Powered descent and dust');

  console.log('  waiting for LANDED…');
  console.log('  phase:', await waitForPhase(['LANDED', 'COMPLETE'], 180_000));
  await page.waitForTimeout(3000);
  await shot('landed', 'On the surface');

  await page.waitForTimeout(12000);
  await shot('result', 'Mission result card');

  // ---- Diagnostics dump ----
  const state = await page.evaluate(() => {
    const g = window.orbital;
    // Reach into the running game for a state summary.
    const sim = g?.sim ?? null;
    return {
      hasGame: !!g,
      bodyClass: document.body.className,
      missionPhase:
        document.querySelector('#mission-state .phase')?.textContent ?? null,
      met: document.querySelector('#mission-state .met')?.textContent ?? null,
      telemetry: [...document.querySelectorAll('#telemetry .row')].map((r) => ({
        k: r.querySelector('.osa-label')?.textContent,
        v: r.querySelector('.osa-value')?.textContent,
      })),
      result: document.querySelector('#result .verdict')?.textContent ?? null,
      resultHeadline: document.querySelector('#result .headline')?.textContent ?? null,
      simPresent: !!sim,
    };
  });

  console.log('\n--- final state ---');
  console.log(JSON.stringify(state, null, 2));
  console.log(`\nconsole errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 12)) console.log('  -', e.slice(0, 300));

  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ shots, state, consoleErrors }, null, 2),
  );

  await browser.close();
  await server.close();
  console.log(`\nwrote ${shots.length} screenshots to ${OUT}`);
}

main().catch(async (err) => {
  console.error('visual test failed:', err);
  process.exit(1);
});
