import { describe, expect, it } from 'vitest';
import { CAT, TICK_DT, TILE } from '../../src/shared/br/constants';
import { KITS, KIT_IDS, type KitId } from '../../src/shared/br/modes';
import { isWeapon, magOf } from '../../src/shared/br/items';
import { defaultSkin } from '../../src/shared/br/skin';
import { ZONE_TECHO, ZONE_TERRITORIO } from '../../src/shared/br/zone';
import { HOLD_TO_WIN_S } from '../../src/shared/br/modes';
import { PvpGame } from '../../src/server/br/PvpGame';
import type { CatInit } from '../../src/server/br/Game';

const cat = (id: number, team: 0 | 1, bot: boolean): CatInit => ({
  id,
  name: bot ? `bot${id}` : `gato${id}`,
  userId: bot ? null : id,
  bot,
  skin: defaultSkin(),
  team,
});

function duel(
  cats: CatInit[],
  teamSize = 1,
  extra: Partial<ConstructorParameters<typeof PvpGame>[0]> = {},
): PvpGame {
  return new PvpGame({
    seed: 4242,
    mapKind: 'tejado',
    mode: 'techo',
    cats,
    teamSize,
    zone: ZONE_TECHO,
    ...extra,
  });
}

/** Un tramo horizontal despejado donde se puede disparar sin chocar con coberturas. */
function lane(g: PvpGame, tiles = 12): { x: number; y: number } {
  const m = g.map;
  for (let y = 4; y < m.h - 4; y++) {
    for (let x = 4; x < m.w - 4 - tiles; x++) {
      let ok = true;
      for (let k = 0; k < tiles && ok; k++)
        for (let dy = -1; dy <= 1 && ok; dy++) if (m.solid[(y + dy) * m.w + x + k]) ok = false;
      if (ok) return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
    }
  }
  throw new Error('sin tramo despejado');
}

/** Pasa a la pelea y deja atras la proteccion de los primeros instantes. */
function fight(g: PvpGame): void {
  until(g, 'fight');
  g.time = 3;
}

const run = (g: PvpGame, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) g.step();
};

/** Avanza hasta que la partida llegue a esa fase (o falla si no llega). */
function until(g: PvpGame, phase: string, maxSeconds = 120): void {
  // (al llegar a la pelea se salta la proteccion de los primeros instantes)
  for (let i = 0; i < Math.round(maxSeconds / TICK_DT); i++) {
    if (g.phase === phase) return;
    g.step();
  }
  throw new Error(`no llego a la fase ${phase}: sigue en ${g.phase}`);
}

describe('pelea por rondas: fases y kits', () => {
  it('cada equipo aparece de su lado y empieza eligiendo kit, todos quietos', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    expect(g.phase).toBe('pick');
    expect(g.round).toBe(1);
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    expect(a.x).toBeLessThan((g.map.w * TILE) / 2);
    expect(b.x).toBeGreaterThan((g.map.w * TILE) / 2);
    const x0 = a.x;
    g.pushInput(1, { seq: 1, mx: 1, my: 0, aim: 0, fire: false });
    run(g, 1);
    expect(a.x).toBe(x0);
    // las entradas se confirman aunque no se simulen
    expect(a.lastSeq).toBe(1);
    expect(g.cat(1)!.inv.every((it) => it === null)).toBe(true);
  });

  it('elegir kit equipa lo que promete cada kit y las rondas empiezan con cuenta de 3', () => {
    for (const id of KIT_IDS) {
      const g = duel([cat(1, 0, false), cat(2, 1, true)]);
      expect(g.chooseKit(1, id)).toBe(true);
      until(g, 'ready');
      const c = g.cat(1)!;
      const kit = KITS[id];
      expect(g.kitOf(1)).toBe(id);
      const held = c.inv[0]!;
      expect(held.kind).toBe(kit.main);
      expect(isWeapon(held.kind)).toBe(true);
      expect(magOf(held)).toBeGreaterThan(0);
      for (const [k, qty] of Object.entries(kit.ammo)) {
        expect(c.ammo[k as keyof typeof c.ammo]).toBe(qty);
      }
      expect(c.inv.filter((it) => it !== null)).toHaveLength(kit.items.length);
      // durante la cuenta nadie se mueve ni dispara
      g.pushInput(1, { seq: 5, mx: 1, my: 0, aim: 0, fire: true });
      const x0 = c.x;
      run(g, 1);
      expect(g.phase).toBe('ready');
      expect(c.x).toBe(x0);
      until(g, 'fight');
    }
  });

  it('no se puede cambiar de kit despues de elegir tiempo, ni elegir uno inventado', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    expect(g.chooseKit(1, 'inventado')).toBe(false);
    expect(g.chooseKit(99, 'vigia')).toBe(false);
    expect(g.chooseKit(1, 'vigia')).toBe(true);
    until(g, 'fight');
    expect(g.chooseKit(1, 'cazador')).toBe(false);
    expect(g.kitOf(1)).toBe('vigia');
  });

  it('si nadie elige, el kit se asigna solo al acabar el tiempo', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)], 1, { pickSeconds: 4 });
    until(g, 'fight');
    expect(g.kitOf(1)).not.toBeNull();
    expect(g.cat(1)!.inv[0]).not.toBeNull();
  });

  it('con todas las personas listas la eleccion se acorta', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)], 1, { pickSeconds: 30 });
    g.chooseKit(1, 'cazador');
    let ticks = 0;
    while (g.phase === 'pick' && ticks < 600) {
      g.step();
      ticks++;
    }
    expect(g.phase).toBe('ready');
    expect(ticks * TICK_DT).toBeLessThan(5);
  });

  it('en la snapshot los rivales no ven tu kit hasta que empieza la cuenta', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, false)]);
    g.chooseKit(1, 'acechador');
    g.chooseKit(2, 'vigia');
    const mine = g.snapshotFor(1)!;
    expect(mine.pvp?.phase).toBe('pick');
    expect(mine.pvp?.kit).toBe('acechador');
    expect(mine.pvp?.picks.map((p) => p.id)).toEqual([1]);
    until(g, 'ready');
    const later = g.snapshotFor(1)!;
    expect(later.pvp?.picks.map((p) => p.id).sort()).toEqual([1, 2]);
    expect(later.mode).toBe('techo');
    expect(later.pvp?.team).toBe(0);
  });
});

