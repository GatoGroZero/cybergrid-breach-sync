import { z } from 'zod';
import {
  INVENTORY_SLOTS,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SKIN_CELLS,
} from './constants';
import { AMMO_KINDS } from './items';
import { OUTFIT_COUNT } from './outfits';
import {
  DUEL_FORMATS,
  GAME_MODES,
  KIT_IDS,
  TERRITORY_MAX_TEAM,
  TERRITORY_MIN_TEAM,
  type DuelFormat,
  type GameMode,
} from './modes';
import { ALL_MAP_KINDS } from './mapcore';
import { BASE_COATS } from './skin';
import { BOTS_FILL, type BotsSetting } from './rooms';
import type { Item } from './items';

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(USERNAME_PATTERN, 'El usuario debe tener de 3 a 20 letras, números o guion bajo'),
  password: z
    .string()
    .min(PASSWORD_MIN, `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`)
    .max(PASSWORD_MAX, `La contraseña no puede pasar de ${PASSWORD_MAX} caracteres`),
});

export const pingSchema = z.object({
  t: z.number(),
  rtt: z.number().min(0).max(60_000).optional(),
});

/** Lo unico que el cliente le dice al servidor del juego: intencion. Nunca posicion ni daño. */
export const inputSchema = z.object({
  seq: z.number().int().min(0).max(2_000_000_000),
  mx: z.number().min(-1).max(1),
  my: z.number().min(-1).max(1),
  aim: z.number().min(-10).max(10),
  fire: z.boolean(),
  /** Mantener el disparo (joystick de la mira en el movil): las armas de un clic repiten solas. */
  hold: z.boolean().optional(),
  /** Quiere correr (Shift o joystick al maximo). El servidor decide si hay aire. */
  run: z.boolean().optional(),
  /** Aventura: voltereta (el servidor decide si ya se recupero). */
  dash: z.boolean().optional(),
});

const slot = z
  .number()
  .int()
  .min(0)
  .max(INVENTORY_SLOTS - 1);
export const selectSchema = z.object({ slot });
export const moveItemSchema = z.object({ from: slot, to: slot });
export const dropSchema = z.object({ slot });
export const dropAmmoSchema = z.object({
  kind: z.enum(AMMO_KINDS as unknown as [string, ...string[]]),
  qty: z.number().int().min(1).max(100).optional(),
});
export const lootIdSchema = z.object({ id: z.number().int().min(1).max(1_000_000) });
export const lootTakeSchema = z.object({
  id: z.number().int().min(1).max(1_000_000),
  index: z.number().int().min(0).max(63),
  slot: slot.optional(),
});
/** Emotes: 0 risa, 1 llanto, 2 enojo, 3 bandera blanca, 4 paz. */
export const emoteSchema = z.object({ k: z.number().int().min(0).max(4) });
export const spectateSchema = z.object({ dir: z.union([z.literal(1), z.literal(-1)]) });

export const skinSchema = z.object({
  base: z
    .number()
    .int()
    .min(0)
    .max(BASE_COATS.length - 1),
  paint: z.string().regex(new RegExp(`^[0-9a-f]{${SKIN_CELLS}}$`)),
  /** Traje de Halloween: 0 ninguno. Los clientes viejos no lo mandan. */
  outfit: z.number().int().min(0).max(OUTFIT_COUNT).default(0),
});

const roomName = z.string().trim().min(1).max(24);
const roomMap = z.enum([...ALL_MAP_KINDS, 'azar'] as unknown as [string, ...string[]]);
const roomMode = z.enum(GAME_MODES as unknown as [GameMode, ...GameMode[]]);
const roomFormat = z.enum(DUEL_FORMATS as unknown as [DuelFormat, ...DuelFormat[]]);
const roomTeamSize = z.number().int().min(TERRITORY_MIN_TEAM).max(TERRITORY_MAX_TEAM);
/** `'llenar'` completa la partida con bots; un numero (0 a 9) es la cantidad exacta. */
export const botsSchema = z.union([
  z.literal(BOTS_FILL),
  z
    .number()
    .int()
    .min(0)
    .max(MAX_PLAYERS - 1),
]);

export const createRoomSchema = z.object({
  name: roomName.optional(),
  isPrivate: z.boolean().default(false),
  map: roomMap.default('azar'),
  bots: botsSchema.default(BOTS_FILL),
  /** Modo de juego (por omision Battle Royale). */
  mode: roomMode.default('br'),
  /** Pelea en el techo: 1 contra 1 o 2 contra 2. */
  format: roomFormat.default('1v1'),
  /** Territorio: gatos por equipo (1 a 5). */
  teamSize: roomTeamSize.default(TERRITORY_MAX_TEAM),
});

/** El anfitrion cambia lo que quiera de la sala mientras nadie ha empezado. */
export const roomSettingsSchema = z.object({
  name: roomName.optional(),
  isPrivate: z.boolean().optional(),
  map: roomMap.optional(),
  bots: botsSchema.optional(),
  mode: roomMode.optional(),
  format: roomFormat.optional(),
  teamSize: roomTeamSize.optional(),
});

