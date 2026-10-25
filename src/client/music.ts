import {
  barsOf,
  midiHz,
  parseLead,
  scaleNote,
  SONGS,
  type LeadStep,
  type Song,
  type TrackId,
} from './music-data';

/** Cuanto adelante del reloj de audio se programan las notas (segundos). */
const AHEAD = 0.22;
/** Cada cuanto despierta el programador (ms). */
const TICK_MS = 55;
/** Fundido al cambiar de cancion (segundos). */
const FADE = 1.4;

interface Deck {
  id: TrackId;
  song: Song;
  lead: LeadStep[];
  out: GainNode;
  /** Paso que toca programar y hora del reloj de audio en que cae en la cuadricula. */
  step: number;
  grid: number;
  /** Hora en que se deja de programar (cuando se va apagando). */
  endsAt: number;
}

/**
 * Secuenciador de musica de fondo con Web Audio. Toca un bucle por modo de juego
 * (melodia, arpegio, bajo, bateria y colchon) y pasa de una cancion a otra con un fundido.
 */
export class Music {
  private decks: Deck[] = [];
  private timer = 0;
  private current: TrackId | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {}

  get playing(): TrackId | null {
    return this.current;
  }

  /** Cambia de cancion (o la apaga con `null`). Pedir la que ya suena no hace nada. */
  play(id: TrackId | null): void {
    if (id === this.current) return;
    const now = this.ctx.currentTime;
    for (const d of this.decks) {
      if (d.endsAt > now + FADE) {
        d.out.gain.cancelScheduledValues(now);
        d.out.gain.setValueAtTime(d.out.gain.value, now);
        d.out.gain.linearRampToValueAtTime(0, now + FADE);
        d.endsAt = now + FADE;
      }
    }
    this.current = id;
    if (id) {
      const song = SONGS[id];
      const out = this.ctx.createGain();
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(song.level, now + FADE);
      out.connect(this.out);
      this.decks.push({
        id,
        song,
        lead: parseLead(song.lead),
        out,
        step: 0,
        grid: now + 0.08,
        endsAt: Infinity,
      });
    }
    if (!this.timer && this.decks.length > 0) {
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  stop(): void {
    this.play(null);
  }

  private tick(): void {
    const now = this.ctx.currentTime;
    for (const d of this.decks) {
      const stepLen = 60 / d.song.bpm / 4;
      while (d.grid < now + AHEAD && d.grid < d.endsAt) {
        // los pasos impares se retrasan un poco: da ritmo saltarin
        const swing = d.step % 2 === 1 ? d.song.swing * stepLen : 0;
        this.schedule(d, d.step, d.grid + swing);
        d.step++;
        d.grid += stepLen;
      }
    }
    // las canciones que ya se apagaron se sueltan
    this.decks = this.decks.filter((d) => {
      if (d.endsAt <= now) {
        d.out.disconnect();
        return false;
      }
      return true;
    });
    if (this.decks.length === 0 && this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private schedule(d: Deck, step: number, t: number): void {
    const song = d.song;
    const bars = barsOf(song);
    const inBar = step % 16;
    const bar = Math.floor(step / 16) % bars;
    const chord = song.chords[bar];
    if (!chord) return;
    const stepLen = 60 / song.bpm / 4;
    const at = (pattern: string): string =>
      pattern[pattern.length === 16 ? inBar : bar * 16 + inBar] ?? '.';
    const rootMidi = song.root + chord.root;

    // bateria
    if (at(song.kick) === 'x') this.kick(d.out, t);
    if (at(song.snare) === 'x') this.snare(d.out, t, song.clap === true);
    if (at(song.hat) === 'x') this.hat(d.out, t, inBar % 4 === 2 ? 0.05 : 0.03);

    // bajo
    const b = at(song.bass);
    if (b !== '.') {
      const note = b === 'f' ? rootMidi - 12 + 7 : b === 'o' ? rootMidi : rootMidi - 12;
      this.tone(d.out, midiHz(note), t, stepLen * (b === 'r' ? 1.9 : 1.4), 'triangle', 0.2);
    }

    // arpegio
    const a = at(song.arp);
    if (a !== '.') {
      const tone = chord.tones[Number(a)] ?? 0;
      this.tone(d.out, midiHz(rootMidi + 12 + tone), t, stepLen * 1.5, song.arpWave, 0.06);
    }

    // colchon: una vez por compas, largo
    if (song.pad && inBar === 0) {
      const dur = stepLen * 15;
      for (const tn of chord.tones.slice(0, 3)) {
        this.tone(d.out, midiHz(rootMidi + tn), t, dur, 'sawtooth', 0.035, 700, 0.35);
      }
    }

    // melodia
    const tok = d.lead[step % d.lead.length];
    if (tok && tok.kind === 'note') {
      // dura hasta la siguiente ficha que no sea "sostener"
      let len = 1;
      for (let i = 1; i < 16; i++) {
        const nx = d.lead[(step + i) % d.lead.length];
        if (nx?.kind === 'hold') len++;
        else break;
      }
      const hold = stepLen * (len + 0.6);
      this.tone(
        d.out,
        midiHz(scaleNote(song, tok.degree)),
        t,
        hold,
        song.leadWave,
        0.09,
        3200,
        0.02,
      );
    }
  }

  /** Una nota con ataque corto y caida; el filtro le quita lo aspero. */
  private tone(
    out: AudioNode,
    hz: number,
    t: number,
    dur: number,
    wave: OscillatorType,
    vol: number,
    cutoff = 4200,
    attack = 0.006,
  ): void {
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    osc.type = wave;
    osc.frequency.setValueAtTime(hz, t);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(vol, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.05));
    osc.connect(lp).connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + Math.max(dur, attack + 0.05) + 0.03);
  }

  private kick(out: AudioNode, t: number): void {
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    amp.gain.setValueAtTime(0.32, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  private snare(out: AudioNode, t: number, clap: boolean): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clap ? 1500 : 2100;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(clap ? 0.2 : 0.16, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + (clap ? 0.16 : 0.13));
    src.connect(bp).connect(amp).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
    if (!clap) this.tone(out, 190, t, 0.09, 'triangle', 0.12, 2000, 0.002);
  }

  private hat(out: AudioNode, t: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(vol, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(hp).connect(amp).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.06);
  }
}
