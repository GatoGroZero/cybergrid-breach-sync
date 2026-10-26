import { describe, expect, it } from 'vitest';
import {
  BOSS_INTRO_S,
  BOSS_ORDER,
  BOSS_POWER,
  DASH,
  POWERS,
  POWER_SLOTS,
  MOB,
  RELICS,
  REVIVE_S,
  SQUAD_LIVES,
  squadLives,
  computeMods,
  mobDef,
  powerOffer,
} from '../../src/shared/br/adventure';
import { createRng } from '../../src/shared/rng';
import { TICK_DT, TILE } from '../../src/shared/br/constants';
import { WEAPONS, magOf } from '../../src/shared/br/items';
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

/** Deja pasar la presentacion de un jefe (todos quietos) y la proteccion con la que aparece. */
const presentacion = (g: AdventureGame): void => {
  for (let i = 0; i < 600 && g.snapshotFor(1)?.adv?.intro; i++) g.step();
  run(g, 0.6);
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
    // un rumbo despejado hacia donde disparar (los claros tienen arboles y rocas)
    const open = (a: number): boolean =>
      [10, 20, 30, 40, 50].every(
        (d) =>
          g.map.solid[
            Math.floor((c.y + Math.sin(a) * d) / TILE) * g.map.w +
              Math.floor((c.x + Math.cos(a) * d) / TILE)
          ] === 0,
      );
    const dir = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4).find(open) ?? 0;
    // los demas enemigos se quedan quietos atras: no se cruzan en la linea de tiro
    for (const o of alive(g)) {
      if (o === far) continue;
      o.stunUntil = 1e9;
      o.cd = 1e9;
      o.x = c.x - Math.cos(dir) * 60;
      o.y = c.y - Math.sin(dir) * 60;
    }
    const place = (): void => {
      far.x = c.x + Math.cos(dir) * 50;
      far.y = c.y + Math.sin(dir) * 50;
    };
    place();
    far.hp = far.maxHp = 5000;
    far.cd = 1e9;
    far.stunUntil = 1e9;
    g.select(1, 0);
    c.aim = dir;
    for (let i = 0; i < 40; i++) {
      c.hp = 100;
      g.fireControl(c, 0, true);
      g.step();
      g.fireControl(c, 0, false);
      place();
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
    presentacion(g);
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
      presentacion(g);
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

/** Le da una habilidad al gato como si un jefe se la hubiera ensenado. */
function teach(g: AdventureGame, catId: number, id: number, level = 1): void {
  g.stateOf(catId)!.powers.push({ id, level, readyAt: 0 });
}

/** Pide usar la habilidad de una casilla (1 a 3) y avanza un tick. */
function press(g: AdventureGame, catId: number, slot: 1 | 2 | 3): void {
  g.pushInput(catId, {
    seq: 100 + Math.round(g.time * 30),
    mx: 0,
    my: 0,
    aim: 0,
    fire: false,
    pw: slot,
  });
  g.step();
}

describe('aventura: habilidades de jefe', () => {
  it('un jefe ofrece tres habilidades distintas y siempre la suya; con las casillas llenas, subir de nivel', () => {
    const rng = createRng(5);
    for (const boss of Object.keys(BOSS_POWER).map(Number)) {
      const offer = powerOffer(rng, [], boss);
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      expect(offer).toContain(BOSS_POWER[boss]);
    }
    const full = [0, 1, 2].map((id) => ({ id, level: 1 }));
    expect(powerOffer(rng, full, 13).sort()).toEqual([0, 1, 2]);
    const maxed = full.map((o) => ({ ...o, level: 3 }));
    expect(powerOffer(rng, maxed, 13)).toEqual([]);
    expect(POWERS).toHaveLength(8);
    expect(POWER_SLOTS).toBe(3);
  });

  it('al caer un minijefe se elige una habilidad (nueva o de nivel superior)', () => {
    const g = make(1);
    const first = g.rooms.findIndex((r) => r.def.kind === 'minijefe');
    g.debugTeleport(first);
    run(g, 3.5);
    presentacion(g);
    g.damageMob(
      alive(g).find((m) => m.def.boss)!,
      99_999,
      g.cat(1)!,
    );
    run(g, 0.5);
    const adv = g.snapshotFor(1)!.adv!;
    expect(adv.pchoice).toHaveLength(3);
    expect(adv.pchoice).toContain(BOSS_POWER[BOSS_ORDER[0] as number]);
    const pick = adv.pchoice![0] as number;
    expect(g.choosePower(1, 0)).toBe(true);
    expect(g.snapshotFor(1)!.adv!.powers.map((p) => p[0])).toEqual([pick]);
    expect(g.snapshotFor(1)!.adv!.pchoice).toBeNull();
    expect(g.choosePower(1, 0)).toBe(false);
  });

  it('Furia felina dispara el doble de rápido y además pega más fuerte; Mirada de búho sube el daño y el alcance', () => {
    const g = make(1);
    run(g, 0.5);
    const cat = g.cat(1)!;
    teach(g, 1, 0);
    teach(g, 1, 1);
    const base = WEAPONS.pistol.cooldown;
    const dmg = g as unknown as { shotDamage(c: unknown, b: number): number };
    expect(dmg.shotDamage(cat, 10)).toBe(10);
    g.fireControl(cat, 0, true);
    expect(cat.cooldownUntil - g.time).toBeCloseTo(base, 2);
    g.fireControl(cat, 0, false);
    run(g, 1);
    press(g, 1, 1);
    expect(g.snapshotFor(1)!.adv!.powers[0]![3]).toBeGreaterThan(4);
    // con la furia cada bala pega 40 % mas
    expect(dmg.shotDamage(cat, 10)).toBe(14);
    g.fireControl(cat, 0, true);
    expect(cat.cooldownUntil - g.time).toBeCloseTo(base * 0.5, 2);
    // la habilidad entra en espera
    expect(g.snapshotFor(1)!.adv!.powers[0]![2]).toBeGreaterThan(20);
    const prot = g as unknown as {
      shotDamage(c: unknown, b: number): number;
      shotRange(c: unknown, b: number): number;
    };
    const plain = prot.shotDamage(cat, 10);
    press(g, 1, 2);
    expect(prot.shotDamage(cat, 10)).toBeGreaterThanOrEqual(plain * 1.7);
    expect(prot.shotRange(cat, 100)).toBeGreaterThan(125);
  });

  it('Rugido guardián daña y aturde; Maullido hipnótico ralentiza; Nova de fuego quema', () => {
    const g = make(1);
    g.debugTeleport(1);
    run(g, 2.4);
    const cat = g.cat(1)!;
    wipe(g);
    teach(g, 1, 3);
    teach(g, 1, 7);
    teach(g, 1, 5);
    const rata = g.spawnMob(MOB.rata, cat.x + 24, cat.y, 1)!;
    rata.hp = rata.maxHp = 999;
    run(g, 0.6);
    press(g, 1, 1);
    expect(rata.hp).toBeLessThan(999);
    expect(rata.stunUntil).toBeGreaterThan(g.time);
    const hpAfterRoar = rata.hp;
    press(g, 1, 2);
    expect(rata.slowUntil).toBeGreaterThan(g.time + 3);
    press(g, 1, 3);
    expect(rata.hp).toBeLessThan(hpAfterRoar);
    expect(g.snapshotFor(1)!.ev.some((e) => e.e === 'power')).toBe(true);
  });

  it('Esporas curativas cura al grupo dentro de la nube, y Escudo de luna da escudo', () => {
    const g = make(2);
    run(g, 1);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    teach(g, 1, 2);
    teach(g, 1, 6);
    a.hp = 30;
    b.x = a.x + 20;
    b.y = a.y;
    b.hp = 30;
    press(g, 1, 1);
    expect(g.perils.some((h) => h.kind === 5)).toBe(true);
    run(g, 3);
    expect(a.hp).toBeGreaterThan(50);
    expect(b.hp).toBeGreaterThan(50);
    press(g, 1, 2);
    expect(a.shield).toBeGreaterThanOrEqual(55);
    expect(b.shield).toBeGreaterThanOrEqual(55);
  });

  it('Paso espectral deja pasar los golpes y acelera', () => {
    const g = make(1);
    run(g, 3);
    const cat = g.cat(1)!;
    teach(g, 1, 4);
    press(g, 1, 1);
    expect(g.snapshotFor(1)!.me.spd).toBeCloseTo(1.4, 2);
    const hp = cat.hp;
    g.damageCat(cat, 50, null);
    expect(cat.hp).toBe(hp);
    run(g, 4);
    g.damageCat(cat, 10, null);
    expect(cat.hp).toBeLessThan(hp);
  });
});

describe('aventura: botin de jefe y escala por grupo', () => {
  const lootOf = (n: number): { weapons: number; medkits: number; shields: number } => {
    const g = make(n);
    const first = g.rooms.findIndex((r) => r.def.kind === 'minijefe');
    g.debugTeleport(first);
    run(g, 3.5);
    presentacion(g);
    g.damageMob(
      alive(g).find((m) => m.def.boss)!,
      999_999,
      g.cat(1)!,
    );
    const items = g.pickups.filter((p) => p.kind === 4).map((p) => p.item!.kind);
    return {
      weapons: items.filter((k) => k !== 'medkit' && k !== 'shield').length,
      medkits: items.filter((k) => k === 'medkit').length,
      shields: items.filter((k) => k === 'shield').length,
    };
  };

  it('un jefe suelta armas, curas y escudos: mas generoso en solitario y mas grande con amigos', () => {
    const solo = lootOf(1);
    expect(solo.weapons).toBeGreaterThanOrEqual(2);
    expect(solo.medkits).toBeGreaterThanOrEqual(2);
    expect(solo.shields).toBeGreaterThanOrEqual(2);
    const four = lootOf(4);
    expect(four.weapons).toBeGreaterThanOrEqual(4);
    expect(four.medkits).toBeGreaterThanOrEqual(5);
    expect(four.shields).toBeGreaterThanOrEqual(4);
  });

  it('el arma del jefe se recoge caminando y trae sus balas', () => {
    const g = make(1);
    const first = g.rooms.findIndex((r) => r.def.kind === 'minijefe');
    g.debugTeleport(first);
    run(g, 3.5);
    presentacion(g);
    g.damageMob(
      alive(g).find((m) => m.def.boss)!,
      999_999,
      g.cat(1)!,
    );
    const cat = g.cat(1)!;
    const weapon = g.pickups.find(
      (p) => p.kind === 4 && p.item && WEAPONS[p.item.kind as 'rifle'],
    )!;
    cat.x = weapon.x;
    cat.y = weapon.y;
    run(g, 0.2);
    expect(cat.inv.some((it) => it?.kind === weapon.item!.kind)).toBe(true);
    expect(g.snapshotFor(1)!.pk!.every((t) => t[3] !== 4 || typeof t[4] === 'number')).toBe(true);
  });

  it('las salas de combate dejan curas y, a veces, armas', () => {
    let medkits = 0;
    let weapons = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = make(1, 700 + seed);
      clearRoom(g, 1);
      for (const p of g.pickups) {
        if (p.kind !== 4) continue;
        if (p.item!.kind === 'medkit') medkits++;
        else if (p.item!.kind !== 'shield') weapons++;
      }
    }
    expect(medkits).toBeGreaterThanOrEqual(5);
    expect(weapons).toBeGreaterThanOrEqual(1);
  });

  it('con amigos los jefes aguantan mucho mas que en solitario', () => {
    const hp = (n: number): number => {
      const g = make(n);
      const first = g.rooms.findIndex((r) => r.def.kind === 'minijefe');
      g.debugTeleport(first);
      run(g, 3.5);
      presentacion(g);
      return alive(g).find((m) => m.def.boss)!.maxHp;
    };
    const solo = hp(1);
    const two = hp(2);
    expect(solo).toBe(mobDef(BOSS_ORDER[0] as number).hp);
    expect(two).toBeGreaterThan(solo * 1.7);
  });
});

