/**
 * Rigid-body flight dynamics (spec §14, §17, §79).
 *
 * This is a real integrator, not an animation. Translation comes from thrust,
 * inverse-square gravity and atmospheric drag; rotation comes from aerodynamic
 * moments about the centre of pressure, thrust-vector control at the gimbal, and
 * any lateral thrust offset the player built into the vehicle. A stack whose
 * centre of pressure sits ahead of its centre of mass really will diverge, and
 * the guidance system really can fail to catch it.
 *
 * Frame convention: planet-centred inertial. The launch site sits at
 * (0, R, 0), so local "up" at the pad is +Y and the render scene is simply the
 * physics frame shifted down by the planet radius.
 */
import * as THREE from 'three';
import type { PlanetConstants } from '../data/constants';
import { EARTH, G0_ISP } from '../data/constants';
import {
  density,
  dragRise,
  dynamicPressure,
  speedOfSound,
  stagnationHeatFlux,
} from './Atmosphere';
import type { MassProperties, Vehicle } from '../vehicles/Vehicle';
import { clamp } from '../utils/math';

export interface FlightState {
  /** Planet-centred position, m. */
  position: THREE.Vector3;
  /** Planet-centred velocity, m/s. */
  velocity: THREE.Vector3;
  /** Vehicle attitude; local +Y is the nose. */
  orientation: THREE.Quaternion;
  /** Body angular velocity, rad/s, in world axes. */
  angularVelocity: THREE.Vector3;
  /** Mission elapsed time, s. */
  time: number;
  /** Accumulated heat load on the windward face, J/m^2. */
  heatLoad: number;
  /** True once the vehicle has lost attitude control beyond recovery. */
  tumbling: boolean;
  /** True once the vehicle has broken up. */
  destroyed: boolean;
  /** True while the vehicle is resting on the ground. */
  landed: boolean;
}

/** Read-only derived quantities produced by each step, for HUD and cinematics. */
export interface FlightTelemetry {
  altitude: number;
  /** Speed relative to the rotating atmosphere, m/s. */
  airspeed: number;
  /** Inertial speed, m/s. */
  orbitalSpeed: number;
  verticalSpeed: number;
  downrange: number;
  mach: number;
  dynamicPressure: number;
  /** Sensed acceleration (thrust + drag, excluding gravity), m/s^2. */
  gForce: number;
  thrust: number;
  /** Angle between the nose and the velocity vector, degrees. */
  angleOfAttack: number;
  /** Flight-path angle above the local horizon, degrees. */
  flightPathAngle: number;
  heatFlux: number;
  apoapsis: number;
  periapsis: number;
  massProperties: MassProperties;
  /** Fraction of the total propellant load remaining, 0..1. */
  propellantFraction: number;
}

/** What the autopilot is currently trying to do (spec §76 — the player watches). */
export type GuidanceMode =
  | 'hold-vertical'
  | 'gravity-turn'
  | 'prograde'
  | 'retrograde'
  | 'entry-attitude'
  | 'landing-burn'
  | 'landing-vertical'
  | 'circularize'
  | 'coast';

export interface GuidanceCommand {
  mode: GuidanceMode;
  /** Commanded throttle, 0..1. */
  throttle: number;
  /**
   * Pitch relative to the local horizon, radians, used by `circularize`.
   * Positive points above the horizon (raises apoapsis), negative below it
   * (holds apoapsis down while still adding horizontal velocity).
   */
  pitchBias?: number;
  /**
   * Altitude at which the gravity turn finishes, metres. The turn must not
   * complete far below the target orbit: a vehicle that is already flying
   * horizontally at 90 km reaches orbital velocity down there, which pins its
   * periapsis inside the atmosphere no matter how much propellant is left.
   */
  turnEndAltitude?: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Shape of the gravity-turn pitch programme. Lower values pitch over harder
 * early (trading altitude for downrange speed), higher values fly steeper.
 * Tuned so the reference vehicles arrive at their target altitude with close to
 * orbital velocity rather than running out of propellant at either extreme.
 */
const TURN_EXPONENT = Number(
  (globalThis as { __osaTurnExponent?: number }).__osaTurnExponent ?? 0.5,
);

export class FlightSimulator {
  readonly planet: PlanetConstants;
  readonly vehicle: Vehicle;
  readonly state: FlightState;

  /** Set when the atmosphere should be treated as co-rotating with the planet. */
  private readonly rotationRate: number;

