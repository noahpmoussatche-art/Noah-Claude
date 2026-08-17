/**
 * The mission scene: the 3D world the mission actually happens in.
 *
 * This is the piece that makes the simulation visible. It owns the environment,
 * the vehicle's 3D body, one plume per nozzle, the pad smoke, the ground dust,
 * the entry plasma and the two ducks, and every frame it reads the mission
 * state and writes it into the world. Nothing here invents motion: the vehicle
 * is where the integrator says it is (spec §13, §79).
 *
 * It also handles the three environments the mission passes through — launch
 * site, interplanetary cruise, and the Martian surface — as a continuous
 * journey rather than a scene swap (spec §30, §77).
 */
import * as THREE from 'three';
import { EARTH, LAYER_FAR_SPACE, MARS, MissionState, SPACE_VIEW_SCALE } from '../data/constants';
import { density } from '../physics/Atmosphere';
import type { MissionSim } from '../simulation/MissionSim';
import { buildLaunchComplex, type LaunchComplexRefs } from './LaunchComplex';
import { buildMarsSurface, updateMarsDust, type MarsTerrainRefs } from '../planets/MarsSurface';
import { buildPlanetGlobe, buildStarfield, buildSun, SkyDome } from '../planets/Sky';
import { EnginePlume, ExhaustTrail } from '../effects/EnginePlume';
import {
  GroundBlast,
  MARS_DUST,
  PAD_EXHAUST,
  SmokeColumn,
  SparkBurst,
  VentingEffect,
} from '../effects/SmokeSystem';
import { EntryPlasma } from '../effects/EntryPlasma';
import { createCrew, type DuckActor } from '../characters/DuckActor';
import { clamp, lerp } from '../utils/math';
import { InterplanetaryTransfer } from '../simulation/Transfer';

export type SceneMode = 'launch-site' | 'cruise' | 'mars';

export class MissionScene {
  readonly scene = new THREE.Scene();
  readonly sim: MissionSim;

  /** Launch-site environment. */
  readonly complex: LaunchComplexRefs;
  readonly sky: SkyDome;
  readonly sunLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.HemisphereLight;

  /** The two characters (spec §24). */
  readonly crew: { engineer: DuckActor; pilot: DuckActor };

  /** Effects. */
  private readonly plumes: EnginePlume[] = [];
  private readonly exhaust = new ExhaustTrail(1_200);
  private readonly padBlast = new GroundBlast(PAD_EXHAUST, 1_800);
  private readonly marsDustBlast = new GroundBlast(MARS_DUST, 900);
  private readonly smokeColumn = new SmokeColumn(900);
  private readonly venting = new VentingEffect(400);
  private readonly sparks = new SparkBurst(600);
  private readonly plasma: EntryPlasma;

  /** Cruise view. */
  private cruiseGroup: THREE.Group | null = null;
  private cruiseEarth: THREE.Group | null = null;
  private cruiseMars: THREE.Group | null = null;
  private cruiseSun: THREE.Group | null = null;
  private cruiseShip: THREE.Group | null = null;
  private cruiseTrajectory: THREE.Line | null = null;

  /** Mars environment, created lazily when the vehicle arrives. */
  private mars: MarsTerrainRefs | null = null;

  private mode: SceneMode = 'launch-site';
  private readonly starfield: THREE.Points;

  /** Where the vehicle sits in the local render frame. */
  private readonly vehicleAnchor = new THREE.Group();

  /** Scratch. */
  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();

  private cameraPosition = new THREE.Vector3();
  private supersonicFired = false;

