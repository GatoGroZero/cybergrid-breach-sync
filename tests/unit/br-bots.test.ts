import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, TILE } from '../../src/shared/br/constants';
import { MAP_KINDS, generateMap } from '../../src/shared/br/map';
import { randomSkin } from '../../src/shared/br/skin';
import { createRng } from '../../src/shared/rng';
import { BRGame, type Cat } from '../../src/server/br/Game';
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

describe('conducta de los bots', () => {
  interface Brain {
    mode: string;
  }

  /** Mide, sobre varias partidas, cuanto tiempo los bots tiemblan o se quedan atorados sin motivo. */
  function measure(kind: (typeof MAP_KINDS)[number], seed: number, seconds: number) {
    const game = botGame(kind, seed);
    const brains = (game as unknown as { brains: Map<number, Brain> }).brains;
    const last = new Map<number, { x: number; y: number; dx: number; dy: number; rev: number }>();
    const anchor = new Map<number, { x: number; y: number }>();
    let botSeconds = 0;
    let jitterSeconds = 0;
    let windows = 0;
    let stuckWindows = 0;
    let ran = false;
    let tick = 0;
    while (!game.over && game.time < seconds) {
      game.step();
      tick++;
      for (const c of game.cats) {
        if (!c.alive) continue;
        game.snapshotFor(c.id);
        if (c.running) ran = true;
        const b = brains.get(c.id) as Brain;
        const l = last.get(c.id) ?? { x: c.x, y: c.y, dx: 0, dy: 0, rev: 0 };
        const dx = c.x - l.x;
        const dy = c.y - l.y;
        const m = Math.hypot(dx, dy);
        const pm = Math.hypot(l.dx, l.dy);
        if (m > 0.4 && pm > 0.4 && (dx * l.dx + dy * l.dy) / (m * pm) < -0.6) l.rev++;
        Object.assign(l, { x: c.x, y: c.y, dx, dy });
        last.set(c.id, l);
        if (tick % 30 === 0) {
          botSeconds++;
          if (l.rev > 6) jitterSeconds++;
          l.rev = 0;
        }
        if (tick % 90 === 0) {
          const a = anchor.get(c.id);
          if (a) {
            windows++;
            const moving = Math.hypot(c.x - a.x, c.y - a.y) >= 6;
            const legit = c.heal !== null || ['fight', 'camp', 'start', 'loot'].includes(b.mode);
            if (!moving && !legit) stuckWindows++;
          }
          anchor.set(c.id, { x: c.x, y: c.y });
        }
      }
      game.endTick();
    }
    return { game, botSeconds, jitterSeconds, windows, stuckWindows, ran };
  }

  it.each(MAP_KINDS)('en %s casi nunca tiemblan ni se quedan atorados sin motivo', (kind) => {
    const a = measure(kind, 9000, 240);
    const b = measure(kind, 9013, 240);
    const botSeconds = a.botSeconds + b.botSeconds;
    expect((a.jitterSeconds + b.jitterSeconds) / botSeconds).toBeLessThan(0.05);
    expect((a.stuckWindows + b.stuckWindows) / (a.windows + b.windows)).toBeLessThan(0.04);
  });

  it('los bots tambien corren, se cubren y siguen peleando con las balas del compartimento', () => {
    let ran = false;
    let anyWall = false;
    let fired = false;
    for (const seed of [9000, 9013, 9026]) {
      const m = measure('bosque', seed, 300);
      ran ||= m.ran;
      fired ||= m.game.cats.some((c) => c.damageDealt > 0);
      anyWall ||= m.game.cats.some((c) => c.kills > 0 || c.damageDealt > 0);
    }
    expect(ran).toBe(true);
    expect(fired).toBe(true);
    expect(anyWall).toBe(true);
  });

  it('cuando el humano cae, los bots siguen jugando y moviéndose', () => {
    const game = botGame('bosque', 77);
    const human = game.cat(1) as Cat;
    human.bot = false;
    while (game.time < 20) {
      game.step();
      game.endTick();
    }
    game.damageCat(human, 9999, game.cat(2) as Cat);
    // Con la ola tan rapida se mide el camino recorrido, no el desplazamiento neto.
    const last = new Map(game.cats.map((c) => [c.id, { x: c.x, y: c.y }]));
    const walked = new Map<number, number>();
    while (game.time < 50 && !game.over) {
      game.step();
      game.endTick();
      for (const c of game.cats) {
        const l = last.get(c.id);
        if (!c.alive || !l) continue;
        walked.set(c.id, (walked.get(c.id) ?? 0) + Math.hypot(c.x - l.x, c.y - l.y));
        last.set(c.id, { x: c.x, y: c.y });
      }
    }
    const movers = [...walked.values()].filter((d) => d > 40).length;
    expect(game.over || movers >= 4).toBe(true);
  });
});
