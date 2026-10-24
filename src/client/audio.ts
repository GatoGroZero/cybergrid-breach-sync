type AudioCtor = typeof AudioContext;

/** Efectos de sonido sintetizados con Web Audio: no hay archivos de audio que descargar. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = window.localStorage.getItem('cg_muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  /** El navegador solo permite audio tras un gesto del usuario. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.35;
    try {
      window.localStorage.setItem('cg_muted', muted ? '1' : '0');
    } catch {
      // sin almacenamiento disponible: no pasa nada
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    if (!this.noiseBuffer) {
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  shot(): void {
    this.tone(900, 0.07, 'square', 0.05, 420);
  }
  hit(): void {
    this.tone(220, 0.05, 'triangle', 0.06, 140);
  }
  hurt(): void {
    this.tone(160, 0.18, 'sawtooth', 0.09, 70);
    this.noise(0.12, 0.06, 900);
  }
  kill(): void {
    this.noise(0.22, 0.14, 2400);
    this.tone(320, 0.18, 'square', 0.05, 90);
  }
  pickup(): void {
    this.tone(660, 0.07, 'sine', 0.08);
    window.setTimeout(() => this.tone(990, 0.1, 'sine', 0.08), 60);
  }
  use(): void {
    this.tone(300, 0.25, 'sawtooth', 0.07, 900);
  }
  node(): void {
    [392, 523, 659, 784].forEach((f, i) =>
      window.setTimeout(() => this.tone(f, 0.18, 'triangle', 0.09), i * 80),
    );
  }
  death(): void {
    this.tone(260, 0.5, 'sawtooth', 0.1, 40);
    this.noise(0.4, 0.1, 600);
  }
  respawn(): void {
    this.tone(200, 0.3, 'sine', 0.09, 800);
  }
  tick(): void {
    this.tone(740, 0.08, 'square', 0.05);
  }
  go(): void {
    this.tone(1100, 0.25, 'square', 0.06);
  }
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      window.setTimeout(() => this.tone(f, 0.28, 'triangle', 0.1), i * 120),
    );
  }
  lose(): void {
    [392, 330, 262, 196].forEach((f, i) =>
      window.setTimeout(() => this.tone(f, 0.3, 'sawtooth', 0.07), i * 160),
    );
  }
}
