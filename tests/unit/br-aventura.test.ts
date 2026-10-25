import { describe, expect, it } from 'vitest';
import {
  BOSS_ORDER,
  DASH,
  MOB,
  RELICS,
  REVIVE_S,
  SQUAD_LIVES,
  squadLives,
  computeMods,
  mobDef,
} from '../../src/shared/br/adventure';
import { TICK_DT, TILE } from '../../src/shared/br/constants';
import { magOf } from '../../src/shared/br/items';
import { defaultSkin } from '../../src/shared/br/skin';
import { AdventureGame } from '../../src/server/br/AdventureGame';
import type { Mob } from '../../src/server/br/mobs';

const cats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `gato${i + 1}`,
    userId: i + 1,
    bot: false,
    skin: defaultSkin(),
  }));

function make(n = 1, seed = 4321): AdventureGame {
  return new AdventureGame({ seed, cats: cats(n) });
}

const run = (g: AdventureGame, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) g.step();
};

const alive = (g: AdventureGame): Mob[] => [...g.mobs.values()].filter((m) => m.hp > 0);

/** Mata a todos los enemigos de golpe (como si el grupo ya los hubiera vencido). */
function wipe(g: AdventureGame): void {
  for (const m of alive(g)) g.damageMob(m, 99_999, g.cat(1)!);
}

/** Avanza hasta que la sala `i` este superada, eliminando a cada oleada en cuanto sale. */
function clearRoom(g: AdventureGame, i: number, maxSeconds = 90): void {
  g.debugTeleport(i);
  for (let t = 0; t < maxSeconds / TICK_DT; t++) {
    g.step();
    wipe(g);
    // el grupo no se muere mientras prueba
    for (const c of g.cats) c.hp = 100;
    if (g.rooms[i]!.state === 2) return;
  }
  throw new Error(`la sala ${i} no se supero`);
}

describe('aventura: nadie nace encerrado', () => {
  it('los enemigos solo aparecen en suelo al que se puede llegar caminando', () => {
    for (const seed of [4321, 9000, 9194, 77, 1234]) {
      const g = make(1, seed);
      const { w, h, solid } = g.map;
      const start = g.rooms[0]!.def;
      const seen = new Set<number>([
        Math.floor(start.y + start.h / 2) * w + Math.floor(start.x + start.w / 2),
      ]);
      const queue = [...seen];
      for (let i = 0; i < queue.length; i++) {
        const n = queue[i]!;
        const x = n % w;
        const y = (n - x) / w;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          const k = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen.has(k) || solid[k] !== 0) continue;
          seen.add(k);
          queue.push(k);
        }
      }
      for (const room of g.rooms.slice(1)) {
        if (room.def.kind !== 'combate') continue;
        for (let i = 0; i < 60; i++) {
          const p = (g as unknown as { spawnSpot(d: unknown): { x: number; y: number } }).spawnSpot(
            room.def,
          );
          expect(seen.has(Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE))).toBe(true);
        }
      }
    }
  });
});

describe('aventura: arranque', () => {
  it('empieza en el claro del inicio con el kit basico, las vidas del grupo y las salas dormidas', () => {
    const g = make(2);
    expect(g.mode).toBe('aventura');
    expect(g.mapKind).toBe('encantado');
    expect(g.lives).toBe(squadLives(2));
    expect(g.rooms).toHaveLength(23);
    expect(g.rooms[0]!.state).toBe(2);
    expect(g.rooms.slice(1).every((r) => r.state === 0)).toBe(true);
    const c = g.cat(1)!;
    expect(c.inv[0]).toMatchObject({ kind: 'pistol', rarity: 1 });
    expect(c.ammo.ammo_pistol).toBe(60);
    expect(c.inv.some((it) => it?.kind === 'medkit')).toBe(true);
    const start = g.rooms[0]!.def;
    for (const cat of g.cats) {
      expect(cat.x).toBeGreaterThan(start.x * TILE);
      expect(cat.x).toBeLessThan((start.x + start.w) * TILE);
    }
    expect(g.snapshotFor(1)!.adv).toMatchObject({ room: 0, rooms: 23, lives: squadLives(2) });
  });

  it('la aventura no tiene zona ni fuego amigo', () => {
    const g = make(2);
    expect(g.zone.dps).toBe(0);
    run(g, 5);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    a.x = b.x - 10;
    a.y = b.y;
    g.fireControl(a, 0, true);
    run(g, 1);
    expect(b.hp).toBe(100);
    expect(g.isFoe()).toBe(false);
  });
});

