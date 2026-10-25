/** Constantes del Battle Royale. Todo el mundo vive en "mini pixeles": 1 unidad = 1 pixel nativo. */
export const TILE = 16;
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export const MAX_PLAYERS = 12;
export const INVENTORY_SLOTS = 5;
/** Maximo de balas de cada arma. Las balas no ocupan los 5 espacios: van en su propio compartimento. */
export const AMMO_MAX = 120;

/** Los primeros segundos nadie puede hacerse dano: da tiempo de ubicarse y buscar el primer cofre. */
export const SPAWN_GRACE_S = 10;

export const CAT = {
  /** Velocidad en pixeles por segundo. */
  speed: 78,
  /** Mitad del lado de la caja de colision (10x10 en los pies). */
  half: 5,
  maxHp: 100,
  maxShield: 100,
  startShield: 0,
  interactRange: 26,
  /** Un gato solo puede avanzar un paso por tick (con 5 % de holgura y rafagas de 5). */
  budgetSlack: 1.05,
  budgetBurst: 5,
} as const;

export const NATIVE_VIEW_H = 270;

export const WALL_ITEM = {
  hp: 150,
  placeDistance: 22,
} as const;

export const WATER = {
  /** Cada vez que pasa este tiempo dentro del agua se reciben `damage` puntos. */
  tick: 0.5,
  damage: 5,
} as const;

/** Distancia (en pixeles) a la que el servidor envia entidades a cada cliente. */
export const INTEREST_RADIUS = 560;

export const SKIN_W = 24;
export const SKIN_H = 16;
export const SKIN_CELLS = SKIN_W * SKIN_H;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** Flags de estado enviados con cada gato. */
export const FLAG = {
  dead: 1,
  healing: 2,
  moving: 4,
  hurt: 8,
  disconnected: 16,
  bot: 32,
  running: 64,
  /** Pertenece al equipo 1 (azul) en los modos por equipos. */
  team1: 128,
} as const;
