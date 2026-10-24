import { describe, expect, it } from 'vitest';
import { ITEM_KINDS, NODE, PLAYER, SIM_DT } from '../../src/shared/constants';
import type { InputPayload } from '../../src/shared/protocol';
import { Game } from '../../src/server/game/Game';

const input = (seq: number, patch: Partial<InputPayload> = {}): InputPayload => ({
  seq,
  mx: 0,
  my: 0,
  aim: 0,
  auto: false,
  fire: false,
  ...patch,
});

type Internals = {
  damagePlayer(p: unknown, n: number): void;
  spawnDrone(kind: string, at: { x: number; y: number }): void;
  drones: unknown[];
  spawnTimer: number;
};
const internals = (g: Game): Internals => g as unknown as Internals;

function quietGame(players = 1, matchSeconds?: number): Game {
  const game = new Game({
    seed: 4242,
    matchSeconds,
    players: Array.from({ length: players }, (_, i) => ({
      id: i + 1,
      userId: i + 10,
      name: `jugador${i + 1}`,
    })),
  });
  // Sin oleadas de drones: estas pruebas miden reglas concretas, no el balance.
  internals(game).spawnTimer = 1e9;
  for (const p of game.players) p.invuln = 1e9;
  return game;
}

describe('autoridad del servidor sobre el movimiento', () => {
  it('no deja avanzar mas rapido aunque el cliente mande cientos de inputs de golpe', () => {
    const honest = quietGame();
    const hacker = quietGame();
    const start = { ...hacker.playerState(1)! };
    for (let i = 0; i < 12; i++) {
      honest.pushInput(1, input(i, { mx: 1 }));
      honest.step();
    }
    for (let i = 0; i < 400; i++) hacker.pushInput(1, input(i, { mx: 1 }));
    for (let i = 0; i < 12; i++) hacker.step();

    const walked = (g: Game, s: { x: number; y: number }) =>
      Math.hypot(g.playerState(1)!.x - s.x, g.playerState(1)!.y - s.y);
    const limit = PLAYER.speed * (12 * SIM_DT * 1.05 + 5 * SIM_DT) + 1;
    expect(walked(hacker, start)).toBeLessThanOrEqual(limit);
    expect(walked(hacker, start)).toBeGreaterThan(20);
    expect(walked(hacker, start)).toBeLessThan(walked(honest, start) * 1.6);
  });

  it('una entrada con vector gigante se recorta: no supera la velocidad maxima', () => {
    const game = quietGame();
    const start = { ...game.playerState(1)! };
    game.pushInput(1, input(1, { mx: 1, my: 1 }));
    game.step();
    const moved = Math.hypot(game.playerState(1)!.x - start.x, game.playerState(1)!.y - start.y);
    expect(moved).toBeLessThanOrEqual(PLAYER.speed * SIM_DT + 1e-6);
  });

  it('el jugador no atraviesa muros: tras mucho empujar sigue sobre el piso', () => {
    const game = quietGame();
    for (let i = 0; i < 300; i++) {
      game.pushInput(1, input(i, { mx: -1 }));
      game.step();
    }
    const p = game.playerState(1)!;
    expect(p.x).toBeGreaterThan(PLAYER.radius);
    expect(game.map.w * 32).toBeGreaterThan(p.x);
  });
});

describe('autoridad sobre el inventario y el dano', () => {
  it('solo se puede usar un objeto que se tiene, una vez, y un parche cura sin pasar de 100', () => {
    const game = quietGame();
    expect(game.useItem(1, 0)).toBe(false);
    expect(game.useItem(1, 9)).toBe(false);
    const p = game.players[0]!;
    p.invuln = 0;
    internals(game).damagePlayer(p, 50);
    expect(p.hp).toBe(50);
    game.grantItem(1, 'patch');
    expect(game.inventoryOf(1)[0]).toBe('patch');
    expect(game.useItem(1, 0)).toBe(true);
    expect(p.hp).toBe(85);
    expect(game.useItem(1, 0)).toBe(false);
    game.grantItem(1, 'patch');
    p.useCooldown = 0;
    game.useItem(1, 0);
    p.useCooldown = 0;
    expect(p.hp).toBe(100);
  });

  it('disparar con auto apuntado mata drones, suma bajas y puede soltar objetos', () => {
    const game = quietGame();
    const p = game.players[0]!;
    internals(game).spawnDrone('crawler', { x: p.x + 60, y: p.y });
    let seq = 0;
    for (let i = 0; i < 150 && p.kills === 0; i++) {
      game.pushInput(1, input(seq++, { fire: true, auto: true }));
      game.step();
    }
    expect(p.kills).toBeGreaterThanOrEqual(1);
    expect(p.damageDealt).toBeGreaterThan(0);
  });

  it('un jugador muerto no se mueve ni dispara y reaparece tras la espera con 60 de vida', () => {
    const game = quietGame();
    const p = game.players[0]!;
    p.invuln = 0;
    internals(game).damagePlayer(p, 999);
    expect(p.alive).toBe(false);
    const where = { x: p.x, y: p.y };
    game.pushInput(1, input(1, { mx: 1, fire: true }));
    game.step();
    expect({ x: p.x, y: p.y }).toEqual(where);
    for (let i = 0; i < Math.ceil((PLAYER.respawnDelay + 0.5) / SIM_DT); i++) game.step();
    expect(p.alive).toBe(true);
    expect(p.hp).toBe(60);
    expect(p.deaths).toBe(1);
    expect(p.respawnsLeft).toBe(PLAYER.respawns - 1);
  });
});

