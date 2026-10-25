/**
 * Las canciones del juego, escritas como datos: cada una es un bucle de unos compases
 * que `Music` toca con osciladores (sin archivos de audio que descargar).
 *
 * Cada compas tiene 16 pasos (semicorcheas). Los patrones son cadenas de un caracter por paso
 * y la melodia es una lista de fichas separadas por espacios.
 */

export type TrackId = 'lobby' | 'br' | 'techo' | 'territorio' | 'aventura' | 'jefe';
export const TRACK_IDS: readonly TrackId[] = [
  'lobby',
  'br',
  'techo',
  'territorio',
  'aventura',
  'jefe',
];

export interface Chord {
  /** Semitonos sobre la nota base de la cancion. */
  root: number;
  /** Notas del acorde, en semitonos sobre su raiz. */
  tones: readonly number[];
}

export interface Song {
  name: string;
  bpm: number;
  /** Cuanto se retrasa cada paso impar (0 a 0.3 de un paso) para dar ritmo saltarin. */
  swing: number;
  /** Nota MIDI de la tonica. */
  root: number;
  /** Escala de la melodia, en semitonos sobre la tonica. */
  scale: readonly number[];
  /** Un acorde por compas. */
  chords: readonly Chord[];
  /** Arpegio: un caracter por paso, un digito es la nota del acorde (0 a 3) y '.' calla. */
  arp: string;
  /** Bajo: r raiz, f quinta, o octava, '.' calla. Un caracter por paso. */
  bass: string;
  kick: string;
  snare: string;
  hat: string;
  /** Melodia: una ficha por paso y por compas de la cancion; numero = grado de la escala, '.' calla, '_' sostiene. */
  lead: string;
  leadWave: OscillatorType;
  arpWave: OscillatorType;
  /** Colchon de acordes largos. */
  pad: boolean;
  /** La caja suena como una palma. */
  clap?: boolean;
  /** Volumen relativo de la cancion. */
  level: number;
}

const MIN: readonly number[] = [0, 3, 5, 7, 10];
const MAJ: readonly number[] = [0, 2, 4, 7, 9];

const triad = (root: number, minor: boolean): Chord => ({
  root,
  tones: minor ? [0, 3, 7, 12] : [0, 4, 7, 12],
});
const seventh = (root: number, minor: boolean): Chord => ({
  root,
  tones: minor ? [0, 3, 7, 10] : [0, 4, 7, 11],
});

const four = (a: string, b = a, c = a, d = a): string => a + b + c + d;

