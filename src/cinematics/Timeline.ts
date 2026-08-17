/**
 * A small keyframed timeline for scripted sequences.
 *
 * Cinematics are scripted, but they run *alongside* the simulation rather than
 * replacing it (spec §79): a timeline moves cameras and characters, and the
 * vehicle continues to be driven by physics underneath. A timeline can also be
 * skipped at any point, which fires every remaining cue immediately so the world
 * ends up in a consistent state instead of a half-played one.
 */

interface Cue {
  readonly time: number;
  readonly action: () => void;
  fired: boolean;
  /** Cues marked as presentation-only are dropped rather than fired on skip. */
  readonly visualOnly: boolean;
}

export class Timeline {
  private readonly cues: Cue[] = [];
  private elapsed = 0;
  private running = false;
  private finishedCallback: (() => void) | null = null;

  /** Total scripted length, seconds. */
  get duration(): number {
    return this.cues.length > 0 ? this.cues[this.cues.length - 1].time : 0;
  }

  get time(): number {
    return this.elapsed;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Adds a cue.
   *
   * @param visualOnly cues that only place a camera or pose a character; on
   *                   skip they are discarded rather than fired, because firing
   *                   them all at once would be meaningless.
   */
  at(time: number, action: () => void, visualOnly = false): this {
    this.cues.push({ time, action, fired: false, visualOnly });
    this.cues.sort((a, b) => a.time - b.time);
    return this;
  }

  /** Convenience: adds a cue relative to the last one. */
  then(delay: number, action: () => void, visualOnly = false): this {
    return this.at(this.duration + delay, action, visualOnly);
  }

  onFinished(cb: () => void): this {
    this.finishedCallback = cb;
    return this;
  }

  start(): void {
    this.elapsed = 0;
    this.running = true;
    for (const c of this.cues) c.fired = false;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.elapsed += dt;

    for (const cue of this.cues) {
      if (!cue.fired && this.elapsed >= cue.time) {
        cue.fired = true;
        cue.action();
      }
    }

    if (this.elapsed >= this.duration && this.cues.every((c) => c.fired)) {
      this.running = false;
      const cb = this.finishedCallback;
      this.finishedCallback = null;
      cb?.();
    }
  }

  /** Ends the sequence now, firing any remaining non-visual cues. */
  skip(): void {
    if (!this.running) return;
    for (const cue of this.cues) {
      if (!cue.fired) {
        cue.fired = true;
        if (!cue.visualOnly) cue.action();
      }
    }
    this.running = false;
    this.elapsed = this.duration;
    const cb = this.finishedCallback;
    this.finishedCallback = null;
    cb?.();
  }

  stop(): void {
    this.running = false;
  }
}

/**
 * A line of dialogue. Text is deliberately secondary to the image (spec §27):
 * these are rendered as small subtitles at the bottom of the frame, never as a
 * panel covering the shot.
 */
export interface DialogueLine {
  readonly speaker: 'QUILL' | 'MAVIS' | 'CONTROL' | null;
  readonly text: string;
  readonly duration: number;
}
