/**
 * 3D diagnostic gizmos (spec §15, §16, §48).
 *
 * The tutorial is explicit that centre of mass, centre of thrust, the thrust
 * vector and the trajectory must be shown *visually*, not just described. So
 * these are real objects in the world, drawn at the positions the physics
 * actually uses: the yellow/black ball is where the vehicle balances, the blue
 * ring is where thrust acts, the magenta marker is the aerodynamic centre, and
 * the line between them is the static margin that decides whether the vehicle
 * flies straight or tumbles.
 */
import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';
import type { FlightSimulator } from '../physics/FlightDynamics';
import { clamp } from '../utils/math';

/** Classic centre-of-mass marker: quartered yellow and black sphere. */
function buildCoMMarker(radius: number): THREE.Group {
  const g = new THREE.Group();
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffd23a, toneMapped: false });
  const black = new THREE.MeshBasicMaterial({ color: 0x14161a, toneMapped: false });

  // Four quadrants alternating colour, which is how the marker is drawn in
  // engineering diagrams and reads instantly.
  for (let i = 0; i < 4; i++) {
    const quad = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 8, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI / 2),
      i % 2 === 0 ? yellow : black,
    );
    g.add(quad);
    const lower = new THREE.Mesh(
      new THREE.SphereGeometry(
        radius,
        12,
        8,
        (i * Math.PI) / 2,
        Math.PI / 2,
        Math.PI / 2,
        Math.PI / 2,
      ),
      i % 2 === 0 ? black : yellow,
    );
    g.add(lower);
  }
  return g;
}

/** Centre-of-thrust marker: a ring with an arrow showing the thrust direction. */
function buildCoTMarker(radius: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x35b6ea, toneMapped: false });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.18, 8, 20), mat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const spokes = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 1.1, radius * 0.14, radius * 0.14),
      mat,
    );
    spoke.position.set((Math.sin(a) * radius) / 2, 0, (Math.cos(a) * radius) / 2);
    spoke.rotation.y = -a + Math.PI / 2;
    spokes.add(spoke);
  }
  g.add(spokes);

  return g;
}

/** Centre-of-pressure marker: a magenta diamond. */
function buildCoPMarker(radius: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.OctahedronGeometry(radius, 0),
    new THREE.MeshBasicMaterial({ color: 0xe05fd0, toneMapped: false }),
  );
}

export class DiagnosticOverlay {
  readonly group = new THREE.Group();

  private readonly com: THREE.Group;
  private readonly cot: THREE.Group;
  private readonly cop: THREE.Mesh;
  private readonly marginLine: THREE.Line;
  private readonly thrustArrow: THREE.ArrowHelper;
  private readonly velocityArrow: THREE.ArrowHelper;
  private readonly trajectory: THREE.Line;

  private readonly trajectoryPoints: THREE.Vector3[] = [];
  private trajectoryTimer = 0;

  private enabled = false;

  constructor(vehicle: Vehicle) {
    this.group.name = 'diagnostics';
    this.group.visible = false;
    this.group.renderOrder = 40;

    const scale = Math.max(vehicle.maxDiameter * 0.16, 0.35);

    this.com = buildCoMMarker(scale);
    this.cot = buildCoTMarker(scale * 1.15);
    this.cop = buildCoPMarker(scale * 0.9);
    this.group.add(this.com, this.cot, this.cop);

    // The static-margin line: CoM to CoP. Its length and direction are the
    // whole stability story in one graphic.
    const marginGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.marginLine = new THREE.Line(
      marginGeo,
      new THREE.LineDashedMaterial({
        color: 0xffffff,
        dashSize: scale * 1.2,
        gapSize: scale * 0.8,
        transparent: true,
        opacity: 0.7,
      }),
    );
    this.group.add(this.marginLine);

    // Thrust vector, from the centre of thrust along the nozzle axis.
    this.thrustArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(),
      scale * 8,
      0xff7a2a,
      scale * 2,
      scale * 1.2,
    );
    this.group.add(this.thrustArrow);