describe('aventura: salas de combate', () => {
  it('entrar cierra las puertas, sale una oleada tras otra y superar la sala las abre y deja botin', () => {
    const g = make(1);
    const room = g.rooms[1]!;
    g.debugTeleport(1);
    run(g, 0.3);
    expect(room.state).toBe(1);
    // al principio las puertas siguen abiertas; enseguida se cierran
    const gate = room.def.gates[0]!;
    expect(g.map.solid[gate.y * g.map.w + gate.x]).toBe(0);
    run(g, 2);
    expect(room.closed).toBe(true);
    for (const gt of room.def.gates) expect(g.map.solid[gt.y * g.map.w + gt.x]).toBe(3);
    expect(alive(g).length).toBeGreaterThan(0);
    expect(alive(g).every((m) => m.room === 1)).toBe(true);
    // las oleadas se limpian una por una
    let waves = 0;
    for (let t = 0; t < 60 / TICK_DT && room.state !== 2; t++) {
      g.step();
      if (alive(g).length > 0) {
        waves = Math.max(waves, room.wave);
        wipe(g);
      }
    }
    expect(waves).toBeGreaterThanOrEqual(2);
    expect(room.state).toBe(2);
    for (const gt of room.def.gates) expect(g.map.solid[gt.y * g.map.w + gt.x]).toBe(0);
    expect(g.roomsCleared).toBe(1);
    expect(g.pickups.length).toBeGreaterThanOrEqual(3);
    expect(g.kills).toBeGreaterThan(3);
  });

  it('quien se queda afuera cuando cierran las puertas entra al claro', () => {
    const g = make(2);
    g.debugTeleport(2);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    // el segundo gato se queda atras, en el sendero
    const back = g.rooms[2]!.def.gates[0]!;
    b.x = back.x * TILE - 3 * TILE;
    b.y = back.y * TILE;
    run(g, 2.4);
    expect(g.rooms[2]!.closed).toBe(true);
    const def = g.rooms[2]!.def;
    for (const c of [a, b]) {
      expect(c.x).toBeGreaterThan(def.x * TILE);
      expect(c.x).toBeLessThan((def.x + def.w) * TILE);
    }
  });

  it('los enemigos hacen dano de verdad y las balas del gato los vencen', () => {
    const g = make(1);
    g.debugTeleport(1);
    run(g, 2.6);
    const c = g.cat(1)!;
    expect(c.hp).toBe(100);
    const m = alive(g)[0]!;
    // el enemigo pega al llegar
    m.x = c.x + 8;
    m.y = c.y;
    m.cd = 0;
    run(g, 2);
    expect(c.hp).toBeLessThan(100);
    // el gato dispara y le quita vida a un enemigo lejano
    const far = alive(g)[0]!;
    far.x = c.x + 100;
    far.y = c.y;
    far.hp = far.maxHp = 5000;
    far.cd = 1e9;
    far.stunUntil = 1e9;
    g.select(1, 0);
    c.aim = 0;
    for (let i = 0; i < 40; i++) {
      c.hp = 100;
      g.fireControl(c, 0, true);
      g.step();
      g.fireControl(c, 0, false);
      far.x = c.x + 100;
      far.y = c.y;
    }
    expect(far.hp).toBeLessThan(far.maxHp);
    expect(magOf(c.inv[0]!)).toBeLessThan(30);
  });

  it('con mas gatos hay mas enemigos y mas vida por enemigo', () => {
    const count = (n: number): { mobs: number; hp: number } => {
      const g = make(n);
      g.debugTeleport(1);
      run(g, 2.6);
      const list = alive(g);
      return { mobs: list.length, hp: list.reduce((s, m) => s + m.maxHp, 0) / list.length };
    };
    const solo = count(1);
    const squad = count(4);
    expect(squad.mobs).toBeGreaterThan(solo.mobs);
    expect(squad.hp).toBeGreaterThan(solo.hp * 1.5);
  });
});

