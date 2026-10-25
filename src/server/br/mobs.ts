import { HAZARD, HOSTILE_SHOT, MOB, MOB_FLAG, type MobDef } from '../../shared/br/adventure';
import type { BRMap } from '../../shared/br/map';
import { dist, hasLineOfSight, moveBox } from '../../shared/br/physics';
import type { Rng } from '../../shared/rng';

/** Lo minimo que un enemigo necesita saber de un jugador. */
export interface Target {
  id: number;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface Step {
  /** Segundos despues del inicio del ataque en que se ejecuta. */
  at: number;
  run: () => void;
}

export interface Script {
  t0: number;
  steps: Step[];
  i: number;
  /** El jefe se queda quieto mientras dura el ataque. */
  still: boolean;
  /** Cuando termina todo el ataque. */
  end: number;
}

export interface Mob {
  id: number;
  kind: number;
  def: MobDef;
  room: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  aim: number;
  born: number;
  /** No ataca antes de este momento. */
  cd: number;
  windupUntil: number;
  stunUntil: number;
  hurtUntil: number;
  dashUntil: number;
  dvx: number;
  dvy: number;
  invuln: number;
  /** Ralentizado (maullido hipnotico) hasta este momento. */
  slowUntil: number;
  /** Cuantos amigos mas hay en el grupo: los jefes atacan mas seguido y traen mas ayudantes. */
  hard: number;
  phase: number;
  dmgScale: number;
  script: Script | null;
  targetId: number;
  retargetAt: number;
  /** Memoria de la IA: estado, direccion de giro, golpes pendientes... */
  data: Record<string, number>;
}

/** Lo que la partida le ofrece a la IA de los enemigos. */
export interface MobCtx {
  time: number;
  dt: number;
  readonly rng: Rng;
  readonly map: BRMap;
  players(): Target[];
  nearest(x: number, y: number): Target | null;
  hit(target: Target, dmg: number, from: Mob): void;
  shoot(from: Mob, angle: number, kind: number, dmg: number, speed: number, range: number): void;
  hazard(h: {
    x: number;
    y: number;
    r: number;
    kind: number;
    dmg: number;
    delay: number;
    life: number;
    dps?: number;
    owner: Mob;
  }): void;
  tele(x: number, y: number, r: number, t: number, shape?: 0 | 1, a?: number, len?: number): void;
  spawn(kind: number, x: number, y: number, room: number, owner?: Mob): Mob | null;
  push(target: Target, fromX: number, fromY: number, distance: number): void;
  /** Rectangulo del claro del enemigo, en pixeles. */
  bounds(room: number): { x0: number; y0: number; x1: number; y1: number };
  mobsOfRoom(room: number): Mob[];
  bossEvent(kind: number, phase: number): void;
}

const TAU = Math.PI * 2;
const angleTo = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.atan2(b.y - a.y, b.x - a.x);

/** Mueve un enemigo contra los muros; devuelve cuanto avanzo de verdad. */
function move(ctx: MobCtx, m: Mob, dx: number, dy: number): number {
  const next = moveBox(ctx.map, m.x, m.y, dx, dy, m.def.half);
  const moved = Math.hypot(next.x - m.x, next.y - m.y);
  m.x = next.x;
  m.y = next.y;
  return moved;
}

/** Cuanto avanzaria sin mover nada: sirve para rodear un obstaculo antes de chocar con el. */
function probe(ctx: MobCtx, m: Mob, angle: number, step: number): number {
  const next = moveBox(
    ctx.map,
    m.x,
    m.y,
    Math.cos(angle) * step,
    Math.sin(angle) * step,
    m.def.half,
  );
  return Math.hypot(next.x - m.x, next.y - m.y);
}

/** Camina hacia un angulo y, si una roca o un tronco le cierra el paso, la rodea por un lado. */
function walk(ctx: MobCtx, m: Mob, angle: number, speed: number): number {
  const step = speed * ctx.dt * (ctx.time < m.slowUntil ? 0.4 : 1);
  let a = angle;
  const circling = ctx.time < (m.data.sideUntil ?? 0);
  if (circling || probe(ctx, m, a, step) < step * 0.55) {
    const side = m.data.side ?? (ctx.rng.chance(0.5) ? 1 : -1);
    for (const turn of [0.8, 1.57, -0.8, -1.57]) {
      const cand = angle + turn * side;
      if (probe(ctx, m, cand, step) >= step * 0.7) {
        a = cand;
        m.data.side = turn * side > 0 ? 1 : -1;
        if (!circling) m.data.sideUntil = ctx.time + 0.7;
        break;
      }
    }
  }
  return move(ctx, m, Math.cos(a) * step, Math.sin(a) * step);
}

function target(ctx: MobCtx, m: Mob): Target | null {
  if (ctx.time >= m.retargetAt) {
    m.retargetAt = ctx.time + 0.5;
    m.targetId = ctx.nearest(m.x, m.y)?.id ?? 0;
  }
  const t = ctx.players().find((p) => p.id === m.targetId && p.alive);
  return t ?? ctx.nearest(m.x, m.y);
}

/** Separa a los enemigos que se amontonan para que no queden todos en el mismo pixel. */
function separate(ctx: MobCtx, m: Mob): void {
  for (const o of ctx.mobsOfRoom(m.room)) {
    if (o === m || o.def.boss || m.def.boss) continue;
    const d = dist(m.x, m.y, o.x, o.y);
    const min = m.def.half + o.def.half + 1;
    if (d > 0.01 && d < min) {
      const a = Math.atan2(m.y - o.y, m.x - o.x);
      move(ctx, m, Math.cos(a) * (min - d) * 0.4, Math.sin(a) * (min - d) * 0.4);
    }
  }
}

const scaled = (m: Mob, base: number): number => Math.round(base * m.dmgScale);

/** Un golpe cuerpo a cuerpo con aviso corto: ataca cuando termina el aviso si el rival sigue cerca. */
function melee(ctx: MobCtx, m: Mob, t: Target, reach: number, windup: number): void {
  if (m.data.pending === 1) {
    if (ctx.time >= m.windupUntil) {
      m.data.pending = 0;
      if (t.alive && dist(m.x, m.y, t.x, t.y) <= reach + 8) ctx.hit(t, scaled(m, m.def.dmg), m);
    }
    return;
  }
  if (ctx.time >= m.cd && dist(m.x, m.y, t.x, t.y) <= reach) {
    m.data.pending = 1;
    m.windupUntil = ctx.time + windup;
    m.cd = ctx.time + m.def.cooldown;
  }
}

// ------------------------------------------------------------------ enemigos comunes

function chase(ctx: MobCtx, m: Mob, t: Target): void {
  const d = dist(m.x, m.y, t.x, t.y);
  m.aim = angleTo(m, t);
  if (m.data.pending !== 1 && d > 11) walk(ctx, m, m.aim, m.def.speed);
  melee(ctx, m, t, 14, 0.28);
}

function flit(ctx: MobCtx, m: Mob, t: Target): void {
  const base = angleTo(m, t);
  const wobble = Math.sin(ctx.time * 5.2 + m.id) * 1.15;
  m.aim = base;
  if (m.data.pending !== 1) walk(ctx, m, base + wobble, m.def.speed);
  melee(ctx, m, t, 11, 0.16);
}

function shooter(ctx: MobCtx, m: Mob, t: Target): void {
  const d = dist(m.x, m.y, t.x, t.y);
  m.aim = angleTo(m, t);
  if (m.data.pending === 1) {
    if (ctx.time >= m.windupUntil) {
      m.data.pending = 0;
      ctx.shoot(
        m,
        m.aim + ctx.rng.range(-0.06, 0.06),
        HOSTILE_SHOT.pluma,
        scaled(m, m.def.dmg),
        138,
        280,
      );
    }
    return;
  }
  if (d < 95) walk(ctx, m, m.aim + Math.PI, m.def.speed * 1.2);
  else if (d > 150) walk(ctx, m, m.aim, m.def.speed);
  else {
    if (ctx.time >= (m.data.strafeUntil ?? 0)) {
      m.data.strafeUntil = ctx.time + ctx.rng.range(1.1, 2);
      m.data.strafe = ctx.rng.chance(0.5) ? 1 : -1;
    }
    walk(ctx, m, m.aim + (m.data.strafe ?? 1) * 1.45, m.def.speed * 0.7);
  }
  if (ctx.time >= m.cd && d < 250 && hasLineOfSight(ctx.map, m.x, m.y, t.x, t.y)) {
    m.data.pending = 1;
    m.windupUntil = ctx.time + 0.36;
    m.cd = ctx.time + m.def.cooldown * ctx.rng.range(0.85, 1.2);
  }
}

function charger(ctx: MobCtx, m: Mob, t: Target): void {
  const d = dist(m.x, m.y, t.x, t.y);
  const st = m.data.st ?? 0;
  if (st === 1) {
    // aviso: se queda mirando y pateando antes de salir disparado
    if (ctx.time >= m.windupUntil) {
      m.data.st = 2;
      m.dashUntil = ctx.time + 0.5;
      m.data.hit = 0;
    }
    return;
  }
  if (st === 2) {
    const moved = move(ctx, m, m.dvx * ctx.dt, m.dvy * ctx.dt);
    if (!m.data.hit && t.alive && dist(m.x, m.y, t.x, t.y) < 13) {
      m.data.hit = 1;
      ctx.hit(t, scaled(m, m.def.dmg), m);
    }
    if (ctx.time >= m.dashUntil || moved < 0.4) {
      m.data.st = 3;
      m.stunUntil = ctx.time + 0.8;
    }
    return;
  }
  if (st === 3) {
    if (ctx.time >= m.stunUntil) m.data.st = 0;
    return;
  }
  m.aim = angleTo(m, t);
  if (d > 110) walk(ctx, m, m.aim, m.def.speed);
  else if (d < 60) walk(ctx, m, m.aim + Math.PI, m.def.speed * 0.8);
  else walk(ctx, m, m.aim + 1.4, m.def.speed * 0.6);
  if (ctx.time >= m.cd && d < 160 && hasLineOfSight(ctx.map, m.x, m.y, t.x, t.y)) {
    m.data.st = 1;
    m.windupUntil = ctx.time + 0.6;
    m.cd = ctx.time + m.def.cooldown;
    const a = angleTo(m, t);
    m.aim = a;
    m.dvx = Math.cos(a) * 210;
    m.dvy = Math.sin(a) * 210;
    ctx.tele(m.x, m.y, 9, 0.6, 1, a, 130);
  }
}

function turret(ctx: MobCtx, m: Mob, t: Target): void {
  m.aim = angleTo(m, t);
  if (m.data.pending === 1) {
    if (ctx.time >= m.windupUntil) {
      m.data.pending = 0;
      const n = 5 + Math.round((m.dmgScale - 1) * 6);
      const off = ctx.rng.range(0, TAU);
      for (let i = 0; i < n; i++)
        ctx.shoot(m, off + (i / n) * TAU, HOSTILE_SHOT.espora, scaled(m, m.def.dmg), 70, 190);
    }
    return;
  }
  if (ctx.time >= m.cd && dist(m.x, m.y, t.x, t.y) < 220) {
    m.data.pending = 1;
    m.windupUntil = ctx.time + 0.55;
    m.cd = ctx.time + m.def.cooldown;
  }
}

function skirmisher(ctx: MobCtx, m: Mob, t: Target): void {
  const d = dist(m.x, m.y, t.x, t.y);
  const st = m.data.st ?? 0;
  if (st === 1) {
    // salto
    move(ctx, m, m.dvx * ctx.dt, m.dvy * ctx.dt);
    if (!m.data.hit && dist(m.x, m.y, t.x, t.y) < 13) {
      m.data.hit = 1;
      ctx.hit(t, scaled(m, m.def.dmg), m);
    }
    if (ctx.time >= m.dashUntil) {
      m.data.st = 2;
      m.data.retreatUntil = ctx.time + 1.1;
    }
    return;
  }
  if (st === 2) {
    walk(ctx, m, angleTo(m, t) + Math.PI + Math.sin(ctx.time * 3 + m.id) * 0.5, m.def.speed * 1.05);
    if (ctx.time >= (m.data.retreatUntil ?? 0)) m.data.st = 0;
    return;
  }
  m.aim = angleTo(m, t);
  if (d > 56) walk(ctx, m, m.aim + Math.sin(ctx.time * 2 + m.id) * 0.5, m.def.speed);
  else walk(ctx, m, m.aim + 1.5, m.def.speed * 0.8);
  if (ctx.time >= m.cd && d < 80) {
    m.data.st = 1;
    m.data.hit = 0;
    m.dashUntil = ctx.time + 0.26;
    m.cd = ctx.time + m.def.cooldown;
    m.dvx = Math.cos(m.aim) * 210;
    m.dvy = Math.sin(m.aim) * 210;
  }
}

function brute(ctx: MobCtx, m: Mob, t: Target): void {
  const d = dist(m.x, m.y, t.x, t.y);
  m.aim = angleTo(m, t);
  if (m.data.pending === 1) {
    if (ctx.time >= m.windupUntil) {
      m.data.pending = 0;
      for (const p of ctx.players()) {
        if (p.alive && dist(m.x, m.y, p.x, p.y) <= 32) {
          ctx.hit(p, scaled(m, m.def.dmg), m);
          ctx.push(p, m.x, m.y, 26);
        }
      }
    }
    return;
  }
  if (d > 30) walk(ctx, m, m.aim, m.def.speed);
  if (ctx.time >= m.cd && d < 46) {
    m.data.pending = 1;
    m.windupUntil = ctx.time + 0.9;
    m.cd = ctx.time + m.def.cooldown;
    ctx.tele(m.x, m.y, 32, 0.9, 0);
  }
}

// ------------------------------------------------------------------ jefes

type Attack = (ctx: MobCtx, m: Mob, t: Target) => Script;

const script = (ctx: MobCtx, steps: Step[], still: boolean, end: number): Script => ({
  t0: ctx.time,
  steps,
  i: 0,
  still,
  end: ctx.time + end,
});

function fan(
  ctx: MobCtx,
  m: Mob,
  a: number,
  n: number,
  spread: number,
  kind: number,
  dmg: number,
  speed: number,
  range = 300,
): void {
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5;
    ctx.shoot(m, a + k * spread, kind, dmg, speed, range);
  }
}