  /** Scratch vectors, reused every step to avoid per-frame allocation. */
  private readonly _v = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _nose = new THREE.Vector3();
  private readonly _force = new THREE.Vector3();
  private readonly _torque = new THREE.Vector3();

  constructor(planet: PlanetConstants, vehicle: Vehicle, startAltitude = 0) {
    this.planet = planet;
    this.vehicle = vehicle;
    this.rotationRate = (Math.PI * 2) / planet.rotationPeriod;

    this.state = {
      position: new THREE.Vector3(0, planet.radius + startAltitude, 0),
      velocity: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      angularVelocity: new THREE.Vector3(),
      time: 0,
      heatLoad: 0,
      tumbling: false,
      destroyed: false,
      landed: startAltitude <= 0,
    };
  }

  /**
   * Velocity relative to the co-rotating atmosphere — the vehicle's speed over
   * the ground. This is what a landing controller has to cancel.
   */
  surfaceVelocity(target = new THREE.Vector3()): THREE.Vector3 {
    const atm = this.atmosphereVelocity(new THREE.Vector3());
    return target.copy(this.state.velocity).sub(atm);
  }

  /** Altitude above the planet datum, m. */
  altitude(): number {
    return this.state.position.length() - this.planet.radius;
  }

  /** Local up direction at the vehicle's position. */
  localUp(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.state.position).normalize();
  }

  /** Velocity of the co-rotating atmosphere at the vehicle's position. */
  private atmosphereVelocity(target: THREE.Vector3): THREE.Vector3 {
    // Planet spins about +Y in this frame.
    return target.set(
      -this.state.position.z * this.rotationRate,
      0,
      this.state.position.x * this.rotationRate,
    );
  }