/** Aventura: elegir una de las reliquias que se ofrecen (0 a 2). */
export const relicSchema = z.object({ i: z.number().int().min(0).max(2) });
/** Aventura: mejoras permanentes que trae cada gato (se guardan en su navegador). */
export const metaSchema = z.object({
  vida: z.number().int().min(0).max(5).default(0),
  garras: z.number().int().min(0).max(5).default(0),
  municion: z.number().int().min(0).max(3).default(0),
  botiquin: z.number().int().min(0).max(3).default(0),
  esencia: z.number().int().min(0).max(3).default(0),
  vidas: z.number().int().min(0).max(3).default(0),
  reliquia: z.number().int().min(0).max(2).default(0),
});

/** Cambiarse de equipo antes de que empiece la ronda. */
export const teamSchema = z.object({ team: z.union([z.literal(0), z.literal(1)]) });
/** Elegir kit al empezar cada ronda. */
export const kitSchema = z.object({ kit: z.enum(KIT_IDS as unknown as [string, ...string[]]) });

const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
export const joinRoomSchema = z.object({
  code: z.string().trim().toUpperCase().regex(roomCodePattern, 'Código de sala inválido'),
});

export const readySchema = z.object({ ready: z.boolean() });

export type Credentials = z.infer<typeof credentialsSchema>;
export type InputPayload = z.infer<typeof inputSchema>;
export type CreateRoomPayload = z.infer<typeof createRoomSchema>;
export type RoomSettingsPayload = z.infer<typeof roomSettingsSchema>;

export interface PongPayload {
  t: number;
  ts: number;
}

export interface RoomMember {
  userId: number;
  name: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  skin: { base: number; paint: string; outfit?: number };
  /** Equipo (0 o 1) en los modos por equipos. */
  team?: number;
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

export interface RoomState {
  code: string;
  name: string;
  isPrivate: boolean;
  phase: RoomPhase;
  map: string;
  /** Gatos por partida contando bots. */
  maxPlayers: number;
  /** Personas que caben segun los bots reservados. */
  maxHumans: number;
  /** Ajuste del anfitrion: `'llenar'` o una cantidad exacta. */
  bots: BotsSetting;
  /** Bots que entrarian ahora mismo a la partida. */
  botCount: number;
  /** Hay gatos suficientes para empezar (al menos 2 contando bots). */
  canStart: boolean;
  mode: GameMode;
  format: DuelFormat;
  /** Gatos por equipo en los modos por equipos (0 si no hay equipos). */
  teamSize: number;
  members: RoomMember[];
  countdown: number;
}

export interface PublicRoom {
  code: string;
  name: string;
  host: string;
  /** Personas dentro. */
  players: number;
  /** Personas que caben. */
  maxPlayers: number;
  /** Bots que entrarian ahora mismo. */
  bots: number;
  phase: RoomPhase;
  map: string;
  mode: GameMode;
}

export interface CatInfo {
  id: number;
  name: string;
  bot: boolean;
  skin: { base: number; paint: string; outfit?: number };
  /** Equipo (0 o 1) en los modos por equipos. */
  team?: number;
}

export interface GameStartPayload {
  seed: number;
  map: string;
  /** Modo de juego (si falta es Battle Royale). */
  mode?: GameMode;
  /** Gatos por equipo en los modos por equipos. */
  teamSize?: number;
  you: number;
  cats: CatInfo[];
  tickHz: number;
}

export interface WinPayload {
  winnerId: number | null;
  winnerName: string | null;
  /** Modos por equipos: equipo ganador (0 o 1) y marcador de rondas. */
  winnerTeam?: number | null;
  score?: [number, number];
  /** Aventura: el grupo gano o perdio. */
  adv?: 'victory' | 'defeat';
}

export interface PlacementRow {
  id: number;
  name: string;
  bot: boolean;
  placement: number;
  kills: number;
  survivalS: number;
  damageDealt: number;
  team?: number;
}

export interface GameEndPayload {
  winnerId: number | null;
  /** True si quien gano es un humano. */
  humanWon: boolean;
  durationS: number;
  rows: PlacementRow[];
  /** Modos por equipos: equipo ganador y marcador de rondas. */
  winnerTeam?: number | null;
  score?: [number, number];
  mode?: GameMode;
  /** Aventura: resumen de la partida y la esencia lunar que se gano. */
  adv?: {
    victory: boolean;
    rooms: number;
    totalRooms: number;
    bosses: number;
    kills: number;
    relics: number[];
    essence: Record<number, number>;
  };
}

export interface DiedPayload {
  placement: number;
  killerName: string | null;
  kills: number;
  survivalS: number;
}

export interface LootContents {
  id: number;
  kind: 'chest' | 'golden' | 'ammo' | 'tomb' | 'drop';
  title: string;
  items: Item[];
}

export type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
