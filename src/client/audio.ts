import { G } from '../shared/br/map';

type AudioCtor = typeof AudioContext;

export type Surface = 'grass' | 'path' | 'wood' | 'deck' | 'carpet' | 'stone' | 'water';
export type AmbientKind = 'bosque' | 'casa' | 'piscina';

/** Que suena bajo las patas segun el terreno. */
export function surfaceFor(ground: number): Surface {
  switch (ground) {
    case G.DIRT:
    case G.PATH:
    case G.SAND:
      return 'path';
    case G.WOOD:
    case G.WOOD2:
      return 'wood';
    case G.DECK:
    case G.DECK2:
      return 'deck';
    case G.CARPET:
    case G.BEDSHADE:
      return 'carpet';
    case G.TILE:
    case G.POOLEDGE:
    case G.HOUSEWALL:
    case G.WALLTOP:
      return 'stone';
    case G.WATER:
      return 'water';
    default:
      return 'grass';
  }
}

/** Volumen y lado (-1 izquierda, 1 derecha) de un sonido que viene de `dx, dy` pixeles de distancia. */
export function spatial(dx: number, dy: number, hearing = 420): { v: number; pan: number } {
  const d = Math.hypot(dx, dy);
  return {
    v: Math.max(0, 1 - d / hearing),
    pan: Math.max(-1, Math.min(1, dx / 220)),
  };
}

/** Canales del mezclador: cada familia de sonidos tiene su propio volumen. */
export type Channel = 'ambient' | 'weapons' | 'damage' | 'steps' | 'ui';
export const CHANNELS: readonly Channel[] = ['ambient', 'weapons', 'damage', 'steps', 'ui'];
export const CHANNEL_LABELS: Record<Channel, string> = {
  ambient: 'Ambiente',
  weapons: 'Armas y explosiones',
  damage: 'Golpes y daño',
  steps: 'Pasos',
  ui: 'Avisos y menús',
};
export type Volumes = Record<Channel | 'master', number>;
export const DEFAULT_VOLUMES: Volumes = {
  master: 1,
  ambient: 1,
  weapons: 1,
  damage: 1,
  steps: 1,
  ui: 1,
};
const VOLUMES_KEY = 'cg_volumes';

/** Lee los volumenes guardados, ignorando lo que no sea un numero de 0 a 1. */
export function parseVolumes(raw: unknown): Volumes {
  const out: Volumes = { ...DEFAULT_VOLUMES };
  if (typeof raw !== 'object' || raw === null) return out;
  for (const key of Object.keys(out) as (keyof Volumes)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.max(0, Math.min(1, v));
  }
  return out;
}

/** El oido percibe el volumen de forma logaritmica: la curva cuadratica hace que el control se sienta parejo. */
export const gainOf = (v: number): number => v * v;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
/** Tope de sonidos al mismo tiempo: con 12 gatos peleando no se debe saturar el audio. */
const MAX_VOICES = 56;