  /**
   * Advances the simulation by dt seconds using semi-implicit Euler, which is
   * stable for the stiff thrust/gravity coupling here and conserves energy far
   * better than explicit Euler at the step sizes the game uses.
   */
  step(dt: number, guidance: GuidanceCommand): FlightTelemetry {
    const s = this.state;
    const mp = this.vehicle.massProperties();

    const rMag = s.position.length();
    const altitude = rMag - this.planet.radius;
    this._up.copy(s.position).multiplyScalar(1 / rMag);

    // ---- Atmosphere-relative velocity ----
    const atmVel = this.atmosphereVelocity(this._v.clone());
    const vRel = new THREE.Vector3().subVectors(s.velocity, atmVel);
    const airspeed = vRel.length();

    const rho = density(this.planet, altitude);
    const sound = speedOfSound(this.planet, altitude);
    const mach = airspeed / sound;
    const q = dynamicPressure(rho, airspeed);

    // ---- Attitude ----
    this._nose.set(0, 1, 0).applyQuaternion(s.orientation).normalize();

    const vHat =
      airspeed > 0.5 ? vRel.clone().multiplyScalar(1 / airspeed) : this._nose.clone();
    const aoaCos = clamp(this._nose.dot(vHat), -1, 1);
    const angleOfAttack = Math.acos(aoaCos);

    // ---- Thrust ----
    // Nozzle performance interpolates between sea-level and vacuum by ambient
    // pressure, which is why a vacuum bell is useless at liftoff.
    //
    // The reference for "sea level" is EARTH's sea level, because that is what
    // the engines' quoted thrustSL means. Using the local planet's surface
    // density instead would treat the Martian surface — six-tenths of a percent
    // of an Earth atmosphere — as full back-pressure, and rob a descent engine
    // of half its thrust exactly when it is needed.
    const pressureRatio = clamp(rho / EARTH.rho0, 0, 1);
    let thrustMag = 0;
    let massFlow = 0;
    const stage = this.vehicle.currentStage();

    for (const e of this.vehicle.activeEngines()) {
      if (!e.operational || e.throttle <= 0) continue;
      const spec = e.def.engine!;
      const t = spec.thrustVac + (spec.thrustSL - spec.thrustVac) * pressureRatio;
      const isp = spec.ispVac + (spec.ispSL - spec.ispVac) * pressureRatio;
      const eThrust = t * e.throttle;
      thrustMag += eThrust;
      massFlow += eThrust / (isp * G0_ISP);
      e.burnTime += dt;
    }

    // Draw the propellant this step actually consumed. Running dry cuts thrust.
    if (massFlow > 0) {
      const wanted = massFlow * dt;
      const drawn = this.vehicle.drawPropellant(stage, wanted);
      if (drawn < wanted - 1e-6) {
        const ratio = wanted > 0 ? drawn / wanted : 0;
        thrustMag *= ratio;
        if (ratio < 0.02) {
          for (const e of this.vehicle.activeEngines()) e.throttle = 0;
        }
      }
    }

    // ---- Forces ----
    const mass = Math.max(mp.totalMass, 1);
    this._force.set(0, 0, 0);

    // Gravity.
    const gMag = this.planet.mu / (rMag * rMag);
    this._force.addScaledVector(this._up, -gMag * mass);

    // Thrust along the nose.
    this._force.addScaledVector(this._nose, thrustMag);

    // Drag, opposing the airflow. Angle of attack increases the effective area,
    // so a tumbling vehicle is dragged far harder than a nose-first one.
    const aoaDragFactor = 1 + 3.2 * Math.sin(angleOfAttack) * Math.sin(angleOfAttack);
    const dragMag = q * mp.dragArea * dragRise(mach) * aoaDragFactor;
    if (airspeed > 0.1) {
      this._force.addScaledVector(vHat, -dragMag);
    }

    const sensedAccel = (thrustMag + dragMag) / mass;

    // ---- Torques ----
    this._torque.set(0, 0, 0);

    if (airspeed > 12 && rho > 1e-6 && angleOfAttack > 1e-4) {
      // Aerodynamic moment about the centre of mass, computed the general way:
      //
      //     torque = (r_CoP − r_CoM) × F_aero
      //
      // Deriving it rather than assuming "rotate the nose toward the velocity"
      // matters, because that assumption is only true for a nose-forward
      // vehicle. An entry capsule is stable flying its *heat shield* forward,
      // and the cross product produces that automatically from the geometry:
      // the vehicle turns until its centre of pressure trails its centre of
      // mass, whichever end that puts into the airflow.
      const lever = this._nose
        .clone()
        .multiplyScalar(mp.centreOfPressure.y - mp.centreOfMass.y);
      const aeroForce = vHat
        .clone()
        .multiplyScalar(-q * mp.dragArea * 1.6 * Math.sin(angleOfAttack));
      this._torque.add(lever.cross(aeroForce));

      // Fins add extra restoring authority proportional to dynamic pressure,
      // always acting to align the nose with the airflow.
      const finAxis = new THREE.Vector3().crossVectors(this._nose, vHat);
      if (finAxis.lengthSq() > 1e-12) {
        finAxis.normalize();
        this._torque.addScaledVector(
          finAxis,
          q * mp.liftAuthority * Math.sin(angleOfAttack) * 0.04,
        );
      }
    }

    // Thrust-vector control: the autopilot steers toward the commanded attitude.
    const desired = this.desiredAttitude(guidance, vHat, this._up);
    // How far the vehicle is from the attitude it is being asked to hold. This,
    // not the angle of attack, is the measure of whether control has been lost:
    // an entry capsule deliberately flies at 180 degrees angle of attack, and
    // judging it by angle of attack alone would declare every correct entry a
    // tumble and switch off its attitude control.
    const controlError = Math.acos(clamp(this._nose.dot(desired), -1, 1));

    if (!s.tumbling && this.vehicle.hasCommandModule()) {
      const err = new THREE.Vector3().crossVectors(this._nose, desired);
      const errMag = clamp(err.length(), 0, 1);
      if (errMag > 1e-5) {
        err.multiplyScalar(1 / errMag);
        const gimbalArm = Math.abs(mp.centreOfMass.y - mp.centreOfThrust.y);
        const maxGimbal = this.maxGimbalRadians();
        // Proportional-derivative law, saturated at the physical gimbal limit.
        const angleErr = Math.asin(errMag);
        const rateErr = s.angularVelocity.dot(err);
        const command = clamp(angleErr * 2.2 - rateErr * 1.6, -maxGimbal, maxGimbal);
        const controlTorque = thrustMag * Math.sin(command) * gimbalArm;
        this._torque.addScaledVector(err, controlTorque);
      }
    }

    // A lateral thrust offset is a permanent, uncommanded moment.
    if (mp.thrustOffset > 1e-3 && thrustMag > 0) {
      const offsetDir = new THREE.Vector3(
        mp.centreOfThrust.x - mp.centreOfMass.x,
        0,
        mp.centreOfThrust.z - mp.centreOfMass.z,
      ).normalize();
      const axis = new THREE.Vector3().crossVectors(this._nose, offsetDir).normalize();
      const arm = Math.abs(mp.centreOfMass.y - mp.centreOfThrust.y);
      this._torque.addScaledVector(axis, thrustMag * mp.thrustOffset * 0.5 * Math.sign(arm || 1));
    }

    // Aerodynamic damping — a body moving through air resists rotation.
    if (rho > 1e-7) {
      this._torque.addScaledVector(
        s.angularVelocity,
        -q * mp.dragArea * 0.9 * this.vehicle.height * 0.01,
      );
    }

    // ---- Integrate ----
    const accel = this._force.multiplyScalar(1 / mass);
    s.velocity.addScaledVector(accel, dt);
    s.position.addScaledVector(s.velocity, dt);

    const angAccel = this._torque.multiplyScalar(1 / mp.inertia);
    s.angularVelocity.addScaledVector(angAccel, dt);
    // Light structural damping keeps the integrator from ringing.
    s.angularVelocity.multiplyScalar(Math.exp(-0.05 * dt));

    const omega = s.angularVelocity.length();
    if (omega > 1e-7) {
      const dq = new THREE.Quaternion().setFromAxisAngle(
        s.angularVelocity.clone().multiplyScalar(1 / omega),
        omega * dt,
      );
      s.orientation.premultiply(dq).normalize();
    }

    s.time += dt;

    // ---- Failure conditions (spec §52) ----
    // Losing attitude authority at high dynamic pressure is unrecoverable —
    // measured against the commanded attitude, not against the airflow.
    if (!s.tumbling && controlError > Math.PI / 2.2 && q > 4_000) {
      s.tumbling = true;
    }
    if (s.tumbling && q * mp.dragArea > this.vehicle.weakestStructure()) {
      s.destroyed = true;
    }

    // ---- Heating ----
    const noseRadius = Math.max(this.vehicle.maxDiameter * 0.25, 0.3);
    const heatFlux = stagnationHeatFlux(rho, airspeed, noseRadius);
    s.heatLoad += heatFlux * dt;

    // ---- Orbit elements ----
    const { apoapsis, periapsis } = this.orbitElements();

    const capacity = this.vehicle.tanks.reduce((sum, t) => sum + t.capacity, 0);
    const remaining = this.vehicle.tanks.reduce((sum, t) => sum + t.remaining, 0);

    return {
      altitude,
      airspeed,
      orbitalSpeed: s.velocity.length(),
      verticalSpeed: s.velocity.dot(this._up),
      downrange: this.downrange(),
      mach,
      dynamicPressure: q,
      gForce: sensedAccel / 9.80665,
      thrust: thrustMag,
      angleOfAttack: (angleOfAttack * 180) / Math.PI,
      flightPathAngle:
        airspeed > 1 ? (Math.asin(clamp(vHat.dot(this._up), -1, 1)) * 180) / Math.PI : 90,
      heatFlux,
      apoapsis,
      periapsis,
      massProperties: mp,
      propellantFraction: capacity > 0 ? remaining / capacity : 0,
    };
  }

