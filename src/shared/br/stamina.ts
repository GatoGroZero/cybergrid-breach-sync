/** Estamina para correr. La usan igual el servidor y el cliente (prediccion). */
export const STAMINA = {
  max: 100,
  /** Velocidad al correr, en veces la de caminar. */
  runMultiplier: 1.55,
  /** Correr gasta toda la barra en 5 segundos. */
  drainPerS: 20,
  /** Quieto o caminando, la barra se llena en 4 segundos. */
  regenPerS: 25,
  /** Si se agota, hace falta recuperar este valor para volver a correr. */
  resumeAt: 25,
  /** Vector de movimiento minimo para contar como "moverse". */
  minMove: 0.2,
} as const;

export interface StaminaState {
  value: number;
  /** Se quedo sin aire: no puede correr hasta llegar a `resumeAt`. */
  tired: boolean;
}

export const fullStamina = (): StaminaState => ({ value: STAMINA.max, tired: false });

/**
 * Un paso. Corre solo quien lo pide, se mueve y tiene aire. Mientras corre la barra baja y NO se
 * recupera; si se suelta la carrera (quieto o caminando) se recupera, y si a media recuperacion
 * se vuelve a correr, la recuperacion se detiene ahi. Devuelve si el gato corre en este paso.
 */
export function stepStamina(
  s: StaminaState,
  wantsRun: boolean,
  moveLen: number,
  dt: number,
): boolean {
  const moving = moveLen > STAMINA.minMove;
  const running = wantsRun && moving && s.value > 0 && !s.tired;
  if (running) {
    s.value = Math.max(0, s.value - STAMINA.drainPerS * dt);
    if (s.value <= 0) s.tired = true;
  } else {
    s.value = Math.min(STAMINA.max, s.value + STAMINA.regenPerS * dt);
    if (s.tired && s.value >= STAMINA.resumeAt) s.tired = false;
  }
  return running;
}
