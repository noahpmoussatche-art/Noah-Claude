/**
 * All DOM interface construction and updating.
 *
 * The governing rule (spec §62, §63) is that the interface must never be the
 * main event. The HUD lives in thin strips at the edges of the frame, the
 * countdown and cinematic titles are transient overlays rather than panels, and
 * cinematic mode collapses everything except letterbox bars and a subtitle line
 * so that the image can carry the story (spec §27).
 */
import { MissionState, TIME_SCALES } from '../data/constants';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  PartCategory,
  type PartDef,
} from '../parts/PartDef';
import { PART_CATALOG, getPart } from '../data/catalog';
import type { MissionDef } from '../data/missions';
import { MISSIONS } from '../data/missions';
import type { StackItem, VehicleDesign } from '../vehicles/VehicleDesign';
import { designCost, designHeight } from '../vehicles/VehicleDesign';
import type { SubsystemReport, VehicleAnalysis, Warning } from '../simulation/SystemCheck';
import type { FlightTelemetry } from '../physics/FlightDynamics';
import type { MissionSim } from '../simulation/MissionSim';
import {
  formatDistance,
  formatDuration,
  formatForce,
  formatMass,
  formatSpeed,
} from '../utils/math';
import type { DialogueLine } from '../cinematics/Timeline';
import type { Tutorial, TutorialContext } from './Tutorial';

