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

  it('tiene 23 salas: inicio, cinco minijefes, tesoros, descansos y el jefe final al fondo', () => {
    for (const seed of [11, 12, 13, 777]) {
      const m = generateMap('encantado', seed);
      const rooms = m.rooms!;
      expect(rooms).toHaveLength(23);
      expect(rooms[0]!.kind).toBe('inicio');
      expect(rooms[22]!.kind).toBe('jefe');
      const minis = rooms.filter((r) => r.kind === 'minijefe');
      expect(minis).toHaveLength(MINIBOSSES);
      // el primer minijefe es el mas cercano al inicio: el orden de los jefes sigue la profundidad
      expect(minis.map((r) => r.boss)).toEqual(BOSS_ORDER.slice(0, MINIBOSSES));
      expect(rooms[22]!.boss).toBe(BOSS_ORDER[BOSS_ORDER.length - 1]);
      expect(rooms.filter((r) => r.kind === 'tesoro')).toHaveLength(3);
      expect(rooms.filter((r) => r.kind === 'descanso')).toHaveLength(3);
      expect(rooms.filter((r) => r.kind === 'combate')).toHaveLength(10);
      expect(new Set(rooms.map((r) => r.id)).size).toBe(23);
    }
  });

  it('no es una fila: el inicio da a elegir, hay ramas sin salida y lazos para dar la vuelta', () => {
    let loops = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const m = generateMap('encantado', seed * 97);
      const rooms = m.rooms!;
      // los senderos van en los dos sentidos
      for (const r of rooms) for (const n of r.links) expect(rooms[n]!.links).toContain(r.id);
      // el inicio da a elegir entre dos caminos o mas
      expect(rooms[0]!.links.length).toBeGreaterThanOrEqual(2);
      // el jefe final y los minijefes son callejones: se llega a ellos explorando, no de paso
      expect(rooms[22]!.links).toHaveLength(1);
      for (const r of rooms.filter((x) => x.kind === 'minijefe')) expect(r.links).toHaveLength(1);
      // junto al inicio solo hay combates
      for (const n of rooms[0]!.links) expect(rooms[n]!.kind).toBe('combate');
      const edges = rooms.reduce((a, r) => a + r.links.length, 0) / 2;
      if (edges > rooms.length - 1) loops++;
      // todo el bosque se alcanza desde el inicio por los senderos
      const seen = new Set<number>([0]);
      const queue = [0];
      for (let i = 0; i < queue.length; i++)
        for (const n of rooms[queue[i]!]!.links)
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
      expect(seen.size).toBe(23);
    }
    expect(loops).toBeGreaterThan(30);
  });

  it('la dificultad sube con la distancia al inicio, no con el numero de sala', () => {
    const m = generateMap('encantado', 4242);
    const rooms = m.rooms!;
    const depth = new Array<number>(rooms.length).fill(-1);
    depth[0] = 0;
    const queue = [0];
    for (let i = 0; i < queue.length; i++)
      for (const n of rooms[queue[i]!]!.links)
        if (depth[n] === -1) {
          depth[n] = depth[queue[i]!]! + 1;
          queue.push(n);
        }
    // las salas estan numeradas por profundidad (el jefe final va al ultimo)
    for (let i = 1; i < 22; i++) expect(depth[i]!).toBeGreaterThanOrEqual(depth[i - 1]!);
    const combats = rooms.filter((r) => r.kind === 'combate');
    const near = combats.filter((r) => depth[r.id]! <= 2);
    const far = combats.filter((r) => depth[r.id]! >= Math.max(...depth) - 1);
    if (near.length > 0 && far.length > 0)
      expect(Math.max(...far.map((r) => r.act))).toBeGreaterThan(
        Math.min(...near.map((r) => r.act)),
      );
  });

  it('cada sala tiene sus puertas, abiertas hacia un sendero', () => {
    for (const seed of [3, 30, 300]) {
      const m = generateMap('encantado', seed);
      const rooms = m.rooms!;
      rooms.forEach((r) => {
        expect(r.gates.length).toBeGreaterThanOrEqual(4 * r.links.length);
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