describe('aventura: jefes y reliquias', () => {
  it('cada minijefe aparece con un aviso, ataca y al caer da una reliquia a elegir', () => {
    const g = make(1);
    const first = g.rooms.findIndex((r) => r.def.kind === 'minijefe');
    g.debugTeleport(first);
    run(g, 3.5);
    const boss = alive(g).find((m) => m.def.boss)!;
    expect(boss).toBeDefined();
    expect(boss.kind).toBe(BOSS_ORDER[0]);
    expect(g.snapshotFor(1)!.adv!.boss).toMatchObject({ kind: BOSS_ORDER[0], hp: 100 });
    // el jefe lanza ataques con aviso y proyectiles
    let attacked = false;
    for (let i = 0; i < 20 / TICK_DT; i++) {
      g.cat(1)!.hp = 100;
      g.step();
      if (boss.script || g.shotCount() > 0 || g.perils.length > 0) attacked = true;
    }
    expect(attacked).toBe(true);
    g.damageMob(boss, boss.maxHp + 5, g.cat(1)!);
    run(g, 0.5);
    expect(g.rooms[first]!.state).toBe(2);
    expect(g.bossesDown).toBe(1);
    const adv = g.snapshotFor(1)!.adv!;
    expect(adv.choice).toHaveLength(3);
    expect(new Set(adv.choice).size).toBe(3);
    const pick = adv.choice![1] as number;
    expect(g.chooseRelic(1, 1)).toBe(true);
    expect(g.snapshotFor(1)!.adv!.relics).toEqual([pick]);
    expect(g.snapshotFor(1)!.adv!.choice).toBeNull();
    // ya no hay eleccion pendiente
    expect(g.chooseRelic(1, 0)).toBe(false);
    expect(g.pickups.some((p) => p.kind === 3)).toBe(true);
  });

  it('cada jefe tiene sus propios ataques y los de dos fases cambian a la mitad de su vida', () => {
    for (const kind of BOSS_ORDER) {
      const g = make(1, 77 + kind);
      const idx = g.rooms.findIndex((r) => r.def.boss === kind);
      g.debugTeleport(idx);
      run(g, 3.5);
      const boss = alive(g).find((m) => m.kind === kind)!;
      expect(boss, mobDef(kind).name).toBeDefined();
      const seen = new Set<number>();
      let phase2 = false;
      for (let i = 0; i < 80 / TICK_DT; i++) {
        g.cat(1)!.hp = 100;
        g.step();
        if (boss.script) seen.add(boss.data.last ?? -1);
        if (boss.hp > boss.maxHp * 0.45 && i > 20 * 30)
          g.damageMob(boss, boss.maxHp * 0.1, g.cat(1)!);
        if (boss.phase >= 2) phase2 = true;
        if (boss.hp <= 0 || !g.mobs.has(boss.id)) break;
      }
      expect(seen.size, mobDef(kind).name).toBeGreaterThanOrEqual(2);
      expect(phase2, mobDef(kind).name).toBe(true);
    }
  }, 60_000);

  it('el jefe final cierra la aventura con victoria, esencia y el resumen', () => {
    const g = make(2);
    clearRoom(g, 22, 60);
    expect(g.ending).toBe('victory');
    const res = g.result!;
    expect(res.humanWon).toBe(true);
    expect(res.mode).toBe('aventura');
    expect(res.adv!.victory).toBe(true);
    expect(res.adv!.totalRooms).toBe(23);
    expect(res.adv!.essence[1]).toBeGreaterThan(100);
    expect(res.rows).toHaveLength(2);
  }, 60_000);
});