/** Callbacks the interface raises back to the game. */
export interface InterfaceHandlers {
  onMissionSelected: (mission: MissionDef) => void;
  onAddPart: (partId: string, stage: number) => void;
  onRemovePart: (index: number) => void;
  onSetStage: (index: number, stage: number) => void;
  onLoadReference: () => void;
  onClearDesign: () => void;
  onOpenCheck: () => void;
  onCloseCheck: () => void;
  onLaunch: () => void;
  onToggleDiagnostics: () => void;
  onSetTimeScale: (scale: number) => void;
  onTogglePause: () => void;
  onSkipCinematic: () => void;
  onTutorialAdvance: () => void;
  onTutorialBack: () => void;
  onTutorialSkip: () => void;
  onReplay: () => void;
  onReturnToBuild: () => void;
  onReturnToMenu: () => void;
  onToggleMute: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Interface {
  private readonly root: HTMLElement;
  private readonly handlers: InterfaceHandlers;

  // Screens
  private loading!: HTMLElement;
  private menu!: HTMLElement;
  private buildUI!: HTMLElement;
  private hud!: HTMLElement;

  // Build screen
  private partList!: HTMLElement;
  private categoryTabs!: HTMLElement;
  private stackList!: HTMLElement;
  private vehicleStats!: HTMLElement;
  private launchButton!: HTMLButtonElement;

  // HUD
  private telemetryPanel!: HTMLElement;
  private missionStatePanel!: HTMLElement;
  private countdownEl!: HTMLElement;
  private warningsEl!: HTMLElement;
  private timeControls!: HTMLElement;
  private diagnosticsPanel!: HTMLElement;

  // Overlays
  private systemCheck!: HTMLElement;
  private tutorialPanel!: HTMLElement;
  private resultPanel!: HTMLElement;
  private subtitleEl!: HTMLElement;
  private slateEl!: HTMLElement;
  private fadeEl!: HTMLElement;

  private activeCategory: PartCategory = PartCategory.PROPULSION;
  private selectedStage = 0;
  private subtitleTimer = 0;
  private slateTimer = 0;
  private cinematicMode = false;

  constructor(root: HTMLElement, handlers: InterfaceHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.build();
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private build(): void {
    this.root.innerHTML = '';

    // Letterbox bars, fade layer, subtitles and slate sit above everything.
    this.root.appendChild(el('div', 'letterbox top'));
    this.root.appendChild(el('div', 'letterbox bottom'));

    this.fadeEl = el('div');
    this.fadeEl.id = 'fade';
    this.root.appendChild(this.fadeEl);

    this.buildSubtitle();
    this.buildSlate();
    this.buildHud();
    this.buildBuildScreen();
    this.buildSystemCheck();
    this.buildTutorial();
    this.buildResult();
    this.buildMenu();
    this.buildLoading();
  }

  private buildLoading(): void {
    this.loading = el('div');
    this.loading.id = 'loading';
    const inner = el('div', 'inner');
    inner.appendChild(el('div', 'mark', '🦆'));
    inner.appendChild(
      el('div', 'osa-label', 'Orbital Space Agency · initialising systems'),
    );
    const bar = el('div', 'bar');
    bar.appendChild(el('div', 'fill'));
    inner.appendChild(bar);
    this.loading.appendChild(inner);
    this.root.appendChild(this.loading);
  }

  private buildMenu(): void {
    this.menu = el('div');
    this.menu.id = 'menu';
    this.menu.classList.add('hidden');

    const inner = el('div', 'inner');
    inner.appendChild(el('div', 'mark', '🦆🦆'));
    inner.appendChild(el('h1', undefined, 'ORBITAL'));
    inner.appendChild(el('div', 'agency', 'ENGINEERING · ORBITAL SPACE AGENCY'));
    inner.appendChild(
      el(
        'div',
        'blurb',
        'Two ducks, one launch complex, and a catalogue of real spaceflight ' +
          'hardware. Build a vehicle from modular parts, check it against the ' +
          'physics, and then watch it fly — or fail — exactly as you designed it.',
      ),
    );

    const select = el('div');
    select.id = 'mission-select';
    for (const mission of MISSIONS) {
      const card = el('div', 'mission-card');
      card.appendChild(el('div', 'nm', mission.name));
      card.appendChild(el('div', 'sub', mission.subtitle));
      card.appendChild(el('div', 'desc', mission.briefing));
      card.addEventListener('click', () => this.handlers.onMissionSelected(mission));
      select.appendChild(card);
    }
    inner.appendChild(select);

    inner.appendChild(
      el(
        'div',
        'hint',
        'DRAG TO ORBIT CAMERA · SCROLL TO ZOOM · SPACE TO PAUSE · D FOR DIAGNOSTICS · M TO MUTE',
      ),
    );

    this.menu.appendChild(inner);
    this.root.appendChild(this.menu);
  }

  private buildBuildScreen(): void {
    this.buildUI = el('div');
    this.buildUI.id = 'build-ui';
    this.buildUI.classList.add('hidden');

    // ---- Parts catalogue ----
    const parts = el('div', 'osa-panel');
    parts.id = 'parts-panel';

    const header = el('header');
    header.appendChild(el('div', 'title', 'PARTS CATALOGUE'));
    header.appendChild(
      el('div', 'sub', 'Every part has real mass, dimensions and physics.'),
    );
    parts.appendChild(header);

    this.categoryTabs = el('div');
    this.categoryTabs.id = 'category-tabs';
    for (const cat of CATEGORY_ORDER) {
      const btn = el('button', 'osa-btn', CATEGORY_LABEL[cat]);
      btn.addEventListener('click', () => {
        this.activeCategory = cat;
        this.refreshCategoryTabs();
        this.refreshPartList();
      });
      btn.dataset.category = cat;
      this.categoryTabs.appendChild(btn);
    }
    parts.appendChild(this.categoryTabs);

    this.partList = el('div');
    this.partList.id = 'part-list';
    parts.appendChild(this.partList);

    this.buildUI.appendChild(parts);

    // Middle column is left empty so the 3D vehicle is visible between panels.
    this.buildUI.appendChild(el('div'));

    // ---- Vehicle panel ----
    const vehicle = el('div', 'osa-panel');
    vehicle.id = 'vehicle-panel';

    const vHeader = el('header');
    vHeader.appendChild(el('div', 'title', 'VEHICLE'));
    vHeader.appendChild(el('div', 'sub', 'Stack order is bottom to top.'));
    vehicle.appendChild(vHeader);

    // Stage selector for newly added parts.
    const stageRow = el('div', 'osa-label');
    stageRow.style.padding = '9px 15px 0';
    stageRow.textContent = 'ADD TO STAGE';
    vehicle.appendChild(stageRow);

    const stageButtons = el('div');
    stageButtons.style.cssText = 'display:flex;gap:4px;padding:6px 15px 10px;';
    for (let s = 0; s < 4; s++) {
      const btn = el('button', 'osa-btn', String(s + 1));
      btn.style.flex = '1';
      btn.dataset.stage = String(s);
      btn.addEventListener('click', () => {
        this.selectedStage = s;
        for (const b of Array.from(stageButtons.children)) {
          b.classList.toggle('active', Number((b as HTMLElement).dataset.stage) === s);
        }
      });
      if (s === 0) btn.classList.add('active');
      stageButtons.appendChild(btn);
    }
    vehicle.appendChild(stageButtons);

    this.stackList = el('div');
    this.stackList.id = 'stack-list';
    vehicle.appendChild(this.stackList);

    this.vehicleStats = el('div');
    this.vehicleStats.id = 'vehicle-stats';
    vehicle.appendChild(this.vehicleStats);

    const actions = el('div');
    actions.id = 'build-actions';

    const row1 = el('div', 'row');
    const refBtn = el('button', 'osa-btn', 'Load reference');
    refBtn.addEventListener('click', () => this.handlers.onLoadReference());
    const clearBtn = el('button', 'osa-btn danger', 'Clear');
    clearBtn.addEventListener('click', () => this.handlers.onClearDesign());
    row1.append(refBtn, clearBtn);
    actions.appendChild(row1);

    const row2 = el('div', 'row');
    const diagBtn = el('button', 'osa-btn', 'Diagnostics');
    diagBtn.id = 'diag-toggle';
    diagBtn.addEventListener('click', () => this.handlers.onToggleDiagnostics());
    const checkBtn = el('button', 'osa-btn', 'System check');
    checkBtn.addEventListener('click', () => this.handlers.onOpenCheck());
    row2.append(diagBtn, checkBtn);
    actions.appendChild(row2);

    this.launchButton = el('button', 'osa-btn primary', 'LAUNCH');
    this.launchButton.addEventListener('click', () => this.handlers.onLaunch());
    actions.appendChild(this.launchButton);

    vehicle.appendChild(actions);
    this.buildUI.appendChild(vehicle);

    this.root.appendChild(this.buildUI);
    this.refreshCategoryTabs();
    this.refreshPartList();
  }

  private buildHud(): void {
    this.hud = el('div');
    this.hud.id = 'hud';
    this.hud.style.display = 'none';

    // Telemetry
    this.telemetryPanel = el('div', 'osa-panel hud-hideable');
    this.telemetryPanel.id = 'telemetry';
    this.hud.appendChild(this.telemetryPanel);

    // Mission state
    this.missionStatePanel = el('div', 'osa-panel hud-hideable');
    this.missionStatePanel.id = 'mission-state';
    this.hud.appendChild(this.missionStatePanel);

    // Countdown
    this.countdownEl = el('div');
    this.countdownEl.id = 'countdown';
    this.hud.appendChild(this.countdownEl);

    // Warnings
    this.warningsEl = el('div', 'hud-hideable');
    this.warningsEl.id = 'warnings';
    this.hud.appendChild(this.warningsEl);

    // Time controls
    this.timeControls = el('div', 'osa-panel hud-hideable');
    this.timeControls.id = 'time-controls';
    this.timeControls.appendChild(el('span', 'warp-label', 'WARP'));
    for (const scale of TIME_SCALES) {
      const btn = el('button', 'osa-btn', `${scale}×`);
      btn.dataset.scale = String(scale);
      btn.addEventListener('click', () => this.handlers.onSetTimeScale(scale));
      this.timeControls.appendChild(btn);
    }
    const pause = el('button', 'osa-btn', '❚❚');
    pause.id = 'pause-btn';
    pause.addEventListener('click', () => this.handlers.onTogglePause());
    this.timeControls.appendChild(pause);

    const mute = el('button', 'osa-btn', '🔊');
    mute.id = 'mute-btn';
    mute.addEventListener('click', () => this.handlers.onToggleMute());
    this.timeControls.appendChild(mute);

    this.hud.appendChild(this.timeControls);

    // Diagnostics readout
    this.diagnosticsPanel = el('div', 'osa-panel hud-hideable');
    this.diagnosticsPanel.id = 'diagnostics';
    this.hud.appendChild(this.diagnosticsPanel);

    this.root.appendChild(this.hud);
  }

  private buildSystemCheck(): void {
    this.systemCheck = el('div', 'osa-panel');
    this.systemCheck.id = 'system-check';
    this.root.appendChild(this.systemCheck);
  }

  private buildTutorial(): void {
    this.tutorialPanel = el('div', 'osa-panel');
    this.tutorialPanel.id = 'tutorial';
    this.root.appendChild(this.tutorialPanel);
  }

  private buildResult(): void {
    this.resultPanel = el('div');
    this.resultPanel.id = 'result';
    this.root.appendChild(this.resultPanel);
  }

  private buildSubtitle(): void {
    this.subtitleEl = el('div');
    this.subtitleEl.id = 'subtitle';
    this.subtitleEl.appendChild(el('span', 'speaker'));
    this.subtitleEl.appendChild(el('div', 'line'));
    this.root.appendChild(this.subtitleEl);
  }

  private buildSlate(): void {
    this.slateEl = el('div');
    this.slateEl.id = 'slate';
    this.slateEl.appendChild(el('div', 'bar'));
    this.slateEl.appendChild(el('div', 'title'));
    this.slateEl.appendChild(el('div', 'sub'));
    this.root.appendChild(this.slateEl);
  }

  // -------------------------------------------------------------------------
  // Screen visibility
  // -------------------------------------------------------------------------

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  showMenu(show: boolean): void {
    this.menu.classList.toggle('hidden', !show);
  }

  showBuild(show: boolean): void {
    this.buildUI.classList.toggle('hidden', !show);
  }

  showHud(show: boolean): void {
    this.hud.style.display = show ? 'block' : 'none';
  }

  setCinematicMode(on: boolean): void {
    this.cinematicMode = on;
    document.body.classList.toggle('cinematic', on);
  }

  get isCinematic(): boolean {
    return this.cinematicMode;
  }

  /** Fades the screen to or from black. */
  fade(to: number, seconds: number): void {
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    // Force a reflow so the transition applies even on an immediate change.
    void this.fadeEl.offsetHeight;
    this.fadeEl.style.opacity = String(to);
  }

  // -------------------------------------------------------------------------
  // Build screen
  // -------------------------------------------------------------------------

  private refreshCategoryTabs(): void {
    for (const btn of Array.from(this.categoryTabs.children)) {
      btn.classList.toggle(
        'active',
        (btn as HTMLElement).dataset.category === this.activeCategory,
      );
    }
  }

  private refreshPartList(): void {
    this.partList.innerHTML = '';
    const parts = PART_CATALOG.filter((p) => p.category === this.activeCategory);

    for (const part of parts) {
      this.partList.appendChild(this.buildPartEntry(part));
    }

    if (parts.length === 0) {
      this.partList.appendChild(
        el('div', 'osa-label', 'No parts in this category yet.'),
      );
    }
  }

  private buildPartEntry(part: PartDef): HTMLElement {
    const entry = el('div', 'part-entry');
    entry.appendChild(el('div', 'name', part.name));

    const spec = el('div', 'spec');
    spec.appendChild(el('span', undefined, formatMass(part.mass)));
    spec.appendChild(
      el(
        'span',
        undefined,
        `${part.dimensions[0].toFixed(1)} × ${part.dimensions[1].toFixed(1)} m`,
      ),
    );
    spec.appendChild(el('span', undefined, `${part.cost} cr`));
    if (part.engine) {
      // Catalogue figures are per nozzle; show the part's total.
      const n = part.engine.nozzleCount;
      spec.appendChild(
        el('span', undefined, `${formatForce(part.engine.thrustSL * n)} SL`),
      );
      spec.appendChild(el('span', undefined, `${part.engine.ispVac} s Isp`));
      if (n > 1) spec.appendChild(el('span', undefined, `${n} nozzles`));
    }
    if (part.tank) {
      spec.appendChild(el('span', undefined, `${formatMass(part.tank.propellantMass)} prop`));
    }
    if (part.power && part.power.outputW > 0) {
      spec.appendChild(el('span', undefined, `${part.power.outputW} W`));
    }
    entry.appendChild(spec);
    entry.appendChild(el('div', 'fn', part.function));

    entry.title = part.description;
    entry.addEventListener('click', () =>
      this.handlers.onAddPart(part.id, this.selectedStage),
    );

    return entry;
  }

  /** Redraws the stack list and vehicle statistics. */
  refreshVehicle(design: VehicleDesign, analysis: VehicleAnalysis | null): void {
    // ---- Stack ----
    this.stackList.innerHTML = '';
    if (design.stack.length === 0) {
      this.stackList.appendChild(
        el('div', 'osa-label', 'Empty. Add an engine to begin.'),
      );
    }

    // Displayed top-to-bottom, which is how the vehicle reads on screen.
    for (let i = design.stack.length - 1; i >= 0; i--) {
      this.stackList.appendChild(this.buildStackEntry(design.stack[i], i));
    }

    // ---- Statistics ----
    this.vehicleStats.innerHTML = '';
    const stat = (label: string, value: string, cls = ''): void => {
      const wrap = el('div');
      wrap.appendChild(el('div', 'osa-label', label));
      wrap.appendChild(el('div', `osa-value ${cls}`, value));
      this.vehicleStats.appendChild(wrap);
    };

    if (analysis) {
      const twrClass =
        analysis.liftoffTWR < 1 ? 'fail' : analysis.liftoffTWR < 1.2 ? 'warn' : '';
      stat('Total mass', formatMass(analysis.totalMass));
      stat('Height', `${designHeight(design).toFixed(1)} m`);
      stat('TWR', analysis.liftoffTWR.toFixed(2), twrClass);
      stat('Delta-v', `${analysis.totalDeltaV.toFixed(0)} m/s`);
      stat(
        'Static margin',
        `${analysis.staticMargin.toFixed(2)} m`,
        analysis.staticMargin > 0 ? '' : 'warn',
      );
      stat('Cost', `${designCost(design)} cr`);
    } else {
      stat('Total mass', '—');
      stat('Height', '—');
    }

    this.launchButton.disabled = design.stack.length === 0;
    this.launchButton.textContent = analysis?.launchable ? 'LAUNCH' : 'LAUNCH ANYWAY';
    this.launchButton.classList.toggle('danger', analysis ? !analysis.launchable : false);
  }

  private buildStackEntry(item: StackItem, index: number): HTMLElement {
    const def = getPart(item.partId);
    const entry = el('div', 'stack-entry');

    const chip = el('span', 'stage-chip', `S${item.stage + 1}`);
    chip.title = 'Click to change stage';
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () =>
      this.handlers.onSetStage(index, (item.stage + 1) % 4),
    );
    entry.appendChild(chip);

    const name = el('span', 'nm', def.name);
    const radialCount = (item.radial ?? []).reduce((n, r) => n + r.count, 0);
    if (radialCount > 0) {
      name.textContent = `${def.name}  (+${radialCount})`;
    }
    entry.appendChild(name);

    const rm = el('span', 'rm', '✕');
    rm.title = 'Remove';
    rm.addEventListener('click', () => this.handlers.onRemovePart(index));
    entry.appendChild(rm);

    return entry;
  }

  setDiagnosticsButtonActive(active: boolean): void {
    document.getElementById('diag-toggle')?.classList.toggle('active', active);
  }

  // -------------------------------------------------------------------------
  // System check (spec §53)
  // -------------------------------------------------------------------------

  showSystemCheck(analysis: VehicleAnalysis, mission: MissionDef): void {
    this.systemCheck.innerHTML = '';

    const header = el('header');
    header.appendChild(el('div', 'title', 'SYSTEM CHECK'));
    header.appendChild(
      el(
        'div',
        'sub',
        `${mission.name} · ${mission.subtitle} — all figures computed from the ` +
          'same model the flight simulation uses.',
      ),
    );
    this.systemCheck.appendChild(header);

    for (const report of analysis.reports) {
      this.systemCheck.appendChild(this.buildCheckRow(report));
    }

    const footer = el('div');
    footer.id = 'check-footer';

    const verdict = el(
      'div',
      `verdict ${analysis.launchable ? 'go' : 'no-go'}`,
      analysis.launchable
        ? 'ALL SYSTEMS GO'
        : `NO-GO · ${analysis.reports.filter((r) => r.status === 'fail').length} SUBSYSTEM FAILURES`,
    );
    footer.appendChild(verdict);

    const close = el('button', 'osa-btn', 'Back to build');
    close.addEventListener('click', () => this.handlers.onCloseCheck());
    footer.appendChild(close);

    const launch = el(
      'button',
      `osa-btn ${analysis.launchable ? 'primary' : 'danger'}`,
      analysis.launchable ? 'Proceed to launch' : 'Launch anyway',
    );
    launch.addEventListener('click', () => this.handlers.onLaunch());
    footer.appendChild(launch);

    this.systemCheck.appendChild(footer);
    this.systemCheck.classList.add('visible');
  }

  private buildCheckRow(report: SubsystemReport): HTMLElement {
    const row = el('div', 'check-row');
    row.appendChild(el('div', 'sys', report.system));
    row.appendChild(
      el('div', `status ${report.status}`, report.status.toUpperCase()),
    );
    const body = el('div', 'body');
    body.appendChild(el('div', 'summary', report.summary));
    body.appendChild(el('div', 'detail', report.detail));
    row.appendChild(body);
    return row;
  }

  hideSystemCheck(): void {
    this.systemCheck.classList.remove('visible');
  }

  get isSystemCheckOpen(): boolean {
    return this.systemCheck.classList.contains('visible');
  }

  // -------------------------------------------------------------------------
  // HUD updates
  // -------------------------------------------------------------------------

  updateTelemetry(sim: MissionSim, telemetry: FlightTelemetry): void {
    const rows: Array<[string, string, string]> = [
      ['Altitude', formatDistance(telemetry.altitude), ''],
      ['Speed', formatSpeed(telemetry.airspeed), ''],
      ['Vertical', `${telemetry.verticalSpeed >= 0 ? '+' : ''}${telemetry.verticalSpeed.toFixed(0)} m/s`, ''],
      ['Downrange', formatDistance(telemetry.downrange), ''],
      ['Mach', telemetry.mach.toFixed(2), telemetry.mach > 1 ? 'warn' : ''],
      [
        'Dyn. pressure',
        `${(telemetry.dynamicPressure / 1000).toFixed(1)} kPa`,
        telemetry.dynamicPressure > 30_000 ? 'fail' : telemetry.dynamicPressure > 20_000 ? 'warn' : '',
      ],
      ['Acceleration', `${telemetry.gForce.toFixed(1)} g`, telemetry.gForce > 4.5 ? 'warn' : ''],
      ['Thrust', formatForce(telemetry.thrust), ''],
      ['Mass', formatMass(telemetry.massProperties.totalMass), ''],
      [
        'Propellant',
        `${(telemetry.propellantFraction * 100).toFixed(0)}%`,
        telemetry.propellantFraction < 0.12 ? 'warn' : '',
      ],
    ];

    // Orbital elements only make sense once the vehicle is actually going fast.
    if (telemetry.apoapsis > 40_000) {
      rows.push(['Apoapsis', formatDistance(telemetry.apoapsis), '']);
      rows.push([
        'Periapsis',
        telemetry.periapsis < -1000 ? 'SUBORBITAL' : formatDistance(telemetry.periapsis),
        telemetry.periapsis < 100_000 ? 'warn' : '',
      ]);
    }

    // During the cruise, show the journey instead (spec §30).
    if (sim.state === MissionState.TRANSFER) {
      rows.length = 0;
      const t = sim.transfer;
      rows.push(['To Mars', formatDistance(t.distanceToDestination()), '']);
      rows.push(['From Earth', formatDistance(t.distanceToOrigin()), '']);
      rows.push(['Elapsed', formatDuration(t.elapsed), '']);
      rows.push(['Remaining', formatDuration(t.timeRemaining()), '']);
      rows.push(['Progress', `${(t.progress * 100).toFixed(1)}%`, '']);
      rows.push(['Injection Δv', `${t.departureDeltaV.toFixed(0)} m/s`, '']);
    }

    this.telemetryPanel.innerHTML = '';
    for (const [label, value, cls] of rows) {
      const row = el('div', 'row');
      row.appendChild(el('div', 'osa-label', label));
      row.appendChild(el('div', `osa-value ${cls}`, value));
      this.telemetryPanel.appendChild(row);
    }
  }

  updateMissionState(sim: MissionSim): void {
    this.missionStatePanel.innerHTML = '';
    this.missionStatePanel.appendChild(
      el('div', 'phase', sim.state.replace(/_/g, ' ')),
    );
    const met = sim.missionTime;
    const sign = met < 0 ? '−' : '+';
    this.missionStatePanel.appendChild(
      el('div', 'met', `T${sign}${formatDuration(Math.abs(met))}`),
    );
  }

  showCountdown(value: number): void {
    this.countdownEl.textContent = value > 0 ? String(value) : 'LIFTOFF';
    // Restart the animation.
    this.countdownEl.classList.remove('tick');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('tick');
  }

  updateWarnings(warnings: readonly Warning[]): void {
    this.warningsEl.innerHTML = '';
    // Show the most severe handful; a wall of text helps nobody.
    const sorted = [...warnings].sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === 'fail' ? -1 : 1,
    );
    for (const w of sorted.slice(0, 4)) {
      const div = el('div', `warning ${w.severity}`);
      div.appendChild(el('span', 'code', `WARNING: ${w.code}`));
      div.appendChild(el('span', 'msg', w.message));
      this.warningsEl.appendChild(div);
    }
  }

