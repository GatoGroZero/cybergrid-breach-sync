export const TILE = 32;
export const MAP_W = 64;
export const MAP_H = 40;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_PLAYERS = 4;
export const MATCH_SECONDS = 300;

export const VIEW_W = 960;
export const VIEW_H = 540;

export const PLAYER = {
  radius: 10,
  speed: 190,
  maxHp: 100,
  respawns: 2,
  respawnDelay: 6,
  invulnSeconds: 2.5,
  fireCooldown: 0.28,
  projectileSpeed: 540,
  projectileLife: 0.8,
  projectileRadius: 4,
  baseDamage: 18,
  damagePerLevel: 4,
} as const;

export const BOOST = { speedMul: 1.35, seconds: 6 } as const;
export const NODE = {
  radius: 42,
  captureSeconds: 4,
  decaySeconds: 8,
  count: 3,
  healOnBreach: 25,
} as const;
export const EXIT = { radius: 58, syncSeconds: 3 } as const;
export const ITEMS = {
  slots: 3,
  patchHeal: 35,
  empRadius: 170,
  empStun: 3,
  empDamage: 25,
  pickupRadius: 18,
  lifetime: 20,
} as const;

export const ITEM_KINDS = ['patch', 'overclock', 'emp'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const DRONE_KINDS = ['crawler', 'spitter', 'brute'] as const;
export type DroneKind = (typeof DRONE_KINDS)[number];

export const STATUS = { dead: 1, boosted: 2, invuln: 4, disconnected: 8 } as const;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