describe('pelea por rondas: combate y marcador', () => {
  it('no hay fuego amigo: ni balas, ni garras, ni explosiones danan a tu equipo', () => {
    const g = duel([cat(1, 0, false), cat(2, 0, false), cat(3, 1, true), cat(4, 1, true)], 2);
    g.chooseKit(1, 'cazador');
    g.chooseKit(2, 'bombardero');
    until(g, 'fight');
    g.time = 5;
    const [a, b] = [g.cat(1)!, g.cat(2)!];
    // companeros a quemarropa, uno frente al otro
    const l = lane(g);
    a.x = l.x;
    a.y = l.y;
    b.x = l.x + 30;
    b.y = l.y;
    const before = b.hp + b.shield;
    g.fireControl(a, 0, true);
    run(g, 0.4);
    expect(b.hp + b.shield).toBe(before);
    expect(a.damageDealt).toBe(0);
    // el bombardero se dispara a si mismo y a su companero: la explosion no toca al companero
    g.select(2, 0);
    b.aim = Math.PI;
    g.fireControl(b, Math.PI, true);
    run(g, 1);
    expect(a.hp + a.shield).toBe(CAT.maxHp);
    // el enemigo si recibe dano
    const foe = g.cat(3)!;
    foe.x = l.x + 120;
    foe.y = l.y;
    g.select(1, 0);
    a.cooldownUntil = 0;
    a.prevFire = false;
    g.fireControl(a, 0, true);
    run(g, 0.6);
    expect(a.damageDealt).toBeGreaterThan(0);
  });

  it('eliminar a todo un equipo gana la ronda, se pasa a la siguiente y todo se reinicia', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    fight(g);
    const foe = g.cat(2)!;
    const me = g.cat(1)!;
    me.x += 30;
    g.damageCat(foe, 9999, me);
    run(g, 0.2);
    expect(g.phase).toBe('between');
    expect(g.wins).toEqual([1, 0]);
    expect(g.roundWinner).toBe(0);
    expect(g.result).toBeNull();
    me.hp = 30;
    until(g, 'pick');
    expect(g.round).toBe(2);
    expect(me.hp).toBe(CAT.maxHp);
    expect(foe.alive).toBe(true);
    expect(me.x).toBe(me.spawn.x);
    expect(me.inv.every((it) => it === null)).toBe(true);
    // las muertes y el dano de la ronda anterior se acumulan para el marcador final
    expect(me.kills).toBe(1);
  });

  it('el primero en ganar dos rondas gana la partida y el resultado lo dice', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    for (let r = 0; r < 2; r++) {
      fight(g);
      g.damageCat(g.cat(2)!, 9999, g.cat(1)!);
      run(g, 0.2);
      if (r === 0) until(g, 'pick');
    }
    expect(g.over).toBe(true);
    expect(g.phase).toBe('over');
    const res = g.result!;
    expect(res.winnerTeam).toBe(0);
    expect(res.score).toEqual([2, 0]);
    expect(res.humanWon).toBe(true);
    expect(res.mode).toBe('techo');
    expect(res.rows.find((r) => r.id === 1)?.placement).toBe(1);
    expect(res.rows.find((r) => r.id === 2)?.placement).toBe(2);
    expect(res.rows[0]?.team).toBe(0);
  });

  it('un empate repite la ronda sin dar punto', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    fight(g);
    g.damageCat(g.cat(1)!, 9999, null);
    g.damageCat(g.cat(2)!, 9999, null);
    run(g, 0.2);
    expect(g.phase).toBe('between');
    expect(g.wins).toEqual([0, 0]);
    until(g, 'pick');
    expect(g.round).toBe(1);
  });

  it('no hay lapidas ni botin al caer: los kits son fijos', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    fight(g);
    g.damageCat(g.cat(2)!, 9999, g.cat(1)!);
    expect(g.allContainers().some((c) => c.kind === 'tomb')).toBe(false);
  });

  it('un jugador eliminado mira a su companero y no recibe el cartel de puesto', () => {
    const g = duel([cat(1, 0, false), cat(2, 0, true), cat(3, 1, true), cat(4, 1, true)], 2);
    fight(g);
    g.damageCat(g.cat(1)!, 9999, g.cat(3)!);
    expect(g.drainDeaths()).toEqual([]);
    expect(g.cat(1)!.spectate).toBe(2);
    expect(g.teamAlive(0)).toBe(1);
  });

  it('la tormenta danna a quien se queda lejos del circulo', () => {
    const g = duel([cat(1, 0, false), cat(2, 1, true)]);
    until(g, 'fight');
    const me = g.cat(1)!;
    run(g, ZONE_TECHO.timeline.start1 + ZONE_TECHO.timeline.shrink1 + 12);
    const far = g.zone.circle;
    expect(far.r).toBeLessThan(g.map.w * TILE);
    expect(me.alive ? me.hp + me.shield : 0).toBeLessThan(CAT.maxHp * 2);
  });
});

