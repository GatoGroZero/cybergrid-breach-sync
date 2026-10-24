import { CAT } from './constants';

export interface Vitals {
  hp: number;
  shield: number;
}

/** El escudo absorbe primero; lo que sobra pasa a la vida. Nunca devuelve valores negativos. */
export function applyDamage(v: Vitals, damage: number): Vitals & { dealt: number } {
  const dmg = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  const absorbed = Math.min(v.shield, dmg);
  const rest = dmg - absorbed;
  const hp = Math.max(0, v.hp - rest);
  return { hp, shield: v.shield - absorbed, dealt: absorbed + (v.hp - hp) };
}

/**
 * El botiquin cura 10 de vida por segundo hasta llenar la barra. Cada escudo da 10 por segundo
 * durante 5 segundos (50 puntos), asi que con dos se llena la barra.
 */
export const HEAL = {
  medkit: { stat: 'hp', perSecond: 10, total: 100 },
  shield: { stat: 'shield', perSecond: 10, total: 50 },
} as const;

export type HealKind = keyof typeof HEAL;

const current = (kind: HealKind, v: Vitals): number => (kind === 'medkit' ? v.hp : v.shield);
const capOf = (kind: HealKind): number => (kind === 'medkit' ? CAT.maxHp : CAT.maxShield);

/** Cuanto puede curar todavia un objeto nuevo. Si es 0 no tiene sentido empezar a usarlo. */
export function healMissing(kind: HealKind, v: Vitals): number {
  return Math.min(capOf(kind) - current(kind, v), HEAL[kind].total);
}

/** Un segundo de curacion. `left` es lo que le queda al objeto en uso. */
export function healStep(
  kind: HealKind,
  v: Vitals,
  left: number = HEAL[kind].total,
): Vitals & { done: boolean; left: number } {
  const rule = HEAL[kind];
  const give = Math.max(0, Math.min(rule.perSecond, left, capOf(kind) - current(kind, v)));
  const next = current(kind, v) + give;
  const rest = left - give;
  return {
    hp: kind === 'medkit' ? next : v.hp,
    shield: kind === 'shield' ? next : v.shield,
    done: next >= capOf(kind) || rest <= 0,
    left: rest,
  };
}

/** Segundos que faltan para terminar el uso, util para la barra y los avisos. */
export function healSecondsLeft(kind: HealKind, v: Vitals, left: number): number {
  const missing = Math.min(capOf(kind) - current(kind, v), left);
  return missing <= 0 ? 0 : Math.ceil(missing / HEAL[kind].perSecond);
}

/** Segundos que tardara en completarse el uso de un objeto nuevo. */
export function healDuration(kind: HealKind, v: Vitals): number {
  return healSecondsLeft(kind, v, HEAL[kind].total);
}

/** Daño de una explosion: completo en el centro y baja linealmente hasta 40 % en el borde. */
export function splashDamage(base: number, distance: number, radius: number): number {
  if (distance >= radius || radius <= 0) return 0;
  const k = 1 - 0.6 * (distance / radius);
  return Math.max(1, Math.round(base * k));
}
