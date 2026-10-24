// Bot jugador para medir el balance: corre partidas completas contra la simulacion real.
// Uso: npx tsx scripts/sim-balance.ts [partidas] [jugadores]
import { SIM_DT, TILE } from '../src/shared/constants';
import { computeFlowField, flowDirection } from '../src/shared/flow';
import type { Vec } from '../src/shared/map';
import { dist } from '../src/shared/physics';
import { Game } from '../src/server/game/Game';

const games = Number(process.argv[2] ?? 30);
const playerCount = Number(process.argv[3] ?? 1);

interface Internals {
  drones: { x: number; y: number }[];
}

function goalFor(game: Game, from: Vec): Vec {
  if (game.exitOpen) return game.map.exit;
  let best: Vec | null = null;
  let bestD = Infinity;
  game.map.nodes.forEach((n, i) => {
    if (game.nodeOpen[i]) return;
    const d = dist(from.x, from.y, n.x, n.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  });
  return best ?? game.map.exit;
}

function play(seed: number): { result: string; reason: string; t: number; kills: number } {
  const game = new Game({
    seed,
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: i + 1,
      userId: i + 1,
      name: `bot${i + 1}`,
    })),
  });
  let seq = 0;
  const flows = new Map<string, Int16Array>();
  while (!game.over) {
    for (const p of game.players) {
      if (!p.alive) continue;
      const goal = goalFor(game, p);
      const key = `${Math.floor(goal.x / TILE)},${Math.floor(goal.y / TILE)}`;
      let flow = flows.get(key);
      if (!flow) {
        flow = computeFlowField(game.map, [goal]);
        flows.set(key, flow);
      }
      const dir = flowDirection(game.map, flow, p.x, p.y);
      let mx = dir?.x ?? 0;
      let my = dir?.y ?? 0;
      const drones = (game as unknown as Internals).drones;
      let nearest = Infinity;
      let nx = 0;
      let ny = 0;
      for (const d of drones) {
        const dd = dist(p.x, p.y, d.x, d.y);
        if (dd < nearest) {
          nearest = dd;
          nx = d.x;
          ny = d.y;
        }
      }
      // Sencillo: si un dron esta muy cerca, se aleja un poco mientras dispara.
      if (nearest < 70) {
        mx = (p.x - nx) / nearest;
        my = (p.y - ny) / nearest;
      }
      if (p.hp < 45 && game.inventoryOf(p.id).includes('patch')) {
        game.useItem(p.id, game.inventoryOf(p.id).indexOf('patch'));
      } else if (nearest < 100 && game.inventoryOf(p.id).includes('emp')) {
        game.useItem(p.id, game.inventoryOf(p.id).indexOf('emp'));
      } else if (game.inventoryOf(p.id).includes('overclock') && nearest < 160) {
        game.useItem(p.id, game.inventoryOf(p.id).indexOf('overclock'));
      }
      game.pushInput(p.id, {
        seq: ++seq,
        mx,
        my,
        aim: 0,
        auto: true,
        fire: nearest < 380,
      });
    }
    game.step();
    if (game.time > 400) break;
  }
  const r = game.result;
  return {
    result: r?.result ?? 'loss',
    reason: r?.reason ?? 'timeout',
    t: Math.round(game.time),
    kills: game.players.reduce((s, p) => s + p.kills, 0),
  };
}

let wins = 0;
const reasons: Record<string, number> = {};
let totalT = 0;
let totalKills = 0;
for (let i = 0; i < games; i++) {
  const r = play(1000 + i * 37);
  if (r.result === 'win') wins++;
  reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  totalT += r.t;
  totalKills += r.kills;
}
console.info(
  `jugadores=${playerCount} partidas=${games} victorias=${wins} (${Math.round((wins / games) * 100)} %)`,
  reasons,
  `tiempo medio=${Math.round(totalT / games)} s, bajas medias=${Math.round(totalKills / games)}`,
  `paso=${SIM_DT.toFixed(4)}`,
);