describe('aventura: revivir al terminar la zona', () => {
  it('quien cae sin vidas vuelve al superar la sala si queda alguien de pie', () => {
    const g = make(2);
    run(g, 1);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    g.lives = 0;
    g.damageCat(a, 9999, null);
    expect(a.alive).toBe(false);
    run(g, REVIVE_S + 2);
    expect(a.alive).toBe(false);
    // mientras tanto el compañero ve el aviso y el caido sabe que volvera
    expect(g.snapshotFor(1)!.adv!.fallen).toBe(-1);
    clearRoom(g, 1);
    run(g, 0.3);
    expect(a.alive).toBe(true);
    expect(b.alive).toBe(true);
    expect(g.lives).toBe(0);
    expect(a.hp).toBeGreaterThan(30);
    expect(g.over).toBe(false);
  });

  it('en una sala de descanso o de tesoro tambien se levantan', () => {
    const g = make(2);
    run(g, 1);
    const a = g.cat(1)!;
    g.lives = 0;
    g.damageCat(a, 9999, null);
    const rest = g.rooms.findIndex((r) => r.def.kind === 'tesoro');
    g.debugTeleport(rest);
    run(g, 0.5);
    expect(a.alive).toBe(true);
  });

  it('si nadie queda de pie la aventura termina y nadie revive', () => {
    const g = make(2);
    run(g, 1);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    g.lives = 0;
    g.damageCat(a, 9999, null);
    g.damageCat(b, 9999, null);
    run(g, 0.3);
    expect(g.over).toBe(true);
    expect(g.ending).toBe('defeat');
  });

  it('en solitario sin vidas no hay quien levante: se acaba', () => {
    const g = make(1);
    run(g, 1);
    g.lives = 0;
    g.damageCat(g.cat(1)!, 9999, null);
    run(g, 0.3);
    expect(g.over).toBe(true);
  });
});

