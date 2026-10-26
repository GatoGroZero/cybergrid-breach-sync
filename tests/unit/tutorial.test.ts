import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS } from '../../src/client/game/input';
import { tutorialSections } from '../../src/client/ui/tutorial-data';

describe('tutorial de la Aventura', () => {
  const sections = tutorialSections(DEFAULT_KEYS);

  it('cubre lo que hay que saber: meta, moverse, pelear, curarse, salas, jefes, reliquias, vidas y esencia', () => {
    expect(sections.map((s) => s.id)).toEqual([
      'meta',
      'moverse',
      'pelear',
      'curar',
      'salas',
      'jefes',
      'reliquias',
      'vidas',
      'esencia',
    ]);
    for (const s of sections) {
      expect(s.title.length, s.id).toBeGreaterThan(5);
      expect(s.lines.length, s.id).toBeGreaterThanOrEqual(2);
      for (const l of s.lines) expect(l.length, `${s.id}: ${l}`).toBeGreaterThan(20);
    }
  });

  it('no usa rayas largas ni deja marcas sin reemplazar', () => {
    const all = sections.flatMap((s) => [s.title, ...s.lines]).join('\n');
    expect(all).not.toMatch(/[\u2014\u2013]/);
    expect(all).not.toMatch(/\{|\}|undefined|NaN/);
  });

  it('dice las teclas que el jugador tiene puestas', () => {
    const custom = { ...DEFAULT_KEYS, dash: 'KeyV', reload: 'KeyB', power1: 'KeyZ' };
    const text = tutorialSections(custom)
      .flatMap((s) => s.lines)
      .join('\n');
    expect(text).toContain('V (PC)');
    expect(text).toContain('Recarga con B');
    expect(text).toContain('con Z,');
    const base = tutorialSections(DEFAULT_KEYS)
      .flatMap((s) => s.lines)
      .join('\n');
    expect(base).toContain('Q (PC)');
    expect(base).toContain('F, G y H');
  });

  it('cada seccion tiene un dibujo distinto de los que sabe pintar el panel', () => {
    const icons = new Set(sections.map((s) => s.icon));
    expect(icons.size).toBeGreaterThanOrEqual(7);
  });
});
