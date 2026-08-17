/**
 * A vehicle design: the player's blueprint, independent of any 3D realisation.
 *
 * The design is a vertical stack of parts plus radially-attached parts on each
 * stack item. Positions are derived from the parts' own dimensions, which is why
 * nothing can float, overlap or attach to nothing (spec §6).
 */
import { getPart } from '../data/catalog';
import type { PartDef } from '../parts/PartDef';

export interface RadialAttachment {
  readonly partId: string;
  /** How many copies, evenly spaced around the stack. */
  readonly count: number;
  /** Fractional height along the host part, 0 = bottom, 1 = top. */
  readonly heightFraction: number;
  /** Extra rotation offset, radians. */
  readonly angleOffset?: number;
}

export interface StackItem {
  readonly partId: string;
  /** Stage index; lower numbers fire first. */
  readonly stage: number;
  readonly radial?: readonly RadialAttachment[];
}

export interface VehicleDesign {
  readonly name: string;
  /** Bottom-to-top stack order. */
  readonly stack: readonly StackItem[];
}

/** A resolved stack entry with its computed vertical placement. */
export interface ResolvedStackItem {
  readonly item: StackItem;
  readonly def: PartDef;
  /** Height of the part's own origin above the vehicle datum, metres. */
  readonly baseY: number;
  /** Height consumed in the stack by this part, metres. */
  readonly stackHeight: number;
  /** Outer diameter of the part at its widest, metres. */
  readonly diameter: number;
  /** True if this part sits inside a fairing and is shielded from the airflow. */
  readonly shielded: boolean;
}

/**
 * Walks the stack bottom-to-top, assigning each part a base height.
 *
 * Engines are the special case: their model hangs below their mount plane, so
 * they consume height below the datum rather than above it. That is what keeps
 * an engine bell from intersecting the tank it is bolted to.
 */
export function resolveStack(design: VehicleDesign): ResolvedStackItem[] {
  const out: ResolvedStackItem[] = [];
  let cursor = 0;

  // While inside a fairing, parts stack within its volume rather than on top of
  // it — that is what a fairing is for. `enclosureTop` records where the stack
  // resumes once the payload fits inside.
  let enclosureTop = -Infinity;

  for (const item of design.stack) {
    const def = getPart(item.partId);
    const isEngine = def.engine !== undefined;
    const height = def.dimensions[1];

    if (isEngine) {
      // The engine's mount plane is its origin; the bell extends downward.
      out.push({
        item,
        def,
        baseY: cursor + height,
        stackHeight: height,
        diameter: def.dimensions[0],
        shielded: cursor < enclosureTop,
      });
      cursor += height;
      continue;
    }

    const shielded = cursor < enclosureTop;
    out.push({
      item,
      def,
      baseY: cursor,
      stackHeight: height,
      diameter: def.dimensions[0],
      shielded,
    });

    if (def.enclosing) {
      // The fairing occupies this volume; the payload goes inside it, starting
      // just above the separation ring at its base.
      enclosureTop = cursor + height;
      cursor += Math.min(height * 0.12, 1.2);
    } else {
      cursor += height;
      // Once the payload has filled the fairing, resume above it.
      if (cursor > enclosureTop && enclosureTop > -Infinity) {
        cursor = Math.max(cursor, enclosureTop);
        enclosureTop = -Infinity;
      }
    }
  }

  return out;
}

/** Total stacked height of a design, metres. */
export function designHeight(design: VehicleDesign): number {
  const resolved = resolveStack(design);
  if (resolved.length === 0) return 0;
  const last = resolved[resolved.length - 1];
  return last.baseY + (last.def.engine ? 0 : last.stackHeight);
}

/** Widest diameter anywhere in the design, metres. */
export function designWidth(design: VehicleDesign): number {
  let w = 0;
  for (const r of resolveStack(design)) {
    w = Math.max(w, r.diameter);
    for (const rad of r.item.radial ?? []) {
      const rd = getPart(rad.partId);
      w = Math.max(w, r.diameter + rd.dimensions[0] * 2);
    }
  }
  return w;
}

/** Total build cost of a design, agency credits. */
export function designCost(design: VehicleDesign): number {
  let cost = 0;
  for (const item of design.stack) {
    cost += getPart(item.partId).cost;
    for (const rad of item.radial ?? []) {
      cost += getPart(rad.partId).cost * rad.count;
    }
  }
  return Math.round(cost);
}

/** Highest stage index used by the design. */
export function stageCount(design: VehicleDesign): number {
  let max = 0;
  for (const item of design.stack) max = Math.max(max, item.stage);
  return max + 1;
}

/** Every part id used, including radial copies. */
export function allPartIds(design: VehicleDesign): string[] {
  const ids: string[] = [];
  for (const item of design.stack) {
    ids.push(item.partId);
    for (const rad of item.radial ?? []) {
      for (let i = 0; i < rad.count; i++) ids.push(rad.partId);
    }
  }
  return ids;
}
