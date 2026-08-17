/**
 * Landing hardware (spec §35, §36).
 *
 * Legs are hinged four-bar assemblies with real footpads and suspension
 * cylinders, so they can fold for launch and deploy for touchdown. Parachutes
 * start as a packed mortar can and inflate through a visible reefed stage
 * before reaching full canopy — they never simply appear.
 */
import * as THREE from 'three';
import { Materials } from '../../render/materials';
import { mergeGeometries, mesh } from '../../render/geometry';
import { LEG_PIVOT, CHUTE_CANOPY } from './structural';

/**
 * A set of landing legs around the base of a stage. Each leg is parented to a
 * pivot named LEG_PIVOT so the deployment animation can rotate it.
 */
export function buildLandingLegs(
  stackRadius: number,
  legLength: number,
  count = 4,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'landing-legs';

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;

    // Pivot sits on the vehicle skin; the deployment animation rotates it.
    const pivot = new THREE.Group();
    pivot.name = LEG_PIVOT;
    pivot.position.set(Math.sin(a) * stackRadius, 0, Math.cos(a) * stackRadius);
    pivot.rotation.y = -a;
    // Stowed: leg lies flat against the vehicle side.
    pivot.rotation.z = 0;

    // Primary strut.
    const strut = mesh(
      new THREE.CylinderGeometry(legLength * 0.045, legLength * 0.055, legLength, 10),
      Materials.machinedAlloy(),
    );
    strut.position.y = -legLength / 2;
    pivot.add(strut);

    // Telescoping shock absorber sleeve.
    const sleeve = mesh(
      new THREE.CylinderGeometry(legLength * 0.07, legLength * 0.07, legLength * 0.34, 10),
      Materials.structuralSteel(),
    );
    sleeve.position.y = -legLength * 0.24;
    pivot.add(sleeve);

    // A-frame side braces back to the vehicle, which is what makes a leg
    // read as load-bearing rather than a stick.
    const braces: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const top = new THREE.Vector3(s * legLength * 0.03, legLength * 0.26, 0);
      const bottom = new THREE.Vector3(s * legLength * 0.17, -legLength * 0.66, 0);
      const dir = new THREE.Vector3().subVectors(bottom, top);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(legLength * 0.022, legLength * 0.022, len, 6);
      g.translate(0, -len / 2, 0);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, -1, 0),
          dir.clone().normalize(),
        ),
      );
      g.translate(top.x, top.y, top.z);
      braces.push(g);
    }
    pivot.add(mesh(mergeGeometries(braces), Materials.structuralSteel()));

    // Footpad with a ground-contact plate.
    const pad = mesh(
      new THREE.CylinderGeometry(legLength * 0.19, legLength * 0.22, legLength * 0.05, 12),
      Materials.machinedAlloy(),
    );
    pad.position.y = -legLength;
    pivot.add(pad);

    const grip = mesh(
      new THREE.CylinderGeometry(legLength * 0.2, legLength * 0.2, legLength * 0.018, 12),
      Materials.rubber(),
    );
    grip.position.y = -legLength * 1.03;
    pivot.add(grip);

    // Hinge fitting on the vehicle side.
    const hinge = mesh(
      new THREE.CylinderGeometry(legLength * 0.05, legLength * 0.05, legLength * 0.14, 8),
      Materials.structuralSteel(),
    );
    hinge.rotation.x = Math.PI / 2;
    pivot.add(hinge);

    root.add(pivot);
  }

  return root;
}

/**
 * A parachute assembly. Returns a mortar can containing a canopy group named
 * CHUTE_CANOPY, scaled to zero while packed. The descent sequence scales and
 * reshapes it through reefed and full-open states (spec §35).
 */
