/**
 * Shared material library (spec §56).
 *
 * Materials are created once and reused across every part instance, which keeps
 * draw-call state changes and GPU memory down (spec §73) and guarantees that the
 * same physical substance looks identical wherever it appears.
 */
import * as THREE from 'three';
import * as tex from './textures';

const registry = new Map<string, THREE.Material>();

function reg<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = registry.get(key);
  if (hit) return hit as T;
  const mat = make();
  mat.name = key;
  registry.set(key, mat);
  return mat;
}

export const Materials = {
  /** Painted aerospace white — the primary skin of a launch vehicle. */
  hullWhite: (): THREE.MeshStandardMaterial =>
    reg('hullWhite', () =>
      new THREE.MeshStandardMaterial({
        map: tex.paintedPanels('#eef1f4', '#b9c0c8', 3),
        color: 0xffffff,
        roughness: 0.55,
        metalness: 0.12,
      })),

  /** Agency black used on roll-pattern bands and markings. */
  hullBlack: (): THREE.MeshStandardMaterial =>
    reg('hullBlack', () =>
      new THREE.MeshStandardMaterial({
        map: tex.paintedPanels('#23262b', '#15171a', 3),
        color: 0xffffff,
        roughness: 0.62,
        metalness: 0.15,
      })),

  /** Bare rolled aluminium/stainless tank barrel. */
  tankMetal: (): THREE.MeshStandardMaterial =>
    reg('tankMetal', () =>
      new THREE.MeshStandardMaterial({
        map: tex.metalSkin('#c6cad1', 2),
        color: 0xffffff,
        roughness: 0.34,
        metalness: 0.86,
      })),

  /** Darker structural steel for towers, trusses and ground equipment. */
  structuralSteel: (): THREE.MeshStandardMaterial =>
    reg('structuralSteel', () =>
      new THREE.MeshStandardMaterial({
        color: 0x6d747d,
        roughness: 0.62,
        metalness: 0.78,
      })),

  /** Hot-section alloy for nozzles and combustion chambers. */
  nozzleAlloy: (): THREE.MeshStandardMaterial =>
    reg('nozzleAlloy', () =>
      new THREE.MeshStandardMaterial({
        color: 0x8e8378,
        roughness: 0.42,
        metalness: 0.94,
      })),

  /** Soot-darkened nozzle interior. */
  nozzleInterior: (): THREE.MeshStandardMaterial =>
    reg('nozzleInterior', () =>
      new THREE.MeshStandardMaterial({
        color: 0x2a2622,
        roughness: 0.85,
        metalness: 0.5,
        side: THREE.BackSide,
      })),

  /** Copper regenerative-cooling channels / plumbing. */
  copperPlumbing: (): THREE.MeshStandardMaterial =>
    reg('copperPlumbing', () =>
      new THREE.MeshStandardMaterial({
        color: 0xa8642f,
        roughness: 0.38,
        metalness: 0.92,
      })),

  /** Turbopump and valve castings. */
  machinedAlloy: (): THREE.MeshStandardMaterial =>
    reg('machinedAlloy', () =>
      new THREE.MeshStandardMaterial({
        color: 0x9aa1a9,
        roughness: 0.44,
        metalness: 0.88,
      })),

  /** Carbon-fibre composite: fairings, interstage, panel substrates. */
  composite: (): THREE.MeshStandardMaterial =>
    reg('composite', () =>
      new THREE.MeshStandardMaterial({
        map: tex.carbonWeave(6),
        color: 0xffffff,
        roughness: 0.4,
        metalness: 0.22,
      })),

  /** Multi-layer insulation foil. */
  mli: (): THREE.MeshStandardMaterial =>
    reg('mli', () =>
      new THREE.MeshStandardMaterial({
        map: tex.thermalBlanket(2),
        color: 0xffffff,
        roughness: 0.36,
        metalness: 0.72,
      })),

  /** Ablative heat-shield face. */
  ablative: (): THREE.MeshStandardMaterial =>
    reg('ablative', () =>
      new THREE.MeshStandardMaterial({
        map: tex.ablator(3),
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.05,
      })),

  /** Photovoltaic array face. */
  solarFace: (): THREE.MeshStandardMaterial =>
    reg('solarFace', () =>
      new THREE.MeshStandardMaterial({
        map: tex.solarCells(1),
        color: 0xffffff,
        roughness: 0.18,
        metalness: 0.45,
        side: THREE.DoubleSide,
      })),

  /** Reverse (structural) side of a solar wing. */
  solarBack: (): THREE.MeshStandardMaterial =>
    reg('solarBack', () =>
      new THREE.MeshStandardMaterial({
        color: 0xd8d3c6,
        roughness: 0.72,
        metalness: 0.15,
        side: THREE.DoubleSide,
      })),

  /** Window / optical glass. */
  glass: (): THREE.MeshPhysicalMaterial =>
    reg('glass', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x9fc4d8,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.82,
        thickness: 0.4,
        transparent: true,
        opacity: 0.55,
      })),

  /** Rover tyres, seals, flexible boots. */
  rubber: (): THREE.MeshStandardMaterial =>
    reg('rubber', () =>
      new THREE.MeshStandardMaterial({
        color: 0x24262a,
        roughness: 0.94,
        metalness: 0.02,
      })),

  /** Parachute / soft-goods fabric. */
  fabric: (): THREE.MeshStandardMaterial =>
    reg('fabric', () =>
      new THREE.MeshStandardMaterial({
        color: 0xf2f2ee,
        roughness: 0.88,
        metalness: 0,
        side: THREE.DoubleSide,
      })),

  /** High-visibility orange used on the agency's fabric and markings. */
  fabricOrange: (): THREE.MeshStandardMaterial =>
    reg('fabricOrange', () =>
      new THREE.MeshStandardMaterial({
        color: 0xe2611f,
        roughness: 0.88,
        metalness: 0,
        side: THREE.DoubleSide,
      })),

  /** Moulded plastic housings, cameras, avionics boxes. */
  plastic: (): THREE.MeshStandardMaterial =>
    reg('plastic', () =>
      new THREE.MeshStandardMaterial({
        color: 0xe8e6e1,
        roughness: 0.6,
        metalness: 0.04,
      })),

  darkPlastic: (): THREE.MeshStandardMaterial =>
    reg('darkPlastic', () =>
      new THREE.MeshStandardMaterial({
        color: 0x33363b,
        roughness: 0.55,
        metalness: 0.08,
      })),

  /** Concrete pad and roadway. */
  concrete: (): THREE.MeshStandardMaterial =>
    reg('concrete', () =>
      new THREE.MeshStandardMaterial({
        map: tex.concrete(8),
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0,
      })),

  /** Flame-trench concrete, scorched by previous launches. */
  concreteScorched: (): THREE.MeshStandardMaterial =>
    reg('concreteScorched', () =>
      new THREE.MeshStandardMaterial({
        map: tex.concrete(4, true),
        color: 0xffffff,
        roughness: 0.98,
        metalness: 0,
      })),

  /** Martian surface. */
  regolith: (): THREE.MeshStandardMaterial =>
    reg('regolith', () =>
      new THREE.MeshStandardMaterial({
        map: tex.regolith(1),
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
        vertexColors: true,
      })),

  /** Basalt boulders and outcrops on Mars. */
  marsRock: (): THREE.MeshStandardMaterial =>
    reg('marsRock', () =>
      new THREE.MeshStandardMaterial({
        color: 0x6d4029,
        roughness: 0.96,
        metalness: 0.02,
        flatShading: true,
      })),

  /** OSA signature accent — used sparingly on markings and UI-linked hardware. */
  agencyAccent: (): THREE.MeshStandardMaterial =>
    reg('agencyAccent', () =>
      new THREE.MeshStandardMaterial({
        color: 0x1c8fd6,
        roughness: 0.45,
        metalness: 0.3,
      })),

  agencyOrange: (): THREE.MeshStandardMaterial =>
    reg('agencyOrange', () =>
      new THREE.MeshStandardMaterial({
        color: 0xf07a1c,
        roughness: 0.5,
        metalness: 0.2,
      })),

  /** Duck body plumage. */
  duckBody: (): THREE.MeshStandardMaterial =>
    reg('duckBody', () =>
      new THREE.MeshStandardMaterial({
        color: 0xf7e07a,
        roughness: 0.78,
        metalness: 0,
      })),

  duckBill: (): THREE.MeshStandardMaterial =>
    reg('duckBill', () =>
      new THREE.MeshStandardMaterial({
        color: 0xe8912b,
        roughness: 0.62,
        metalness: 0,
      })),

  duckEye: (): THREE.MeshStandardMaterial =>
    reg('duckEye', () =>
      new THREE.MeshStandardMaterial({
        color: 0x14171c,
        roughness: 0.25,
        metalness: 0,
      })),

  /** Emissive helper: a self-lit surface (indicator lamps, screens, plume core). */
  emissive: (color: number, intensity = 2): THREE.MeshBasicMaterial =>
    reg(`emissive:${color}:${intensity}`, () => {
      const c = new THREE.Color(color).multiplyScalar(intensity);
      return new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    }),

  /** Releases every cached material. */
  disposeAll(): void {
    for (const mat of registry.values()) mat.dispose();
    registry.clear();
    tex.disposeTextureCache();
  },
};