  constructor(sim: MissionSim) {
    this.sim = sim;

    // ---- Environment ----
    this.complex = buildLaunchComplex();
    this.scene.add(this.complex.root);

    this.sky = new SkyDome(60_000);
    this.scene.add(this.sky.mesh);

    this.starfield = buildStarfield(3_500, 380_000);
    this.starfield.visible = false;
    this.scene.add(this.starfield);

    // Dawn lighting for the first launch (spec §26).
    // Low enough to read as dawn, high enough that the vehicle is modelled by
    // the light rather than reduced to a silhouette against the sky.
    const sunDir = new THREE.Vector3(0.55, 0.34, -0.76).normalize();
    this.sky.setSunDirection(sunDir);
    this.sky.setDawn(1);

    this.sunLight = new THREE.DirectionalLight(0xffd8b4, 3.4);
    this.sunLight.position.copy(sunDir).multiplyScalar(900);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 1_800;
    this.sunLight.shadow.camera.left = -180;
    this.sunLight.shadow.camera.right = 180;
    this.sunLight.shadow.camera.top = 220;
    this.sunLight.shadow.camera.bottom = -60;
    this.sunLight.shadow.bias = -0.0007;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.ambientLight = new THREE.HemisphereLight(0x9ec4e8, 0x5a5142, 1.15);
    this.scene.add(this.ambientLight);

    // ---- Vehicle ----
    this.scene.add(this.vehicleAnchor);
    this.vehicleAnchor.add(sim.vehicle.root);
    // The anchor stays at the origin: the flight simulator's render position is
    // already measured from the ground datum and includes the pad height, so
    // offsetting the anchor as well would leave the vehicle hovering above the
    // launch mount.
    this.vehicleAnchor.position.set(0, 0, 0);

    // ---- One plume per nozzle (spec §10) ----
    for (const engine of sim.vehicle.engines) {
      const spec = engine.def.engine!;
      // Vacuum engines get long, wide plumes; sea-level engines short tight ones.
      const isVacuum = spec.expansion > 60;
      const plume = new EnginePlume({
        exitRadius: engine.exitRadius,
        length: engine.exitRadius * (isVacuum ? 26 : 15),
        // Short rated burn times belong to solids, whose exhaust is far smokier.
        fuel: spec.ratedBurnTime < 120 ? 'solid' : 'kerolox',
      });
      // Anchor at the nozzle exit, in the vehicle's own frame.
      plume.group.position.copy(engine.exitLocal);
      sim.vehicle.root.add(plume.group);
      this.plumes.push(plume);
    }

    this.scene.add(this.exhaust.system.points);
    this.scene.add(this.padBlast.system.points);
    this.scene.add(this.smokeColumn.system.points);
    this.scene.add(this.venting.system.points);
    this.scene.add(this.sparks.system.points);

    this.plasma = new EntryPlasma(Math.max(sim.vehicle.maxDiameter / 2, 1));
    sim.vehicle.root.add(this.plasma.group);
    this.scene.add(this.plasma.wake.points);

    // ---- Crew ----
    this.crew = createCrew();
    const marks = this.complex.crewMarks;
    this.crew.engineer.placeAt(marks[0].x, marks[0].y, marks[0].z, Math.PI);
    this.crew.pilot.placeAt(marks[1].x, marks[1].y, marks[1].z, Math.PI);
    this.scene.add(this.crew.engineer.object);
    this.scene.add(this.crew.pilot.object);

    // ---- Fog gives the site aerial perspective and hides the terrain edge ----
    this.scene.fog = new THREE.FogExp2(0xc9b49a, 0.00042);

    this.wireEvents();
  }

  // -------------------------------------------------------------------------
  // Subjects the camera can frame
  // -------------------------------------------------------------------------