    // Velocity vector, so angle of attack is visible as the angle between them.
    this.velocityArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      scale * 8,
      0x4fd08a,
      scale * 2,
      scale * 1.2,
    );
    this.group.add(this.velocityArrow);

    // Flown trajectory, accumulated as the mission progresses (spec §48).
    this.trajectory = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x35b6ea, transparent: true, opacity: 0.55 }),
    );
    this.trajectory.frustumCulled = false;

    this.makeGizmosDrawThrough();
  }

  /**
   * Diagnostic markers sit *inside* the vehicle they describe — the centre of
   * mass is by definition somewhere in the middle of the hull. Depth testing is
   * therefore disabled across the whole overlay so the gizmos read through the
   * structure, which is the entire point of a diagnostic view.
   */
  private makeGizmosDrawThrough(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Line;
      const mat = (m as THREE.Mesh).material;
      if (!mat) return;
      for (const material of Array.isArray(mat) ? mat : [mat]) {
        material.depthTest = false;
        material.depthWrite = false;
        material.transparent = true;
        material.needsUpdate = true;
      }
      o.renderOrder = 40;
    });
  }

  /** The trajectory line lives in world space, so it is added separately. */
  get trajectoryObject(): THREE.Line {
    return this.trajectory;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
    this.trajectory.visible = on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Updates the gizmos. The overlay is parented to the vehicle, so marker
   * positions are simply the local-space values the mass calculation returns.
   */
  update(dt: number, vehicle: Vehicle, flight: FlightSimulator | null): void {
    if (!this.enabled) return;

    const mp = vehicle.massProperties();

    this.com.position.copy(mp.centreOfMass);
    this.cot.position.copy(mp.centreOfThrust);
    this.cop.position.copy(mp.centreOfPressure);

    // Spin the markers slowly so they read as gizmos, not vehicle hardware.
    this.com.rotation.y += dt * 0.6;
    this.cop.rotation.y += dt * 0.9;
    this.cop.rotation.x += dt * 0.4;

    // Static-margin line.
    const positions = this.marginLine.geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, mp.centreOfMass.x, mp.centreOfMass.y, mp.centreOfMass.z);
    positions.setXYZ(1, mp.centreOfPressure.x, mp.centreOfPressure.y, mp.centreOfPressure.z);
    positions.needsUpdate = true;
    this.marginLine.geometry.computeBoundingSphere();
    this.marginLine.computeLineDistances();

    // Colour the margin line by whether the vehicle is stable.
    const mat = this.marginLine.material as THREE.LineDashedMaterial;
    mat.color.setHex(mp.staticMargin > 0 ? 0x4fd08a : 0xe8543f);

    // Thrust vector length scales with actual thrust.
    const thrustScale = flight
      ? clamp(vehicle.activeEngines().reduce((s, e) => s + e.throttle, 0), 0, 4)
      : 0;
    this.thrustArrow.position.copy(mp.centreOfThrust);
    this.thrustArrow.setDirection(new THREE.Vector3(0, -1, 0));
    this.thrustArrow.setLength(
      Math.max(vehicle.maxDiameter * (1 + thrustScale * 2.4), 0.1),
      vehicle.maxDiameter * 0.5,
      vehicle.maxDiameter * 0.3,
    );
    this.thrustArrow.visible = thrustScale > 0.01;

    // Velocity vector, transformed into the vehicle's local frame.
    if (flight && flight.state.velocity.lengthSq() > 1) {
      const localVel = flight.state.velocity
        .clone()
        .applyQuaternion(flight.state.orientation.clone().invert())
        .normalize();
      this.velocityArrow.position.copy(mp.centreOfMass);
      this.velocityArrow.setDirection(localVel);
      this.velocityArrow.setLength(
        vehicle.maxDiameter * 3.5,
        vehicle.maxDiameter * 0.5,
        vehicle.maxDiameter * 0.3,
      );
      this.velocityArrow.visible = true;
    } else {
      this.velocityArrow.visible = false;
    }

    // ---- Trajectory trail ----
    if (flight) {
      this.trajectoryTimer += dt;
      if (this.trajectoryTimer > 0.28) {
        this.trajectoryTimer = 0;
        this.trajectoryPoints.push(flight.renderPosition(new THREE.Vector3()));
        // Cap the trail so a long mission does not grow without bound.
        if (this.trajectoryPoints.length > 1_400) this.trajectoryPoints.shift();
        this.trajectory.geometry.dispose();
        this.trajectory.geometry = new THREE.BufferGeometry().setFromPoints(
          this.trajectoryPoints,
        );
      }
    }
  }

  clearTrajectory(): void {
    this.trajectoryPoints.length = 0;
    this.trajectory.geometry.dispose();
    this.trajectory.geometry = new THREE.BufferGeometry();
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    this.trajectory.geometry.dispose();
  }
}
