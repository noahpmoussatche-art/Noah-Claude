/**
 * Engine models (spec §9).
 *
 * An engine here is assembled the way a real one is: a combustion chamber and
 * regeneratively-cooled bell, a turbopump body hung off the side, propellant
 * feed ducts running from the stage into the pump, a gimbal block that carries
 * thrust into the thrust structure, and actuators that visibly connect the two.
 * Nothing is a bare cone.
 */
import * as THREE from 'three';
import { Materials } from '../../render/materials';
import {
  boltRing,
  mergeGeometries,
  mesh,
  nozzleBell,
} from '../../render/geometry';
import { Rng } from '../../utils/math';

export interface EngineVisualOptions {
  /** Nozzle exit radius, metres — sets overall visual size. */
  readonly exitRadius: number;
  /** Nozzle length, metres. */
  readonly bellLength: number;
  /** Area expansion ratio. Vacuum engines use large values (>60). */
  readonly expansion: number;
  /** Draw the turbopump and feed plumbing (skip for tiny thrusters). */
  readonly plumbing: boolean;
  /** Draw a protective boat-tail fairing around the powerhead. */
  readonly shroud: boolean;
  readonly seed: number;
}

/**
 * The point, in the engine's local space, from which exhaust leaves. Effects
 * attach here so the plume always starts at the nozzle exit plane and points
 * along -Y (spec §10).
 */
export const NOZZLE_EXIT_MARKER = 'nozzle-exit';

/**
 * Builds an engine oriented with its exhaust pointing down local -Y and its
 * mounting interface at local Y=0.
 */
