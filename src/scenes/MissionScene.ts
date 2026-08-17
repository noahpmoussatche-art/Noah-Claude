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
import { softParticle } from '../render/textures';
import { InterplanetaryTransfer } from '../simulation/Transfer';

export type SceneMode = 'launch-site' | 'cruise' | 'mars';

/**
 * Reduction applied in the renderer's far-space pass. At 1/2000 the Earth is a
 * 3186-unit sphere and a 200 km orbit is 100 units above it — numbers a depth
 * buffer is comfortable with, while every angle stays exact.
 */
const FAR_SPACE_SCALE = 1 / 2_000;

/** Altitude at which the sky dome gives way to the planet, metres. */
const FAR_EARTH_ALTITUDE = 55_000;

/**
 * Altitude at which the Martian render frame locks to the landing site even if
 * the parachute has not reported deploying, metres. The frame must be anchored
 * well before touchdown or the ground under the lander is the wrong ground.
 */
const MARS_FRAME_LOCK_ALTITUDE = 14_000;

/** Body disc radius in the cruise map, as a fraction of the astronomical unit. */
const CRUISE_BODY_SCALE = 0.042;

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

  /**
   * Horizontal origin of the Martian render frame.
   *
   * Entry carries the vehicle hundreds of kilometres downrange — far outside
   * any terrain patch that could reasonably be generated. So during entry the
   * frame follows the vehicle (nothing but sky and plasma is in shot anyway),
   * and it locks the moment the parachute opens, which is when the ground first
   * matters. From then on the last few kilometres of descent play out over real
   * terrain.
   */
  private marsOrigin = new THREE.Vector3();
  private marsOriginLocked = false;

  /** Orbital Earth, drawn in the renderer's far-space pass. */
  private farEarth: THREE.Group | null = null;

  private cameraPosition = new THREE.Vector3();
  private supersonicFired = false;

  constructor(sim: MissionSim) {
    this.sim = sim;

    // ---- Environment ----
    this.complex = buildLaunchComplex();
    this.scene.add(this.complex.root);

    this.sky = new SkyDome(60_000);
    this.scene.add(this.sky.mesh);

    // The starfield lives on the far-space layer, so it is drawn in the
    // renderer's far pass — behind the planet rather than through it — and its
    // radius is small enough to sit inside that pass's clip range in every
    // view. It is re-centred on the camera each frame, so it reads as infinity.
    this.starfield = buildStarfield(3_500, 20_000);
    this.starfield.layers.set(LAYER_FAR_SPACE);
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
    // Body sizes for the map view. The camera has to stand far enough back to
    // hold Mars's whole orbit, and at that distance a true-scale planet is well
    // under a pixel — so the discs are drawn at a schematic fraction of the
    // astronomical unit, the way every orrery does it. Distances stay exact.
    const bodyScale = AU * CRUISE_BODY_SCALE;

    // Sun at the origin.
    this.cruiseSun = buildSun(AU * CRUISE_BODY_SCALE * 1.5);
    group.add(this.cruiseSun);

    const sunLight = new THREE.PointLight(0xfff0d8, 3.2, 0, 0);
    group.add(sunLight);

    // Planets, sized relative to each other so Mars still reads as the smaller
    // — but not so much smaller that it drops below a readable disc.
    this.cruiseEarth = buildPlanetGlobe(bodyScale, 'earth', 11);
    group.add(this.cruiseEarth);
    this.cruiseEarth.add(mapLabel('EARTH', bodyScale));

    this.cruiseMars = buildPlanetGlobe(
      bodyScale * Math.max(MARS.radius / EARTH.radius, 0.68),
      'mars',
      23,
    );
    group.add(this.cruiseMars);
    this.cruiseMars.add(mapLabel('MARS', bodyScale * 0.68));

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
    marker.material.map = softParticle('rgba(180,255,215,1)', 'rgba(60,220,150,0)');
    marker.scale.setScalar(AU * CRUISE_BODY_SCALE * 1.9);
    this.cruiseShip.add(marker);
    this.cruiseShip.add(mapLabel('ARES', AU * CRUISE_BODY_SCALE * 0.75, 0x8fe6bd));

    this.cruiseGroup = group;
    this.scene.add(group);

    // Hide the launch site and switch to a space environment. The orbital
    // Earth goes with it: the map view has its own, at map scale.
    this.complex.root.visible = false;
    this.sky.mesh.visible = false;
    if (this.farEarth) this.farEarth.visible = false;
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
    if (this.farEarth) this.farEarth.visible = false;
    // Mars's air is thin: the horizon is dusty, not walled off. At 0.00035 the
    // fog reached full extinction inside six kilometres and every surface shot
    // came out as a flat brown card. This is tuned so a mesa five kilometres
    // out is still clearly a mesa.
    this.scene.fog = new THREE.FogExp2(0xb87b4e, 0.000055);
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

    // ---- The planet itself, once there is height enough to see it ----
    // Below this the sky dome and the launch site are the world; above it they
    // are a few pixels of nothing and the Earth has to take over, or orbit is a
    // black screen with a rocket in it.
    if (altitude > FAR_EARTH_ALTITUDE * 0.75) this.ensureFarEarth();
    if (this.farEarth) {
      this.farEarth.visible = altitude > FAR_EARTH_ALTITUDE;
      this.farEarth.rotation.y += dt * 7.3e-5;
    }
    // The dome dissolves as the planet takes over, rather than cutting: it is
    // opaque, so left on it would simply paint over the Earth behind it.
    this.sky.setOpacity(1 - clamp((altitude - FAR_EARTH_ALTITUDE * 0.72) / 18_000, 0, 1));
    this.sky.mesh.visible = altitude < FAR_EARTH_ALTITUDE * 0.72 + 18_000;
    this.syncStarfield();
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

    this.syncStarfield();

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

    const altitude = flight.altitude();

    // Lock the render frame once the parachute is out — or, failing that, once
    // the vehicle is low enough that the ground has to be right. Until then the
    // frame follows the vehicle, keeping it over the middle of the patch.
    if (!this.marsOriginLocked) {
      this.marsOrigin.set(this._v.x, 0, this._v.z);
      if (sim.deployment.chute > 0.05 || altitude < MARS_FRAME_LOCK_ALTITUDE) {
        this.marsOriginLocked = true;
      }
    }
    const localX = this._v.x - this.marsOrigin.x;
    const localZ = this._v.z - this.marsOrigin.z;

    // Height comes from the altimeter, not from the render position.
    //
    // `renderPosition` is measured in a tangent plane pinned at the *entry*
    // point, and entry runs five hundred kilometres downrange — far enough that
    // the planet curves away by some forty kilometres underneath it. Taking the
    // vertical straight from that plane put the lander tens of kilometres below
    // the terrain, with the camera aimed at a point deep inside the ground,
    // which is why every landing frame came out as a flat brown card. In a
    // local frame anchored at the landing site the correct height is simply the
    // altitude above the datum, plus whatever relief the terrain has there.
    const groundY = mars.heightAt(localX, localZ);
    this.sim.vehicle.root.position.set(localX, altitude + groundY, localZ);
    this.sim.vehicle.root.quaternion.copy(flight.state.orientation);

    if (sim.shake > 0.001) {
      const t = sim.missionTime;
      this.sim.vehicle.root.position.x += Math.sin(t * 58) * sim.shake * 0.14;
      this.sim.vehicle.root.position.z += Math.sin(t * 67 + 0.7) * sim.shake * 0.14;
    }

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
    // Wind-blown dust is a surface phenomenon. It used to be emitted around the
    // camera at any altitude, which put metre-wide puffs across the lens while
    // the vehicle was still eleven kilometres up under its parachute.
    const cameraAltitude = this.cameraPosition.y - mars.heightAt(this.cameraPosition.x, this.cameraPosition.z);
    const nearSurface = cameraAltitude < 400;
    mars.dust.points.visible = nearSurface;
    if (nearSurface) {
      updateMarsDust(mars.dust, dt, this.cameraPosition, clamp(1 - cameraAltitude / 400, 0.15, 1));
    }

    // Aerial perspective thins out with height, the same way it does on the
    // climb from Earth — from orbit there is nothing between camera and ground.
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = lerp(0.000055, 0.000012, clamp(cameraAltitude / 12_000, 0, 1));
    }

    // Sky and shadows track the vehicle.
    mars.sky.position.copy(this.cameraPosition);
    mars.sunLight.target.position.copy(this.sim.vehicle.root.position);
    mars.sunLight.position
      .copy(this.sim.vehicle.root.position)
      .add(new THREE.Vector3(-320, 300, 220));
  }

  /**
   * Re-centres the starfield on the camera.
   *
   * It is drawn in the far-space pass, whose camera sits at the main camera's
   * position reduced by the pass scale — so the star sphere has to be reduced
   * by the same factor or it lands outside that pass's clip range entirely and
   * the sky goes empty in orbit.
   */
  private syncStarfield(): void {
    this.starfield.position.copy(this.cameraPosition).multiplyScalar(this.farSpaceScale());
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

  /**
   * Numeric state of the render frame, for the headless visual harness. The
   * screenshots alone cannot say *why* a frame is empty — this reports where
   * the camera, the vehicle and the ground actually are.
   */
  debugSnapshot(): Record<string, unknown> {
    const v = this.sim.vehicle.root.position;
    return {
      mode: this.mode,
      vehicle: [round2(v.x), round2(v.y), round2(v.z)],
      camera: [
        round2(this.cameraPosition.x),
        round2(this.cameraPosition.y),
        round2(this.cameraPosition.z),
      ],
      cameraToVehicle: round2(this.cameraPosition.distanceTo(v)),
      marsOrigin: [round2(this.marsOrigin.x), round2(this.marsOrigin.z)],
      marsOriginLocked: this.marsOriginLocked,
      groundUnderVehicle: this.mars ? round2(this.mars.heightAt(v.x, v.z)) : null,
      groundUnderCamera: this.mars
        ? round2(this.mars.heightAt(this.cameraPosition.x, this.cameraPosition.z))
        : null,
      altitude: round2(
        this.mode === 'mars' && this.sim.marsFlight
          ? this.sim.marsFlight.altitude()
          : this.sim.flight.altitude(),
      ),
    };
  }

  /**
   * Reduction factor for the renderer's far-space pass.
   *
   * The pass always runs — it is what draws the stars, which have to sit behind
   * everything else — but only the orbital phase needs it *scaled*, because
   * that is the only time something the size of a planet shares the frame with
   * something the size of a rocket.
   */
  farSpaceScale(): number {
    if (this.farEarth?.visible) return FAR_SPACE_SCALE;
    // Unscaled when only the stars need it, and skipped altogether when there
    // is nothing on the far layer to draw — the pass costs a full scene
    // traversal, and at the pad and on the ground it would draw nothing.
    return this.starfield.visible ? 1 : 0;
  }

  /**
   * Builds the orbital Earth, once, the first time the vehicle gets high enough
   * to see it. Radius and centre are the real ones, reduced by the far-space
   * factor — the vehicle's own position is reduced by exactly the same factor
   * when the far pass runs, so the horizon sits where the physics says it does.
   */
  private ensureFarEarth(): void {
    if (this.farEarth) return;

    const group = new THREE.Group();
    group.name = 'far-earth';

    const globe = buildPlanetGlobe(EARTH.radius * FAR_SPACE_SCALE, 'earth', 7);
    // The launch site is the world origin and sits on the surface, so the
    // planet's centre is one radius straight down.
    globe.position.y = -EARTH.radius * FAR_SPACE_SCALE;
    group.add(globe);

    // The far pass collects only lights that share its layer, so the planet
    // needs its own sun. Same direction as the one lighting the vehicle.
    const sun = new THREE.DirectionalLight(0xfff4e2, 3.6);
    sun.position.copy(this.sunLight.position).normalize().multiplyScalar(1e5);
    group.add(sun);
    group.add(sun.target);
    group.add(new THREE.AmbientLight(0x2c3d55, 0.5));

    group.traverse((o) => o.layers.set(LAYER_FAR_SPACE));
    group.visible = false;
    this.scene.add(group);
    this.farEarth = group;
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

/**
 * A small text label for the cruise map.
 *
 * The heliocentric view is a diagram, and an unlabelled diagram of four white
 * dots is not readable. The sprite is drawn to a canvas rather than added as a
 * DOM overlay so it moves with the body it names, at map scale, with no
 * per-frame projection maths.
 */
function mapLabel(text: string, bodyRadius: number, color = 0xdce8f4): THREE.Sprite {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 4;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 40px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      opacity: 0.85,
    }),
  );
  sprite.renderOrder = 30;
  // Sat just clear of the disc, sized so it stays legible without swamping it.
  sprite.scale.set(bodyRadius * 7.2, bodyRadius * 1.8, 1);
  sprite.position.y = bodyRadius * 2.1;
  return sprite;
}

/** Two decimal places, so the harness log stays readable. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