/** Efectos de sonido sintetizados con Web Audio: no hay archivos de audio que descargar. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<Channel, GainNode>();
  /** Canal al que pertenece el sonido que se esta creando ahora mismo. */
  private ch: Channel = 'ui';
  volumes: Volumes = { ...DEFAULT_VOLUMES };
  /** Hora del dia (0 dia, 1 noche): el ambiente cambia de pajaros a grillos y buhos. */
  private dayP = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private brownBuffer: AudioBuffer | null = null;
  private voices = 0;
  private ambient: { stop(): void } | null = null;
  private pendingAmbient: AmbientKind | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = window.localStorage.getItem('cg_muted') === '1';
      this.volumes = parseVolumes(JSON.parse(window.localStorage.getItem(VOLUMES_KEY) ?? 'null'));
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
      this.master.gain.value = this.masterGain();
      this.master.connect(this.ctx.destination);
      for (const channel of CHANNELS) {
        const bus = this.ctx.createGain();
        bus.gain.value = gainOf(this.volumes[channel]);
        bus.connect(this.master);
        this.buses.set(channel, bus);
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.pendingAmbient) {
      const kind = this.pendingAmbient;
      this.pendingAmbient = null;
      this.startAmbient(kind);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = this.masterGain();
    try {
      window.localStorage.setItem('cg_muted', muted ? '1' : '0');
    } catch {
      // sin almacenamiento disponible: no pasa nada
    }
  }

  private masterGain(): number {
    return this.muted ? 0 : 0.35 * gainOf(this.volumes.master);
  }

  /** Cambia el volumen de un canal (0 a 1) y lo recuerda. */
  setVolume(channel: Channel | 'master', value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.volumes[channel] = v;
    if (channel === 'master') {
      if (this.master) this.master.gain.value = this.masterGain();
    } else {
      const bus = this.buses.get(channel);
      if (bus) bus.gain.value = gainOf(v);
    }
    try {
      window.localStorage.setItem(VOLUMES_KEY, JSON.stringify(this.volumes));
    } catch {
      // sin almacenamiento disponible: no pasa nada
    }
  }

  /** Un sonido de muestra para oir como queda un canal al mover su control. */
  preview(channel: Channel | 'master'): void {
    switch (channel) {
      case 'weapons':
        return this.shot('rifle');
      case 'damage':
        return this.hitDealt(false);
      case 'steps':
        return this.step('wood', false);
      case 'ambient':
        return this.chirp();
      default:
        return this.node();
    }
  }

  /** Piar corto de muestra para el control del ambiente. */
  private chirp(): void {
    this.ch = 'ambient';
    this.tone(2600, 0.07, 'sine', 0.05, 3300);
    this.tone(2900, 0.08, 'sine', 0.045, 2300, 0, 0.1);
  }

  /** El render avisa la hora en cada cuadro; los sonidos de ambiente la leen cuando les toca sonar. */
  setDaytime(p: number): void {
    this.dayP = Math.max(0, Math.min(1, p));
  }

  /** Aviso suave cuando cambia la hora del dia. */
  phaseChime(name: string): void {
    this.ch = 'ui';
    switch (name) {
      case 'Tarde':
        [660, 784].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.05, undefined, 0, i * 0.14));
        break;
      case 'Atardecer':
        [784, 659, 523].forEach((f, i) =>
          this.tone(f, 0.34, 'triangle', 0.06, undefined, 0, i * 0.16),
        );
        break;
      case 'Anochecer':
        [440, 330].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.06, undefined, 0, i * 0.2));
        this.tone(110, 0.7, 'sine', 0.07, 80, 0, 0.1);
        break;
      case 'Noche':
        [330, 392, 311].forEach((f, i) => this.tone(f, 0.55, 'sine', 0.06, undefined, 0, i * 0.25));
        this.tone(82, 1, 'sine', 0.09, 60);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ piezas basicas

  private ready(): boolean {
    return this.ctx !== null && this.master !== null && !this.muted && this.voices < MAX_VOICES;
  }

  /** Bus del canal actual (o la salida general si todavia no existe). */
  private output(): AudioNode {
    return this.buses.get(this.ch) ?? (this.master as GainNode);
  }

  /** Conecta una voz a la salida, con su lado si hace falta, y la cuenta hasta que termine. */
  private route(node: AudioNode, last: AudioScheduledSourceNode, pan: number): void {
    const ctx = this.ctx as AudioContext;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(this.output());
    } else {
      node.connect(this.output());
    }
    this.voices++;
    last.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
    };
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    pan = 0,
    delay = 0,
  ): void {
    if (!this.ready() || vol <= 0) return;
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    this.route(gain, osc, pan);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseSource(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuffer) {
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  private noise(
    dur: number,
    vol: number,
    cutoff: number,
    pan = 0,
    kind: BiquadFilterType = 'lowpass',
    q = 0.7,
    delay = 0,
  ): void {
    if (!this.ready() || vol <= 0) return;
    const ctx = this.ctx as AudioContext;
    const buffer = this.noiseSource();
    if (!buffer) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = kind;
    filter.frequency.value = cutoff;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain);
    this.route(gain, src, pan);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ armas

  /** Cada arma suena distinto; `v` baja el volumen con la distancia y `pan` lo mueve a un lado. */
  shot(weapon = 'pistol', v = 1, pan = 0): void {
    this.ch = 'weapons';
    switch (weapon) {
      case 'rifle':
        this.tone(760, 0.05, 'square', 0.05 * v, 280, pan);
        this.noise(0.05, 0.06 * v, 3200, pan);
        this.tone(120, 0.06, 'sine', 0.04 * v, 70, pan);
        break;
      case 'shotgun':
        this.noise(0.22, 0.17 * v, 1900, pan);
        this.tone(190, 0.18, 'sawtooth', 0.09 * v, 65, pan);
        this.tone(95, 0.2, 'sine', 0.07 * v, 45, pan);
        break;
      case 'sniper':
        this.tone(1600, 0.26, 'sawtooth', 0.075 * v, 170, pan);
        this.noise(0.14, 0.11 * v, 4200, pan);
        this.tone(80, 0.3, 'sine', 0.08 * v, 40, pan, 0.02);
        break;
      case 'bazooka':
        this.tone(130, 0.45, 'sawtooth', 0.11 * v, 52, pan);
        this.noise(0.36, 0.13 * v, 700, pan);
        this.noise(0.5, 0.05 * v, 1800, pan, 'bandpass', 1, 0.05);
        break;
      default:
        this.tone(950, 0.07, 'square', 0.055 * v, 420, pan);
        this.noise(0.03, 0.04 * v, 2800, pan);
    }
  }

  /** Recargar: cada arma tiene sus propios clics y golpes. */
  reload(weapon: string, v = 1, pan = 0): void {
    this.ch = 'weapons';
    const click = (delay: number, f = 520, vol = 0.05): void =>
      this.tone(f, 0.025, 'square', vol * v, f * 0.6, pan, delay);
    const thud = (delay: number, vol = 0.07): void =>
      this.tone(150, 0.07, 'triangle', vol * v, 80, pan, delay);
    switch (weapon) {
      case 'rifle':
        thud(0.05);
        this.noise(0.05, 0.05 * v, 2500, pan, 'highpass', 0.7, 0.25);
        thud(0.7);
        click(1.5, 700, 0.06);
        click(1.62, 420, 0.06);
        break;
      case 'shotgun':
        for (let i = 0; i < 3; i++) click(0.1 + i * 0.35, 640, 0.05);
        this.tone(110, 0.1, 'sawtooth', 0.07 * v, 60, pan, 1.3);
        this.noise(0.08, 0.06 * v, 1400, pan, 'lowpass', 0.7, 1.3);
        this.tone(95, 0.12, 'sawtooth', 0.07 * v, 55, pan, 1.75);
        break;
      case 'sniper':
        click(0.1, 600, 0.05);
        this.tone(220, 0.12, 'sawtooth', 0.05 * v, 130, pan, 0.8);
        click(1.2, 520, 0.06);
        this.tone(260, 0.08, 'square', 0.05 * v, 150, pan, 1.9);
        thud(2.2, 0.06);
        break;
      case 'bazooka':
        this.tone(100, 0.2, 'sawtooth', 0.08 * v, 60, pan, 0.1);
        this.noise(0.25, 0.05 * v, 900, pan, 'lowpass', 0.7, 0.9);
        thud(1.5, 0.09);
        click(1.8, 500, 0.06);
        break;
      default:
        click(0.05, 700, 0.05);
        thud(0.55);
        click(1.2, 520, 0.06);
    }
  }

  /** Terminaste de recargar: un clic corto de confirmacion. */
  reloadDone(): void {
    this.ch = 'weapons';
    this.tone(880, 0.05, 'square', 0.035, 1200);
  }

  /** Cargador vacio y sin balas de repuesto. */
  dry(v = 1, pan = 0): void {
    this.ch = 'weapons';
    this.tone(320, 0.03, 'square', 0.05 * v, 180, pan);
  }

  // ------------------------------------------------------------------ golpes y dano

  /** Tu disparo le pego a alguien: un "tic" brillante y un golpe seco. */
  hitDealt(kill: boolean): void {
    this.ch = 'damage';
    this.tone(1500, 0.05, 'square', 0.06, 900);
    this.noise(0.07, 0.09, 1600);
    if (kill) {
      this.tone(220, 0.2, 'sawtooth', 0.07, 80, 0, 0.02);
      [784, 1047].forEach((f, i) =>
        this.tone(f, 0.12, 'triangle', 0.06, undefined, 0, 0.1 + i * 0.07),
      );
    }
  }

  /** Te hirieron: golpe grave y un maullido corto de dolor. */
  hurt(): void {
    this.ch = 'damage';
    this.tone(150, 0.2, 'sawtooth', 0.1, 55);
    this.noise(0.14, 0.08, 800);
    this.tone(760, 0.12, 'triangle', 0.06, 420, 0, 0.02);
    this.tone(540, 0.12, 'triangle', 0.045, 300, 0, 0.1);
  }

  /** Alguien cerca recibe dano: se escucha el golpe, mas flojo y de su lado. */
  hitNear(v: number, pan: number): void {
    this.ch = 'damage';
    this.tone(190, 0.1, 'triangle', 0.07 * v, 100, pan);
    this.noise(0.08, 0.06 * v, 900, pan);
  }

  /** Un gato cercano cae. */
  kill(v = 1, pan = 0): void {
    this.ch = 'damage';
    this.noise(0.24, 0.15 * v, 2400, pan);
    this.tone(320, 0.2, 'square', 0.055 * v, 80, pan);
  }

  /** Impacto contra un muro de madera. */
  wallHit(v = 1, pan = 0): void {
    this.ch = 'damage';
    this.noise(0.07, 0.08 * v, 1400, pan);
    this.tone(210, 0.07, 'square', 0.04 * v, 120, pan);
  }

  // ------------------------------------------------------------------ movimiento

  /** Pisada segun el piso. Al correr suena mas rapida y fuerte; `v` y `pan` ubican a quien camina. */
  step(surface: Surface = 'grass', running = false, v = 1, pan = 0): void {
    this.ch = 'steps';
    const k = (running ? 1.35 : 1) * v;
    const wobble = rand(0.9, 1.12);
    switch (surface) {
      case 'wood':
        this.tone(170 * wobble, 0.05, 'triangle', 0.07 * k, 110 * wobble, pan);
        this.noise(0.03, 0.04 * k, 2600, pan, 'bandpass', 1.2);
        break;
      case 'deck':
        this.tone(250 * wobble, 0.07, 'sine', 0.07 * k, 150 * wobble, pan);
        this.noise(0.05, 0.035 * k, 1000, pan, 'bandpass', 1);
        break;
      case 'carpet':
        this.noise(0.09, 0.03 * k, 380, pan);
        break;
      case 'stone':
        this.tone(950 * wobble, 0.025, 'square', 0.03 * k, 600, pan);
        this.noise(0.03, 0.035 * k, 3200, pan, 'highpass');
        break;
      case 'path':
        this.noise(0.05, 0.05 * k, 2300 * wobble, pan, 'bandpass', 1.4);
        this.noise(0.05, 0.04 * k, 1900 * wobble, pan, 'bandpass', 1.4, 0.035);
        break;
      case 'water':
        this.noise(0.14, 0.07 * k, 1700, pan, 'bandpass', 0.8);
        this.tone(520 * wobble, 0.09, 'sine', 0.035 * k, 980, pan);
        break;
      default:
        this.noise(0.07, 0.05 * k, 1000 * wobble, pan, 'bandpass', 0.6);
        this.noise(0.04, 0.018 * k, 3600, pan, 'highpass', 0.7, 0.01);
    }
  }

  /** Se puso un muro. */
  place(): void {
    this.ch = 'weapons';
    this.noise(0.08, 0.1, 500);
    this.tone(150, 0.12, 'square', 0.06, 90);
  }

  /** Un muro se rompe. */
  wallBreak(v = 1, pan = 0): void {
    this.ch = 'damage';
    this.noise(0.3, 0.14 * v, 800, pan);
    this.tone(110, 0.2, 'sawtooth', 0.06 * v, 50, pan);
  }

  /** Sin aire: el gato resopla. */
  huff(): void {
    this.ch = 'steps';
    this.noise(0.16, 0.05, 1200);
    this.tone(210, 0.14, 'sine', 0.03, 140);
  }

  /** Poca vida: latido. */
  heartbeat(): void {
    this.ch = 'damage';
    this.tone(70, 0.1, 'sine', 0.12, 50);
    this.tone(60, 0.12, 'sine', 0.09, 45, 0, 0.14);
  }

  /** Salto del gato al atravesar una puerta o algo parecido: reservado. */
  drop(): void {
    this.ch = 'ui';
    this.tone(260, 0.08, 'triangle', 0.06, 160);
  }

  /** Clic de interfaz. */
  click(): void {
    this.ch = 'ui';
    this.tone(520, 0.04, 'square', 0.025, 380);
  }

  /** Estallido de un fuego artificial. */
  pop(v = 1): void {
    this.ch = 'ui';
    this.tone(1300, 0.1, 'triangle', 0.05 * v, 300);
    this.noise(0.25, 0.1 * v, 2600);
  }

  boom(v = 1, pan = 0): void {
    this.ch = 'weapons';
    this.noise(0.5, 0.2 * v, 1300, pan);
    this.tone(95, 0.4, 'sawtooth', 0.1 * v, 35, pan);
    this.tone(55, 0.5, 'sine', 0.1 * v, 30, pan);
  }

  chest(): void {
    this.ch = 'ui';
    [523, 659, 880].forEach((f, i) =>
      this.tone(f, 0.12, 'triangle', 0.07, undefined, 0, i * 0.055),
    );
  }

  warn(): void {
    this.ch = 'ui';
    this.tone(520, 0.22, 'square', 0.06);
    this.tone(390, 0.3, 'square', 0.06, undefined, 0, 0.23);
  }

  hit(v = 1): void {
    this.ch = 'damage';
    this.tone(220, 0.05, 'triangle', 0.06 * v, 140);
  }

  pickup(): void {
    this.ch = 'ui';
    this.tone(660, 0.07, 'sine', 0.08);
    this.tone(990, 0.1, 'sine', 0.08, undefined, 0, 0.06);
  }

  use(): void {
    this.ch = 'ui';
    this.tone(300, 0.25, 'sawtooth', 0.07, 900);
  }

  node(): void {
    this.ch = 'ui';
    [392, 523, 659, 784].forEach((f, i) =>
      this.tone(f, 0.18, 'triangle', 0.09, undefined, 0, i * 0.08),
    );
  }

  death(): void {
    this.ch = 'damage';
    this.tone(260, 0.5, 'sawtooth', 0.1, 40);
    this.noise(0.4, 0.1, 600);
  }

  respawn(): void {
    this.ch = 'ui';
    this.tone(200, 0.3, 'sine', 0.09, 800);
  }

  tick(): void {
    this.ch = 'ui';
    this.tone(740, 0.08, 'square', 0.05);
  }

  go(): void {
    this.ch = 'ui';
    this.tone(1100, 0.25, 'square', 0.06);
  }

  /** Cuenta regresiva del inicio: cada segundo suena un poco mas alto. */
  introTick(n: number): void {
    this.ch = 'ui';
    const f = 330 + (5 - Math.min(5, Math.max(1, n))) * 70;
    this.tone(f, 0.14, 'square', 0.07, f * 0.85);
    this.tone(f / 2, 0.2, 'sine', 0.06, f / 2.4);
  }

  /** "A jugar": acorde que sube con un golpe de aire. */
  introGo(): void {
    this.ch = 'ui';
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.32, 'triangle', 0.09, undefined, 0, i * 0.045),
    );
    this.noise(0.5, 0.1, 3200, 0, 'highpass', 0.7, 0.02);
    this.tone(90, 0.35, 'sine', 0.12, 45);
  }

  win(): void {
    this.ch = 'ui';
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.28, 'triangle', 0.1, undefined, 0, i * 0.12),
    );
  }

  lose(): void {
    this.ch = 'ui';
    [392, 330, 262, 196].forEach((f, i) =>
      this.tone(f, 0.3, 'sawtooth', 0.07, undefined, 0, i * 0.16),
    );
  }

  // ------------------------------------------------------------------ ambiente

  private brown(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.brownBuffer) {
      const len = this.ctx.sampleRate * 6;
      this.brownBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.brownBuffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
        data[i] = last * 6;
      }
      // empalme suave para que el bucle no haga clic
      const fade = Math.floor(this.ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        data[len - fade + i] = (data[len - fade + i] as number) * (1 - k) + (data[i] as number) * k;
      }
    }
    return this.brownBuffer;
  }

  /**
   * Ambiente de fondo del mapa: viento y pajaros en el bosque, reloj y maullidos lejanos en la
   * casa, agua y gaviotas en la piscina. Si todavia no hay gesto del usuario, arranca despues.
   */
  startAmbient(kind: AmbientKind): void {
    this.stopAmbient();
    if (!this.ctx || !this.master) {
      this.pendingAmbient = kind;
      return;
    }
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
    bus.connect(this.buses.get('ambient') ?? this.master);
    const buffer = this.brown();
    if (!buffer) return;
    const nodes: AudioScheduledSourceNode[] = [];

    const layer = (
      type: BiquadFilterType,
      freq: number,
      base: number,
      swell: number,
      swellHz: number,
      q = 0.7,
    ): void => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = rand(0, 2);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = swellHz;
      const depth = ctx.createGain();
      depth.gain.value = swell;
      lfo.connect(depth).connect(gain.gain);
      src.connect(filter).connect(gain).connect(bus);
      src.start();
      lfo.start();
      nodes.push(src, lfo);
    };

    let stopped = false;
    let clockId: number | null = null;
    let clockTick = false;
    const later = (min: number, max: number, fn: () => void): void => {
      window.setTimeout(
        () => {
          if (stopped) return;
          this.ch = 'ambient';
          fn();
          later(min, max, fn);
        },
        rand(min, max) * 1000,
      );
    };
    const pan = (): number => rand(-0.85, 0.85);
    const smooth = (a: number, b: number, v: number): number => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    /** Cuanto sol queda (1 de dia, 0 de noche): decide si cantan los pajaros. */
    const sunLeft = (): number => 1 - smooth(0.4, 0.66, this.dayP);
    const night = (): number => smooth(0.45, 0.78, this.dayP);

    if (kind === 'bosque') {
      layer('lowpass', 520, 0.11, 0.06, 0.1);
      layer('bandpass', 2200, 0.02, 0.012, 0.23, 0.9);
      later(2.2, 6.5, () => {
        if (Math.random() > sunLeft()) return;
        const p = pan();
        const base = rand(2300, 3600);
        const notes = Math.floor(rand(2, 5));
        for (let i = 0; i < notes; i++)
          this.tone(base * rand(0.9, 1.15), 0.07, 'sine', 0.03, base * rand(1.1, 1.5), p, i * 0.1);
      });
      later(9, 20, () => {
        // un grillo lejano
        const p = pan();
        for (let i = 0; i < 4; i++) this.tone(4300, 0.04, 'square', 0.012, 4100, p, i * 0.06);
      });
    } else if (kind === 'casa') {
      layer('lowpass', 210, 0.12, 0.04, 0.07);
      layer('bandpass', 700, 0.012, 0.008, 0.17, 0.8);
      clockId = window.setInterval(() => {
        this.ch = 'ambient';
        clockTick = !clockTick;
        this.tone(clockTick ? 1700 : 1350, 0.02, 'square', 0.018, 900, 0.55);
      }, 1000);
      later(7, 16, () => {
        const p = pan();
        if (Math.random() < 0.6) {
          // un maullido lejano
          this.tone(560, 0.16, 'triangle', 0.035, 820, p);
          this.tone(820, 0.2, 'triangle', 0.03, 470, p, 0.15);
        } else {
          // un ronroneo corto
          for (let i = 0; i < 14; i++) this.tone(70, 0.05, 'sawtooth', 0.02, 60, p, i * 0.06);
        }
      });
    } else {
      layer('bandpass', 900, 0.1, 0.05, 0.33, 0.6);
      layer('lowpass', 300, 0.07, 0.03, 0.12);
      later(1.8, 5, () => {
        if (Math.random() > sunLeft()) return;
        const p = pan();
        this.noise(0.14, 0.035, 1700, p, 'bandpass', 0.9);
        this.tone(rand(900, 1300), 0.08, 'sine', 0.025, rand(1500, 2000), p, 0.03);
      });
      later(11, 22, () => {
        const p = pan();
        this.tone(1250, 0.2, 'sawtooth', 0.02, 850, p);
        this.tone(900, 0.25, 'sawtooth', 0.018, 1200, p, 0.22);
      });
    }

    // Noche: coro de grillos, buho, maullido lejano y rafagas de viento.
    const outdoors = kind === 'casa' ? 0.4 : 1;
    later(0.7, 1.9, () => {
      if (Math.random() > night()) return;
      const p = pan();
      const base = rand(4200, 5100);
      for (let i = 0; i < 3; i++)
        this.tone(base, 0.035, 'square', 0.011 * outdoors, base * 0.96, p, i * 0.055);
    });
    later(13, 27, () => {
      if (kind === 'casa' || night() < 0.6) return;
      const p = pan();
      [0, 0.34, 0.78].forEach((d, i) =>
        this.tone(
          [420, 400, 340][i] as number,
          i === 2 ? 0.5 : 0.2,
          'sine',
          0.045,
          undefined,
          p,
          d,
        ),
      );
    });
    later(21, 44, () => {
      if (night() < 0.7) return;
      const p = pan();
      this.tone(520, 0.5, 'triangle', 0.035 * outdoors, 940, p);
      this.tone(940, 0.5, 'triangle', 0.03 * outdoors, 430, p, 0.38);
    });
    later(11, 24, () => {
      if (night() < 0.6) return;
      this.noise(1.3, 0.05 * outdoors, 620, pan(), 'bandpass', 0.5);
    });

    this.ambient = {
      stop: () => {
        stopped = true;
        if (clockId !== null) window.clearInterval(clockId);
        const t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(0, t + 0.6);
        window.setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
            } catch {
              // ya estaba detenido
            }
          }
          bus.disconnect();
        }, 800);
      },
    };
  }

  stopAmbient(): void {
    this.pendingAmbient = null;
    this.ambient?.stop();
    this.ambient = null;
  }
}