  /** World position of the vehicle's centre. */
  vehiclePosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.setFromMatrixPosition(this.sim.vehicle.root.matrixWorld);
  }

  /** World position partway up the vehicle, for framing the whole stack. */
  vehicleMidpoint(target = new THREE.Vector3()): THREE.Vector3 {
    this.vehiclePosition(target);
    const up = this._v.set(0, 1, 0).applyQuaternion(this.sim.vehicle.root.quaternion);
    return target.addScaledVector(up, this.sim.vehicle.height * 0.45);
  }

  /** World position of the engine section. */
  vehicleBase(target = new THREE.Vector3()): THREE.Vector3 {
    return this.vehiclePosition(target);
  }

  /** Mount transform for onboard cameras. */
  vehicleMount(): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    return {
      position: this.vehiclePosition(new THREE.Vector3()),
      quaternion: this.sim.vehicle.root.getWorldQuaternion(new THREE.Quaternion()),
    };
  }

  get currentMode(): SceneMode {
    return this.mode;
  }

  /** Tells the scene where the camera is, for audio falloff and dust focus. */
  setCameraPosition(p: THREE.Vector3): void {
    this.cameraPosition.copy(p);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private wireEvents(): void {
    this.sim.on((e) => {
      switch (e.type) {
        case 'ignition-start': {
          // Sparks under the engines as the igniters fire.
          const base = this.vehicleBase(new THREE.Vector3());
          this.sparks.burst(base, 90, 22, 1.4);
          break;
        }
        case 'stage-separation': {
          const p = this.vehiclePosition(new THREE.Vector3());
          this.sparks.burst(p, 70, 30, 1.2);
          break;
        }
        case 'fairing-jettison': {
          const p = this.vehicleMidpoint(new THREE.Vector3());
          this.sparks.burst(p, 45, 24, 0.9);
          break;
        }
        case 'mars-approach':
          this.enterMars();
          break;
        case 'cruise-begin':
          this.enterCruise();
          break;
        default:
          break;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Mode transitions
  // -------------------------------------------------------------------------

  /**
   * Switches to the interplanetary cruise view: a heliocentric map with the
   * planets and the transfer ellipse drawn at a documented reduced scale, plus
   * the ship rendered at true size in a near layer so it never becomes a dot.
   */
  private enterCruise(): void {
    if (this.cruiseGroup) return;
    this.mode = 'cruise';

    const group = new THREE.Group();
    group.name = 'cruise-view';

    const S = SPACE_VIEW_SCALE;
    // Map-view body sizes. At a true 1/40000 reduction a planet is a fraction
    // of a pixel next to its own orbit, so bodies are drawn at a schematic size
    // relative to the astronomical unit — the same convention every orrery
    // uses. Distances remain to scale; only the discs are exaggerated.
    const AU = 1.496e11 * S;
    const bodyScale = AU * 0.022;

    // Sun at the origin.
    this.cruiseSun = buildSun(AU * 0.03);
    group.add(this.cruiseSun);

    const sunLight = new THREE.PointLight(0xfff0d8, 3.2, 0, 0);
    group.add(sunLight);

    // Planets, sized relative to each other so Mars still reads as the smaller.
    this.cruiseEarth = buildPlanetGlobe(bodyScale, 'earth', 11);
    group.add(this.cruiseEarth);

    this.cruiseMars = buildPlanetGlobe(bodyScale * (MARS.radius / EARTH.radius), 'mars', 23);
    group.add(this.cruiseMars);

    // Orbits and the transfer trajectory (spec §31).
    const orbitMat = new THREE.LineBasicMaterial({
      color: 0x3f6f9f,
      transparent: true,
      opacity: 0.35,
    });
    for (const r of [EARTH.orbitRadius, MARS.orbitRadius]) {
      const pts = InterplanetaryTransfer.sampleOrbit(r * S, 200);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, orbitMat));
    }

    const trajPts = this.sim.transfer.samplePath(180).map((p) => p.multiplyScalar(S));
    const trajGeo = new THREE.BufferGeometry().setFromPoints(trajPts);
    this.cruiseTrajectory = new THREE.Line(
      trajGeo,
      new THREE.LineBasicMaterial({ color: 0x4fd08a, transparent: true, opacity: 0.85 }),
    );
    group.add(this.cruiseTrajectory);

    // The ship: the actual vehicle, reparented here at true metre scale.
    this.cruiseShip = new THREE.Group();
    this.cruiseShip.add(this.sim.vehicle.root);
    this.sim.vehicle.root.position.set(0, 0, 0);
    group.add(this.cruiseShip);

    // At map scale a 60 m spacecraft is far below one pixel, so it also carries
    // a marker sized for the view. The ship itself is still there at true scale
    // underneath — zooming in finds it.
    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0x4fd08a,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    marker.name = 'ship-marker';
    marker.scale.setScalar(EARTH.orbitRadius * S * 0.012);
    this.cruiseShip.add(marker);

    this.cruiseGroup = group;
    this.scene.add(group);

    // Hide the launch site and switch to a space environment.
    this.complex.root.visible = false;
    this.sky.mesh.visible = false;
    this.starfield.visible = true;
    this.scene.fog = null;
    this.sunLight.intensity = 0;
    this.ambientLight.intensity = 0.12;

    // The crew watch from mission control, not from space.
    this.crew.engineer.object.visible = false;
    this.crew.pilot.object.visible = false;
  }

  /** Switches to the Martian surface for entry, descent and landing. */
  private enterMars(): void {
    if (this.mars) return;
    this.mode = 'mars';

    if (this.cruiseGroup) {
      this.cruiseGroup.visible = false;
    }

    this.mars = buildMarsSurface();
    this.scene.add(this.mars.root);
    this.scene.add(this.marsDustBlast.system.points);

    // Reparent the vehicle back into the world anchor.
    this.vehicleAnchor.add(this.sim.vehicle.root);
    this.vehicleAnchor.position.set(0, 0, 0);
    this.sim.vehicle.root.position.set(0, 0, 0);

    this.starfield.visible = false;
    this.scene.fog = new THREE.FogExp2(0xb87b4e, 0.00035);
    this.sunLight.intensity = 0;
    this.ambientLight.intensity = 0;

    // Vacuum-style plumes: there is barely any atmosphere to confine them.
    for (const plume of this.plumes) plume.vacuum = 0.85;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  update(dt: number): void {
    switch (this.mode) {
      case 'launch-site':
        this.updateLaunchSite(dt);
        break;
      case 'cruise':
        this.updateCruise(dt);
        break;
      case 'mars':
        this.updateMars(dt);
        break;
      default:
        break;
    }

    // Characters animate in every mode they are visible in.
    this.crew.engineer.update(dt);
    this.crew.pilot.update(dt);

    // Shared effect systems.
    this.exhaust.update(dt);
    this.sparks.update(dt);
    this.venting.update(dt);
    this.smokeColumn.update(dt);
    for (const plume of this.plumes) plume.update(dt);
  }

  private updateLaunchSite(dt: number): void {
    const sim = this.sim;
    const flight = sim.flight;
    const state = sim.state;

    // ---- Vehicle transform straight from the integrator ----
    flight.renderPosition(this._v);
    this.sim.vehicle.root.position.copy(this._v);
    this.sim.vehicle.root.quaternion.copy(flight.state.orientation);

    // Structural vibration: a small physical displacement of the whole stack,
    // strongest when thrust is high and the vehicle is still in dense air.
    if (sim.shake > 0.001) {
      const t = sim.missionTime;
      this.sim.vehicle.root.position.x += Math.sin(t * 63) * sim.shake * 0.12;
      this.sim.vehicle.root.position.z += Math.sin(t * 71 + 1.1) * sim.shake * 0.12;
    }

    const altitude = flight.altitude();
    const rho = density(EARTH, altitude);
    const vacuumFactor = clamp(1 - rho / EARTH.rho0, 0, 1);

    // ---- Sky and lighting follow the climb (spec §29) ----
    this.sky.setAltitude(altitude);
    this.sky.update(dt);
    this.sky.mesh.position.copy(this.cameraPosition);

    // Above the atmosphere, ambient bounce disappears and shadows go hard.
    this.ambientLight.intensity = lerp(1.15, 0.08, this.sky.altitudeFactor);
    this.sunLight.intensity = lerp(3.4, 4.2, this.sky.altitudeFactor);
    this.starfield.visible = this.sky.altitudeFactor > 0.35;
    if (this.starfield.visible) {
      this.starfield.position.copy(this.cameraPosition);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = lerp(0.00042, 0, clamp(altitude / 30_000, 0, 1));
    }

    // Keep the shadow camera following the vehicle so shadows stay crisp.
    this.sunLight.target.position.copy(this.sim.vehicle.root.position);
    this.sunLight.position
      .copy(this.sim.vehicle.root.position)
      .add(new THREE.Vector3(380, 260, -820));

    // ---- Plumes ----
    this.updatePlumes(dt, vacuumFactor, flight.state.velocity);

    // ---- Pad interaction (spec §12) ----
    const throttle = this.maxThrottle();
    if (throttle > 0.02 && altitude < 420) {
      // How strongly the exhaust is still hitting the pad.
      const proximity = clamp(1 - altitude / 380, 0, 1);
      const impact = this._v.set(
        this.sim.vehicle.root.position.x,
        this.complex.padHeight * 0.2,
        this.sim.vehicle.root.position.z,
      );
      this.padBlast.emit(dt, impact, throttle, proximity, 17);

      // The trench throws exhaust sideways from two fixed mouths.
      for (const mouth of this.complex.trenchMouths) {
        this.padBlast.emit(dt, mouth, throttle * 0.7, proximity, 12);
      }
    }
    this.padBlast.update(dt);

    // Rising smoke column left behind on the way up.
    if (throttle > 0.05 && altitude < 9_000 && rho > 0.05) {
      this.smokeColumn.emit(
        dt,
        this.vehicleBase(new THREE.Vector3()),
        throttle * clamp(1 - altitude / 9_000, 0, 1),
        this.sim.vehicle.maxDiameter * 1.4,
      );
    }

    // ---- Cryogenic boil-off while waiting on the pad ----
    if (state === MissionState.COUNTDOWN || state === MissionState.CHECK) {
      const ventPoint = this.vehicleMidpoint(new THREE.Vector3());
      ventPoint.x += this.sim.vehicle.maxDiameter * 0.55;
      this.venting.emit(dt, ventPoint, new THREE.Vector3(1, 0.2, 0), 0.6);
    }

    // ---- Service arms retract before launch ----
    const retract = state === MissionState.COUNTDOWN
      ? clamp(-sim.missionTime / 8, 0, 1)
      : sim.missionTime > -8
        ? 0
        : 1;
    for (let i = 0; i < this.complex.serviceArms.length; i++) {
      const arm = this.complex.serviceArms[i];
      arm.rotation.y = lerp(0, -1.15, 1 - retract);
    }

    // ---- Pad floodlights: on at dawn, off once the sun is up ----
    for (const light of this.complex.padLights) {
      light.intensity = lerp(2.4, 0, clamp(this.sky.altitudeFactor * 3, 0, 1));
    }

    // ---- Debris keeps flying (spec §19) ----
    for (const d of sim.debris) {
      if (!d.group.parent) this.scene.add(d.group);
    }
  }

  private updateCruise(dt: number): void {
    const sim = this.sim;
    const S = SPACE_VIEW_SCALE;
    const transfer = sim.transfer;

    // Planets orbit; the ship follows the transfer ellipse.
    if (this.cruiseEarth) {
      transfer.originPosition(this._v).multiplyScalar(S);
      this.cruiseEarth.position.copy(this._v);
      this.cruiseEarth.rotation.y += dt * 0.02;
      const clouds = this.cruiseEarth.getObjectByName('clouds');
      if (clouds) clouds.rotation.y += dt * 0.006;
    }
    if (this.cruiseMars) {
      transfer.destinationPosition(this._v).multiplyScalar(S);
      this.cruiseMars.position.copy(this._v);
      this.cruiseMars.rotation.y += dt * 0.019;
    }
    if (this.cruiseShip) {
      transfer.shipPosition(this._v).multiplyScalar(S);
      this.cruiseShip.position.copy(this._v);
      // Point the ship along its velocity: tangent to the ellipse.
      const ahead = transfer.shipPosition(new THREE.Vector3());
      const nu = transfer.trueAnomaly();
      const tangent = new THREE.Vector3(-Math.sin(nu), 0, Math.cos(nu)).normalize();
      void ahead;
      this._q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      this.cruiseShip.quaternion.slerp(this._q, 1 - Math.exp(-dt));
      // Slow roll, so the ship is visibly alive in the void.
      this.cruiseShip.rotateY(dt * 0.05);
    }

    this.starfield.position.copy(this.cameraPosition);

    // Solar arrays generate: a faint venting of attitude thrusters now and then.
    if (Math.random() < dt * 0.4 && this.cruiseShip) {
      this.venting.emit(
        dt,
        this.cruiseShip.getWorldPosition(new THREE.Vector3()),
        new THREE.Vector3(1, 0, 0),
        0.25,
      );
    }

    // Plumes are off during coast.
    for (const plume of this.plumes) plume.throttle = 0;
  }

  private updateMars(dt: number): void {
    const sim = this.sim;
    const flight = sim.marsFlight;
    const mars = this.mars;
    if (!flight || !mars) return;

    // ---- Vehicle transform ----
    flight.renderPosition(this._v);
    // The flight simulator measures altitude from the planet datum, but the
    // rendered terrain has relief on top of it. Lifting the vehicle by the
    // local ground height keeps "altitude zero" meaning "resting on the
    // surface" — otherwise the lander touches down buried inside a hillside.
    const groundY = mars.heightAt(this._v.x, this._v.z);
    this.sim.vehicle.root.position.set(this._v.x, this._v.y + groundY, this._v.z);
    this.sim.vehicle.root.quaternion.copy(flight.state.orientation);

    if (sim.shake > 0.001) {
      const t = sim.missionTime;
      this.sim.vehicle.root.position.x += Math.sin(t * 58) * sim.shake * 0.14;
      this.sim.vehicle.root.position.z += Math.sin(t * 67 + 0.7) * sim.shake * 0.14;
    }

    const altitude = flight.altitude();
    const rho = density(MARS, altitude);

    // ---- Entry plasma driven by the simulated heat flux (spec §34) ----
    const heatFlux = sim.telemetry.heatFlux;
    // Normalise against a typical Mars peak of ~1.2 MW/m^2.
    this.plasma.intensity = clamp(heatFlux / 1.2e6, 0, 1);

    const wakeDir = flight.state.velocity.clone().normalize().negate();
    this.plasma.update(
      dt,
      this.vehicleBase(new THREE.Vector3()),
      wakeDir,
      sim.telemetry.airspeed,
      Math.max(this.sim.vehicle.maxDiameter / 2, 1),
    );

    // The plasma also lights the vehicle and the ground below it.
    mars.sunLight.intensity = 1.55;

    // ---- Plumes ----
    this.updatePlumes(dt, clamp(1 - rho / MARS.rho0, 0, 1), flight.state.velocity);

    // ---- Landing dust (spec §36) ----
    const throttle = this.maxThrottle();
    if (throttle > 0.02 && altitude < 90) {
      const proximity = clamp(1 - altitude / 85, 0, 1);
      const impact = this._v.set(
        this.sim.vehicle.root.position.x,
        mars.heightAt(this.sim.vehicle.root.position.x, this.sim.vehicle.root.position.z),
        this.sim.vehicle.root.position.z,
      );
      this.marsDustBlast.emit(dt, impact, throttle, proximity, 11);
    }
    this.marsDustBlast.update(dt);

    // ---- Ambient wind-blown dust ----
    updateMarsDust(mars.dust, dt, this.cameraPosition, 1);

    // Sky and shadows track the vehicle.
    mars.sky.position.copy(this.cameraPosition);
    mars.sunLight.target.position.copy(this.sim.vehicle.root.position);
    mars.sunLight.position
      .copy(this.sim.vehicle.root.position)
      .add(new THREE.Vector3(-320, 300, 220));
  }

  /** Writes throttle and ambient pressure into every plume. */
  private updatePlumes(dt: number, vacuumFactor: number, velocity: THREE.Vector3): void {
    const engines = this.sim.vehicle.engines;
    for (let i = 0; i < this.plumes.length && i < engines.length; i++) {
      const engine = engines[i];
      const plume = this.plumes[i];

      const dead = this.sim.vehicle.stages.find((s) => s.index === engine.stage)?.separated;
      plume.throttle = dead || !engine.operational ? 0 : engine.throttle;
      plume.vacuum = vacuumFactor;

      // Trailing exhaust column from each firing nozzle.
      if (plume.intensity > 0.03) {
        const worldExit = engine.exitLocal.clone();
        this.sim.vehicle.root.localToWorld(worldExit);
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(
          this.sim.vehicle.root.getWorldQuaternion(this._q),
        );
        this.exhaust.emit(
          dt,
          worldExit,
          down,
          velocity,
          plume.intensity,
          engine.exitRadius,
          vacuumFactor,
        );
      }
    }
  }

  /** Highest throttle across all live engines. */
  maxThrottle(): number {
    let t = 0;
    for (const e of this.sim.vehicle.activeEngines()) {
      if (e.operational) t = Math.max(t, e.throttle);
    }
    return t;
  }

  /** Smoothed plume intensity, for audio and camera reactions. */
  plumeIntensity(): number {
    let t = 0;
    for (const p of this.plumes) t = Math.max(t, p.intensity);
    return t;
  }

  /** True once the vehicle first goes supersonic — used for the boom. */
  consumeSupersonicEvent(): boolean {
    if (this.supersonicFired) return false;
    if (this.sim.telemetry.mach > 1 && this.sim.telemetry.altitude > 500) {
      this.supersonicFired = true;
      return true;
    }
    return false;
  }

  /** Relative air density at the vehicle, 0..1, for audio. */
  airDensityFactor(): number {
    if (this.mode === 'mars' && this.sim.marsFlight) {
      return clamp(density(MARS, this.sim.marsFlight.altitude()) / EARTH.rho0, 0, 1);
    }
    if (this.mode === 'cruise') return 0;
    return clamp(density(EARTH, this.sim.flight.altitude()) / EARTH.rho0, 0, 1);
  }

  /** Terrain height under a world point on Mars, or 0 elsewhere. */
  groundHeightAt(x: number, z: number): number {
    return this.mars ? this.mars.heightAt(x, z) : 0;
  }

  /** Sets the render layer used for the far-space pass. */
  applyFarLayer(): void {
    this.starfield.layers.set(LAYER_FAR_SPACE);
  }

  dispose(): void {
    for (const p of this.plumes) p.dispose();
    this.exhaust.dispose();
    this.padBlast.dispose();
    this.marsDustBlast.dispose();
    this.smokeColumn.dispose();
    this.venting.dispose();
    this.sparks.dispose();
    this.plasma.dispose();
    this.sky.dispose();
    this.crew.engineer.dispose();
    this.crew.pilot.dispose();
  }
}