export function buildEngine(opts: EngineVisualOptions): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'engine';
  const rng = new Rng(opts.seed);

  const throatRadius = opts.exitRadius / Math.sqrt(opts.expansion);
  const chamberRadius = Math.max(throatRadius * 2.0, opts.exitRadius * 0.16);
  const powerheadHeight = chamberRadius * 2.4;

  // ---- Gimbal block: the structural interface to the stage ----
  const gimbalRadius = chamberRadius * 1.25;
  const gimbal = mesh(
    new THREE.CylinderGeometry(gimbalRadius, gimbalRadius * 0.86, chamberRadius * 0.7, 12),
    Materials.machinedAlloy(),
  );
  gimbal.position.y = -chamberRadius * 0.35;
  root.add(gimbal);

  const gimbalBall = mesh(
    new THREE.SphereGeometry(chamberRadius * 0.52, 12, 8),
    Materials.nozzleAlloy(),
  );
  gimbalBall.position.y = -chamberRadius * 0.8;
  root.add(gimbalBall);

  // ---- Combustion chamber, tapering into the throat ----
  const chamberTop = -chamberRadius * 0.9;
  const chamberBottom = chamberTop - powerheadHeight;
  const chamber = mesh(
    new THREE.CylinderGeometry(chamberRadius, throatRadius * 1.35, powerheadHeight, 20),
    Materials.nozzleAlloy(),
  );
  chamber.position.y = (chamberTop + chamberBottom) / 2;
  root.add(chamber);

  // Regenerative cooling channels wrapped around the chamber.
  const channels: THREE.BufferGeometry[] = [];
  const channelCount = 20;
  for (let i = 0; i < channelCount; i++) {
    const a = (i / channelCount) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(
      chamberRadius * 0.055,
      chamberRadius * 0.055,
      powerheadHeight * 0.86,
      4,
    );
    // Slight taper follows the chamber contour inward toward the throat.
    g.translate(0, 0, 0);
    g.rotateY(-a);
    g.translate(Math.sin(a) * chamberRadius * 0.94, 0, Math.cos(a) * chamberRadius * 0.94);
    channels.push(g);
  }
  const channelMesh = mesh(mergeGeometries(channels), Materials.copperPlumbing());
  channelMesh.position.y = chamberTop - powerheadHeight * 0.45;
  root.add(channelMesh);

  // Injector dome on top of the chamber.
  const injector = mesh(
    new THREE.SphereGeometry(chamberRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    Materials.machinedAlloy(),
  );
  injector.position.y = chamberTop;
  root.add(injector);

  const injectorBolts = mesh(
    boltRing(chamberRadius * 0.98, 16, chamberRadius * 0.06),
    Materials.machinedAlloy(),
  );
  injectorBolts.position.y = chamberTop;
  root.add(injectorBolts);

  // ---- Nozzle bell ----
  const bellTop = chamberBottom;
  const bellGeo = nozzleBell(throatRadius * 1.35, opts.bellLength, opts.expansion, 36);
  // The lathe builds bottom-to-top; flip so the bell opens downward.
  bellGeo.rotateX(Math.PI);
  const bell = mesh(bellGeo, Materials.nozzleAlloy());
  bell.position.y = bellTop;
  root.add(bell);

  // Sooted interior, rendered back-side so it is visible looking up the bell.
  const interiorGeo = nozzleBell(throatRadius * 1.28, opts.bellLength * 0.99, opts.expansion, 36);
  interiorGeo.rotateX(Math.PI);
  const interior = mesh(interiorGeo, Materials.nozzleInterior(), false, false);
  interior.position.y = bellTop;
  root.add(interior);

  // Nozzle stiffening hoops — a real bell is not a smooth shell.
  const hoops: THREE.BufferGeometry[] = [];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const r =
      (throatRadius * 1.35 + (opts.exitRadius - throatRadius * 1.35) * Math.pow(t, 0.62)) * 1.02;
    const g = new THREE.TorusGeometry(r, opts.exitRadius * 0.012, 5, 24);
    g.rotateX(Math.PI / 2);
    g.translate(0, bellTop - t * opts.bellLength, 0);
    hoops.push(g);
  }
  root.add(mesh(mergeGeometries(hoops), Materials.machinedAlloy()));

  // Exit-plane reinforcement ring.
  const exitRing = mesh(
    new THREE.TorusGeometry(opts.exitRadius * 1.01, opts.exitRadius * 0.022, 6, 32),
    Materials.machinedAlloy(),
  );
  exitRing.rotation.x = Math.PI / 2;
  exitRing.position.y = bellTop - opts.bellLength;
  root.add(exitRing);

  if (opts.plumbing) {
    // ---- Turbopump: two stacked volutes hung beside the chamber ----
    const pumpGroup = new THREE.Group();
    const pumpRadius = chamberRadius * 0.62;

    const oxPump = mesh(
      new THREE.CylinderGeometry(pumpRadius, pumpRadius * 0.9, pumpRadius * 1.1, 14),
      Materials.machinedAlloy(),
    );
    pumpGroup.add(oxPump);

    const fuelPump = mesh(
      new THREE.CylinderGeometry(pumpRadius * 0.82, pumpRadius * 0.82, pumpRadius * 0.9, 14),
      Materials.machinedAlloy(),
    );
    fuelPump.position.y = -pumpRadius * 1.05;
    pumpGroup.add(fuelPump);

    // Turbine exhaust duct sweeping down the side of the bell.
    const duct = mesh(
      new THREE.CylinderGeometry(pumpRadius * 0.3, pumpRadius * 0.24, opts.bellLength * 0.55, 8),
      Materials.nozzleAlloy(),
    );
    duct.position.set(0, -pumpRadius * 1.6 - opts.bellLength * 0.24, pumpRadius * 0.5);
    duct.rotation.x = -0.12;
    pumpGroup.add(duct);

    pumpGroup.position.set(chamberRadius * 1.45, chamberTop - powerheadHeight * 0.3, 0);
    root.add(pumpGroup);

    // ---- Propellant feed lines from the stage down into the pump ----
    const feed: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * chamberRadius * 0.4, chamberRadius * 0.6, side * chamberRadius * 0.9),
        new THREE.Vector3(side * chamberRadius * 1.1, chamberTop * 0.9, side * chamberRadius * 0.7),
        new THREE.Vector3(chamberRadius * 1.35, chamberTop - powerheadHeight * 0.18, side * chamberRadius * 0.3),
        new THREE.Vector3(chamberRadius * 1.45, chamberTop - powerheadHeight * 0.3, 0),
      ]);
      feed.push(new THREE.TubeGeometry(curve, 14, chamberRadius * 0.17, 8, false));
    }
    root.add(mesh(mergeGeometries(feed), Materials.tankMetal()));

    // ---- Gimbal actuators: two struts from the stage to the chamber ----
    const actuators: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 2; i++) {
      const a = i === 0 ? 0.6 : 0.6 + Math.PI / 2;
      const top = new THREE.Vector3(
        Math.sin(a) * chamberRadius * 2.1,
        chamberRadius * 0.4,
        Math.cos(a) * chamberRadius * 2.1,
      );
      const bottom = new THREE.Vector3(
        Math.sin(a) * chamberRadius * 1.1,
        chamberTop - powerheadHeight * 0.55,
        Math.cos(a) * chamberRadius * 1.1,
      );
      const dir = new THREE.Vector3().subVectors(bottom, top);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(chamberRadius * 0.11, chamberRadius * 0.09, len, 8);
      g.translate(0, -len / 2, 0);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, -1, 0),
          dir.clone().normalize(),
        ),
      );
      g.translate(top.x, top.y, top.z);
      actuators.push(g);
    }
    root.add(mesh(mergeGeometries(actuators), Materials.machinedAlloy()));

    // Small avionics / valve boxes scattered on the powerhead.
    const boxes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = chamberRadius * rng.range(0.22, 0.36);
      const g = new THREE.BoxGeometry(s, s * 0.8, s * 0.7);
      g.translate(
        Math.sin(a) * chamberRadius * 1.05,
        chamberTop - powerheadHeight * rng.range(0.15, 0.7),
        Math.cos(a) * chamberRadius * 1.05,
      );
      boxes.push(g);
    }
    root.add(mesh(mergeGeometries(boxes), Materials.darkPlastic()));
  }

  if (opts.shroud) {
    // Boat-tail fairing that closes out the base of the stage around the engine.
    const shroud = mesh(
      new THREE.CylinderGeometry(
        opts.exitRadius * 1.5,
        opts.exitRadius * 1.15,
        powerheadHeight * 0.9,
        24,
        1,
        true,
      ),
      Materials.hullWhite(),
    );
    shroud.position.y = chamberTop - powerheadHeight * 0.35;
    root.add(shroud);
  }

  // Marker used by the effects system to anchor the exhaust plume.
  const exit = new THREE.Object3D();
  exit.name = NOZZLE_EXIT_MARKER;
  exit.position.y = bellTop - opts.bellLength;
  // Store the exit radius so the plume can size itself to the bell.
  exit.userData.exitRadius = opts.exitRadius;
  root.add(exit);

  return root;
}

