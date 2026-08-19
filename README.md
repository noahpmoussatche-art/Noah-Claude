# ORBITAL ENGINEERING

A 3D space-construction and exploration game. Build a launch vehicle from
modular parts, check it against the physics, then watch it fly — or fail —
exactly as you designed it.

Two ducks run the agency.

```
npm install
npm run dev
```

---

## What it is

You are the entire engineering staff of the **Orbital Space Agency**, along with
Quill (methodical, carries a clipboard) and Mavis (quicker, has to ride the
thing). You assemble vehicles from a catalogue of parts that all carry real
mass, dimensions and physics, run a pre-flight check that tells you which
physical limit you are about to cross, and then launch.

You never pilot. Once it lights, the guidance system flies the profile and you
control the camera, the time warp and the pause. What happens is a consequence
of what you built.

### The three missions

| Mission | Profile |
| --- | --- |
| **FIRST FLIGHT** | Two-stage launcher to a low parking orbit. |
| **SURVEYOR** | Carry a satellite up inside the fairing, separate it, watch it unfold its solar wings and high-gain dish. |
| **ARES** | The full profile: orbit, trans-Mars injection, an eight-month cruise, entry at 5.5 km/s, parachute, and the last kilometre on the descent engine. |

---

## The simulation

Everything visible is driven by an integrator, not an animation.

**Translation** comes from thrust, inverse-square gravity and atmospheric drag.
Nozzle performance interpolates between sea-level and vacuum by ambient
pressure, which is why a vacuum bell is useless at liftoff and why a descent
engine gets essentially its full vacuum thrust in Mars's thin air.

**Rotation** comes from the aerodynamic moment about the centre of mass,
thrust-vector control at the gimbal, and any lateral thrust offset you built in.
The aerodynamic moment is computed as `(r_CoP − r_CoM) × F_aero` rather than
"rotate the nose toward the velocity" — that distinction is what lets an entry
capsule fly heat-shield-first while a rocket flies nose-first, from the same
equation.

**Mass properties** — centre of mass, centre of thrust, centre of pressure,
pitch inertia — are computed from the actual placed parts every step, and the
centre of mass migrates as propellant drains. The diagnostic overlay draws the
same numbers the integrator uses.

**Ascent guidance** flies a gravity turn whose pitch programme is tied to the
target orbit, then holds a climb rate onto the target altitude while a
horizontal burn lifts periapsis clear of the atmosphere. Throttle is limited by
dynamic pressure through max-Q and by a 4 g acceleration cap.

**Entry, descent and landing** separates the cruise stage, flies the aeroshell
into the atmosphere, deploys the parachute around Mach 2 at ~11 km, jettisons
the shield, cuts the canopy as the engine lights, cancels horizontal drift, and
then descends vertically on a braking curve to a walking-pace touchdown.

**Time warp** runs to 1000×, and the physics sub-steps to match. During powered
atmospheric flight the step size is small, so the effective warp is capped
rather than letting the integrator take strides it cannot resolve.

### Failures are real

A vehicle with thrust-to-weight below 1.0 sits on the pad. One short on
propellant runs dry partway up. One that loses attitude authority at high
dynamic pressure tumbles and breaks apart. An aeroshell that is undersized for
the entry heat load does not survive to the parachute phase. Coming in above the
landing gear's rated speed collapses it.

Every failure reports which physical limit was exceeded and by how much.

---

## Rendering

There are no binary art assets. Every model is procedural geometry and every
texture is drawn to a canvas at load time.

- **Parts** are assembled the way the real hardware is. An engine has a
  combustion chamber, a regeneratively-cooled bell with stiffening hoops, a
  turbopump, feed ducts, a gimbal block and actuators. A tank is a lathed
  pressure vessel with elliptical bulkheads, stringers, ribs, a feed line and a
  cable raceway. An interstage is an open triangulated truss with pneumatic
  pushers.
- **Scale is one unit per metre**, everywhere. A duck is 0.55 m, the reference
  launcher is ~56 m, the launch tower is 78 m.
- **Engine plumes** are a shaded supersonic core with shock diamonds that fade
  out in vacuum, a turbulent luminous envelope, a bloom at the exit plane, a
  trailing exhaust column and a flickering dynamic light. The plume geometry
  responds to ambient pressure and throttle.
- **Pad interaction**: exhaust hits the deflector and erupts sideways out of the
  flame trench in a rolling cloud before the vehicle has moved.
- **Mars** is a displaced terrain built from layered noise with carved craters,
  raised ejecta rims, central peaks, instanced boulder fields, wind-blown dust
  and a butterscotch sky with the blue aureole around the sun that Mars actually
  has, carried out to the horizon by a coarse far field so the detailed patch
  never reads as a plate floating in the sky.
