/**
 * Audio (spec §59).
 *
 * Every sound is synthesised at runtime with the Web Audio API — no audio files
 * ship with the project. That is not just an asset-size decision: an engine's
 * roar is a continuous, parameter-driven sound that has to track throttle and
 * atmospheric density in real time, and synthesis gives that directly.
 *
 * The signature effect is the vacuum cutoff: sound needs air, so as the vehicle
 * climbs out of the atmosphere the engine roar is low-passed and faded to
 * nothing, leaving only the structural rumble conducted through the airframe.
 */
import { clamp, lerp } from '../utils/math';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  private engineSource: AudioBufferSourceNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineLow: GainNode | null = null;
  private engineLowFilter: BiquadFilterNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private ambienceGain: GainNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  private started = false;
  private muted = false;
  private masterVolume = 0.75;

  /** Web Audio requires a user gesture; call this from a click handler. */
  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);

    this.noiseBuffer = this.createNoiseBuffer(4);
    this.buildEngineChain();
    this.buildWindChain();

    this.started = true;
  }

  get isRunning(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : this.masterVolume,
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1);
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  // -------------------------------------------------------------------------
  // Buffers
  // -------------------------------------------------------------------------

  /** White noise, the raw material for engines, wind and most impacts. */
  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Brown-ish noise: integrating white noise emphasises low frequencies,
    // which is what makes a rocket sound big rather than hissy.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2 + white * 0.25;
    }
    return buffer;
  }

  // -------------------------------------------------------------------------
  // Continuous sources
  // -------------------------------------------------------------------------

  private buildEngineChain(): void {
    const ctx = this.ctx!;

    // Mid/high band: the roar, which needs air to exist.
    this.engineSource = ctx.createBufferSource();
    this.engineSource.buffer = this.noiseBuffer;
    this.engineSource.loop = true;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.8;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    // A resonant peak gives the roar a throaty character.
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 140;
    peak.Q.value = 1.4;
    peak.gain.value = 9;

    this.engineSource.connect(this.engineFilter);
    this.engineFilter.connect(peak);
    peak.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus!);
    this.engineSource.start();

    // Low band: structural rumble conducted through the vehicle. This survives
    // in vacuum, because it is not travelling through air.
    const lowSource = ctx.createBufferSource();
    lowSource.buffer = this.noiseBuffer;
    lowSource.loop = true;

    this.engineLowFilter = ctx.createBiquadFilter();
    this.engineLowFilter.type = 'lowpass';
    this.engineLowFilter.frequency.value = 90;
    this.engineLowFilter.Q.value = 2.2;

    this.engineLow = ctx.createGain();
    this.engineLow.gain.value = 0;

    lowSource.connect(this.engineLowFilter);
    this.engineLowFilter.connect(this.engineLow);
    this.engineLow.connect(this.sfxBus!);
    lowSource.start();
  }

  private buildWindChain(): void {
    const ctx = this.ctx!;

    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.7;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.sfxBus!);
    this.windSource.start();
  }

  /**
   * Updates the continuous engine sound.
   *
   * @param throttle    0..1
   * @param airDensity  0..1 relative to sea level — drives the vacuum cutoff
   * @param distance    metres from the camera, for falloff
   */
  updateEngine(throttle: number, airDensity: number, distance = 60): void {
    if (!this.ctx || !this.engineGain || !this.engineFilter || !this.engineLow) return;
    const now = this.ctx.currentTime;

    // Inverse falloff with a floor, so a distant launch is quiet but audible.
    const falloff = clamp(120 / Math.max(distance, 40), 0.05, 1);
    const air = clamp(airDensity, 0, 1);

    // The audible roar requires atmosphere.
    const roar = throttle * air * falloff * 0.42;
    this.engineGain.gain.setTargetAtTime(roar, now, 0.08);

    // In thin air the remaining sound is dull and low.
    this.engineFilter.frequency.setTargetAtTime(
      lerp(320, 1_400, air * (0.4 + throttle * 0.6)),
      now,
      0.15,
    );

    // Structural rumble persists regardless of air.
    this.engineLow.gain.setTargetAtTime(throttle * falloff * 0.3, now, 0.12);
  }

  /** Aerodynamic noise, which peaks around maximum dynamic pressure. */
  updateWind(dynamicPressure: number, airDensity: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const now = this.ctx.currentTime;
    const q = clamp(dynamicPressure / 30_000, 0, 1);
    this.windGain.gain.setTargetAtTime(q * clamp(airDensity, 0, 1) * 0.3, now, 0.2);
    this.windFilter.frequency.setTargetAtTime(lerp(300, 1_800, q), now, 0.25);
  }

  /** Ambient bed for a scene: pad wind, workshop hum, Martian wind. */
  setAmbience(kind: 'pad' | 'workshop' | 'control' | 'mars' | 'space' | 'none'): void {
    if (!this.ctx || !this.sfxBus) return;

    if (this.ambienceSource) {
      try {
        this.ambienceSource.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      this.ambienceSource.disconnect();
      this.ambienceSource = null;
    }
    if (this.ambienceGain) {
      this.ambienceGain.disconnect();
      this.ambienceGain = null;
    }
    if (kind === 'none' || kind === 'space') return;

    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    switch (kind) {
      case 'pad':
        // Open-air wind across a large flat site.
        filter.type = 'bandpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.5;
        gain.gain.value = 0.075;
        break;
      case 'mars':
        // Thin, high, hollow — a very low-density atmosphere.
        filter.type = 'bandpass';
        filter.frequency.value = 240;
        filter.Q.value = 1.6;
        gain.gain.value = 0.045;
        break;
      case 'workshop':
        // Ventilation and machinery hum in a big enclosed volume.
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        gain.gain.value = 0.075;
        break;
      case 'control':
        // Quiet room tone with electronics.
        filter.type = 'lowpass';
        filter.frequency.value = 120;
        gain.gain.value = 0.045;
        break;
      default:
        break;
    }

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start();

    this.ambienceSource = src;
    this.ambienceGain = gain;

    // Slow gain drift so the bed breathes instead of sitting flat.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = gain.gain.value * 0.45;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();
  }

  // -------------------------------------------------------------------------
  // One-shot events
  // -------------------------------------------------------------------------

  /** A filtered noise burst — the basis of ignition, separation and impacts. */
  private burst(options: {
    duration: number;
    peak: number;
    filterType: BiquadFilterType;
    startFreq: number;
    endFreq: number;
    q?: number;
    attack?: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (options.delay ?? 0);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = options.filterType;
    filter.Q.value = options.q ?? 1;
    filter.frequency.setValueAtTime(options.startFreq, t0);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(options.endFreq, 20),
      t0 + options.duration,
    );

    const gain = ctx.createGain();
    const attack = options.attack ?? 0.01;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(options.peak, 0.0002), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + options.duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + options.duration + 0.05);
  }

  /** A pitched tone — beeps, alarms, countdown marks. */
  private tone(options: {
    frequency: number;
    duration: number;
    peak: number;
    type?: OscillatorType;
    endFrequency?: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (options.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(options.frequency, t0);
    if (options.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(options.endFrequency, t0 + options.duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(options.peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + options.duration);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + options.duration + 0.05);
  }

  /** Countdown mark. The zero mark is a distinct, higher, longer tone. */
  countdownBeep(isZero = false): void {
    this.tone({
      frequency: isZero ? 1_180 : 780,
      duration: isZero ? 0.55 : 0.13,
      peak: isZero ? 0.2 : 0.13,
      type: 'square',
    });
  }

  /** Ignition: a hard crack, then a swelling roar. */
  ignition(): void {
    this.burst({
      duration: 0.4,
      peak: 0.45,
      filterType: 'lowpass',
      startFreq: 2_800,
      endFreq: 260,
      attack: 0.004,
    });
    this.burst({
      duration: 2.6,
      peak: 0.3,
      filterType: 'lowpass',
      startFreq: 180,
      endFreq: 900,
      attack: 0.5,
      delay: 0.1,
    });
  }

  /** Explosive-bolt separation: a sharp crack with a metallic ring. */
  separation(): void {
    this.burst({
      duration: 0.32,
      peak: 0.38,
      filterType: 'bandpass',
      startFreq: 2_400,
      endFreq: 420,
      q: 1.6,
      attack: 0.003,
    });
    this.tone({ frequency: 620, endFrequency: 190, duration: 0.7, peak: 0.1, type: 'triangle' });
  }

  /** Pyrotechnic fairing jettison. */
  fairingJettison(): void {
    this.burst({
      duration: 0.5,
      peak: 0.3,
      filterType: 'highpass',
      startFreq: 700,
      endFreq: 2_600,
      attack: 0.004,
    });
  }

  /** Parachute mortar fire, then the canopy cracking open. */
  chuteDeploy(): void {
    this.burst({
      duration: 0.22,
      peak: 0.4,
      filterType: 'lowpass',
      startFreq: 1_800,
      endFreq: 300,
      attack: 0.002,
    });
    this.burst({
      duration: 1.1,
      peak: 0.24,
      filterType: 'bandpass',
      startFreq: 900,
      endFreq: 240,
      q: 0.8,
      delay: 0.35,
      attack: 0.09,
    });
  }

  /** Touchdown: a dull thud plus the creak of the gear taking load. */
  touchdown(hard = false): void {
    this.burst({
      duration: hard ? 0.9 : 0.5,
      peak: hard ? 0.5 : 0.3,
      filterType: 'lowpass',
      startFreq: hard ? 420 : 260,
      endFreq: 60,
      attack: 0.005,
    });
    this.tone({
      frequency: hard ? 90 : 140,
      endFrequency: 55,
      duration: 0.8,
      peak: 0.11,
      type: 'sine',
    });
  }

  /** Deployment servo: a small motorised whirr. */
  servo(duration = 1.4): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.linearRampToValueAtTime(168, t0 + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.1);
    gain.gain.setValueAtTime(0.05, t0 + duration - 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** Radio comms chirp, used to punctuate callouts. */
  commsChirp(): void {
    this.tone({ frequency: 1_450, endFrequency: 980, duration: 0.09, peak: 0.06, type: 'sine' });
    this.burst({
      duration: 0.14,
      peak: 0.03,
      filterType: 'bandpass',
      startFreq: 2_200,
      endFreq: 1_400,
      q: 3,
      delay: 0.08,
    });
  }

  /** Warning klaxon for a failure. */
  alarm(): void {
    for (let i = 0; i < 3; i++) {
      this.tone({
        frequency: 440,
        endFrequency: 300,
        duration: 0.34,
        peak: 0.16,
        type: 'sawtooth',
        delay: i * 0.42,
      });
    }
  }

  /** Success sting: a short rising major triad. */
  success(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone({ frequency: f, duration: 0.85, peak: 0.11, type: 'triangle', delay: i * 0.13 });
    });
  }

  /** Failure sting: a descending minor figure. */
  failure(): void {
    const notes = [392, 349.23, 293.66, 233.08];
    notes.forEach((f, i) => {
      this.tone({ frequency: f, duration: 1.1, peak: 0.1, type: 'sine', delay: i * 0.2 });
    });
  }

  /** UI click. */
  click(): void {
    this.tone({ frequency: 1_100, duration: 0.045, peak: 0.05, type: 'square' });
  }

  /** UI confirm. */
  confirm(): void {
    this.tone({ frequency: 740, endFrequency: 1_180, duration: 0.16, peak: 0.07, type: 'triangle' });
  }

  /** Duck vocalisation, pitched per character. */
  quack(role: 'engineer' | 'pilot'): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const base = role === 'engineer' ? 300 : 420;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    // The characteristic quack contour: up then sharply down.
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.linearRampToValueAtTime(base * 1.5, t0 + 0.05);
    osc.frequency.exponentialRampToValueAtTime(base * 0.62, t0 + 0.19);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(base * 3.4, t0);
    filter.frequency.exponentialRampToValueAtTime(base * 1.7, t0 + 0.2);
    filter.Q.value = 5.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.28);
  }

  /** Sonic boom rolling back to the observer after the vehicle goes supersonic. */
  sonicBoom(): void {
    this.burst({
      duration: 1.6,
      peak: 0.34,
      filterType: 'lowpass',
      startFreq: 700,
      endFreq: 55,
      attack: 0.02,
    });
  }

  dispose(): void {
    try {
      this.engineSource?.stop();
      this.windSource?.stop();
      this.ambienceSource?.stop();
    } catch {
      // Sources may already be stopped.
    }
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
