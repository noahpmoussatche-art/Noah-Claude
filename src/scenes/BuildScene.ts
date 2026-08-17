/**
 * The workshop scene — where the vehicle is designed (spec §22, §78).
 *
 * The vehicle under construction stands full-size in a real high bay, with the
 * two ducks on the floor beside it. Because everything is at true metre scale,
 * the moment a player adds a second tank they can see the stack grow past the
 * work platforms and dwarf the characters, which is the point (spec §21).
 */
import * as THREE from 'three';
import { buildWorkshop, type WorkshopRefs } from './Interiors';
import { Vehicle } from '../vehicles/Vehicle';
import type { VehicleDesign } from '../vehicles/VehicleDesign';
import { createCrew, type DuckActor } from '../characters/DuckActor';
import { DiagnosticOverlay } from '../ui/DiagnosticOverlay';
import { clamp, damp } from '../utils/math';

export class BuildScene {
  readonly scene = new THREE.Scene();
  readonly workshop: WorkshopRefs;
  readonly crew: { engineer: DuckActor; pilot: DuckActor };

  /** The live preview vehicle, rebuilt whenever the design changes. */
  vehicle: Vehicle | null = null;
  diagnostics: DiagnosticOverlay | null = null;

  private readonly vehicleAnchor = new THREE.Group();
  private craneTarget = 0;
  private time = 0;

  constructor() {
    this.workshop = buildWorkshop();
    this.scene.add(this.workshop.root);
    this.scene.add(this.vehicleAnchor);
    this.vehicleAnchor.position.copy(this.workshop.assemblyPoint);

    this.crew = createCrew();
    const marks = this.workshop.crewMarks;
    this.crew.engineer.placeAt(marks[0].x, marks[0].y, marks[0].z, 0.4);
    this.crew.pilot.placeAt(marks[1].x, marks[1].y, marks[1].z, 0.2);
    this.crew.engineer.setPose('inspect');
    this.crew.pilot.setPose('idle');
    this.scene.add(this.crew.engineer.object);
    this.scene.add(this.crew.pilot.object);

    this.scene.background = new THREE.Color(0x141a22);
  }

  /** Replaces the preview vehicle with one built from the current design. */
  setDesign(design: VehicleDesign): void {
    if (this.vehicle) {
      this.vehicleAnchor.remove(this.vehicle.root);
      this.vehicle.dispose();
      this.vehicle = null;
    }
    if (this.diagnostics) {
      this.diagnostics.dispose();
      this.diagnostics.group.removeFromParent();
      this.diagnostics.trajectoryObject.removeFromParent();
      this.diagnostics = null;
    }

    if (design.stack.length === 0) return;

    this.vehicle = new Vehicle(design);
    this.vehicleAnchor.add(this.vehicle.root);

    // Legs and solar wings are stowed in the workshop; nothing is deployed on
    // the ground, which is exactly how it looks before rollout.
    for (const pivot of this.vehicle.legPivots) pivot.rotation.z = 0;

    this.diagnostics = new DiagnosticOverlay(this.vehicle);
    this.vehicle.root.add(this.diagnostics.group);
    this.scene.add(this.diagnostics.trajectoryObject);

    // Park the crane above the top of the stack, as if it just placed the part.
    this.craneTarget = clamp(this.vehicle.height + 12, 18, 62);
  }

  setDiagnosticsEnabled(on: boolean): void {
    this.diagnostics?.setEnabled(on);
  }

  /** Point the camera should frame: the middle of the vehicle. */
  focusPoint(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.vehicle) return target.copy(this.workshop.assemblyPoint).setY(8);
    return target
      .copy(this.vehicleAnchor.position)
      .setY(this.vehicleAnchor.position.y + this.vehicle.height * 0.45);
  }

  /** How far back the camera needs to be to hold the whole vehicle. */
  framingDistance(): number {
    const h = this.vehicle?.height ?? 12;
    return clamp(h * 1.45, 18, 150);
  }

  update(dt: number): void {
    this.time += dt;

    // The crane rides up and down the bay, so the workshop is never static.
    const crane = this.workshop.crane;
    crane.position.y = damp(crane.position.y, this.craneTarget + 8, 1.2, dt);
    crane.position.z = Math.sin(this.time * 0.16) * 14;

    // Robotic arms idle-animate: slow articulation with a working weld flicker.
    for (let i = 0; i < this.workshop.arms.length; i++) {
      const arm = this.workshop.arms[i];
      const shoulder = arm.getObjectByName('arm-shoulder');
      const elbow = arm.getObjectByName('arm-elbow');
      const wrist = arm.getObjectByName('arm-wrist');
      const phase = this.time * 0.4 + i * 2.1;

      if (shoulder) shoulder.rotation.z = 0.35 + Math.sin(phase) * 0.22;
      if (elbow) elbow.rotation.z = -0.85 + Math.sin(phase * 1.3 + 1) * 0.3;
      if (wrist) wrist.rotation.y = Math.sin(phase * 0.7) * 0.6;

      const tip = arm.getObjectByName('weld-tip');
      if (tip) {
        // Welding arc: on in bursts, not continuously.
        const arc = Math.sin(phase * 9) > 0.4 && Math.sin(phase * 0.6) > 0;
        tip.visible = arc;
        tip.scale.setScalar(arc ? 1 + Math.random() * 0.7 : 1);
      }
    }

    // The crew watch the vehicle and react to how big it is getting.
    const focus = this.focusPoint(new THREE.Vector3());
    this.crew.engineer.lookAt(focus);
    this.crew.pilot.lookAt(focus);
    this.crew.engineer.update(dt);
    this.crew.pilot.update(dt);

    if (this.diagnostics && this.vehicle) {
      this.diagnostics.update(dt, this.vehicle, null);
    }
  }

  dispose(): void {
    this.vehicle?.dispose();
    this.diagnostics?.dispose();
    this.crew.engineer.dispose();
    this.crew.pilot.dispose();
  }
}
