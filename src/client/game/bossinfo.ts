import { MOB } from '../../shared/br/adventure';

/** Colores de la luz de cada jefe (aura del suelo y titulo de su presentacion). */
export const BOSS_AURA: Record<number, string> = {
  [MOB.reinaRata]: '#ffcd75',
  [MOB.buhoAnciano]: '#73c9ff',
  [MOB.mamaHongo]: '#ff7ab6',
  [MOB.perroGuardian]: '#ff7a3a',
  [MOB.zorroEspectral]: '#73b3ff',
  [MOB.reyGato]: '#b794f4',
};

/** La frase que acompana al nombre de cada jefe cuando se presenta. */
export const BOSS_EPITHET: Record<number, string> = {
  [MOB.reinaRata]: 'Soberana de las alcantarillas',
  [MOB.buhoAnciano]: 'El vigía de las mil noches',
  [MOB.mamaHongo]: 'Madre del bosque podrido',
  [MOB.perroGuardian]: 'Nadie cruza sin su permiso',
  [MOB.zorroEspectral]: 'La sombra que corre entre los pinos',
  [MOB.reyGato]: 'El que apaga la luna',
};

/** Segundos desde que empieza la presentacion hasta que el enfoque llega al jefe y hasta que sale su nombre. */
export const INTRO_PAN_S = 0.8;
export const INTRO_NAME_AT = 1.2;
export const INTRO_OUT_S = 0.6;

const ease = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * Cuanto esta enfocado el jefe (0 a 1): la camara va hacia el en el primer momento y regresa con el
 * grupo en los ultimos segundos, justo antes de que empiece la pelea.
 */
export function introFocus(elapsed: number, left: number): number {
  return ease(elapsed / INTRO_PAN_S) * ease(left / INTRO_OUT_S);
}

/** El acercamiento de la camara (1 = normal) con el enfoque dado. */
export const introZoom = (focus: number): number => 1 + 0.7 * focus;