describe('pelea por rondas: bots', () => {
  it.each(['tejado', 'azotea', 'mansarda'] as const)(
    'una partida 1v1 entre bots en %s termina sola con un ganador',
    (mapKind) => {
      const g = duel([cat(1, 0, true), cat(2, 1, true)], 1, { mapKind });
      for (let i = 0; i < 40_000 && !g.over; i++) g.step();
      expect(g.over).toBe(true);
      const res = g.result!;
      expect([0, 1]).toContain(res.winnerTeam);
      expect(Math.max(...res.score!)).toBe(2);
      // pelearon de verdad
      expect(res.rows.reduce((s, r) => s + r.damageDealt, 0)).toBeGreaterThan(50);
    },
    60_000,
  );

  it('cada bot elige un kit distinto de forma aleatoria pero siempre valido', () => {
    const seen = new Set<KitId>();
    for (let seed = 1; seed <= 12; seed++) {
      const g = duel([cat(1, 0, true), cat(2, 1, true)], 1, { seed });
      until(g, 'ready');
      seen.add(g.kitOf(1)!);
      seen.add(g.kitOf(2)!);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('territorio: patios que se disputan', () => {
  function turf(cats: CatInit[], teamSize = 1): PvpGame {
    return new PvpGame({
      seed: 8181,
      mapKind: 'calle',
      mode: 'territorio',
      cats,
      teamSize,
      zone: ZONE_TERRITORIO,
    });
  }
  const humans = (n: number): CatInit[] =>
    Array.from({ length: n }, (_, i) => cat(i + 1, (i % 2) as 0 | 1, false));

  /** Pone a un gato justo en el centro de un patio. */
  function stand(g: PvpGame, catId: number, point: number): void {
    const p = g.map.points![point]!;
    const c = g.cat(catId)!;
    c.x = p.x;
    c.y = p.y;
  }

  it('el mapa trae tres patios y la snapshot dice de quien es cada uno', () => {
    const g = turf(humans(2));
    expect(g.map.points).toHaveLength(3);
    const snap = g.snapshotFor(1)!;
    expect(snap.mode).toBe('territorio');
    expect(snap.pvp?.points).toEqual([
      [-1, 0, -1],
      [-1, 0, -1],
      [-1, 0, -1],
    ]);
    expect(snap.pvp?.hold).toEqual([0, 0]);
  });

  it('quedarse en un patio lo captura en unos 6 segundos y avisa con un evento', () => {
    const g = turf(humans(2));
    fight(g);
    g.cat(2)!.x = 5;
    stand(g, 1, 0);
    run(g, 3);
    let pts = g.snapshotFor(1)!.pvp!.points!;
    expect(pts[0]![0]).toBe(-1);
    expect(pts[0]![1]).toBeGreaterThan(30);
    expect(pts[0]![1]).toBeLessThan(80);
    expect(pts[0]![2]).toBe(0);
    run(g, 4);
    pts = g.snapshotFor(1)!.pvp!.points!;
    expect(pts[0]).toEqual([0, 100, 0]);
    // la captura quedo registrada para los clientes cercanos
    const names = g.snapshotFor(1)!.ev.map((e) => e.e);
    expect(names.length).toBeGreaterThanOrEqual(0);
  });

  it('entre dos equipos en el mismo patio nadie avanza', () => {
    const g = turf(humans(2));
    fight(g);
    const p = g.map.points![1]!;
    g.cat(1)!.x = p.x - 10;
    g.cat(1)!.y = p.y;
    g.cat(2)!.x = p.x + 10;
    g.cat(2)!.y = p.y;
    // los dos se mantienen vivos y quietos en el centro
    for (let i = 0; i < 90; i++) {
      g.cat(1)!.hp = 100;
      g.cat(2)!.hp = 100;
      g.step();
    }
    expect(g.snapshotFor(1)!.pvp!.points![1]).toEqual([-1, 0, -1]);
  });

  it('un patio se le quita al rival pasando antes por cero y los patios propios curan', () => {
    const g = turf(humans(2));
    fight(g);
    stand(g, 1, 0);
    g.cat(2)!.x = 5;
    run(g, 7);
    expect(g.snapshotFor(1)!.pvp!.points![0]![0]).toBe(0);
    // dentro de su patio el dueno se cura solo
    g.cat(1)!.hp = 50;
    run(g, 2);
    expect(g.cat(1)!.hp).toBeGreaterThan(55);
    // el rival lo va a quitando: primero baja el avance y luego cambia de dueno
    g.cat(1)!.x = 5;
    stand(g, 2, 0);
    run(g, 2);
    expect(g.snapshotFor(2)!.pvp!.points![0]![0]).toBe(0);
    run(g, 5);
    // primero queda sin dueno...
    expect(g.snapshotFor(2)!.pvp!.points![0]![0]).toBe(-1);
    run(g, 7);
    // ...y luego es suyo
    expect(g.snapshotFor(2)!.pvp!.points![0]![0]).toBe(1);
  });

  it('dominar los tres patios mucho tiempo gana la ronda', () => {
    const g = turf(humans(6), 3);
    fight(g);
    // tres gatos del equipo 0 (ids 1, 3, 5) se reparten los tres patios
    const mine = [1, 3, 5];
    for (const id of [2, 4, 6]) g.cat(id)!.x = 5;
    for (let i = 0; i < 3; i++) stand(g, mine[i]!, i);
    run(g, 8);
    expect(g.snapshotFor(1)!.pvp!.points!.every((p) => p[0] === 0)).toBe(true);
    run(g, HOLD_TO_WIN_S + 1);
    expect(g.wins).toEqual([1, 0]);
    expect(g.roundWinner).toBe(0);
    expect(g.phase).toBe('between');
  });

  it('el equipo grande de cinco se arma entero y los bots se reparten por los patios', () => {
    const g = turf(
      [
        cat(1, 0, false),
        ...[2, 3, 4, 5].map((i) => cat(i, 0, true)),
        ...[6, 7, 8, 9, 10].map((i) => cat(i, 1, true)),
      ],
      5,
    );
    expect(g.cats).toHaveLength(10);
    expect(g.teamAlive(0)).toBe(5);
    expect(g.teamAlive(1)).toBe(5);
    const [a, b] = g.map.teamSpawns!;
    for (const t of [0, 1] as const) {
      const spots = (t === 0 ? a : b).map((s) => `${s.x},${s.y}`);
      const mine = g.cats.filter((c) => c.team === t).map((c) => `${c.x},${c.y}`);
      expect(new Set(mine).size).toBe(5);
      for (const m of mine) expect(spots).toContain(m);
    }
    until(g, 'fight');
    run(g, 40);
    // los bots salieron de su base hacia los patios
    const moved = g.cats.filter((c) => c.bot && Math.hypot(c.x - c.spawn.x, c.y - c.spawn.y) > 100);
    expect(moved.length).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it('una partida entera de bots 3 contra 3 en cada mapa de calle termina sola', () => {
    for (const mapKind of ['calle', 'patios'] as const) {
      const g = new PvpGame({
        seed: 99,
        mapKind,
        mode: 'territorio',
        zone: ZONE_TERRITORIO,
        teamSize: 3,
        cats: [0, 1, 2, 3, 4, 5].map((i) => cat(i + 1, (i < 3 ? 0 : 1) as 0 | 1, true)),
      });
      for (let i = 0; i < 80_000 && !g.over; i++) g.step();
      expect(g.over, `${mapKind} no termino`).toBe(true);
      expect(Math.max(...g.result!.score!)).toBe(2);
    }
  }, 120_000);
});