function ring(
  ctx: MobCtx,
  m: Mob,
  n: number,
  off: number,
  kind: number,
  dmg: number,
  speed: number,
  range = 260,
): void {
  for (let i = 0; i < n; i++) ctx.shoot(m, off + (i / n) * TAU, kind, dmg, speed, range);
}

/** Cerca de un punto, pero dentro del claro y sobre suelo libre. */
function around(ctx: MobCtx, m: Mob, x: number, y: number, r: number): { x: number; y: number } {
  const b = ctx.bounds(m.room);
  const a = ctx.rng.range(0, TAU);
  return {
    x: Math.min(b.x1 - 16, Math.max(b.x0 + 16, x + Math.cos(a) * r)),
    y: Math.min(b.y1 - 16, Math.max(b.y0 + 16, y + Math.sin(a) * r)),
  };
}

function dashAt(ctx: MobCtx, m: Mob, a: number, speed: number, secs: number, dmg: number): void {
  m.dashUntil = ctx.time + secs;
  m.dvx = Math.cos(a) * speed;
  m.dvy = Math.sin(a) * speed;
  m.data.dashDmg = dmg;
  m.data.dashHit = 0;
}

const BOSS_ATTACKS: Record<number, Attack[]> = {
  // ---- La Reina de los Ratones
  [MOB.reinaRata]: [
    (ctx, m, t) => {
      const a = angleTo(m, t);
      ctx.tele(m.x, m.y, 12, 0.85, 1, a, 220);
      m.aim = a;
      return script(
        ctx,
        [{ at: 0.85, run: () => dashAt(ctx, m, a, 250, 0.6, scaled(m, 18)) }],
        true,
        1.5,
      );
    },
    (ctx, m) => {
      const n = (m.phase >= 2 ? 5 : 3) + Math.min(3, m.hard);
      const spots = Array.from({ length: n }, () => around(ctx, m, m.x, m.y, 60));
      for (const s of spots) ctx.tele(s.x, s.y, 10, 0.7, 0);
      return script(
        ctx,
        [{ at: 0.7, run: () => spots.forEach((s) => ctx.spawn(MOB.rata, s.x, s.y, m.room, m)) }],
        true,
        1.2,
      );
    },
    (ctx, m) => {
      ctx.tele(m.x, m.y, 42, 0.7, 0);
      return script(
        ctx,
        [
          {
            at: 0.7,
            run: () => {
              for (const p of ctx.players())
                if (p.alive && dist(m.x, m.y, p.x, p.y) <= 42) {
                  ctx.hit(p, scaled(m, 16), m);
                  ctx.push(p, m.x, m.y, 30);
                }
              ring(
                ctx,
                m,
                m.phase >= 2 ? 14 : 10,
                ctx.rng.range(0, TAU),
                HOSTILE_SHOT.chispa,
                scaled(m, 8),
                90,
              );
            },
          },
        ],
        true,
        1.3,
      );
    },
  ],
  // ---- El Buho Anciano
  [MOB.buhoAnciano]: [
    (ctx, m, t) => {
      const volleys = m.phase >= 2 ? 4 : 3;
      const steps: Step[] = [];
      for (let i = 0; i < volleys; i++)
        steps.push({
          at: 0.4 + i * 0.42,
          run: () => {
            const a = angleTo(m, t);
            m.aim = a;
            fan(ctx, m, a, 5, 0.7, HOSTILE_SHOT.pluma, scaled(m, 9), 150, 300);
          },
        });
      return script(ctx, steps, false, 0.4 + volleys * 0.42 + 0.5);
    },
    (ctx, m) => {
      ctx.tele(m.x, m.y, 90, 0.8, 0);
      return script(
        ctx,
        [
          {
            at: 0.8,
            run: () => {
              for (const p of ctx.players())
                if (p.alive && dist(m.x, m.y, p.x, p.y) <= 90) {
                  ctx.hit(p, scaled(m, 8), m);
                  ctx.push(p, m.x, m.y, 64);
                }
              ring(ctx, m, 8, 0.2, HOSTILE_SHOT.pluma, scaled(m, 8), 120);
            },
          },
        ],
        true,
        1.3,
      );
    },
    (ctx, m) => {
      const spots = ctx
        .players()
        .filter((p) => p.alive)
        .slice(0, 3)
        .map((p) => ({ x: p.x + ctx.rng.range(-18, 18), y: p.y + ctx.rng.range(-18, 18) }));
      for (const s of spots) ctx.tele(s.x, s.y, 26, 1.1, 0);
      return script(
        ctx,
        [
          {
            at: 1.1,
            run: () => {
              for (const s of spots)
                for (const p of ctx.players())
                  if (p.alive && dist(s.x, s.y, p.x, p.y) <= 26) ctx.hit(p, scaled(m, 22), m);
              if (m.phase >= 2)
                for (let i = 0; i < 3; i++) {
                  const s = around(ctx, m, m.x, m.y, 50);
                  ctx.spawn(MOB.murcielago, s.x, s.y, m.room, m);
                }
            },
          },
        ],
        false,
        1.6,
      );
    },
  ],
  // ---- Mama Hongo
  [MOB.mamaHongo]: [
    (ctx, m) => {
      const steps: Step[] = [];
      const rings = m.phase >= 2 ? 4 : 3;
      for (let i = 0; i < rings; i++)
        steps.push({
          at: 0.6 + i * 0.5,
          run: () => ring(ctx, m, 12, i * 0.26, HOSTILE_SHOT.espora, scaled(m, 8), 82, 280),
        });
      ctx.tele(m.x, m.y, 30, 0.6, 0);
      return script(ctx, steps, true, 0.6 + rings * 0.5 + 0.6);
    },
    (ctx, m) => {
      const pools = ctx
        .players()
        .filter((p) => p.alive)
        .slice(0, 4)
        .map((p) => ({ x: p.x, y: p.y }));
      for (const s of pools) ctx.tele(s.x, s.y, 24, 0.8, 0);
      return script(
        ctx,
        [
          {
            at: 0.8,
            run: () =>
              pools.forEach((s) =>
                ctx.hazard({
                  x: s.x,
                  y: s.y,
                  r: 24,
                  kind: HAZARD.charco,
                  dmg: 0,
                  delay: 0,
                  life: 7,
                  dps: scaled(m, 10),
                  owner: m,
                }),
              ),
          },
        ],
        false,
        1.2,
      );
    },
    (ctx, m) => {
      const n = (m.phase >= 2 ? 3 : 2) + (m.hard >= 2 ? 1 : 0);
      const spots = Array.from({ length: n }, () => around(ctx, m, m.x, m.y, 70));
      for (const s of spots) ctx.tele(s.x, s.y, 12, 0.8, 0);
      return script(
        ctx,
        [{ at: 0.8, run: () => spots.forEach((s) => ctx.spawn(MOB.hongo, s.x, s.y, m.room, m)) }],
        true,
        1.3,
      );
    },
  ],
  // ---- El Perro Guardian
  [MOB.perroGuardian]: [
    (ctx, m, t) => {
      const steps: Step[] = [];
      const n = m.phase >= 2 ? 4 : 3;
      let at = 0;
      for (let i = 0; i < n; i++) {
        steps.push({
          at,
          run: () => {
            const a = angleTo(m, t);
            m.aim = a;
            ctx.tele(m.x, m.y, 12, 0.5, 1, a, 170);
          },
        });
        steps.push({ at: at + 0.5, run: () => dashAt(ctx, m, m.aim, 270, 0.45, scaled(m, 22)) });
        at += 1.1;
      }
      return script(ctx, steps, true, at + 0.3);
    },
    (ctx, m) => {
      ctx.tele(m.x, m.y, 16, 0.9, 0);
      return script(
        ctx,
        [
          {
            at: 0.9,
            run: () => {
              const n = m.phase >= 2 ? 4 : 3;
              for (let i = 0; i < n; i++) {
                const s = around(ctx, m, m.x, m.y, 60);
                ctx.spawn(MOB.perro, s.x, s.y, m.room, m);
              }
              ctx.hazard({
                x: m.x,
                y: m.y,
                r: 8,
                kind: HAZARD.onda,
                dmg: scaled(m, 14),
                delay: 0,
                life: 1.1,
                owner: m,
              });
            },
          },
        ],
        true,
        1.6,
      );
    },
    (ctx, m) => {
      ctx.tele(m.x, m.y, 48, 0.85, 0);
      return script(
        ctx,
        [
          {
            at: 0.85,
            run: () => {
              for (const p of ctx.players())
                if (p.alive && dist(m.x, m.y, p.x, p.y) <= 48) {
                  ctx.hit(p, scaled(m, 26), m);
                  ctx.push(p, m.x, m.y, 36);
                }
              ring(ctx, m, 10, ctx.rng.range(0, TAU), HOSTILE_SHOT.chispa, scaled(m, 9), 105);
            },
          },
        ],
        true,
        1.4,
      );
    },
  ],
  // ---- El Zorro Espectral
  [MOB.zorroEspectral]: [
    (ctx, m, t) => {
      const behind = {
        x: t.x - Math.cos(angleTo(m, t)) * 30,
        y: t.y - Math.sin(angleTo(m, t)) * 30,
      };
      const spot = around(ctx, m, behind.x, behind.y, 4);
      m.invuln = ctx.time + 0.45;
      return script(
        ctx,
        [
          {
            at: 0.45,
            run: () => {
              m.x = spot.x;
              m.y = spot.y;
              m.aim = angleTo(m, t);
              ctx.tele(m.x, m.y, 34, 0.55, 0);
            },
          },
          {
            at: 1.0,
            run: () => {
              for (const p of ctx.players())
                if (p.alive && dist(m.x, m.y, p.x, p.y) <= 34) ctx.hit(p, scaled(m, 20), m);
              fan(ctx, m, m.aim, 5, 1.0, HOSTILE_SHOT.fuego, scaled(m, 10), 130, 260);
            },
          },
        ],
        true,
        1.5,
      );
    },
    (ctx, m, t) => {
      const steps: Step[] = [];
      const n = m.phase >= 2 ? 5 : 4;
      for (let i = 0; i < n; i++)
        steps.push({
          at: 0.4 + i * 0.4,
          run: () => {
            const a = angleTo(m, t);
            m.aim = a;
            fan(
              ctx,
              m,
              a + (i % 2 ? 0.14 : -0.14),
              7,
              1.2,
              HOSTILE_SHOT.fuego,
              scaled(m, 9),
              125,
              300,
            );
          },
        });
      return script(ctx, steps, false, 0.4 + n * 0.4 + 0.4);
    },
    (ctx, m) => {
      m.invuln = ctx.time + 0.4;
      const spots = Array.from({ length: 3 + (m.hard >= 2 ? 1 : 0) }, () =>
        around(ctx, m, m.x, m.y, 70),
      );
      for (const s of spots) ctx.tele(s.x, s.y, 12, 0.7, 0);
      const away = around(ctx, m, m.x, m.y, 90);
      return script(
        ctx,
        [
          {
            at: 0.7,
            run: () => {
              spots.forEach((s) => ctx.spawn(MOB.clon, s.x, s.y, m.room, m));
              m.x = away.x;
              m.y = away.y;
            },
          },
        ],
        true,
        1.3,
      );
    },
  ],
  // ---- El Rey Gato de las Sombras
  [MOB.reyGato]: [
    (ctx, m, t) => {
      const steps: Step[] = [];
      const n = m.phase >= 3 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        steps.push({
          at: i * 0.75,
          run: () => {
            const a = angleTo(m, t);
            m.aim = a;
            ctx.tele(m.x + Math.cos(a) * 30, m.y + Math.sin(a) * 30, 34, 0.4, 0);
          },
        });
        steps.push({
          at: i * 0.75 + 0.4,
          run: () => {
            const cx = m.x + Math.cos(m.aim) * 30;
            const cy = m.y + Math.sin(m.aim) * 30;
            move(ctx, m, Math.cos(m.aim) * 26, Math.sin(m.aim) * 26);
            for (const p of ctx.players())
              if (p.alive && dist(cx, cy, p.x, p.y) <= 36) {
                ctx.hit(p, scaled(m, 24), m);
                ctx.push(p, m.x, m.y, 16);
              }
          },
        });
      }
      return script(ctx, steps, true, n * 0.75 + 0.3);
    },
    (ctx, m) => {
      const steps: Step[] = [];
      const waves = m.phase >= 2 ? 3 : 2;
      for (let i = 0; i < waves; i++)
        steps.push({
          at: 0.5 + i * 0.7,
          run: () =>
            ring(
              ctx,
              m,
              m.phase >= 3 ? 16 : 12,
              i * 0.3,
              HOSTILE_SHOT.orbe,
              scaled(m, 11),
              95,
              300,
            ),
        });
      ctx.tele(m.x, m.y, 26, 0.5, 0);
      return script(ctx, steps, true, 0.5 + waves * 0.7 + 0.4);
    },
    (ctx, m) => {
      const n = (m.phase >= 2 ? 4 : 3) + (m.hard >= 1 ? 1 : 0);
      const spots = Array.from({ length: n }, () => around(ctx, m, m.x, m.y, 80));
      for (const s of spots) ctx.tele(s.x, s.y, 12, 0.8, 0);
      return script(
        ctx,
        [{ at: 0.8, run: () => spots.forEach((s) => ctx.spawn(MOB.sombra, s.x, s.y, m.room, m)) }],
        true,
        1.3,
      );
    },
    (ctx, m) => {
      // lluvia de meteoros de sombra: solo desde la segunda fase
      const spots = ctx
        .players()
        .filter((p) => p.alive)
        .flatMap((p) => [
          { x: p.x, y: p.y },
          { x: p.x + ctx.rng.range(-50, 50), y: p.y + ctx.rng.range(-50, 50) },
        ]);
      const n = m.phase >= 3 ? 7 : 5;
      const picks = spots.slice(0, n);
      while (picks.length < n) picks.push(around(ctx, m, m.x, m.y, 90));
      picks.forEach((s, i) => ctx.tele(s.x, s.y, 28, 1 + i * 0.15, 0));
      return script(
        ctx,
        picks.map((s, i) => ({
          at: 1 + i * 0.15,
          run: () => {
            ctx.hazard({
              x: s.x,
              y: s.y,
              r: 28,
              kind: HAZARD.sombra,
              dmg: scaled(m, 26),
              delay: 0,
              life: 0.5,
              owner: m,
            });
          },
        })),
        false,
        1 + n * 0.15 + 0.5,
      );
    },
  ],
};

