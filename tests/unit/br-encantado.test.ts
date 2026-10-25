import { describe, expect, it } from 'vitest';
import { BOSS_ORDER, MINIBOSSES } from '../../src/shared/br/adventure';
import { TILE } from '../../src/shared/br/constants';
import { G, generateMap, generateMapReport, isSolidTile, reachable } from '../../src/shared/br/map';

describe('bosque encantado', () => {
  it('se genera siempre, es determinista y grande', () => {
    for (let seed = 1; seed <= 25; seed++) {
      expect(generateMapReport('encantado', seed * 4079).map).not.toBeNull();
    }
    const a = generateMap('encantado', 2026);
    const b = generateMap('encantado', 2026);
    expect(Array.from(a.solid)).toEqual(Array.from(b.solid));
    expect(a.rooms).toEqual(b.rooms);
    expect(a.w).toBeGreaterThanOrEqual(140);
    expect(a.h).toBeGreaterThanOrEqual(90);
  });

  it('tiene 23 salas en orden: inicio, cinco actos con su minijefe, descanso y el jefe final', () => {
    const m = generateMap('encantado', 11);
    const rooms = m.rooms!;
    expect(rooms).toHaveLength(23);
    expect(rooms[0]!.kind).toBe('inicio');
    expect(rooms[22]!.kind).toBe('jefe');
    expect(rooms[21]!.kind).toBe('descanso');
    const minis = rooms.filter((r) => r.kind === 'minijefe');
    expect(minis).toHaveLength(MINIBOSSES);
    expect(minis.map((r) => r.boss)).toEqual(BOSS_ORDER.slice(0, MINIBOSSES));
    expect(rooms[22]!.boss).toBe(BOSS_ORDER[BOSS_ORDER.length - 1]);
    // cada jefe cierra un acto: el acto sube justo despues de cada minijefe
    rooms.forEach((r, i) => {
      if (i > 0) expect(r.act).toBeGreaterThanOrEqual(rooms[i - 1]!.act);
    });
    expect(rooms.filter((r) => r.kind === 'tesoro').length).toBeGreaterThanOrEqual(3);
    expect(rooms.filter((r) => r.kind === 'descanso').length).toBeGreaterThanOrEqual(3);
    expect(new Set(rooms.map((r) => r.id)).size).toBe(23);
  });

  it('las salas forman un camino sin saltos y cada una tiene sus puertas', () => {
    for (const seed of [3, 30, 300]) {
      const m = generateMap('encantado', seed);
      const rooms = m.rooms!;
      rooms.forEach((r, i) => {
        if (i > 0) expect(r.links).toContain(i - 1);
        if (i < rooms.length - 1) expect(r.links).toContain(i + 1);
        expect(r.gates.length).toBeGreaterThanOrEqual(4);
        for (const g of r.gates) {
          // la puerta esta fuera del claro, pegada a el, en un sendero abierto
          const inside = g.x >= r.x && g.x < r.x + r.w && g.y >= r.y && g.y < r.y + r.h;
          expect(inside).toBe(false);
          expect(isSolidTile(m, g.x, g.y)).toBe(false);
          expect(m.ground[g.y * m.w + g.x]).toBe(G.PATH);
        }
      });
    }
  });

  it('todo el bosque se recorre desde el inicio y los cofres se alcanzan', () => {
    for (const seed of [5, 50, 500]) {
      const m = generateMap('encantado', seed);
      const start = m.spawns[0]!;
      const seen = reachable(m, Math.floor(start.x / TILE), Math.floor(start.y / TILE));
      for (const r of m.rooms!) {
        let ok = false;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (seen[(r.y + Math.floor(r.h / 2) + dy) * m.w + r.x + Math.floor(r.w / 2) + dx])
              ok = true;
        expect(ok).toBe(true);
      }
      expect(m.spawns).toHaveLength(4);
      expect(m.chests.length).toBeGreaterThanOrEqual(6);
      for (const c of m.chests) {
        const tx = Math.floor(c.x / TILE);
        const ty = Math.floor(c.y / TILE);
        const near = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => seen[(ty + dy!) * m.w + tx + dx!]);
        expect(near).toBe(true);
      }
    }
  });
});
