import type { Item } from './items';

/** [id, x, y, flags, apuntado en grados, arma en mano (indice de ITEM_KINDS * 3 + rareza, o -1)] */
export type CatTuple = [number, number, number, number, number, number];
/** [id, x, y, tipo (0 bala, 1 perdigon, 2 sniper, 3 misil), angulo en grados] */
export type ShotTuple = [number, number, number, number, number];
/** [id, casillaX, casillaY, vida %] */
export type WallTuple = [number, number, number, number];
/** [id, x, y, tipo (0 cofre, 1 cofre dorado, 2 lapida, 3 objeto tirado), abierto 0/1, objeto tirado (indice de ITEM_KINDS * 3 + rareza) o -1] */
export type ContainerTuple = [number, number, number, number, number, number];

export type BREvent =
  | { e: 'shot'; x: number; y: number; a: number; w: number }
  | { e: 'hit'; x: number; y: number; v: number; kill: boolean }
  | { e: 'boom'; x: number; y: number; r: number }
  | { e: 'wallhit'; x: number; y: number }
  | { e: 'wallbreak'; x: number; y: number }
  | { e: 'place'; x: number; y: number }
  | { e: 'death'; x: number; y: number; id: number }
  | { e: 'open'; x: number; y: number; golden: boolean; ammo?: boolean }
  | { e: 'emote'; x: number; y: number; id: number; k: number }
  | { e: 'splash'; x: number; y: number }
  | { e: 'heal'; x: number; y: number; kind: 'hp' | 'shield' }
  | { e: 'zone'; phase: number; shrinking: boolean }
  | { e: 'claw'; x: number; y: number; a: number };

export interface MeState {
  x: number;
  y: number;
  hp: number;
  shield: number;
  sel: number;
  alive: boolean;
  kills: number;
  /** Segundos que faltan de la curacion en curso, o 0. */
  healLeft: number;
  healKind: 'medkit' | 'shield' | null;
  /** Segundos hasta poder disparar otra vez. */
  cooldown: number;
  /** Aire para correr, de 0 a 100. */
  stamina: number;
  /** Se quedo sin aire: no corre hasta recuperar un poco. */
  tired: boolean;
}

export interface ZoneView {
  phase: number;
  cx: number;
  cy: number;
  r: number;
  shrinking: boolean;
  /** Proxima zona (contorno), o null. */
  nx: number;
  ny: number;
  nr: number;
  dps: number;
  nextIn: number;
}

export interface BRSnapshot {
  /** Milisegundos desde que arranco la partida. */
  t: number;
  tick: number;
  ack: number;
  me: MeState;
  /** Solo viaja cuando cambia. */
  inv?: (Item | null)[];
  /** Balas de cada arma (orden de AMMO_KINDS). Viaja junto con `inv`. */
  ammo?: number[];
  cats: CatTuple[];
  shots: ShotTuple[];
  walls: WallTuple[];
  boxes: ContainerTuple[];
  zone: ZoneView;
  alive: number;
  ev: BREvent[];
  /** A quien se esta viendo cuando ya estas eliminado. */
  spectating?: number;
  /** Eliminaciones nuevas (para el aviso arriba a la izquierda). */
  feed?: { k: string | null; v: string }[];
}