describe('reglas de la partida', () => {
  it('abrir los 3 nodos y sincronizar a todos en la salida gana la partida', () => {
    const game = quietGame(2);
    const [a, b] = game.players as [(typeof game.players)[0], (typeof game.players)[0]];
    game.map.nodes.forEach((node) => {
      a.x = node.x;
      a.y = node.y;
      b.x = node.x + 5;
      b.y = node.y;
      for (let i = 0; i < Math.ceil((NODE.captureSeconds + 1) / SIM_DT); i++) {
        internals(game).drones.length = 0;
        game.step();
      }
    });
    expect(game.nodeOpen.every(Boolean)).toBe(true);
    expect(game.exitOpen).toBe(true);
    expect(game.weaponLevel).toBe(3);

    a.x = game.map.exit.x;
    a.y = game.map.exit.y;
    b.x = game.map.exit.x + 10;
    b.y = game.map.exit.y;
    for (let i = 0; i < 8 / SIM_DT && !game.over; i++) {
      internals(game).drones.length = 0;
      game.step();
    }
    expect(game.over).toBe(true);
    expect(game.result?.result).toBe('win');
    expect(game.result?.reason).toBe('sync');
    expect(game.result?.players).toHaveLength(2);
  });

  it('si un jugador vivo no esta en la salida no hay sincronizacion', () => {
    const game = quietGame(2);
    game.nodeOpen.fill(true);
    game.exitOpen = true;
    const [a, b] = game.players as [(typeof game.players)[0], (typeof game.players)[0]];
    a.x = game.map.exit.x;
    a.y = game.map.exit.y;
    b.x = game.map.spawn.x;
    b.y = game.map.spawn.y;
    for (let i = 0; i < 150; i++) game.step();
    expect(game.syncProgress).toBe(0);
    expect(game.over).toBe(false);
  });

  it('se pierde por tiempo agotado y por aniquilacion total sin respaldos', () => {
    const timeout = quietGame(1, 1);
    for (let i = 0; i < 40; i++) timeout.step();
    expect(timeout.result).toMatchObject({ result: 'loss', reason: 'timeout' });

    const wipe = quietGame();
    const p = wipe.players[0]!;
    p.invuln = 0;
    p.respawnsLeft = 0;
    internals(wipe).damagePlayer(p, 999);
    wipe.step();
    expect(wipe.result).toMatchObject({ result: 'loss', reason: 'wipe' });
  });

  it('una desconexion de mas de 30 s cuenta como abandono definitivo', () => {
    const game = quietGame(2);
    game.setConnected(2, false);
    for (let i = 0; i < Math.ceil(31 / SIM_DT); i++) game.step();
    const b = game.players[1]!;
    expect(b.alive).toBe(false);
    expect(b.respawnsLeft).toBe(0);
    expect(game.over).toBe(false);
  });

  it('la instantanea es compacta y trae el ack del ultimo input procesado', () => {
    const game = quietGame(4);
    for (let i = 0; i < 30; i++) internals(game).spawnDrone('crawler', game.map.spawn);
    game.pushInput(2, input(77, { mx: 1 }));
    game.step();
    const snap = game.snapshot();
    expect(snap.ack[2]).toBe(77);
    expect(snap.pl).toHaveLength(4);
    expect(snap.dr).toHaveLength(30);
    expect(snap.nd).toHaveLength(NODE.count);
    expect(JSON.stringify(snap).length).toBeLessThan(3500);
    expect(snap.inv[1]).toEqual([-1, -1, -1]);
    expect(ITEM_KINDS).toHaveLength(3);
  });
});