export function buildParachute(canopyRadius: number, packRadius: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'parachute';

  // ---- Packed mortar can, visible on the vehicle before deployment ----
  const can = mesh(
    new THREE.CylinderGeometry(packRadius, packRadius, packRadius * 1.7, 16),
    Materials.machinedAlloy(),
  );
  can.position.y = packRadius * 0.85;
  root.add(can);

  const lid = mesh(
    new THREE.CylinderGeometry(packRadius * 1.06, packRadius * 1.06, packRadius * 0.12, 16),
    Materials.agencyOrange(),
  );
  lid.position.y = packRadius * 1.75;
  root.add(lid);

  // ---- Canopy, hidden until deployment ----
  //
  // Two nested groups. The outer one is what the deployment animation scales,
  // and it sits at the mortar mouth; the inner one lifts the dome a full riser
  // length above it, so the suspension lines converge *down* onto the can. That
  // nesting is what makes a reefed chute read correctly: at a fifth of scale the
  // canopy is both smaller and closer, exactly as a real one is before it opens.
  // Built the other way round — dome at the can, lines hanging below it — the
  // canopy sits inside the vehicle it is supposed to be holding up.
  const canopy = new THREE.Group();
  canopy.name = CHUTE_CANOPY;
  canopy.scale.setScalar(0.001);
  canopy.visible = false;

  const inner = new THREE.Group();
  inner.position.y = canopyRadius * 1.5;
  canopy.add(inner);

  // Hemispherical canopy with a vent at the apex and gore seams.
  const canopyGeo = new THREE.SphereGeometry(
    canopyRadius,
    24,
    12,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.46,
  );
  const canopyMesh = mesh(canopyGeo, Materials.fabric(), true, false);
  inner.add(canopyMesh);

  // Alternating high-visibility gores so the canopy is legible against sky.
  const gores: THREE.BufferGeometry[] = [];
  const goreCount = 8;
  for (let i = 0; i < goreCount; i += 2) {
    const start = (i / goreCount) * Math.PI * 2;
    const g = new THREE.SphereGeometry(
      canopyRadius * 1.003,
      6,
      12,
      start,
      (Math.PI * 2) / goreCount,
      0,
      Math.PI * 0.46,
    );
    gores.push(g);
  }
  inner.add(mesh(mergeGeometries(gores), Materials.fabricOrange(), true, false));

  // Suspension lines converging on the riser.
  const lines: THREE.BufferGeometry[] = [];
  const lineCount = 16;
  const skirtY = canopyRadius * Math.cos(Math.PI * 0.46);
  const skirtR = canopyRadius * Math.sin(Math.PI * 0.46);
  for (let i = 0; i < lineCount; i++) {
    const a = (i / lineCount) * Math.PI * 2;
    const top = new THREE.Vector3(Math.sin(a) * skirtR, skirtY, Math.cos(a) * skirtR);
    const bottom = new THREE.Vector3(0, -canopyRadius * 1.5, 0);
    const dir = new THREE.Vector3().subVectors(bottom, top);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(canopyRadius * 0.004, canopyRadius * 0.004, len, 4);
    g.translate(0, -len / 2, 0);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        dir.clone().normalize(),
      ),
    );
    g.translate(top.x, top.y, top.z);
    lines.push(g);
  }
  inner.add(mesh(mergeGeometries(lines), Materials.fabric(), false, false));

  canopy.position.y = packRadius * 2;
  root.add(canopy);

  return root;
}

/** Airbag landing system — inflatable impact attenuation. */
export function buildAirbags(radius: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'airbags';

  const lobes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.SphereGeometry(radius * 0.42, 12, 10);
    g.translate(Math.sin(a) * radius * 0.62, -radius * 0.2, Math.cos(a) * radius * 0.62);
    lobes.push(g);
  }
  lobes.push(new THREE.SphereGeometry(radius * 0.5, 12, 10));
  root.add(mesh(mergeGeometries(lobes), Materials.fabric()));

  return root;
}

/** Rover wheel with a real tread pattern and a suspension rocker arm. */
export function buildWheel(radius: number, width: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'wheel';

  // Rim.
  const rim = mesh(
    new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, width, 20),
    Materials.machinedAlloy(),
  );
  rim.rotation.z = Math.PI / 2;
  root.add(rim);

  // Tread band — real cleats, which is what makes a Mars wheel recognisable.
  const cleats: THREE.BufferGeometry[] = [];
  const cleatCount = 18;
  for (let i = 0; i < cleatCount; i++) {
    const a = (i / cleatCount) * Math.PI * 2;
    const g = new THREE.BoxGeometry(width * 0.92, radius * 0.16, radius * 0.1);
    g.rotateY(0);
    g.translate(0, radius * 0.93, 0);
    g.rotateX(a);
    cleats.push(g);
  }
  const tread = mesh(mergeGeometries(cleats), Materials.machinedAlloy());
  tread.rotation.z = Math.PI / 2;
  root.add(tread);

  // Compliant spokes.
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = new THREE.BoxGeometry(width * 0.6, radius * 0.82, radius * 0.03);
    g.translate(0, radius * 0.41, 0);
    g.rotateX(a);
    spokes.push(g);
  }
  const spokeMesh = mesh(mergeGeometries(spokes), Materials.structuralSteel());
  spokeMesh.rotation.z = Math.PI / 2;
  root.add(spokeMesh);

  // Hub motor housing.
  const hub = mesh(
    new THREE.CylinderGeometry(radius * 0.26, radius * 0.26, width * 1.25, 12),
    Materials.darkPlastic(),
  );
  hub.rotation.z = Math.PI / 2;
  root.add(hub);

  return root;
}
