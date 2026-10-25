import type { Rng } from '../rng';
import { AMMO_MAX } from './constants';

export const WEAPON_KINDS = ['pistol', 'shotgun', 'sniper', 'bazooka', 'rifle'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

export type AmmoKind = `ammo_${WeaponKind}`;
export const AMMO_KINDS: readonly AmmoKind[] = WEAPON_KINDS.map((w) => `ammo_${w}` as AmmoKind);

export const UTILITY_KINDS = ['medkit', 'shield', 'wall'] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

export type ItemKind = WeaponKind | AmmoKind | UtilityKind;
export const ITEM_KINDS: readonly ItemKind[] = [...WEAPON_KINDS, ...AMMO_KINDS, ...UTILITY_KINDS];

/** 0 comun (gris), 1 normal (verde), 2 epica (morada). */
export type Rarity = 0 | 1 | 2;
export const RARITY_NAMES = ['Común', 'Normal', 'Épica'] as const;
export const RARITY_COLORS = ['#94b0c2', '#38b764', '#b55bf0'] as const;

export interface Item {
  kind: ItemKind;
  qty: number;
  rarity: Rarity;
  /** Solo armas: disparos que quedan cargados. Sin valor significa cargador lleno. */
  mag?: number;
}

export const isWeapon = (kind: ItemKind): kind is WeaponKind =>
  (WEAPON_KINDS as readonly string[]).includes(kind);
export const isAmmo = (kind: ItemKind): kind is AmmoKind => kind.startsWith('ammo_');
export const isConsumable = (kind: ItemKind): boolean => kind === 'medkit' || kind === 'shield';

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  ammo: AmmoKind;
  ammoPerShot: number;
  /** Daño por bala (o por perdigon) segun rareza: comun, normal, epica. */
  damage: readonly [number, number, number];
  pellets: number;
  spread: number;
  cooldown: number;
  speed: number;
  range: number;
  auto: boolean;
  /** Radio de la explosion (solo bazuca). */
  splash: number;
  /** Disparos que caben en el cargador. */
  magazine: number;
  /** Segundos que tarda recargar. */
  reload: number;
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  pistol: {
    kind: 'pistol',
    name: 'Pistola',
    ammo: 'ammo_pistol',
    ammoPerShot: 1,
    damage: [5, 10, 15],
    pellets: 1,
    spread: 0.04,
    cooldown: 0.32,
    speed: 300,
    range: 260,
    auto: false,
    splash: 0,
    magazine: 30,
    reload: 1.6,
  },
  shotgun: {
    kind: 'shotgun',
    name: 'Escopeta',
    ammo: 'ammo_shotgun',
    ammoPerShot: 2,
    damage: [10, 20, 30],
    pellets: 5,
    spread: 0.3,
    cooldown: 0.9,
    speed: 260,
    range: 130,
    auto: false,
    splash: 0,
    magazine: 5,
    reload: 2.2,
  },
  sniper: {
    kind: 'sniper',
    name: 'Sniper',
    ammo: 'ammo_sniper',
    ammoPerShot: 1,
    damage: [40, 70, 80],
    pellets: 1,
    spread: 0,
    cooldown: 1.5,
    speed: 760,
    range: 520,
    auto: false,
    splash: 0,
    magazine: 3,
    reload: 2.4,
  },
  bazooka: {
    kind: 'bazooka',
    name: 'Bazuca',
    ammo: 'ammo_bazooka',
    ammoPerShot: 1,
    damage: [40, 70, 90],
    pellets: 1,
    spread: 0,
    cooldown: 2,
    speed: 235,
    range: 360,
    auto: false,
    splash: 34,
    magazine: 1,
    reload: 2.0,
  },
  rifle: {
    kind: 'rifle',
    name: 'Fusil',
    ammo: 'ammo_rifle',
    ammoPerShot: 1,
    damage: [10, 15, 20],
    pellets: 1,
    spread: 0.07,
    cooldown: 0.18,
    speed: 340,
    range: 320,
    auto: true,
    splash: 0,
    magazine: 30,
    reload: 2.0,
  },
};

