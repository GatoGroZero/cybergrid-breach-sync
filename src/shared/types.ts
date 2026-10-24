/**
 * Formato de las instantaneas que el servidor difunde. Las entidades viajan como tuplas de numeros
 * para ahorrar ancho de banda; el cliente las convierte en objetos al recibirlas.
 */

/** [id, x, y, hp, angulo, estado (mascara STATUS), respaldos restantes, segundos para reaparecer x10] */
export type PlayerTuple = [number, number, number, number, number, number, number, number];
/** [id, tipo (indice de DRONE_KINDS), x, y, vida en %, aturdido 0/1] */
export type DroneTuple = [number, number, number, number, number, number];
/** [id, x, y, dueno (0 = enemigo, si no id del jugador)] */
export type ProjectileTuple = [number, number, number, number];
/** [id, objeto (indice de ITEM_KINDS), x, y] */
export type PickupTuple = [number, number, number, number];
/** [progreso en %, abierto 0/1] */
export type NodeTuple = [number, number];

export type GameEvent =
  | { e: 'hit'; x: number; y: number; v: number; on: 'd' | 'p' }
  | { e: 'kill'; x: number; y: number; k: number; by: number }
  | { e: 'shot'; x: number; y: number; a: number; by: number }
  | { e: 'pickup'; x: number; y: number; it: number; by: number }
  | { e: 'use'; x: number; y: number; it: number; by: number }
  | { e: 'node'; i: number }
  | { e: 'death'; id: number; x: number; y: number }
  | { e: 'respawn'; id: number; x: number; y: number }
  | { e: 'wave'; w: number }
  | { e: 'exit' };

export interface Snapshot {
  /** Milisegundos desde que arranco la partida, segun el reloj del servidor. */
  t: number;
  tick: number;
  /** Ultimo numero de input procesado por jugador, para reconciliar la prediccion. */
  ack: Record<number, number>;
  pl: PlayerTuple[];
  dr: DroneTuple[];
  pj: ProjectileTuple[];
  pk: PickupTuple[];
  nd: NodeTuple[];
  /** [salida abierta 0/1, progreso de sincronizacion en %] */
  ex: [number, number];
  /** Inventario por jugador: indice de ITEM_KINDS o -1 si la casilla esta vacia. */
  inv: Record<number, number[]>;
  /** Segundos que quedan, con un decimal. */
  clock: number;
  wave: number;
  /** Nivel del arma del equipo. */
  wl: number;
  ev: GameEvent[];
}
