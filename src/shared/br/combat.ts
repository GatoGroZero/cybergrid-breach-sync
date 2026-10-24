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

export const HEAL = {
  medkit: { stat: 'hp', perSecond: 10 },
  shield: { stat: 'shield', perSecond: 5 },
} as const;

export type HealKind = keyof typeof HEAL;

/** Cuanto falta por curar con ese objeto. Si es 0 no tiene sentido empezar a usarlo. */
export function healMissing(kind: HealKind, v: Vitals): number {
  return kind === 'medkit' ? CAT.maxHp - v.hp : CAT.maxShield - v.shield;
}

/** Un segundo de curacion: +10 de vida o +5 de escudo, sin pasar de 100. */
export function healStep(kind: HealKind, v: Vitals): Vitals & { done: boolean } {
  const rule = HEAL[kind];
  if (rule.stat === 'hp') {
    const hp = Math.min(CAT.maxHp, v.hp + rule.perSecond);
    return { hp, shield: v.shield, done: hp >= CAT.maxHp };
  }
  const shield = Math.min(CAT.maxShield, v.shield + rule.perSecond);
  return { hp: v.hp, shield, done: shield >= CAT.maxShield };
}

/** Segundos que tardara en completarse el uso, util para la animacion y los avisos. */
export function healDuration(kind: HealKind, v: Vitals): number {
  const missing = healMissing(kind, v);
  return missing <= 0 ? 0 : Math.ceil(missing / HEAL[kind].perSecond);
}

/** Daño de una explosion: completo en el centro y baja linealmente hasta 40 % en el borde. */
export function splashDamage(base: number, distance: number, radius: number): number {
  if (distance >= radius || radius <= 0) return 0;
  const k = 1 - 0.6 * (distance / radius);
  return Math.max(1, Math.round(base * k));
}