export const SONGS: Record<TrackId, Song> = {
  // el menu: tranquila, para esperar a los amigos
  lobby: {
    name: 'Lobby de la tarde',
    bpm: 88,
    swing: 0.12,
    root: 60,
    scale: MAJ,
    chords: [triad(0, false), triad(9, true), triad(5, false), triad(7, false)],
    arp: four('0.1.2.1.0.1.2.1.'.slice(0, 16)),
    bass: four('r.......f.......'),
    kick: four('x...............'),
    snare: four('................'),
    hat: four('....x.......x...'),
    lead: [
      '4 . . . 2 . 3 . 4 . . . 7 . . .',
      '5 . . . 4 . 2 . 0 . . . . . . .',
      '3 . . . 4 . 5 . 4 . . . 2 . . .',
      '1 . . . 2 . 4 . 2 . . . . . . .',
    ].join(' '),
    leadWave: 'triangle',
    arpWave: 'sine',
    pad: true,
    level: 0.8,
  },
  // battle royale: marcha por el bosque, optimista y con empuje
  br: {
    name: 'Marcha del bosque',
    bpm: 116,
    swing: 0.08,
    root: 57,
    scale: MIN,
    chords: [triad(0, true), triad(-4, false), triad(3, false), triad(-2, false)],
    arp: four('0.1.2.1.0.1.2.3.'),
    bass: four('r..rr..fr..rr.fo'),
    kick: four('x..xx..xx..xx...'),
    snare: four('....x.......x...'),
    hat: four('x.x.x.x.x.x.x.xx'),
    lead: [
      '4 . 4 . 3 . 2 . 0 . 2 . 3 . . .',
      '4 . 4 . 3 . 2 . 4 . . . _ _ . .',
      '5 . 5 . 4 . 3 . 2 . 3 . 4 . . .',
      '3 . 2 . 0 . 2 . 3 . . . _ _ . .',
    ].join(' '),
    leadWave: 'square',
    arpWave: 'square',
    pad: false,
    level: 0.9,
  },
  // pelea en el techo: lluvia, nervios, el golpe seco del bajo
  techo: {
    name: 'Tejado bajo la lluvia',
    bpm: 134,
    swing: 0,
    root: 52,
    scale: MIN,
    chords: [triad(0, true), triad(8, false), triad(5, true), triad(7, false)],
    arp: four('0.2.1.2.0.2.1.2.'),
    bass: four('rrorrorrrrorrorr'.slice(0, 16)),
    kick: four('x...x..xx...x...'),
    snare: four('....x.......x..x'),
    hat: four('xxxxxxxxxxxxxxxx'),
    lead: [
      '4 . . 3 4 . . 5 4 . . 3 2 . . .',
      '4 . . 3 4 . . 5 7 . . 5 4 . . .',
      '5 . . 4 5 . . 7 5 . . 4 3 . . .',
      '3 . . 2 3 . . 4 2 . . 0 _ _ . .',
    ].join(' '),
    leadWave: 'sawtooth',
    arpWave: 'square',
    pad: true,
    level: 0.78,
  },
  // territorio: groove de barrio, bajo saltarin y palmas a contratiempo
  territorio: {
    name: 'Patios y banderas',
    bpm: 120,
    swing: 0.2,
    root: 50,
    scale: [0, 2, 3, 5, 7, 9, 10],
    chords: [seventh(0, true), seventh(5, false), seventh(0, true), seventh(7, false)],
    arp: four('..0...1...2...1.'),
    bass: four('r..r.fr..o.rf..r'),
    kick: four('x....x..x..x....'),
    snare: four('....x.......x...'),
    hat: four('x.xxx.xxx.xxx.xx'),
    lead: [
      '. . 4 . 5 . 4 . 2 . . . 0 . 2 .',
      '4 . . 5 . 4 . . 2 . 0 . . . . .',
      '. . 4 . 5 . 7 . 5 . 4 . 2 . 4 .',
      '5 . . 4 . 2 . . 0 . . _ _ . . .',
    ].join(' '),
    leadWave: 'square',
    arpWave: 'triangle',
    pad: false,
    clap: true,
    level: 0.85,
  },
  // aventura: fantasia, arpas y un colchon amplio
  aventura: {
    name: 'Bosque encantado',
    bpm: 84,
    swing: 0.05,
    root: 62,
    scale: [0, 2, 3, 5, 7, 9, 10],
    chords: [triad(0, true), triad(-2, false), triad(-4, false), seventh(-5, true)],
    arp: four('0123210301232103'.slice(0, 16)),
    bass: four('r.......f.......'),
    kick: four('x.......x.......'),
    snare: four('................'),
    hat: four('................'),
    lead: [
      '4 . . . _ _ 2 . 3 . . . 2 . 0 .',
      '4 . . . _ _ 5 . 4 . . . 2 . . .',
      '5 . . . _ _ 4 . 2 . . . 3 . 4 .',
      '2 . . . _ _ _ _ 0 . . . _ _ . .',
    ].join(' '),
    leadWave: 'triangle',
    arpWave: 'sine',
    pad: true,
    level: 0.95,
  },
  // jefe: tension, bajo corrido y golpes de bombo
  jefe: {
    name: 'El rey despierta',
    bpm: 146,
    swing: 0,
    root: 50,
    scale: [0, 1, 3, 5, 7, 8, 10],
    chords: [triad(0, true), triad(1, false), triad(0, true), triad(-2, false)],
    arp: four('0.1.2.1.0.1.2.3.'),
    bass: four('rrrrrrrrrrrrrrrr'),
    kick: four('x..xx..xx..xx.x.'),
    snare: four('....x.......x...'),
    hat: four('x.x.x.x.x.x.x.xx'),
    lead: [
      '4 . 4 . 3 . 4 . 5 . . . 4 . 3 .',
      '4 . 4 . 3 . 4 . 7 . . . 5 . 4 .',
      '5 . 5 . 4 . 5 . 6 . . . 5 . 4 .',
      '4 . 3 . 1 . 3 . 0 . . . _ _ . .',
    ].join(' '),
    leadWave: 'sawtooth',
    arpWave: 'square',
    pad: true,
    level: 0.8,
  },
};

/** Frecuencia de una nota MIDI. */
export const midiHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** Nota MIDI de un grado de la escala (puede ser negativo o pasar de una octava). */
export function scaleNote(song: Song, degree: number): number {
  const len = song.scale.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return song.root + 12 + (song.scale[idx] ?? 0) + oct * 12;
}

export type LeadStep = { kind: 'rest' } | { kind: 'hold' } | { kind: 'note'; degree: number };

/** Las fichas de la melodia, una por paso. */
export function parseLead(lead: string): LeadStep[] {
  return lead
    .trim()
    .split(/\s+/)
    .map((tok): LeadStep => {
      if (tok === '.') return { kind: 'rest' };
      if (tok === '_') return { kind: 'hold' };
      return { kind: 'note', degree: Number(tok) };
    });
}

/** Compases del bucle: uno por acorde. */
export const barsOf = (song: Song): number => song.chords.length;

/** Revisa que una cancion este bien armada (la usan las pruebas). */
export function checkSong(song: Song): string[] {
  const problems: string[] = [];
  const steps = 16;
  for (const key of ['arp', 'bass', 'kick', 'snare', 'hat'] as const) {
    const want = steps * 1;
    const len = song[key].length;
    if (len !== want && len !== want * barsOf(song)) problems.push(`${key}: ${len} pasos`);
  }
  const lead = parseLead(song.lead);
  if (lead.length !== steps * barsOf(song)) problems.push(`lead: ${lead.length} fichas`);
  for (const t of lead) {
    if (t.kind === 'note' && !Number.isFinite(t.degree)) problems.push('lead: ficha rara');
  }
  if (song.bpm < 60 || song.bpm > 200) problems.push('bpm fuera de rango');
  return problems;
}
