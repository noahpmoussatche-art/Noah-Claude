/**
 * Telemetry recording for the post-mission replay (spec §51).
 *
 * The recorder samples the actual simulated state at a fixed cadence, so a
 * replay is a playback of what really happened rather than a re-run that might
 * diverge. Samples are stored in flat typed arrays to keep an eight-month cruise
 * from becoming a memory problem.
 */
import * as THREE from 'three';
import type { MissionState } from '../data/constants';
import type { FlightSimulator, FlightTelemetry } from '../physics/FlightDynamics';

/** Seconds of mission time between recorded samples. */
const SAMPLE_INTERVAL = 0.1;
/** Hard cap on stored samples (~2 hours of dense flight). */
const MAX_SAMPLES = 72_000;

export interface TelemetrySample {
  time: number;
  state: MissionState;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  altitude: number;
  airspeed: number;
  mach: number;
  dynamicPressure: number;
  gForce: number;
  thrust: number;
  mass: number;
  propellantFraction: number;
}

export class TelemetryRecorder {
  private readonly time: number[] = [];
  private readonly states: MissionState[] = [];
  private readonly pos: number[] = [];
  private readonly quat: number[] = [];
  private readonly scalars: number[] = [];

  private nextSampleAt = -Infinity;

  get count(): number {
    return this.time.length;
  }

  get duration(): number {
    return this.time.length > 0 ? this.time[this.time.length - 1] - this.time[0] : 0;
  }

  get startTime(): number {
    return this.time.length > 0 ? this.time[0] : 0;
  }

  /** Records a sample if enough mission time has passed. */
  sample(
    missionTime: number,
    state: MissionState,
    flight: FlightSimulator,
    telemetry: FlightTelemetry,
  ): void {
    if (missionTime < this.nextSampleAt) return;
    if (this.time.length >= MAX_SAMPLES) return;
    this.nextSampleAt = missionTime + SAMPLE_INTERVAL;

    const p = flight.renderPosition(new THREE.Vector3());
    const q = flight.state.orientation;

    this.time.push(missionTime);
    this.states.push(state);
    this.pos.push(p.x, p.y, p.z);
    this.quat.push(q.x, q.y, q.z, q.w);
    this.scalars.push(
      telemetry.altitude,
      telemetry.airspeed,
      telemetry.mach,
      telemetry.dynamicPressure,
      telemetry.gForce,
      telemetry.thrust,
      telemetry.massProperties.totalMass,
      telemetry.propellantFraction,
    );
  }

  /** Reads back the sample nearest a mission time. */
  at(missionTime: number): TelemetrySample | null {
    if (this.time.length === 0) return null;

    // Binary search for the first sample at or after the requested time.
    let lo = 0;
    let hi = this.time.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.time[mid] < missionTime) lo = mid + 1;
      else hi = mid;
    }
    return this.get(lo);
  }

  get(index: number): TelemetrySample | null {
    if (index < 0 || index >= this.time.length) return null;
    const s = index * 8;
    return {
      time: this.time[index],
      state: this.states[index],
      position: new THREE.Vector3(this.pos[index * 3], this.pos[index * 3 + 1], this.pos[index * 3 + 2]),
      orientation: new THREE.Quaternion(
        this.quat[index * 4],
        this.quat[index * 4 + 1],
        this.quat[index * 4 + 2],
        this.quat[index * 4 + 3],
      ),
      altitude: this.scalars[s],
      airspeed: this.scalars[s + 1],
      mach: this.scalars[s + 2],
      dynamicPressure: this.scalars[s + 3],
      gForce: this.scalars[s + 4],
      thrust: this.scalars[s + 5],
      mass: this.scalars[s + 6],
      propellantFraction: this.scalars[s + 7],
    };
  }

  /** Peak value of a recorded scalar, for the post-flight summary. */
  peak(field: 'altitude' | 'airspeed' | 'mach' | 'dynamicPressure' | 'gForce'): number {
    const offset = { altitude: 0, airspeed: 1, mach: 2, dynamicPressure: 3, gForce: 4 }[field];
    let best = 0;
    for (let i = 0; i < this.time.length; i++) {
      best = Math.max(best, this.scalars[i * 8 + offset]);
    }
    return best;
  }

  clear(): void {
    this.time.length = 0;
    this.states.length = 0;
    this.pos.length = 0;
    this.quat.length = 0;
    this.scalars.length = 0;
    this.nextSampleAt = -Infinity;
  }
}
