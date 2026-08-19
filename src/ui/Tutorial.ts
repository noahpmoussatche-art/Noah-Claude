/**
 * The interactive tutorial (spec §46, §47, §48).
 *
 * The prototype's tutorial was one of its better parts, so this keeps its shape
 * and deepens it. Two changes matter:
 *
 *  1. Every step *waits* for the player to actually do the thing (§47). The
 *     objective is a predicate evaluated against the live vehicle design, so
 *     "add an engine" completes when an engine exists, not when a button is
 *     clicked.
 *
 *  2. Every step explains the underlying engineering, not just the action
 *     (§46). Each has a concept note covering what mass, thrust, specific
 *     impulse, staging, stability, the centre of mass or the centre of thrust
 *     actually mean, and several switch on the 3D diagnostic gizmos so the
 *     player sees the concept in the world rather than reading about it (§48).
 *
 * The two ducks narrate: the engineer teaches the physics, the pilot supplies
 * the commentary (§60).
 */
import type { VehicleDesign } from '../vehicles/VehicleDesign';
import { getPart } from '../data/catalog';
import { PartCategory } from '../parts/PartDef';
import type { VehicleAnalysis } from '../simulation/SystemCheck';

export interface TutorialContext {
  readonly design: VehicleDesign;
  readonly analysis: VehicleAnalysis | null;
  /** True while the diagnostic overlay is on. */
  readonly diagnosticsOn: boolean;
  /** True once the player has opened the pre-flight check. */
  readonly checkOpened: boolean;
  /** True once the vehicle has been launched. */
  readonly launched: boolean;
}

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  /** Which duck is talking. */
  readonly speaker: 'engineer' | 'pilot';
  /** Instruction body. Wrap key terms in <em>. */
  readonly body: string;
  /** The engineering concept being taught. */
  readonly concept?: { readonly heading: string; readonly text: string };
  /** What the player must do. Shown as the objective line. */
  readonly objective: string;
  /** Returns true when the step is satisfied. */
  readonly isComplete: (ctx: TutorialContext) => boolean;
  /** Turn the 3D diagnostic gizmos on for this step (§48). */
  readonly showDiagnostics?: boolean;
  /** Steps with no objective advance on a click. */
  readonly informational?: boolean;
}

/** Helper predicates over the design. */
const has = (design: VehicleDesign, predicate: (id: string) => boolean): boolean =>
  design.stack.some(
    (item) =>
      predicate(item.partId) || (item.radial ?? []).some((r) => predicate(r.partId)),
  );

