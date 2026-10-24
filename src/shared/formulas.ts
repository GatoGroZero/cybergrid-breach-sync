import { PLAYER, type DroneKind, type ItemKind } from './constants';
import { clamp } from './physics';

export interface DroneStats {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  armor: number;
  fireInterval: number;
}

const BASE: Record<DroneKind, DroneStats> = {
  crawler: { hp: 36, speed: 125, damage: 7, radius: 9, armor: 0, fireInterval: 0 },
  spitter: { hp: 28, speed: 85, damage: 7, radius: 9, armor: 0, fireInterval: 2.1 },
  brute: { hp: 150, speed: 70, damage: 16, radius: 15, armor: 20, fireInterval: 0 },
};

/** Cada jugador extra sube 35 % la vida de los drones. */
export function playerCountFactor(players: number): number {
  return 1 + 0.35 * (clamp(Math.floor(players), 1, 4) - 1);
}

/** Escalado lineal por oleada: base * (1 + porOleada * oleada). Nunca baja de la base. */
export function scaleByWave(base: number, wave: number, perWave: number): number {
  return base * (1 + perWave * Math.max(0, wave));
}

export function droneStats(kind: DroneKind, wave: number, players: number): DroneStats {
  const base = BASE[kind];
  return {
    hp: Math.round(scaleByWave(base.hp, wave, 0.18) * playerCountFactor(players)),
    damage: Math.round(scaleByWave(base.damage, wave, 0.1) * 10) / 10,
    speed: Math.min(base.speed * 1.35, scaleByWave(base.speed, wave, 0.015)),
    radius: base.radius,
    armor: base.armor,
    fireInterval: base.fireInterval,
  };
}

/** Reduccion por armadura con rendimientos decrecientes. Un golpe siempre hace al menos 1. */
export function mitigate(damage: number, armor: number): number {
  const a = Math.max(0, Number.isFinite(armor) ? armor : 0);
  const d = Number.isFinite(damage) ? damage : 0;
  return Math.max(1, (d * 100) / (100 + a));
}

/** Dano del pulso segun el nivel del arma (sube un nivel por nodo abierto, hasta 5). */
export function pulseDamage(weaponLevel: number): number {
  return PLAYER.baseDamage + PLAYER.damagePerLevel * clamp(Math.floor(weaponLevel), 0, 5);
}

export function waveAt(elapsedSeconds: number, nodesBreached: number): number {
  return Math.floor(Math.max(0, elapsedSeconds) / 40) + Math.max(0, Math.floor(nodesBreached));
}

export function spawnInterval(wave: number, players: number): number {
  return Math.max(0.8, (4.4 - 0.2 * Math.max(0, wave)) / Math.sqrt(playerCountFactor(players)));
}

export function maxDrones(wave: number, players: number): number {
  const p = clamp(Math.floor(players), 1, 4);
  return Math.min(40, 6 + 2 * Math.max(0, wave) + 4 * (p - 1));
}

/** Elige el tipo de dron segun la oleada. `roll` va de 0 a 1. */
export function pickDroneKind(wave: number, roll: number): DroneKind {
  const w = Math.max(0, wave);
  const weights: [DroneKind, number][] = [
    ['crawler', 1],
    ['spitter', w >= 1 ? 0.45 + 0.05 * w : 0],
    ['brute', w >= 3 ? 0.12 + 0.03 * (w - 3) : 0],
  ];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let acc = 0;
  const target = clamp(roll, 0, 0.999999) * total;
  for (const [kind, weight] of weights) {
    acc += weight;
    if (target < acc) return kind;
  }
  return 'crawler';
}

export function dropChance(kind: DroneKind): number {
  return kind === 'brute' ? 0.55 : kind === 'spitter' ? 0.2 : 0.14;
}

export function rollItem(roll: number): ItemKind {
  const r = clamp(roll, 0, 0.999999);
  return r < 0.5 ? 'patch' : r < 0.8 ? 'overclock' : 'emp';
}
