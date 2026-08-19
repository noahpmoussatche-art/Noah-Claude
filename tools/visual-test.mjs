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

  // Serve the real app. Hot reload is switched off: a full pass takes over ten
  // minutes, and a source edit made while one is in flight would otherwise
  // reload the page mid-flight and destroy the run.
  const server = await createServer({
    server: { port: 5199, host: '127.0.0.1', hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  // Take the port Vite actually bound. It falls forward when 5199 is busy, and
  // a hard-coded URL then silently drove the browser at *another* run's server.
  const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5199/';
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
    // A screenshot alone cannot say *why* a frame is empty, so every shot also
    // records where the camera, the vehicle and the ground actually were.
    const debug = await page.evaluate(() => window.orbital?.debugSnapshot?.() ?? null);
    shots.push({ name, file, note, debug });
    console.log(`  captured ${name} ${debug ? JSON.stringify(debug) : ''}`);
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

  // ---- The opening cinematic, sampled on the sequence's own clock ----
  // Not on wall clock: this browser renders in software at a fraction of real
  // speed, so a fixed delay photographs whichever shot happens to be up rather
  // than the one being checked. Each capture waits for the timeline to reach
  // the beat it is meant to document.
  const waitForCinematicTime = async (t, timeoutMs = 120_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const now = await page.evaluate(
        () => window.orbital?.debugSnapshot?.()?.cinematicTime ?? null,
      );
      // Null means the sequence has finished and been torn down.
      if (now === null || now >= t) return now;
      await page.waitForTimeout(250);
    }
    return null;
  };

  for (const [at, name, note] of [
    [2.0, 'cine-establishing', 'Fade-in on the spaceport at dawn'],
    [5.0, 'cine-wide', 'Wide establishing shot, vehicle on the pad'],
    [9.0, 'cine-crew-walk', 'Both ducks walking toward the pad'],
    [13.5, 'cine-scale', 'Over-the-shoulder: duck foreground, rocket behind'],
    [20.5, 'cine-tilt-up', 'Tilt up the vehicle from ground level'],
    [25.5, 'cine-engines', 'Low angle on the engine section'],
  ]) {
    const reached = await waitForCinematicTime(at);
    await shot(name, `${note} (t=${reached ?? 'ended'})`);
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
  // The simulation drops to real time on insertion; give the hero shot a moment
  // to settle before photographing it, or the frame catches a mid-blend camera.
  await page.waitForTimeout(4000);
  await shot('orbit', 'Orbit achieved');

  await page.waitForTimeout(8000);
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
  // From here on the frame is a real 3D place rather than a schematic, so the
  // render-frame numbers are sampled continuously and not only at each shot.
  const trace = [];
  const sampler = setInterval(() => {
    page
      .evaluate(() => window.orbital?.debugSnapshot?.() ?? null)
      .then((d) => {
        if (d && d.mode === 'mars') trace.push(d);
      })
      .catch(() => {});
  }, 2000);

  console.log('  waiting for ENTRY…');
  console.log('  phase:', await waitForPhase(['ENTRY', 'MARS_APPROACH'], 300_000));
  await shot('mars-approach', 'Mars arrival');

  await page.waitForTimeout(4000);
  await shot('entry', 'Entry interface — first contact with the atmosphere');

  // Entry, descent and landing are photographed by altitude, not by phase name.
  // The phases here are short and this browser polls slowly, so waiting on the
  // HUD text raced straight past the parachute and the landing burn — the run
  // reached MISSION COMPLETE with neither captured. Altitude is monotonic and
  // says exactly where the vehicle is.
  const marsAltitude = async () =>
    page.evaluate(() => {
      const d = window.orbital?.debugSnapshot?.();
      return d && d.mode === 'mars' ? d.altitude : null;
    });

  const waitForAltitudeBelow = async (metres, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const a = await marsAltitude();
      if (a !== null && a <= metres) return a;
      // Landed already, or the run failed out of the Martian scene.
      const p = await phase();
      if (p.includes('LANDED') || p.includes('COMPLETE') || p.includes('FAILURE')) return null;
      await page.waitForTimeout(300);
    }
    return `TIMEOUT`;
  };

  // Warp through the long ballistic part of entry, then back to real time for
  // everything that is meant to be watched.
  await setWarp('5×');

  // Peak heating, photographed by altitude. Entry *interface* is where the
  // atmosphere starts, not where it bites: at 107 km the heat flux is still
  // essentially zero, so a shot taken on the phase change catches a vehicle in
  // clear air and proves nothing about whether the plasma renders at all. The
  // shell lights up in the thirty-to-fifty kilometre band.
  console.log('  peak heating band:', await waitForAltitudeBelow(42_000, 420_000));
  await shot('entry-plasma', 'Peak heating — plasma sheath around the aeroshell');

  console.log('  descending…', await waitForAltitudeBelow(20_000, 420_000));
  await setWarp('1×');

  // Below the altitude the canopy is actually open at. Deployment waits for
  // Mach 2.3, which this vehicle does not reach until about 6.5 km — so a shot
  // taken at 7 km catches a packed mortar can and an empty sky, which is
  // exactly what it did.
  console.log('  chute altitude:', await waitForAltitudeBelow(4_800, 420_000));
  await shot('descent', 'Descent under an open parachute');

  console.log('  burn altitude:', await waitForAltitudeBelow(400, 420_000));
  await shot('landing', 'Powered descent and dust');

  console.log('  waiting for LANDED…');
  console.log('  phase:', await waitForPhase(['LANDED', 'COMPLETE'], 300_000));
  await page.waitForTimeout(6000);
  await shot('landed', 'On the surface');

  await page.waitForTimeout(12000);
  await shot('result', 'Mission result card');
  clearInterval(sampler);
  console.log(`\n--- mars render-frame trace (${trace.length} samples) ---`);
  for (const t of trace) {
    console.log(
      `    alt=${t.altitude} veh=[${t.vehicle}] cam=[${t.camera}] d=${t.cameraToVehicle} ` +
        `groundVeh=${t.groundUnderVehicle} groundCam=${t.groundUnderCamera} ` +
        `origin=[${t.marsOrigin}]${t.marsOriginLocked ? ' LOCKED' : ''}`,
    );
  }

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
