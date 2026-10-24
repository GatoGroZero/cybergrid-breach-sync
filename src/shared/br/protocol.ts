import { z } from 'zod';
import { INVENTORY_SLOTS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SKIN_CELLS } from './constants';
import { AMMO_KINDS } from './items';
import { BASE_COATS } from './skin';
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
export const spectateSchema = z.object({ dir: z.union([z.literal(1), z.literal(-1)]) });

export const skinSchema = z.object({
  base: z
    .number()
    .int()
    .min(0)
    .max(BASE_COATS.length - 1),
  paint: z.string().regex(new RegExp(`^[0-9a-f]{${SKIN_CELLS}}$`)),
});

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(24).optional(),
  isPrivate: z.boolean().default(false),
  map: z.enum(['bosque', 'casa', 'piscina', 'azar']).default('azar'),
});

const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
export const joinRoomSchema = z.object({
  code: z.string().trim().toUpperCase().regex(roomCodePattern, 'Código de sala inválido'),
});

export const readySchema = z.object({ ready: z.boolean() });

export type Credentials = z.infer<typeof credentialsSchema>;
export type InputPayload = z.infer<typeof inputSchema>;
export type CreateRoomPayload = z.infer<typeof createRoomSchema>;

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
  skin: { base: number; paint: string };
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

export interface RoomState {
  code: string;
  name: string;
  isPrivate: boolean;
  phase: RoomPhase;
  map: string;
  maxPlayers: number;
  members: RoomMember[];
  countdown: number;
}

export interface PublicRoom {
  code: string;
  name: string;
  players: number;
  maxPlayers: number;
  phase: RoomPhase;
  map: string;
}

export interface CatInfo {
  id: number;
  name: string;
  bot: boolean;
  skin: { base: number; paint: string };
}

export interface GameStartPayload {
  seed: number;
  map: string;
  you: number;
  cats: CatInfo[];
  tickHz: number;
}

export interface WinPayload {
  winnerId: number | null;
  winnerName: string | null;
}

export interface PlacementRow {
  id: number;
  name: string;
  bot: boolean;
  placement: number;
  kills: number;
  survivalS: number;
  damageDealt: number;
}

export interface GameEndPayload {
  winnerId: number | null;
  /** True si quien gano es un humano. */
  humanWon: boolean;
  durationS: number;
  rows: PlacementRow[];
}

export interface DiedPayload {
  placement: number;
  killerName: string | null;
  kills: number;
  survivalS: number;
}

export interface LootContents {
  id: number;
  kind: 'chest' | 'golden' | 'tomb' | 'drop';
  title: string;
  items: Item[];
}

export type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