  /** Largest gimbal deflection the current engines can produce, radians. */
  private maxGimbalRadians(): number {
    let best = 0;
    for (const e of this.vehicle.activeEngines()) {
      if (!e.operational || e.throttle <= 0) continue;
      best = Math.max(best, e.def.engine!.gimbalRange);
    }
    return (best * Math.PI) / 180;
  }

  /** Converts a guidance mode into a world-space direction for the nose. */
  private desiredAttitude(
    guidance: GuidanceCommand,
    vHat: THREE.Vector3,
    up: THREE.Vector3,
  ): THREE.Vector3 {
    switch (guidance.mode) {
      case 'hold-vertical':
        return up.clone();

      case 'gravity-turn': {
        // Pitch program: hold vertical off the pad, then roll progressively
        // into the turn, reaching horizontal only as the vehicle approaches its
        // target orbital altitude. Turning over too early is the classic ascent
        // mistake — it burns the propellant into downrange speed at low
        // altitude and leaves periapsis buried in the atmosphere.
        const alt = this.altitude();
        const start = 250;
        const end = Math.max(guidance.turnEndAltitude ?? this.planet.atmosphereTop, 20_000);
        const t = clamp((alt - start) / (end - start), 0, 1);
        const pitchFromVertical =
          (Math.PI / 2) * Math.pow(t, TURN_EXPONENT) * 0.99;

        // Downrange direction: the horizontal component of the current velocity,
        // falling back to +X so the very first pitch-over has a heading.
        const horiz = new THREE.Vector3()
          .copy(this.state.velocity)
          .addScaledVector(up, -this.state.velocity.dot(up));
        if (horiz.lengthSq() < 1e-4) horiz.set(1, 0, 0);
        horiz.normalize();

        return up
          .clone()
          .multiplyScalar(Math.cos(pitchFromVertical))
          .addScaledVector(horiz, Math.sin(pitchFromVertical))
          .normalize();
      }

      case 'prograde':
        return vHat.clone();

      case 'circularize': {
        // Apoapsis-hold steering. The burn is aimed at a commanded angle
        // relative to the local horizon: level adds pure horizontal velocity,
        // pitching below the horizon holds a runaway apoapsis down while still
        // building the horizontal speed that lifts periapsis. This is the
        // closed loop that turns a ballistic arc into an actual orbit.
        const horiz = vHat.clone().addScaledVector(up, -vHat.dot(up));
        if (horiz.lengthSq() < 1e-6) return vHat.clone();
        horiz.normalize();

        const pitch = guidance.pitchBias ?? 0;
        return horiz
          .multiplyScalar(Math.cos(pitch))
          .addScaledVector(up, Math.sin(pitch))
          .normalize();
      }

      case 'retrograde':
      case 'landing-burn':
        return vHat.clone().negate();

      case 'landing-vertical':
        // Straight up. Once horizontal drift is cancelled, all the engine has
        // to do is hold the vehicle against gravity while it settles.
        return up.clone();

      case 'entry-attitude': {
        // Blunt-body entry: heat shield into the airflow, held at a small angle
        // of attack for a little lift.
        return vHat.clone().negate();
      }

      case 'coast':
      default:
        return new THREE.Vector3(0, 1, 0).applyQuaternion(this.state.orientation);
    }
  }

