// Corre partidas completas de bots contra la simulacion real para medir balance y detectar fallos.
// Uso: npx tsx scripts/sim-br.ts [partidas] [mapa|todos]
import { randomSkin } from '../src/shared/br/skin';
import { MAP_KINDS, type MapKind } from '../src/shared/br/map';
import { createRng } from '../src/shared/rng';
import { BRGame } from '../src/server/br/Game';
import { TICK_DT } from '../src/shared/br/constants';

const games = Number(process.argv[2] ?? 6);
const which = process.argv[3] ?? 'todos';
const kinds: MapKind[] = which === 'todos' ? [...MAP_KINDS] : [which as MapKind];
const NAMES = [
  'Michi',
  'Bigotes',
  'Pelusa',
  'Luna',
  'Tigre',
  'Sombra',
  'Canela',
  'Mini',
  'Nube',
  'Churro',
  'Pixel',
  'Byte',
];

for (const kind of kinds) {
  let totalT = 0;
  let totalKills = 0;
  let maxT = 0;
  const causes = { dead: 0 };
  const t0 = performance.now();
  let ticks = 0;
  const weaponWins: Record<string, number> = {};
  for (let g = 0; g < games; g++) {
    const rng = createRng(1000 + g);
    const game = new BRGame({
      seed: 5000 + g * 31,
      mapKind: kind,
      cats: NAMES.map((name, i) => ({
        id: i + 1,
        name,
        userId: null,
        bot: true,
        skin: randomSkin(rng),
      })),
    });
    while (!game.over && game.time < 1000) {
      game.step();
      for (const c of game.cats) game.snapshotFor(c.id);
      game.endTick();
      ticks++;
    }
    totalT += game.time;
    maxT = Math.max(maxT, game.time);
    totalKills += game.cats.reduce((s, c) => s + c.kills, 0);
    causes.dead += game.cats.filter((c) => !c.alive).length;
    const w = game.result?.rows[0];
    const winner = game.cat(w?.id ?? -1);
    const held = winner ? game.held(winner) : null;
    const key = held ? held.kind : 'garras';
    weaponWins[key] = (weaponWins[key] ?? 0) + 1;
    if (!game.over) console.info(kind, 'seed', g, 'NO TERMINO', game.time);
  }
  const ms = performance.now() - t0;
  console.info(
    `${kind}: partidas=${games} duracion media=${Math.round(totalT / games)} s (max ${Math.round(maxT)} s), bajas medias=${(totalKills / games).toFixed(1)}, muertes=${(causes.dead / games).toFixed(1)}, ganadores por arma=`,
    weaponWins,
    `| CPU: ${(ms / ticks).toFixed(3)} ms por tick (12 gatos, 12 instantaneas)`,
    `${(TICK_DT * 1000).toFixed(1)} ms disponibles`,
  );
}