/** Ataque de garras cuando no llevas arma: siempre disponible, sin balas. */
export const CLAWS = { damage: 3, cooldown: 0.7, range: 18, wallDamage: 25 } as const;

export const ITEM_NAMES: Record<ItemKind, string> = {
  pistol: 'Pistola',
  shotgun: 'Escopeta',
  sniper: 'Sniper',
  bazooka: 'Bazuca',
  rifle: 'Fusil',
  ammo_pistol: 'Balas de pistola',
  ammo_shotgun: 'Balas de escopeta',
  ammo_sniper: 'Balas de sniper',
  ammo_bazooka: 'Balas de bazuca',
  ammo_rifle: 'Balas de fusil',
  medkit: 'Botiquín',
  shield: 'Escudo',
  wall: 'Mini muro',
};

export const STACK_MAX: Record<ItemKind, number> = {
  pistol: 1,
  shotgun: 1,
  sniper: 1,
  bazooka: 1,
  rifle: 1,
  ammo_pistol: AMMO_MAX,
  ammo_shotgun: AMMO_MAX,
  ammo_sniper: AMMO_MAX,
  ammo_bazooka: AMMO_MAX,
  ammo_rifle: AMMO_MAX,
  medkit: 3,
  shield: 4,
  wall: 5,
};

/** Disparos cargados de un arma (sin dato se cuenta como cargador lleno); 0 si no es un arma. */
export function magOf(item: Item | null | undefined): number {
  if (!item || !isWeapon(item.kind)) return 0;
  const cap = WEAPONS[item.kind].magazine;
  return Math.max(0, Math.min(cap, item.mag ?? cap));
}

/** Balas del compartimento que hacen falta para llenar el cargador de esta arma. */
export function reloadNeed(item: Item): number {
  if (!isWeapon(item.kind)) return 0;
  const def = WEAPONS[item.kind];
  return (def.magazine - magOf(item)) * def.ammoPerShot;
}

export function weaponDamage(kind: WeaponKind, rarity: Rarity): number {
  return WEAPONS[kind].damage[rarity] as number;
}

/** Dos objetos se pueden apilar si son del mismo tipo y no son armas. */
export function canStack(a: Item, b: Item): boolean {
  return a.kind === b.kind && !isWeapon(a.kind) && a.rarity === b.rarity;
}

// ---------------------------------------------------------------- probabilidades del botin

/** Pistolas comunes, escopetas y fusiles raros, sniper y bazuca los mas dificiles. */
export const WEAPON_WEIGHTS: Record<WeaponKind, number> = {
  pistol: 38,
  shotgun: 15,
  rifle: 14,
  sniper: 5,
  bazooka: 4,
};

/** Probabilidad de rareza: comun, normal, epica (cofre normal y cofre dorado). */
export const RARITY_WEIGHTS = {
  normal: [66, 27, 7],
  golden: [30, 44, 26],
} as const;

/** La municion es lo que mas falta en una partida: pesa mas que cualquier otra cosa en los cofres. */
const CATEGORY_WEIGHTS = {
  normal: { weapon: 28, ammo: 42, medkit: 12, shield: 10, wall: 8 },
  golden: { weapon: 38, ammo: 34, medkit: 11, shield: 10, wall: 7 },
} as const;

type ChestTier = 'normal' | 'golden';

function pickWeighted<T extends string>(rng: Rng, table: Record<T, number>): T {
  const entries = Object.entries(table) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1]![0];
}

export function rollRarity(rng: Rng, tier: ChestTier): Rarity {
  const w = RARITY_WEIGHTS[tier];
  const total = w[0] + w[1] + w[2];
  const r = rng.next() * total;
  return r < w[0] ? 0 : r < w[0] + w[1] ? 1 : 2;
}

