import { MOB, MOB_FLAG, type MobDef } from '../../shared/br/adventure';

/**
 * Animacion por codigo de los enemigos: los dibujos solo tienen dos cuadros, asi que el movimiento
 * (pasos con peso, saltitos, vuelo, golpe, embestida y aparicion) se logra deformando y moviendo el
 * dibujo. Esta pieza no dibuja: da la "pose" de cada enemigo en cada cuadro y avisa de lo que pasa.
 */

const TAU = Math.PI * 2;

/** Cosas que pasan en un cuadro y que quien dibuja puede acompanar con particulas y sonido. */
export const MOB_EVENT = {
  /** Recibio un golpe. */
  hit: 1,
  /** Termino de prepararse y ataca (embiste o lanza algo). */
  lunge: 2,
  /** Un paso pesado toca el suelo. */
  stomp: 4,
  /** Acaba de aparecer. */
  spawn: 8,
} as const;

export interface MobPose {
  /** Escala horizontal y vertical del dibujo (anclado a los pies, centrado en x). */
  sx: number;
  sy: number;
  /** Desplazamiento en pixeles. */
  offX: number;
  offY: number;
  /** Cuanto se despega del suelo (para sombra y polvo). */
  lift: number;
  /** Sucesos de este cuadro (MOB_EVENT). */
  events: number;
}

interface Gait {
  /** Duracion de un paso completo (ms). */
  period: number;
  /** Cuanto sube el cuerpo entre paso y paso (px). */
  bob: number;
  /** Cuanto se aplasta al pisar (0 a 0.2). */
  squash: number;
  /** Cuanto flota sobre el suelo (px); 0 si camina. */
  hover: number;
  /** Altura del salto (px); 0 si no salta. */
  hop: number;
  /** Cada paso hace temblar el suelo. */
  stomp: boolean;
  /** Ms de un ciclo de respiracion cuando esta quieto. */
  breathe: number;
}

const FLOATERS: ReadonlySet<number> = new Set([
  MOB.murcielago,
  MOB.buho,
  MOB.buhoAnciano,
  MOB.zorroEspectral,
  MOB.sombra,
]);
const HEAVY: ReadonlySet<number> = new Set([
  MOB.golem,
  MOB.perroGuardian,
  MOB.reyGato,
  MOB.reinaRata,
  MOB.mamaHongo,
]);

/** Como camina cada tipo de enemigo. */
export function gaitOf(def: MobDef): Gait {
  const base: Gait = {
    period: 170,
    bob: 1,
    squash: 0.07,
    hover: 0,
    hop: 0,
    stomp: false,
    breathe: 900,
  };
  if (FLOATERS.has(def.kind)) {
    const big = def.boss === true;
    return {
      ...base,
      period: big ? 900 : 260,
      bob: 0,
      squash: 0.02,
      hover: big ? 4 : def.kind === MOB.murcielago ? 3 : 2,
      breathe: 700,
    };
  }
  switch (def.behavior) {
    case 'charger':
      return { ...base, period: 180, bob: 2, squash: 0.1 };
    case 'turret':
      return { ...base, period: 760, bob: 0, squash: 0.16, hop: 3, breathe: 650 };
    case 'skirmisher':
      return { ...base, period: 150, bob: 1.5, squash: 0.08 };
    case 'brute':
      return { ...base, period: 700, bob: 1, squash: 0.09, stomp: true, breathe: 1200 };
    case 'boss':
      return {
        ...base,
        period: HEAVY.has(def.kind) ? 820 : 520,
        bob: 1.5,
        squash: 0.05,
        stomp: HEAVY.has(def.kind) && def.kind !== MOB.mamaHongo,
        hop: def.kind === MOB.mamaHongo ? 3 : 0,
        breathe: 1100,
      };
    default:
      return base;
  }
}

interface State {
  hp: number;
  windup: boolean;
  windupAt: number;
  lungeAt: number;
  lungeAng: number;
  hitAt: number;
  hitSide: number;
  bornAt: number;
  step: number;
  seen: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const NEUTRAL: MobPose = { sx: 1, sy: 1, offX: 0, offY: 0, lift: 0, events: 0 };

/** Lleva la cuenta de cada enemigo para saber cuando lo golpean, ataca o aparece. */
export class MobAnimator {
  private readonly st = new Map<number, State>();
  private frame = 0;

  /** Llamar una vez por cuadro antes de pedir poses: olvida a los enemigos que ya no estan. */
  beginFrame(): void {
    this.frame++;
  }

  endFrame(): void {
    for (const [id, s] of this.st) if (s.seen !== this.frame) this.st.delete(id);
  }