const hasCategory = (design: VehicleDesign, category: PartCategory): boolean =>
  has(design, (id) => getPart(id).category === category);

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the Orbital Space Agency',
    speaker: 'pilot',
    body:
      'We have a workshop, a launch pad, and absolutely no flight history. ' +
      'That last part is what we are going to fix. Quill will walk you through ' +
      'building the first vehicle — I will be the one who has to ride it, so ' +
      'please pay attention.',
    objective: 'Continue',
    informational: true,
    isComplete: () => true,
  },

  {
    id: 'engine',
    title: 'Start with an engine',
    speaker: 'engineer',
    body:
      'Every vehicle is built from the bottom up, and the bottom is the engine. ' +
      'Pick something from <em>PROPULSION</em> and add it to the stack. For a ' +
      'first orbital launcher, the <em>VULCAN-9 Octaweb</em> is the right class ' +
      'of hardware.',
    concept: {
      heading: 'Thrust',
      text:
        'Thrust is the force the engine pushes with, measured in newtons. An ' +
        'engine works by throwing mass out of the nozzle very fast; the reaction ' +
        'to that is what lifts the rocket. Note that engines list two thrust ' +
        'figures — sea level and vacuum. The atmosphere pushes back on the ' +
        'exhaust, so an engine is always weaker at sea level than in space.',
    },
    objective: 'Add an engine to the vehicle',
    isComplete: (ctx) => hasCategory(ctx.design, PartCategory.PROPULSION),
  },

  {
    id: 'fuel',
    title: 'Give it something to burn',
    speaker: 'engineer',
    body:
      'An engine with no propellant is a very expensive paperweight. Add a tank ' +
      'from <em>PROPELLANT</em> directly above the engine. Engines can only draw ' +
      'from tanks in their own stage.',
    concept: {
      heading: 'Mass and the rocket equation',
      text:
        'Propellant is almost all of a rocket’s mass at liftoff — typically ' +
        'ninety percent or more. The rocket equation says your velocity change ' +
        'depends on the *ratio* of full mass to empty mass, not the absolute ' +
        'amount. That is why adding propellant has diminishing returns: the new ' +
        'propellant also has to accelerate all the propellant you already had.',
    },
    objective: 'Add a propellant tank',
    isComplete: (ctx) => hasCategory(ctx.design, PartCategory.FUEL),
  },

  {
    id: 'twr',
    title: 'Check thrust against weight',
    speaker: 'engineer',
    body:
      'Look at the <em>TWR</em> figure in the vehicle summary. That is your ' +
      'thrust-to-weight ratio. If it is below 1.0, the vehicle weighs more than ' +
      'the engines can push, and it will sit on the pad producing an enormous ' +
      'amount of noise and no altitude whatsoever.',
    concept: {
      heading: 'Thrust-to-weight ratio',
      text:
        'TWR is thrust divided by weight. Below 1.0 the vehicle cannot rise at ' +
        'all. Between 1.0 and 1.2 it rises so slowly that gravity eats most of ' +
        'the propellant — this is called gravity loss. A healthy first stage ' +
        'sits between about 1.3 and 1.8. Above roughly 4.0 you are driving hard ' +
        'into thick air and wasting energy on drag instead.',
    },
    objective: 'Get thrust-to-weight above 1.2',
    isComplete: (ctx) => (ctx.analysis?.liftoffTWR ?? 0) > 1.2,
  },

  {
    id: 'avionics',
    title: 'The vehicle needs to know where it is',
    speaker: 'engineer',
    body:
      'Add a <em>Flight Computer Ring</em> from <em>AVIONICS</em>. Without a ' +
      'command module the vehicle has no guidance at all — it will fly whatever ' +
      'attitude aerodynamics happens to hand it, which on a rocket means it ' +
      'tumbles.',
    concept: {
      heading: 'Guidance and control authority',
      text:
        'The flight computer decides where to point. But deciding is useless ' +
        'without authority to act: that comes from gimballing the engines — ' +
        'physically swivelling the nozzles a few degrees — or from aerodynamic ' +
        'surfaces. A computer with nothing to steer with can only watch.',
    },
    objective: 'Add a flight computer',
    isComplete: (ctx) => hasCategory(ctx.design, PartCategory.AVIONICS),
  },

  {
    id: 'power',
    title: 'And it needs power',
    speaker: 'engineer',
    body:
      'Add a <em>Battery Pack</em> from <em>POWER</em>. The moment the umbilical ' +
      'disconnects at liftoff, everything aboard runs on what the vehicle ' +
      'brought with it.',
    concept: {
      heading: 'Electrical budget',
      text:
        'Avionics, radios and instruments all draw power continuously. Batteries ' +
        'store a fixed amount of energy; solar arrays generate more but only ' +
        'once deployed and only in sunlight. If stored energy runs out before ' +
        'generation covers the load, the vehicle goes dark mid-mission.',
    },
    objective: 'Add a power source',
    isComplete: (ctx) => hasCategory(ctx.design, PartCategory.POWER),
  },

  {
    id: 'comms',
    title: 'Somebody has to hear it',
    speaker: 'pilot',
    body:
      'Add an antenna from <em>COMMUNICATION</em>. A rocket with no telemetry ' +
      'is a rocket you learn nothing from — and if it goes wrong, you will never ' +
      'find out why.',
    concept: {
      heading: 'Link range',
      text:
        'An omnidirectional whip works without pointing, which is what you want ' +
        'during a violent ascent, but it only reaches near-Earth distances. A ' +
        'high-gain dish reaches across the solar system, but it must be deployed ' +
        'and aimed. Interplanetary missions need the dish; a launch to low orbit ' +
        'does not.',
    },
    objective: 'Add an antenna',
    isComplete: (ctx) => hasCategory(ctx.design, PartCategory.COMMUNICATION),
  },

  {
    id: 'diagnostics',
    title: 'Now look at the balance',
    speaker: 'engineer',
    body:
      'Turn on <em>DIAGNOSTICS</em>. Three markers appear on the vehicle: the ' +
      'yellow-and-black ball is the <em>centre of mass</em>, the blue ring is the ' +
      '<em>centre of thrust</em>, and the magenta diamond is the <em>centre of ' +
      'pressure</em>. The dashed line between mass and pressure is the one that ' +
      'decides whether you fly or tumble.',
    concept: {
      heading: 'Centre of mass and centre of thrust',
      text:
        'The centre of mass is the point the vehicle balances and rotates ' +
        'about — and it moves as propellant drains. The centre of thrust is ' +
        'where the engines’ combined force acts. If the thrust line does not ' +
        'pass through the centre of mass, every second of burn applies a ' +
        'twisting moment the guidance system has to fight.',
    },
    objective: 'Enable the diagnostic overlay',
    showDiagnostics: true,
    isComplete: (ctx) => ctx.diagnosticsOn,
  },

  {
    id: 'stability',
    title: 'Stability, and why fins go at the bottom',
    speaker: 'engineer',
    body:
      'Watch the dashed line. It is <em>green</em> when the centre of pressure ' +
      'sits below the centre of mass, and <em>red</em> when it does not. Red ' +
      'means the vehicle wants to fly backwards. Adding fins low on the stack ' +
      'drags the centre of pressure downward and fixes it.',
    concept: {
      heading: 'Static margin',
      text:
        'Air pushes on the vehicle at the centre of pressure. If that point is ' +
        'behind the centre of mass — lower, on an ascending rocket — then any ' +
        'gust that yaws the nose creates a restoring moment that swings it back. ' +
        'This is why arrows have feathers at the back. If the centre of pressure ' +
        'is ahead of the centre of mass, the same gust makes things worse, and ' +
        'the vehicle diverges until it breaks up.',
    },
    objective: 'Achieve a positive static margin',
    showDiagnostics: true,
    isComplete: (ctx) => (ctx.analysis?.staticMargin ?? -1) > 0,
  },

  {
    id: 'staging',
    title: 'Two stages beat one',
    speaker: 'engineer',
    body:
      'Add a <em>Separation Ring</em>, then a second engine and tank above it, ' +
      'and assign them to a higher stage. When the lower stage runs dry, it is ' +
      'jettisoned and the upper stage lights.',
    concept: {
      heading: 'Why stage at all',
      text:
        'Once a tank is empty it is dead weight you are still accelerating. ' +
        'Dropping it improves the mass ratio of everything above it. Staging is ' +
        'also how you use the right engine in the right place: a short-nozzle ' +
        'engine for the atmosphere, a huge-nozzle vacuum engine above it — that ' +
        'big bell would flow-separate and tear itself apart at sea level.',
    },
    objective: 'Build a vehicle with two or more stages',
    isComplete: (ctx) => new Set(ctx.design.stack.map((s) => s.stage)).size >= 2,
  },

  {
    id: 'payload',
    title: 'What is it actually for?',
    speaker: 'pilot',
    body:
      'Put something on top from <em>PAYLOAD</em>, <em>SATELLITE</em> or ' +
      '<em>ROVER</em>. A launch that carries nothing is just a very loud way of ' +
      'destroying money. And yes — you can also bolt on things from ' +
      '<em>CHAOS</em>. They have real mass and truly appalling drag, and they ' +
      'will change how the vehicle flies. I am obliged to say that is a bad ' +
      'idea. I am not obliged to mean it.',
    concept: {
      heading: 'Payload fraction',
      text:
        'Payload is typically two to four percent of liftoff mass to low orbit, ' +
        'and far less to another planet. Every kilogram of payload needs roughly ' +
        'twenty to fifty kilograms of vehicle underneath it. That ratio is why ' +
        'spacecraft engineers argue so hard about grams.',
    },
    objective: 'Add a payload',
    isComplete: (ctx) =>
      hasCategory(ctx.design, PartCategory.PAYLOAD) ||
      hasCategory(ctx.design, PartCategory.SATELLITE) ||
      hasCategory(ctx.design, PartCategory.ROVER) ||
      hasCategory(ctx.design, PartCategory.CHAOS),
  },

  {
    id: 'landing',
    title: 'Coming back down',
    speaker: 'engineer',
    body:
      'If the mission has to land, it needs a landing system: legs, a ' +
      'parachute, or ideally both plus a restartable engine. Look at the ' +
      '<em>LANDING</em> category.',
    concept: {
      heading: 'Parachutes, heat shields and why Mars is hard',
      text:
        'Entry converts orbital energy into heat — an aeroshell absorbs it, and ' +
        'without one sized for the job the vehicle does not survive to the ' +
        'parachute phase. Then there is the atmosphere itself. Mars has about ' +
        'one percent of Earth’s surface density: thick enough to cook you on the ' +
        'way in, far too thin to stop you on the way down. That is why every ' +
        'Mars lander needs a heat shield *and* a parachute *and* rockets.',
    },
    objective: 'Continue',
    informational: true,
    isComplete: () => true,
  },

  {
    id: 'check',
    title: 'Run the pre-flight check',
    speaker: 'engineer',
    body:
      'Open <em>SYSTEM CHECK</em>. It reads the same numbers the flight ' +
      'simulation uses, so a red line there is a genuine prediction of failure, ' +
      'not a suggestion. Read the warnings. They tell you which physical limit ' +
      'you have crossed.',
    concept: {
      heading: 'Delta-v budget',
      text:
        'Delta-v is the total velocity change a vehicle can produce, and it is ' +
        'the real currency of spaceflight. Low Earth orbit costs roughly ' +
        '9,400 m/s once gravity and drag losses are counted. The check computes ' +
        'yours from the rocket equation, stage by stage, and tells you whether ' +
        'you can afford the trip.',
    },
    objective: 'Open the system check',
    isComplete: (ctx) => ctx.checkOpened,
  },

  {
    id: 'launch',
    title: 'Then fly it',
    speaker: 'pilot',
    body:
      'You do not pilot the vehicle — once it lights, the guidance system flies ' +
      'the ascent. What you control is the <em>camera</em>, the <em>time ' +
      'warp</em>, and the pause. Watch what your design actually does. If it ' +
      'was built badly, you will see exactly how and exactly when.',
    concept: {
      heading: 'Why you watch instead of steer',
      text:
        'The engineering decision was made in the workshop. Launch is where you ' +
        'find out whether it was right. Everything you see during flight — the ' +
        'trajectory, the staging, the tumble if it comes — is the physics ' +
        'consequence of the vehicle you built.',
    },
    objective: 'Launch the vehicle',
    isComplete: (ctx) => ctx.launched,
  },
];