- **Planets from orbit** are drawn in a second render pass. A world eight
  thousand kilometres across and a fifty-metre vehicle cannot share one depth
  buffer, so the planet is drawn first through a camera that shares the main
  one's orientation and lens but sits at a scaled-down position — every angle is
  preserved, so the parallax is right — and then the depth buffer is cleared and
  the near world is drawn over it. The globe hangs one radius plus the current
  altitude below the vehicle, which is what "below" means where the vehicle
  actually is; the flat launch-site frame it flies in has long since parted
  company with the curved planet by the time it reaches orbit.
- **The camera** carries its subject's motion forward before damping, and is
  bounded in how far it may trail. A plain damped follow lags by roughly speed
  over stiffness, which is invisible on the pad and leaves a kilometre of empty
  frame at atmospheric entry.

---

## Tools

The `tools/` directory holds the verification harnesses used to build this.

```bash
node tools/run-sim-harness.mjs     # fly every reference mission headlessly
node tools/run-failure-cases.mjs   # confirm bad vehicles fail, and how
node tools/visual-test.mjs [dir]   # drive the real game and capture screenshots
node tools/sweep.mjs "0.4,0.5"     # sweep the gravity-turn pitch programme
```

The simulation harness flies all three missions in seconds with no rendering,
which is what made the ascent and landing controllers tunable by measurement
rather than by guesswork.

The visual harness records the render frame's numbers — where the camera, the
vehicle and the ground each are — alongside every screenshot, and samples the
opening sequence on the sequence's own clock and the descent by altitude rather
than by wall clock. A screenshot can show that a frame is empty; only the
numbers say why.

---

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit camera |
| Scroll | Zoom |
| `Space` | Pause |
| `D` | Diagnostic overlay (CoM / CoT / CoP / vectors) |
| `M` | Mute |
| `[` `]` | Time warp down / up |
| `Esc` | Skip cinematic |

---

## Layout

```
src/
  data/        physical constants, part catalogue, mission definitions
  parts/       part schema and procedural model builders
  vehicles/    design resolution, assembly, mass properties, staging
  physics/     atmosphere, flight dynamics integrator
  simulation/  mission state machine, pre-flight checks, transfer, telemetry
  effects/     plumes, smoke, dust, entry plasma, particle system
  characters/  duck models and procedural animation
  scenes/      launch complex, workshop, mission control, mission scene
  planets/     Mars surface, sky, planet globes, starfield
  cinematics/  camera director, shot library, scripted sequences
  ui/          interface, tutorial, diagnostic overlay, styling
  audio/       synthesised audio engine
  render/      shared materials, textures, geometry constructors
```

---

## Hosting it

The game is entirely static — no server, no API, no database, no build-time
secrets. Everything runs in the browser, so "deploying" means putting the
contents of `dist/` behind any web server.

Vite is configured with `base: './'`, so every asset reference is relative and
the build works unchanged from a domain root or from a subdirectory such as
`example.com/orbital/`. This is verified, not assumed — `tools/file-check.mjs`
boots a built copy over a real HTTP server from a subdirectory and fails if
anything 404s or throws.

### The quickest route: drop the folder

Build, then drag the `dist` folder onto [app.netlify.com/drop](https://app.netlify.com/drop).
You get a public URL in a few seconds, with no account and no repository
connection. Works regardless of whether this repo is private.

```
npm ci
npm run build      # produces dist/
```

Cloudflare Pages offers the same via *Direct Upload*.

### A single file, no folder

`npm run bundle` inlines the script and stylesheet into one self-contained
`.html`. That one file can be opened straight off disk, emailed, or dropped on
any host that serves a static page.

```
npm run build && npm run bundle
```

### GitHub Pages, on every push

`.github/workflows/deploy.yml` builds and publishes on every push to `main`,
and can be run by hand from the Actions tab to publish any branch. To enable
it: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

One caveat worth knowing before you try: **GitHub Pages only serves from a
private repository on a paid plan.** On a free account the repository has to be
public. If this one stays private, use Netlify, Cloudflare Pages or Vercel
instead — their free tiers all publish from private repositories.

### What a host needs to get right

Nothing unusual, but two things are worth checking if a deploy misbehaves:

- **`.js` must be served as `application/javascript`.** The bundle is an ES
  module, and a host that sends `text/plain` will have the browser refuse it.
  Every host named above does this correctly by default.
- **WebGL must be available in the visitor's browser.** The game fails with a
  readable message rather than a blank screen if it is not, but there is no
  software fallback — this is a 3D game.

No HTTPS-only APIs are used, so the site works over plain HTTP as well, though
there is no reason to prefer that.