  updateTimeControls(scale: number, paused: boolean, muted: boolean): void {
    for (const btn of Array.from(this.timeControls.children)) {
      const e = btn as HTMLElement;
      if (e.dataset.scale) {
        e.classList.toggle('active', Number(e.dataset.scale) === scale);
      }
    }
    const pause = document.getElementById('pause-btn');
    if (pause) {
      pause.textContent = paused ? '▶' : '❚❚';
      pause.classList.toggle('active', paused);
    }
    const mute = document.getElementById('mute-btn');
    if (mute) mute.textContent = muted ? '🔇' : '🔊';
  }

  updateDiagnostics(sim: MissionSim, visible: boolean): void {
    this.diagnosticsPanel.classList.toggle('visible', visible);
    if (!visible) return;

    const mp = sim.telemetry.massProperties;
    this.diagnosticsPanel.innerHTML = '';
    this.diagnosticsPanel.appendChild(el('div', 'head', 'VEHICLE DIAGNOSTICS'));

    const row = (k: string, v: string, cls = ''): void => {
      const r = el('div', 'diag-row');
      r.appendChild(el('span', 'k', k));
      r.appendChild(el('span', `v ${cls}`, v));
      this.diagnosticsPanel.appendChild(r);
    };

    row('Centre of mass', `${mp.centreOfMass.y.toFixed(2)} m`);
    row('Centre of thrust', `${mp.centreOfThrust.y.toFixed(2)} m`);
    row('Centre of pressure', `${mp.centreOfPressure.y.toFixed(2)} m`);
    row(
      'Static margin',
      `${mp.staticMargin.toFixed(2)} m`,
      mp.staticMargin > 0 ? 'good' : 'bad',
    );
    row(
      'Thrust offset',
      `${mp.thrustOffset.toFixed(3)} m`,
      mp.thrustOffset < 0.05 ? 'good' : 'bad',
    );
    row('Angle of attack', `${sim.telemetry.angleOfAttack.toFixed(1)}°`);
    row('Flight path', `${sim.telemetry.flightPathAngle.toFixed(1)}°`);
    row('Drag area', `${mp.dragArea.toFixed(1)} m²`);
    row('Pitch inertia', `${(mp.inertia / 1e6).toFixed(1)} Mkg·m²`);

    const legend = el('div', 'diag-legend');
    const item = (color: string, text: string): void => {
      const i = el('div', 'item');
      const sw = el('div', 'swatch');
      sw.style.background = color;
      i.appendChild(sw);
      i.appendChild(el('span', undefined, text));
      legend.appendChild(i);
    };
    item('#ffd23a', 'CENTRE OF MASS');
    item('#35b6ea', 'CENTRE OF THRUST');
    item('#e05fd0', 'CENTRE OF PRESSURE');
    item('#ff7a2a', 'THRUST VECTOR');
    item('#4fd08a', 'VELOCITY VECTOR');
    this.diagnosticsPanel.appendChild(legend);
  }