  /** Great-circle distance travelled from the launch site, m. */
  private downrange(): number {
    const start = new THREE.Vector3(0, 1, 0);
    const now = this.state.position.clone().normalize();
    const angle = Math.acos(clamp(start.dot(now), -1, 1));
    return angle * this.planet.radius;
  }

  /** Two-body apoapsis and periapsis altitudes, m above the datum. */
  orbitElements(): { apoapsis: number; periapsis: number; eccentricity: number } {
    const r = this.state.position;
    const v = this.state.velocity;
    const mu = this.planet.mu;
    const rMag = r.length();
    const vMag = v.length();

    const energy = (vMag * vMag) / 2 - mu / rMag;
    // Parabolic or hyperbolic: no bound orbit.
    if (energy >= -1e-9) {
      return { apoapsis: Infinity, periapsis: -this.planet.radius, eccentricity: 1 };
    }

    const a = -mu / (2 * energy);
    const h = new THREE.Vector3().crossVectors(r, v);
    const hMag = h.length();
    const eSq = 1 - (hMag * hMag) / (a * mu);
    const e = Math.sqrt(Math.max(eSq, 0));

    return {
      apoapsis: a * (1 + e) - this.planet.radius,
      periapsis: a * (1 - e) - this.planet.radius,
      eccentricity: e,
    };
  }

  /**
   * Resolves contact with the ground: stops the vehicle at the surface and
   * reports the touchdown speed so the caller can judge survival.
   */
  resolveGroundContact(surfaceAltitude = 0): { touched: boolean; speed: number } {
    const alt = this.altitude();
    if (alt > surfaceAltitude) return { touched: false, speed: 0 };

    // Touchdown speed is speed relative to the *ground*, not inertial speed.
    // The surface is moving with the planet's rotation, and the landing gear
    // does not care how fast Mars is turning — only how hard the vehicle hits
    // the ground it is landing on.
    const speed = this.surfaceVelocity().length();

    this.state.position.setLength(this.planet.radius + surfaceAltitude);
    this.state.velocity.set(0, 0, 0);
    this.state.angularVelocity.set(0, 0, 0);
    this.state.landed = true;

    return { touched: true, speed };
  }

  /**
   * Converts the planet-centred state into the local render frame, where the
   * launch site is the origin and +Y is up.
   */
  renderPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.state.position).sub(new THREE.Vector3(0, this.planet.radius, 0));
  }

  /** Applies the flight state to a 3D object in the local render frame. */
  applyTo(object: THREE.Object3D): void {
    this.renderPosition(object.position);
    object.quaternion.copy(this.state.orientation);
  }

  /** Points the vehicle along a world direction immediately (used at spawn). */
  setAttitude(direction: THREE.Vector3): void {
    this.state.orientation.setFromUnitVectors(WORLD_UP, direction.clone().normalize());
  }
}