describe('aventura: voltereta, vidas y reliquias', () => {
  it('la voltereta salta rapido, deja pasar los golpes y tarda en recuperarse', () => {
    const g = make(1);
    run(g, 1);
    const c = g.cat(1)!;
    const x0 = c.x;
    g.pushInput(1, { seq: 1, mx: 1, my: 0, aim: 0, fire: false, dash: true });
    run(g, 0.1);
    for (let s = 2; s < 8; s++) g.pushInput(1, { seq: s, mx: 0, my: 0, aim: 0, fire: false });
    g.damageCat(c, 50, null);
    expect(c.hp).toBe(100);
    run(g, 0.4);
    expect(c.x - x0).toBeGreaterThan(DASH.distance * 0.6);
    // recien usada: la siguiente todavia no sale
    expect(g.snapshotFor(1)!.me.dash).toBeGreaterThan(1);
    const x1 = c.x;
    g.pushInput(1, { seq: 20, mx: 0, my: 0, aim: 0, fire: false, dash: true });
    run(g, 0.3);
    expect(c.x - x1).toBeLessThan(5);
    run(g, DASH.cooldown + 0.2);
    g.damageCat(c, 10, null);
    expect(c.hp).toBeLessThan(100);
  });

  it('caer gasta una vida del grupo y el gato se levanta solo; sin vidas la aventura termina', () => {
    const g = make(2);
    run(g, 1);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    g.damageCat(a, 9999, null);
    expect(a.alive).toBe(false);
    expect(g.lives).toBe(squadLives(2) - 1);
    expect(g.snapshotFor(1)!.adv!.fallen).toBeGreaterThan(0);
    run(g, REVIVE_S + 0.5);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(60);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(40);
    // sin vidas y sin nadie de pie: se acabo (primero se acaba la invulnerabilidad de volver)
    run(g, 2.6);
    g.lives = 0;
    g.damageCat(a, 9999, null);
    expect(g.over).toBe(false);
    g.damageCat(b, 9999, null);
    run(g, 0.2);
    expect(g.over).toBe(true);
    expect(g.result!.adv!.victory).toBe(false);
    expect(g.ending).toBe('defeat');
  });

  it('las reliquias y la armadura cambian los numeros del gato', () => {
    const base = computeMods([], [-1, -1, -1]);
    expect(base.maxHp).toBe(100);
    const rich = computeMods([5, 5, 0, 6, 2], [2, 2, 2]);
    expect(rich.maxHp).toBe(150);
    expect(rich.dmg).toBeCloseTo(1.12, 5);
    expect(rich.speed).toBeGreaterThan(1.2);
    expect(rich.taken).toBeLessThan(0.7);
    expect(rich.taken).toBeGreaterThanOrEqual(0.4);
    expect(rich.maxShield).toBe(135);
    expect(RELICS).toHaveLength(14);
    // los nombres no se repiten
    expect(new Set(RELICS.map((r) => r.name)).size).toBe(RELICS.length);
  });

  it('elegir "Collar de luna" sube la vida maxima y la armadura se pone sola', () => {
    const g = make(1);
    const c = g.cat(1)!;
    const st = g.stateOf(1)!;
    st.offers.push([5, 0, 1]);
    expect(g.chooseRelic(1, 0)).toBe(true);
    expect(g.modsOf(c).maxHp).toBe(125);
    expect(c.hp).toBe(125);
    // la armadura se equipa desde un cofre sin ocupar espacio
    const body = { kind: 'armor_body' as const, qty: 1, rarity: 2 as const };
    expect(g['equipItem'](c, body)).toBe(true);
    expect(st.equip[1]).toBe(2);
    expect(g.modsOf(c).taken).toBeLessThan(0.8);
    // una pieza peor no reemplaza a la mejor
    g['equipItem'](c, { ...body, rarity: 0 });
    expect(st.equip[1]).toBe(2);
  });

  it('las mejoras permanentes se aplican al empezar y se acotan a su limite', () => {
    const g = new AdventureGame({
      seed: 5,
      cats: cats(1),
      meta: {
        1: { vida: 99, garras: 2, municion: 3, botiquin: 3, esencia: 0, vidas: 2, reliquia: 1 },
      },
    });
    const c = g.cat(1)!;
    expect(g.modsOf(c).maxHp).toBe(150);
    expect(c.hp).toBe(150);
    // 60 + 75 balas, pero ningun arma pasa de 120
    expect(c.ammo.ammo_pistol).toBe(120);
    expect(c.inv.find((it) => it?.kind === 'medkit')!.qty).toBe(3);
    expect(g.lives).toBe(SQUAD_LIVES + 2);
    expect(g.snapshotFor(1)!.adv!.choice).toHaveLength(3);
    void MOB;
  });
});
