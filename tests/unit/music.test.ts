import { describe, expect, it } from 'vitest';
import {
  barsOf,
  checkSong,
  midiHz,
  parseLead,
  scaleNote,
  SONGS,
  TRACK_IDS,
} from '../../src/client/music-data';

describe('musica de fondo', () => {
  it('hay una cancion por modo, para el lobby y para los jefes', () => {
    expect([...TRACK_IDS].sort()).toEqual(
      ['aventura', 'br', 'jefe', 'lobby', 'techo', 'territorio'].sort(),
    );
    for (const id of TRACK_IDS) expect(SONGS[id]).toBeDefined();
  });

  it('todas las canciones estan bien armadas: patrones y melodia con los pasos justos', () => {
    for (const id of TRACK_IDS) expect(checkSong(SONGS[id]), id).toEqual([]);
  });

  it('cada cancion dura cuatro compases y tiene melodia con notas', () => {
    for (const id of TRACK_IDS) {
      const song = SONGS[id];
      expect(barsOf(song)).toBe(4);
      const notes = parseLead(song.lead).filter((t) => t.kind === 'note');
      expect(notes.length).toBeGreaterThan(8);
    }
  });

  it('los modos suenan distinto: tempos y tonicas no se repiten todos', () => {
    const tempos = new Set(TRACK_IDS.map((id) => SONGS[id].bpm));
    expect(tempos.size).toBeGreaterThanOrEqual(5);
    expect(SONGS.jefe.bpm).toBeGreaterThan(SONGS.aventura.bpm);
  });

  it('las notas se convierten bien: La central a 440 Hz y una octava arriba al doble', () => {
    expect(midiHz(69)).toBeCloseTo(440, 5);
    expect(midiHz(81)).toBeCloseTo(880, 5);
    const song = SONGS.br;
    expect(scaleNote(song, 0)).toBe(song.root + 12);
    // pasar de la ultima nota de la escala sube una octava
    expect(scaleNote(song, song.scale.length)).toBe(scaleNote(song, 0) + 12);
    expect(scaleNote(song, -1)).toBeLessThan(scaleNote(song, 0));
  });

  it('una cancion mal armada se detecta', () => {
    const roto = { ...SONGS.br, kick: 'x.x' };
    expect(checkSong(roto).length).toBeGreaterThan(0);
    const sinMelodia = { ...SONGS.br, lead: '0 1 2' };
    expect(checkSong(sinMelodia).length).toBeGreaterThan(0);
  });
});
