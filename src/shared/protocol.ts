import { z } from 'zod';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants';

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(USERNAME_PATTERN, 'El usuario debe tener de 3 a 20 letras, numeros o guion bajo'),
  password: z
    .string()
    .min(PASSWORD_MIN, `La contrasena debe tener al menos ${PASSWORD_MIN} caracteres`)
    .max(PASSWORD_MAX, `La contrasena no puede pasar de ${PASSWORD_MAX} caracteres`),
});

export const pingSchema = z.object({
  t: z.number(),
  rtt: z.number().min(0).max(60_000).optional(),
});

/** Lo unico que el cliente le dice al servidor del juego: intencion, nunca posicion ni dano. */
export const inputSchema = z.object({
  seq: z.number().int().min(0).max(2_000_000_000),
  mx: z.number().min(-1).max(1),
  my: z.number().min(-1).max(1),
  aim: z.number().min(-10).max(10),
  auto: z.boolean(),
  fire: z.boolean(),
});

export const useItemSchema = z.object({ slot: z.number().int().min(0).max(2) });

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(24).optional(),
  isPrivate: z.boolean().default(false),
});

const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
export const joinRoomSchema = z.object({
  code: z.string().trim().toUpperCase().regex(roomCodePattern, 'Codigo de sala invalido'),
});

export const readySchema = z.object({ ready: z.boolean() });

export type Credentials = z.infer<typeof credentialsSchema>;
export type PingPayload = z.infer<typeof pingSchema>;
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
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

export interface RoomState {
  code: string;
  name: string;
  isPrivate: boolean;
  phase: RoomPhase;
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
}

export interface GamePlayerInfo {
  id: number;
  name: string;
  color: number;
}

export interface GameStartPayload {
  seed: number;
  you: number;
  players: GamePlayerInfo[];
  matchSeconds: number;
  tickHz: number;
}

export interface PlayerResult {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  survivalS: number;
  survived: boolean;
}

export interface GameEndPayload {
  result: 'win' | 'loss';
  reason: 'sync' | 'wipe' | 'timeout';
  durationS: number;
  wave: number;
  players: PlayerResult[];
}

export type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