  get tracked(): number {
    return this.st.size;
  }

  pose(
    m: { id: number; hp: number; flags: number; ang: number },
    def: MobDef,
    now: number,
    moving: boolean,
  ): MobPose {
    let s = this.st.get(m.id);
    let events = 0;
    if (!s) {
      s = {
        hp: m.hp,
        windup: false,
        windupAt: 0,
        lungeAt: -9999,
        lungeAng: m.ang,
        hitAt: -9999,
        hitSide: 1,
        bornAt: now,
        step: 0,
        seen: this.frame,
      };
      this.st.set(m.id, s);
      events |= MOB_EVENT.spawn;
    }
    s.seen = this.frame;
    const gait = gaitOf(def);

    // lo que cambio desde el cuadro anterior
    if (m.hp < s.hp) {
      s.hitAt = now;
      s.hitSide = -s.hitSide;
      events |= MOB_EVENT.hit;
    }
    s.hp = m.hp;
    const windup = (m.flags & MOB_FLAG.windup) !== 0;
    if (windup && !s.windup) s.windupAt = now;
    if (!windup && s.windup) {
      s.lungeAt = now;
      s.lungeAng = m.ang;
      events |= MOB_EVENT.lunge;
    }
    s.windup = windup;

    // paso o respiracion
    let sx = 1;
    let sy = 1;
    let offX = 0;
    let offY = 0;
    let lift = 0;
    const phase = (now / gait.period + m.id * 0.37) % 1;
    if (moving) {
      const c = Math.cos(phase * TAU);
      sx += gait.squash * c;
      sy -= gait.squash * 0.9 * c;
      offY -= gait.bob * Math.abs(Math.sin(phase * Math.PI));
      if (gait.hop > 0) {
        const j = Math.max(0, Math.sin(phase * TAU));
        lift += j * gait.hop;
        sy += j * 0.12;
        sx -= j * 0.08;
      }
      if (gait.stomp) {
        const step = Math.floor((now / gait.period + m.id * 0.37) * 2);
        if (step !== s.step) {
          s.step = step;
          // un paso pesado cada medio ciclo
          if (step % 2 === 0) events |= MOB_EVENT.stomp;
        }
      }
    } else {
      const br = Math.sin(now / gait.breathe + m.id);
      sy += 0.025 * br;
      sx -= 0.012 * br;
    }
    if (gait.hover > 0) {
      const wave = Math.sin(now / (gait.period * 0.5) + m.id);
      lift += gait.hover + wave * gait.hover * 0.6;
      offY -= gait.hover + wave * gait.hover * 0.6;
    }

    // prepara el golpe: se encoge y echa el cuerpo hacia atras
    if (windup) {
      const ramp = clamp((now - s.windupAt) / 220, 0, 1);
      sy *= 1 - 0.14 * ramp;
      sx *= 1 + 0.1 * ramp;
      offX -= Math.cos(m.ang) * 2 * ramp;
      if (gait.hover > 0) offY -= 2 * ramp;
    }
    // y suelta la embestida o el lanzamiento
    const k = clamp(1 - (now - s.lungeAt) / 200, 0, 1);
    if (k > 0) {
      offX += Math.cos(s.lungeAng) * 5 * k * k;
      offY += Math.sin(s.lungeAng) * 2.5 * k * k;
      sx *= 1 + 0.16 * k;
      sy *= 1 - 0.12 * k;
    }
    // golpe recibido: se aplasta de lado y rebota
    const h = clamp(1 - (now - s.hitAt) / 190, 0, 1);
    if (h > 0) {
      sx *= 1 + 0.18 * h;
      sy *= 1 - 0.16 * h;
      offX += s.hitSide * 1.5 * h;
    }
    if ((m.flags & MOB_FLAG.dashing) !== 0) {
      sx *= 1.14;
      sy *= 0.9;
    }
    if ((m.flags & MOB_FLAG.stunned) !== 0) offX += Math.sin(now / 55) * 1.2;
    // aparece creciendo desde el suelo
    const born = clamp((now - s.bornAt) / 280, 0, 1);
    if (born < 1) {
      const e = 1 + 2.2 * (born - 1) ** 3 + 1.2 * (born - 1) ** 2;
      const grow = clamp(0.3 + 0.7 * e, 0.3, 1.12);
      sx *= grow;
      sy *= grow;
    }
    return {
      sx: clamp(sx, 0.3, 1.5),
      sy: clamp(sy, 0.3, 1.5),
      offX,
      offY,
      lift,
      events,
    };
  }
}

export const NEUTRAL_POSE: MobPose = NEUTRAL;