describe('aventura: presentacion de los jefes', () => {
  const llegarAlJefe = (n = 1): AdventureGame => {
    const g = make(n);
    const first = g.rooms.findIndex((r) => r.def.kind === 'minijefe');
    g.debugTeleport(first);
    // el jefe aparece a los 1.8 s de entrar a su guarida
    for (let i = 0; i < 600 && !g.snapshotFor(1)?.adv?.intro; i++) g.step();
    return g;
  };

  it('al aparecer el jefe el servidor avisa de la presentacion con su tipo, lugar y tiempo', () => {
    const g = llegarAlJefe();
    const intro = g.snapshotFor(1)!.adv!.intro!;
    expect(intro).toBeDefined();
    const boss = alive(g).find((m) => m.def.boss)!;
    expect(intro.kind).toBe(boss.kind);
    expect(intro.left).toBeGreaterThan(BOSS_INTRO_S - 0.3);
    expect(intro.left).toBeLessThanOrEqual(BOSS_INTRO_S);
    expect(Math.abs(intro.x - boss.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(intro.y - boss.y)).toBeLessThanOrEqual(1);
  });

  it('durante la presentacion todos quedan quietos, el tiempo no corre y nadie sufre dano', () => {
    const g = llegarAlJefe();
    const cat = g.cat(1)!;
    const before = { x: cat.x, y: cat.y, hp: cat.hp, time: g.time };
    for (let s = 1; s <= 30; s++)
      g.pushInput(1, { seq: 5000 + s, mx: 1, my: 0, aim: 0, fire: true });
    run(g, 1.5);
    expect(cat.x).toBe(before.x);
    expect(cat.y).toBe(before.y);
    expect(cat.hp).toBe(before.hp);
    expect(g.time).toBe(before.time);
    const left = g.snapshotFor(1)!.adv!.intro!.left;
    expect(left).toBeLessThan(BOSS_INTRO_S - 1.2);
  });

  it('despues de la presentacion la pelea empieza: el aviso desaparece y el tiempo vuelve a correr', () => {
    const g = llegarAlJefe();
    const t0 = g.time;
    run(g, BOSS_INTRO_S + 0.3);
    expect(g.snapshotFor(1)!.adv!.intro).toBeUndefined();
    expect(g.time).toBeGreaterThan(t0);
    const cat = g.cat(1)!;
    const x = cat.x;
    g.pushInput(1, { seq: 9000, mx: 1, my: 0, aim: 0, fire: false });
    run(g, 0.3);
    expect(cat.x).not.toBe(x);
  });

  it('las salas de combate comunes no tienen presentacion', () => {
    const g = make(1);
    g.debugTeleport(1);
    run(g, 3);
    expect(g.snapshotFor(1)!.adv!.intro).toBeUndefined();
  });
});
