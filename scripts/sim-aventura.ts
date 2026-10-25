// Mide el equilibrio de la Aventura: un jugador automatico recorre el bosque entero.
// Uso: npx tsx scripts/sim-aventura.ts [partidas] [gatos]
import { TICK_DT } from '../src/shared/br/constants';
import { defaultSkin } from '../src/shared/br/skin';
import { AdventureGame } from '../src/server/br/AdventureGame';
import { AutoPlayer } from './adventure-bot';

const games = Number(process.argv[2] ?? 6);
const squad = Number(process.argv[3] ?? 1);
let wins = 0;
let roomsSum = 0;
let bossSum = 0;
let timeSum = 0;
let deaths = 0;
const stopped: Record<string, number> = {};
const lost: Record<string, number> = {};
const dmgBy: Record<string, number> = {};
const t0 = performance.now();
for (let n = 0; n < games; n++) {
  const g = new AdventureGame({
    seed: 9000 + n * 97,
    cats: Array.from({ length: squad }, (_, i) => ({
      id: i + 1,
      name: `g${i + 1}`,
      userId: i + 1,
      bot: false,
      skin: defaultSkin(),
    })),
  });
  const players = g.cats.map((c) => new AutoPlayer(g, c.id, n + 1));
  const gg = g as unknown as {
    damageFrom: (cat: unknown, dmg: number, from: { def: { id: string } }) => void;
    damageCat: (cat: unknown, dmg: number, by: unknown) => void;
  };
  const rawFrom = gg.damageFrom.bind(g);
  let tag = 'otro';
  gg.damageFrom = (cat, dmg, from) => {
    tag = from.def.id;
    dmgBy[tag] = (dmgBy[tag] ?? 0) + dmg;
    rawFrom(cat, dmg, from);
    tag = 'otro';
  };
  const rawCat = gg.damageCat.bind(g);
  gg.damageCat = (cat, dmg, by) => {
    if (tag === 'otro') {
      const fn =
        /at (?:\w+\.)?(\w+)/.exec((new Error().stack ?? '').split('\n')[3] ?? '')?.[1] ?? '?';
      dmgBy[`otro:${fn}`] = (dmgBy[`otro:${fn}`] ?? 0) + dmg;
    }
    rawCat(cat, dmg, by);
  };
  let ticks = 0;
  const limit = Math.round(1500 / TICK_DT);
  let livesNow = g.lives;
  while (!g.over && ticks++ < limit) {
    for (const p of players) p.tick();
    // los avisos del tick anterior ya los vieron los jugadores: se vacian antes de simular
    (g as unknown as { events: unknown[] }).events = [];
    g.step();
    if (g.lives < livesNow) {
      const r = g.rooms[(g as unknown as { currentRoom: number }).currentRoom];
      const k = `${r?.def.id}:${r?.def.kind}:a${r?.def.act}`;
      lost[k] = (lost[k] ?? 0) + (livesNow - g.lives);
    }
    livesNow = g.lives;
  }
  const res = g.result;
  if (res?.adv?.victory) wins++;
  else {
    const room = g.rooms[(g as unknown as { currentRoom: number }).currentRoom];
    const key = `${room?.def.id ?? '?'}:${room?.def.kind ?? ''}`;
    stopped[key] = (stopped[key] ?? 0) + 1;
  }
  roomsSum += g.roomsCleared;
  bossSum += g.bossesDown;
  timeSum += g.time;
  deaths += g.lives0 - g.lives;
  console.info(
    `partida ${n + 1}: ${res?.adv?.victory ? 'VICTORIA' : res ? 'derrota' : 'tiempo'} salas ${g.roomsCleared}/23 jefes ${g.bossesDown} vidas usadas ${g.lives0 - g.lives} tiempo ${Math.round(g.time)} s`,
  );
}
console.info(
  `\n${games} partidas con ${squad} gato(s) en ${((performance.now() - t0) / 1000).toFixed(1)} s: victorias ${wins} (${Math.round((wins / games) * 100)} %), salas ${(roomsSum / games).toFixed(1)}, jefes ${(bossSum / games).toFixed(1)}, vidas usadas ${(deaths / games).toFixed(1)}, ${Math.round(timeSum / games)} s`,
);
console.info('donde se quedaron las derrotas:', JSON.stringify(stopped));
console.info('vidas perdidas por sala:', JSON.stringify(lost));
console.info('dano recibido por fuente:', JSON.stringify(dmgBy));
