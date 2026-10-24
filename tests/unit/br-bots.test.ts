import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, TILE } from '../../src/shared/br/constants';
import { MAP_KINDS, generateMap } from '../../src/shared/br/map';
import { randomSkin } from '../../src/shared/br/skin';
import { createRng } from '../../src/shared/rng';
import { BRGame } from '../../src/server/br/Game';
import { findPath } from '../../src/server/br/bots';

const NAMES = [
  'Michi',
  'Luna',
  'Tigre',
  'Sombra',
  'Canela',
  'Mini',
  'Nube',
  'Churro',
  'Pelusa',
  'Byte',
];

function botGame(kind: (typeof MAP_KINDS)[number], seed: number): BRGame {
  const rng = createRng(seed);
  return new BRGame({
    seed,
    mapKind: kind,
    cats: NAMES.map((name, i) => ({
      id: i + 1,
      name,
      userId: null,
      bot: true,
      skin: randomSkin(rng),
    })),
  });
}

describe('bots', () => {
  it.each(MAP_KINDS)('en %s juegan una partida entera sin romper las reglas', (kind) => {
    const game = botGame(kind, 4242);
    const w = game.map.w * TILE;
    const h = game.map.h * TILE;
    let sawWeapon = false;
    let ticks = 0;
    while (!game.over && game.time < 1000) {
      game.step();
      const check = ++ticks % 20 === 0;
      for (const c of game.cats) {
        game.snapshotFor(c.id);
        if (!check) continue;
        expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
        expect(c.x).toBeGreaterThan(0);
        expect(c.y).toBeGreaterThan(0);
        expect(c.x).toBeLessThan(w);
        expect(c.y).toBeLessThan(h);
        expect(c.hp).toBeGreaterThanOrEqual(0);
        expect(c.hp).toBeLessThanOrEqual(100);
        expect(c.shield).toBeLessThanOrEqual(100);
        expect(c.inv).toHaveLength(INVENTORY_SLOTS);
        if (
          c.inv.some(
            (it) => it && ['pistol', 'rifle', 'shotgun', 'sniper', 'bazooka'].includes(it.kind),
          )
        ) {
          sawWeapon = true;
        }
      }
      game.endTick();
    }
    expect(game.over).toBe(true);
    expect(sawWeapon).toBe(true);
    const rows = game.result?.rows ?? [];
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.placement)).size).toBe(10);
    expect(game.result?.durationS).toBeGreaterThan(10);
  });

  it('nadie recibe daño de otro gato durante la protección inicial aunque haya bots armados cerca', () => {
    const game = botGame('bosque', 99);
    while (game.time < 9.5) {
      game.step();
      game.endTick();
    }
    expect(game.cats.every((c) => c.hp === 100 && c.alive)).toBe(true);
  });

  it('findPath rodea los muros y llega junto al objetivo, o devuelve null si no hay ruta', () => {
    const map = generateMap('bosque', 31);
    const a = map.spawns[0]!;
    const b = map.spawns[5]!;
    const path = findPath(
      map,
      Math.floor(a.x / TILE),
      Math.floor(a.y / TILE),
      Math.floor(b.x / TILE),
      Math.floor(b.y / TILE),
    );
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(5);
    for (const node of path!) expect(map.solid[node]).toBe(0);
    // Un objetivo encerrado en la esquina fuera del mapa jugable no tiene ruta.
    expect(findPath(map, Math.floor(a.x / TILE), Math.floor(a.y / TILE), 0, 0)).toBeNull();
  });
});