export class Tutorial {
  private index = 0;
  private active = false;
  private completed = false;

  /** Steps the player has satisfied, so going back does not re-lock progress. */
  private readonly satisfied = new Set<string>();

  start(): void {
    this.active = true;
    this.index = 0;
    this.completed = false;
    this.satisfied.clear();
  }

  stop(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active && !this.completed;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  get step(): TutorialStep | null {
    return this.active && this.index < TUTORIAL_STEPS.length
      ? TUTORIAL_STEPS[this.index]
      : null;
  }

  get stepNumber(): number {
    return this.index + 1;
  }

  get stepCount(): number {
    return TUTORIAL_STEPS.length;
  }

  /** True when the current step's objective is satisfied. */
  isCurrentSatisfied(ctx: TutorialContext): boolean {
    const step = this.step;
    if (!step) return false;
    if (this.satisfied.has(step.id)) return true;
    if (step.isComplete(ctx)) {
      this.satisfied.add(step.id);
      return true;
    }
    return false;
  }

  /**
   * Advances if the objective is met. Returns true if the tutorial moved on.
   * This is what implements "wait for the player" (spec §47).
   */
  tryAdvance(ctx: TutorialContext): boolean {
    if (!this.isActive) return false;
    if (!this.isCurrentSatisfied(ctx)) return false;

    this.index++;
    if (this.index >= TUTORIAL_STEPS.length) {
      this.completed = true;
      this.active = false;
    }
    return true;
  }

  /** Lets the player step back to re-read an earlier explanation. */
  back(): void {
    if (this.index > 0) this.index--;
  }

  /** Skips the tutorial entirely. */
  skip(): void {
    this.completed = true;
    this.active = false;
  }

  /** Whether the current step wants the diagnostic overlay on. */
  wantsDiagnostics(): boolean {
    return this.step?.showDiagnostics ?? false;
  }
}