export function rollWeaponKind(rng: Rng): WeaponKind {
  return pickWeighted(rng, WEAPON_WEIGHTS);
}

export function rollWeapon(rng: Rng, tier: ChestTier): Item {
  const kind = rollWeaponKind(rng);
  // Las armas de un cofre vienen con el cargador lleno.
  return { kind, qty: 1, rarity: rollRarity(rng, tier), mag: WEAPONS[kind].magazine };
}

/** Municion suelta en un cofre. */
const AMMO_QTY: Record<WeaponKind, [number, number]> = {
  pistol: [20, 40],
  shotgun: [8, 16],
  sniper: [5, 10],
  bazooka: [3, 5],
  rifle: [36, 64],
};

/** Municion en una caja de municion: mucho mas, y de varias armas a la vez. */
const CRATE_QTY: Record<WeaponKind, [number, number]> = {
  pistol: [40, 70],
  shotgun: [16, 30],
  sniper: [8, 16],
  bazooka: [4, 8],
  rifle: [60, 100],
};

/** Cuantas clases distintas de municion trae una caja de municion. */
export const CRATE_KINDS = 4;

export function rollAmmo(rng: Rng, weapon: WeaponKind = rollWeaponKind(rng)): Item {
  const [min, max] = AMMO_QTY[weapon];
  return { kind: `ammo_${weapon}`, qty: rng.int(min, max), rarity: 0 };
}

/** Caja de municion: 4 de las 5 clases, sin repetir, con cantidades grandes. */
export function rollAmmoCrate(rng: Rng): Item[] {
  const pool: Record<string, number> = { ...WEAPON_WEIGHTS };
  const items: Item[] = [];
  for (let i = 0; i < CRATE_KINDS; i++) {
    const weapon = pickWeighted(rng, pool) as WeaponKind;
    delete pool[weapon];
    const [min, max] = CRATE_QTY[weapon];
    items.push({ kind: `ammo_${weapon}`, qty: Math.min(AMMO_MAX, rng.int(min, max)), rarity: 0 });
  }
  return items;
}

export function rollItem(rng: Rng, tier: ChestTier): Item {
  const category = pickWeighted(rng, CATEGORY_WEIGHTS[tier]);
  switch (category) {
    case 'weapon':
      return rollWeapon(rng, tier);
    case 'ammo':
      return rollAmmo(rng);
    case 'medkit':
      return { kind: 'medkit', qty: tier === 'golden' && rng.chance(0.4) ? 2 : 1, rarity: 0 };
    case 'shield':
      return { kind: 'shield', qty: tier === 'golden' && rng.chance(0.4) ? 2 : 1, rarity: 0 };
    default:
      return { kind: 'wall', qty: rng.int(2, 4), rarity: 0 };
  }
}

/** Contenido de un cofre: 3 objetos (4 si es dorado) y siempre algo para pelear. */
export function rollChest(rng: Rng, tier: ChestTier): Item[] {
  const count = tier === 'golden' ? 4 : 3;
  const items: Item[] = [];
  for (let i = 0; i < count; i++) items.push(rollItem(rng, tier));
  if (!items.some((it) => isWeapon(it.kind) || isAmmo(it.kind))) {
    items[count - 1] = rng.chance(0.5) ? rollWeapon(rng, tier) : rollAmmo(rng);
  }
  // Un arma sin balas no sirve: casi siempre viene acompanada de las suyas.
  for (const it of [...items]) {
    if (!isWeapon(it.kind) || items.some((o) => o.kind === `ammo_${it.kind}`)) continue;
    if (!rng.chance(0.7)) continue;
    const spare = items.findIndex((o) => !isWeapon(o.kind) && !isAmmo(o.kind));
    if (spare >= 0) items[spare] = rollAmmo(rng, it.kind);
  }
  return items;
}