const BOSS_REACH: Record<number, number> = {
  [MOB.reinaRata]: 90,
  [MOB.buhoAnciano]: 130,
  [MOB.mamaHongo]: 60,
  [MOB.perroGuardian]: 80,
  [MOB.zorroEspectral]: 100,
  [MOB.reyGato]: 100,
};

/** Fase de un jefe segun su vida: 1, 2 (a la mitad) y, el Rey Gato, 3 (a un tercio). */
export function bossPhase(m: Mob): number {
  const f = m.hp / m.maxHp;
  if (m.kind === MOB.reyGato) return f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  return f > 0.5 ? 1 : 2;
}

function boss(ctx: MobCtx, m: Mob, t: Target): void {
  const phase = bossPhase(m);
  if (phase !== m.phase) {
    m.phase = phase;
    m.script = null;
    m.cd = ctx.time + 1.2;
    ctx.bossEvent(m.kind, phase);
  }
  // el salto de un ataque (embestidas)
  if (ctx.time < m.dashUntil) {
    const moved = move(ctx, m, m.dvx * ctx.dt, m.dvy * ctx.dt);
    if (!m.data.dashHit) {
      for (const p of ctx.players())
        if (p.alive && dist(m.x, m.y, p.x, p.y) < m.def.half + 9) {
          m.data.dashHit = 1;
          ctx.hit(p, m.data.dashDmg ?? m.def.dmg, m);
        }
    }
    if (moved < 0.3) m.dashUntil = ctx.time;
  }
  // un ataque en curso
  if (m.script) {
    const s = m.script;
    while (s.i < s.steps.length && ctx.time - s.t0 >= (s.steps[s.i] as Step).at) {
      (s.steps[s.i] as Step).run();
      s.i++;
    }
    if (ctx.time >= s.end) {
      m.script = null;
      const rate = phase >= 2 ? 0.7 : 1;
      const tempo = 1 - 0.07 * m.hard;
      m.cd =
        ctx.time + m.def.cooldown * rate * tempo * (m.kind === MOB.reyGato && phase === 3 ? 0.7 : 1);
    }
    if (m.script?.still) return;
  }
  m.aim = angleTo(m, t);
  const d = dist(m.x, m.y, t.x, t.y);
  const reach = BOSS_REACH[m.kind] ?? 90;
  const speed = m.def.speed * (phase >= 2 ? 1.2 : 1);
  if (m.kind === MOB.buhoAnciano || m.kind === MOB.zorroEspectral) {
    // los que disparan mantienen la distancia
    if (d < reach * 0.7) walk(ctx, m, m.aim + Math.PI, speed);
    else if (d > reach * 1.4) walk(ctx, m, m.aim, speed);
    else walk(ctx, m, m.aim + Math.sin(ctx.time * 0.8) * 1.6, speed * 0.6);
  } else if (d > reach * 0.5) {
    walk(ctx, m, m.aim, speed);
  }
  if (!m.script && ctx.time >= m.cd) {
    const list = BOSS_ATTACKS[m.kind] ?? [];
    if (list.length === 0) return;
    // el meteoro del Rey Gato solo sale en las fases avanzadas
    const pool = m.kind === MOB.reyGato && phase < 2 ? list.slice(0, 3) : list;
    let i = Math.floor(ctx.rng.next() * pool.length);
    if (i === (m.data.last ?? -1) && pool.length > 1) i = (i + 1) % pool.length;
    m.data.last = i;
    m.script = (pool[i] as Attack)(ctx, m, t);
  }
}

