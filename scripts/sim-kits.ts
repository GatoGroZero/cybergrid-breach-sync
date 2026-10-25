// Mide el equilibrio de los kits de "Pelea en el techo": cada kit contra cada otro, en los tres
// techos y con varias semillas, solo con bots. Cuenta rondas ganadas (no partidas) para tener mas datos.
// Uso: npx tsx scripts/sim-kits.ts [partidas por cruce] [techo|todos]
import { KIT_IDS, type KitId } from '../src/shared/br/modes';
import { DUEL_MAPS, type MapKind } from '../src/shared/br/map';
import { defaultSkin } from '../src/shared/br/skin';
import { ZONE_TECHO } from '../src/shared/br/zone';
import { PvpGame } from '../src/server/br/PvpGame';

const per = Number(process.argv[2] ?? 6);
const which = process.argv[3] ?? 'todos';
const maps: MapKind[] = which === 'todos' ? [...DUEL_MAPS] : [which as MapKind];

interface Row {
  rounds: number;
  wins: number;
  kills: number;
  dmg: number;
}
const table = new Map<string, Row>();
const roundsWon = Object.fromEntries(KIT_IDS.map((k) => [k, 0])) as Record<KitId, number>;
const roundsPlayed = Object.fromEntries(KIT_IDS.map((k) => [k, 0])) as Record<KitId, number>;
let matches = 0;
let totalRounds = 0;
const t0 = performance.now();

for (const mapKind of maps) {
  for (const a of KIT_IDS) {
    for (const b of KIT_IDS) {
      for (let s = 0; s < per; s++) {
        const game = new PvpGame({
          seed: 7000 + s * 53 + KIT_IDS.indexOf(a) * 7 + KIT_IDS.indexOf(b) * 11,
          mapKind,
          mode: 'techo',
          zone: ZONE_TECHO,
          teamSize: 1,
          cats: [
            { id: 1, name: 'a', userId: null, bot: true, skin: defaultSkin(), team: 0 },
            { id: 2, name: 'b', userId: null, bot: true, skin: defaultSkin(), team: 1 },
          ],
        });
        // cada bot lleva el kit que toca en las tres rondas
        let guard = 0;
        while (!game.over && guard++ < 120_000) {
          if (game.phase === 'pick') {
            game.chooseKit(1, a);
            game.chooseKit(2, b);
          }
          game.step();
        }
        matches++;
        const res = game.result;
        if (!res) continue;
        const [w0, w1] = res.score as [number, number];
        totalRounds += w0 + w1;
        roundsWon[a] += w0;
        roundsWon[b] += w1;
        roundsPlayed[a] += w0 + w1;
        roundsPlayed[b] += w0 + w1;
        const key = `${a}>${b}`;
        const row = table.get(key) ?? { rounds: 0, wins: 0, kills: 0, dmg: 0 };
        row.rounds += w0 + w1;
        row.wins += w0;
        row.kills += game.cat(1)?.kills ?? 0;
        row.dmg += game.cat(1)?.damageDealt ?? 0;
        table.set(key, row);
      }
    }
  }
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.info(`\n${matches} partidas, ${totalRounds} rondas en ${secs} s (${maps.join(', ')})`);
console.info('\nRondas ganadas por kit (todos los cruces):');
for (const k of KIT_IDS) {
  const pct = ((roundsWon[k] / Math.max(1, roundsPlayed[k])) * 100).toFixed(1);
  console.info(
    `  ${k.padEnd(11)} ${String(roundsWon[k]).padStart(4)} de ${String(roundsPlayed[k]).padStart(4)}  ${pct}%`,
  );
}
console.info('\nCruces (porcentaje de rondas que gana el de la fila):');
console.info('              ' + KIT_IDS.map((k) => k.slice(0, 9).padStart(10)).join(''));
for (const a of KIT_IDS) {
  const cells = KIT_IDS.map((b) => {
    if (a === b) return '       --- ';
    const r = table.get(`${a}>${b}`);
    return r && r.rounds > 0
      ? `${((r.wins / r.rounds) * 100).toFixed(0).padStart(8)}% `
      : '       n/a ';
  });
  console.info(`  ${a.padEnd(11)}${cells.join('')}`);
}