  // -------------------------------------------------------------------------
  // Tutorial (spec §46, §47)
  // -------------------------------------------------------------------------

  updateTutorial(tutorial: Tutorial, ctx: TutorialContext): void {
    const step = tutorial.step;
    if (!step || !tutorial.isActive) {
      this.tutorialPanel.classList.remove('visible');
      return;
    }

    this.tutorialPanel.classList.add('visible');
    this.tutorialPanel.innerHTML = '';

    const head = el('div', 'head');
    head.appendChild(
      el('div', 'who', step.speaker === 'engineer' ? '🦺' : '🥽'),
    );
    const titleWrap = el('div');
    titleWrap.style.flex = '1';
    titleWrap.appendChild(
      el(
        'div',
        'step-no',
        `${step.speaker === 'engineer' ? 'QUILL' : 'MAVIS'} · STEP ${tutorial.stepNumber} OF ${tutorial.stepCount}`,
      ),
    );
    titleWrap.appendChild(el('div', 'title', step.title));
    head.appendChild(titleWrap);
    this.tutorialPanel.appendChild(head);

    const body = el('div', 'body');
    body.innerHTML = step.body;
    if (step.concept) {
      const concept = el('div', 'concept');
      concept.appendChild(el('strong', undefined, step.concept.heading));
      concept.appendChild(document.createTextNode(step.concept.text));
      body.appendChild(concept);
    }
    this.tutorialPanel.appendChild(body);

    const satisfied = tutorial.isCurrentSatisfied(ctx);
    const foot = el('div', 'foot');
    foot.appendChild(
      el(
        'div',
        `objective ${satisfied ? 'done' : ''}`,
        satisfied ? `✓ ${step.objective}` : `▸ ${step.objective}`,
      ),
    );

    const backBtn = el('button', 'osa-btn', 'Back');
    backBtn.addEventListener('click', () => this.handlers.onTutorialBack());
    foot.appendChild(backBtn);

    const skipBtn = el('button', 'osa-btn', 'Skip tutorial');
    skipBtn.addEventListener('click', () => this.handlers.onTutorialSkip());
    foot.appendChild(skipBtn);

    const nextBtn = el(
      'button',
      `osa-btn ${satisfied ? 'primary' : ''}`,
      step.informational ? 'Continue' : 'Next',
    ) as HTMLButtonElement;
    // The step genuinely blocks until the objective is met (spec §47).
    nextBtn.disabled = !satisfied;
    nextBtn.addEventListener('click', () => this.handlers.onTutorialAdvance());
    foot.appendChild(nextBtn);

    this.tutorialPanel.appendChild(foot);
  }