// ------------------------------------------------------------------ entrada

/** Un paso de la IA de un enemigo. */
export function thinkMob(ctx: MobCtx, m: Mob): void {
  if (ctx.time < m.born + 0.7) return; // nace con un instante de gracia
  if (ctx.time < m.stunUntil && m.data.st !== 3) return;
  const t = target(ctx, m);
  if (!t) return;
  switch (m.def.behavior) {
    case 'chase':
      chase(ctx, m, t);
      break;
    case 'flit':
      flit(ctx, m, t);
      break;
    case 'shooter':
      shooter(ctx, m, t);
      break;
    case 'charger':
      charger(ctx, m, t);
      break;
    case 'turret':
      turret(ctx, m, t);
      return;
    case 'skirmisher':
      skirmisher(ctx, m, t);
      break;
    case 'brute':
      brute(ctx, m, t);
      break;
    case 'boss':
      boss(ctx, m, t);
      return;
  }
  separate(ctx, m);
}

/** Banderas del enemigo para la instantanea. */
export function mobFlags(m: Mob, time: number): number {
  let f = 0;
  if (m.data.pending === 1 || m.data.st === 1 || (m.script && m.script.i === 0))
    f |= MOB_FLAG.windup;
  if (time < m.hurtUntil) f |= MOB_FLAG.hurt;
  if (m.def.boss) f |= MOB_FLAG.boss;
  if (time < m.stunUntil) f |= MOB_FLAG.stunned;
  if (time < m.dashUntil || m.data.st === 2) f |= MOB_FLAG.dashing;
  if (time < m.invuln) f |= MOB_FLAG.shielded;
  if (m.phase >= 2) f |= MOB_FLAG.phase2;
  if (m.phase >= 3) f |= MOB_FLAG.phase3;
  if (time < m.slowUntil) f |= MOB_FLAG.slowed;
  return f;
}