/**
 * A cluster of engines arranged in a ring plus an optional centre engine — the
 * standard layout for a booster with many small engines.
 */
export function buildEngineCluster(
  opts: EngineVisualOptions,
  count: number,
  clusterRadius: number,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'engine-cluster';

  const outer = count > 1 ? count - 1 : 0;
  if (count >= 1) {
    const centre = buildEngine({ ...opts, seed: opts.seed });
    root.add(centre);
  }
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2;
    const e = buildEngine({ ...opts, seed: opts.seed + i + 1 });
    e.position.set(Math.sin(a) * clusterRadius, 0, Math.cos(a) * clusterRadius);
    root.add(e);
  }

  // Thrust structure tying the cluster into the stage base.
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < Math.max(outer, 4); i++) {
    const a = (i / Math.max(outer, 4)) * Math.PI * 2;
    const g = new THREE.BoxGeometry(clusterRadius * 1.2, opts.exitRadius * 0.1, opts.exitRadius * 0.18);
    g.translate(clusterRadius * 0.6, 0, 0);
    g.rotateY(-a);
    spokes.push(g);
  }
  const structure = mesh(mergeGeometries(spokes), Materials.structuralSteel());
  structure.position.y = opts.exitRadius * 0.2;
  root.add(structure);

  return root;
}

/** Small attitude-control thruster quad. */
export function buildRcsQuad(size: number): THREE.Object3D {
  const root = new THREE.Group();

  const block = mesh(
    new THREE.BoxGeometry(size * 0.9, size * 0.7, size * 0.9),
    Materials.machinedAlloy(),
  );
  root.add(block);

  const nozzles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(size * 0.1, size * 0.22, size * 0.5, 8);
    g.rotateZ(Math.PI / 2);
    g.translate(size * 0.62, 0, 0);
    g.rotateY(-a);
    nozzles.push(g);
  }
  root.add(mesh(mergeGeometries(nozzles), Materials.nozzleAlloy()));

  return root;
}