  // -------------------------------------------------------------------------
  // Cinematic overlays
  // -------------------------------------------------------------------------

  say(line: DialogueLine): void {
    if (!line.text) {
      this.subtitleEl.classList.remove('visible');
      this.subtitleTimer = 0;
      return;
    }
    const speaker = this.subtitleEl.querySelector('.speaker') as HTMLElement;
    const text = this.subtitleEl.querySelector('.line') as HTMLElement;
    speaker.textContent = line.speaker ?? '';
    speaker.style.display = line.speaker ? 'block' : 'none';
    text.textContent = line.text;
    this.subtitleEl.classList.add('visible');
    this.subtitleTimer = line.duration;
  }

  slate(title: string, subtitle = ''): void {
    const t = this.slateEl.querySelector('.title') as HTMLElement;
    const s = this.slateEl.querySelector('.sub') as HTMLElement;
    t.textContent = title;
    s.textContent = subtitle;
    s.style.display = subtitle ? 'block' : 'none';
    this.slateEl.classList.add('visible');
    this.slateTimer = 3.4;
  }

  /** Ticks the transient overlays. */
  update(dt: number): void {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitleEl.classList.remove('visible');
    }
    if (this.slateTimer > 0) {
      this.slateTimer -= dt;
      if (this.slateTimer <= 0) this.slateEl.classList.remove('visible');
    }
  }

  // -------------------------------------------------------------------------
  // Mission result (spec §38, §51, §52)
  // -------------------------------------------------------------------------

  showResult(sim: MissionSim): void {
    const success = sim.state === MissionState.MISSION_COMPLETE;
    this.resultPanel.innerHTML = '';

    const card = el('div', 'osa-panel card');
    card.appendChild(
      el(
        'div',
        `verdict ${success ? 'good' : 'bad'}`,
        success ? 'MISSION COMPLETE' : 'MISSION FAILED',
      ),
    );

    card.appendChild(
      el(
        'div',
        'headline',
        success
          ? `${sim.mission.name} — objectives achieved.`
          : (sim.failure?.title ?? 'The vehicle did not complete its mission.'),
      ),
    );

    // Peak values from the recorded telemetry, so the summary is real data.
    const stats = el('div', 'stats');
    const stat = (label: string, value: string): void => {
      const w = el('div');
      w.appendChild(el('div', 'osa-label', label));
      w.appendChild(el('div', 'osa-value', value));
      stats.appendChild(w);
    };
    stat('Peak altitude', formatDistance(sim.recorder.peak('altitude')));
    stat('Peak speed', formatSpeed(sim.recorder.peak('airspeed')));
    stat('Max Mach', sim.recorder.peak('mach').toFixed(2));
    stat('Max dyn. pressure', `${(sim.recorder.peak('dynamicPressure') / 1000).toFixed(1)} kPa`);
    stat('Peak acceleration', `${sim.recorder.peak('gForce').toFixed(1)} g`);
    stat('Mission duration', formatDuration(Math.max(sim.missionTime, 0)));
    card.appendChild(stats);

    if (!success && sim.failure) {
      // The failure explanation is the teaching moment (spec §52).
      card.appendChild(el('div', 'explanation', sim.failure.explanation));
    } else if (success && sim.touchdownVelocity() > 0) {
      card.appendChild(
        el(
          'div',
          'explanation',
          `Touchdown at ${sim.touchdownVelocity().toFixed(1)} m/s, within the ` +
            'landing system’s rating. The vehicle is on the surface and intact.',
        ),
      );
    }

    const actions = el('div', 'actions');

    const replay = el('button', 'osa-btn', 'Mission replay');
    replay.addEventListener('click', () => this.handlers.onReplay());
    actions.appendChild(replay);

    const rebuild = el('button', 'osa-btn', 'Back to workshop');
    rebuild.addEventListener('click', () => this.handlers.onReturnToBuild());
    actions.appendChild(rebuild);

    const menu = el('button', 'osa-btn primary', 'Mission list');
    menu.addEventListener('click', () => this.handlers.onReturnToMenu());
    actions.appendChild(menu);

    card.appendChild(actions);
    this.resultPanel.appendChild(card);
    this.resultPanel.classList.add('visible');
  }

  hideResult(): void {
    this.resultPanel.classList.remove('visible');
  }

  get isResultVisible(): boolean {
    return this.resultPanel.classList.contains('visible');
  }
}
