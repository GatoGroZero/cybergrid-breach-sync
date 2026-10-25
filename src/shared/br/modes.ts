import { AMMO_KINDS, type AmmoKind, type Item } from './items';

/** Modos de juego. Cada sala elige uno. */
export type GameMode = 'br' | 'techo' | 'territorio' | 'aventura';
export const GAME_MODES: readonly GameMode[] = ['br', 'techo', 'territorio', 'aventura'];

export interface ModeInfo {
  id: GameMode;
  name: string;
  /** Una linea para la lista de modos. */
  blurb: string;
  /** Se juega por equipos (dos bandos). */
  teams: boolean;
  /** Personas que caben como maximo. */
  maxHumans: number;
}

export const MODES: Record<GameMode, ModeInfo> = {
  br: {
    id: 'br',
    name: 'Battle Royale',
    blurb: 'Hasta 12 gatos, cofres y una ola que cierra el mapa. Gana el último en pie.',
    teams: false,
    maxHumans: 12,
  },
  techo: {
    id: 'techo',
    name: 'Pelea en el techo',
    blurb: '1 contra 1 o 2 contra 2 sobre un tejado, con un kit a elegir y tormenta. Mejor de 3.',
    teams: true,
    maxHumans: 4,
  },
  territorio: {
    id: 'territorio',
    name: 'Territorio',
    blurb: 'Equipos de hasta 5 contra 5 por las calles y patios. Dominen los patios. Mejor de 3.',
    teams: true,
    maxHumans: 10,
  },
  aventura: {
    id: 'aventura',
    name: 'Aventura',
    blurb: 'De 1 a 4 gatos exploran un bosque encantado, derrotan 5 minijefes y al jefe final.',
    teams: false,
    maxHumans: 4,
  },
};

/** Modos que ya se pueden jugar (los demas salen en la lista pero estan por llegar). */
export const ENABLED_MODES: readonly GameMode[] = ['br', 'techo'];

export const isGameMode = (v: unknown): v is GameMode =>
  typeof v === 'string' && (GAME_MODES as readonly string[]).includes(v);

// ---------------------------------------------------------------- equipos

export type TeamId = 0 | 1;
export const TEAM_NAMES = ['Naranja', 'Azul'] as const;
export const TEAM_COLORS = ['#ef7d57', '#41a6f6'] as const;

/** Formato del modo "Pelea en el techo": gatos por equipo. */
export type DuelFormat = '1v1' | '2v2';
export const DUEL_FORMATS: readonly DuelFormat[] = ['1v1', '2v2'];
export const duelTeamSize = (f: DuelFormat): number => (f === '2v2' ? 2 : 1);

/** Gatos por equipo en "Territorio": de 1 a 5. */
export const TERRITORY_MIN_TEAM = 1;
export const TERRITORY_MAX_TEAM = 5;

/** Rondas que hay que ganar para llevarse la partida (mejor de 3). */
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 3;

// ---------------------------------------------------------------- kits

export type KitId = 'cazador' | 'acechador' | 'vigia' | 'bombardero';

export interface KitStats {
  /** De 1 a 5, para las barritas de la tarjeta. */
  alcance: number;
  dano: number;
  defensa: number;
  area: number;
}

export interface KitDef {
  id: KitId;
  name: string;
  /** Como se juega, en una frase. */
  style: string;
  /** Lo que lleva y como conviene usarlo. */
  blurb: string;
  /** Arma principal (para dibujar el icono de la tarjeta). */
  main: 'rifle' | 'shotgun' | 'sniper' | 'bazooka';
  /** Objetos en los 5 espacios, en orden. */
  items: Item[];
  /** Balas de repuesto de cada arma. */
  ammo: Partial<Record<AmmoKind, number>>;
  stats: KitStats;
}

/**
 * Cuatro kits para que cada persona juegue a su manera y ninguno gane siempre: el Cazador es el mas
 * parejo en distancia media, el Acechador revienta de cerca pero sufre de lejos, el Vigia domina los
 * tiros largos con poco margen de error y el Bombardero castiga a quien se esconde tras un muro.
 */
export const KITS: Record<KitId, KitDef> = {
  cazador: {
    id: 'cazador',
    name: 'Cazador',
    style: 'Distancia media y constante',
    blurb: 'Fusil automático, pistola de respaldo, botiquín, escudo y muros. El más parejo.',
    main: 'rifle',
    items: [
      { kind: 'rifle', qty: 1, rarity: 1 },
      { kind: 'pistol', qty: 1, rarity: 0 },
      { kind: 'medkit', qty: 2, rarity: 0 },
      { kind: 'shield', qty: 1, rarity: 0 },
      { kind: 'wall', qty: 1, rarity: 0 },
    ],
    ammo: { ammo_rifle: 120, ammo_pistol: 60 },
    stats: { alcance: 3, dano: 3, defensa: 3, area: 1 },
  },
  acechador: {
    id: 'acechador',
    name: 'Acechador',
    style: 'Cuerpo a cuerpo y emboscadas',
    blurb: 'Escopeta que revienta de cerca, pistola, escudos y muros para acercarse.',
    main: 'shotgun',
    items: [
      { kind: 'shotgun', qty: 1, rarity: 1 },
      { kind: 'pistol', qty: 1, rarity: 2 },
      { kind: 'shield', qty: 4, rarity: 0 },
      { kind: 'wall', qty: 3, rarity: 0 },
      { kind: 'medkit', qty: 1, rarity: 0 },
    ],
    ammo: { ammo_shotgun: 40, ammo_pistol: 60 },
    stats: { alcance: 1, dano: 5, defensa: 4, area: 2 },
  },
  vigia: {
    id: 'vigia',
    name: 'Vigía',
    style: 'Largo alcance y paciencia',
    blurb: 'Rifle de francotirador, pistola, botiquines y muchos muros para cubrirse.',
    main: 'sniper',
    items: [
      { kind: 'sniper', qty: 1, rarity: 1 },
      { kind: 'pistol', qty: 1, rarity: 0 },
      { kind: 'medkit', qty: 1, rarity: 0 },
      { kind: 'shield', qty: 1, rarity: 0 },
      { kind: 'wall', qty: 3, rarity: 0 },
    ],
    ammo: { ammo_sniper: 18, ammo_pistol: 90 },
    stats: { alcance: 5, dano: 4, defensa: 2, area: 1 },
  },
  bombardero: {
    id: 'bombardero',
    name: 'Bombardero',
    style: 'Control de zona y explosiones',
    blurb:
      'Bazuca con explosión en área, una escopeta recortada para el cuerpo a cuerpo, escudos y botiquines.',
    main: 'bazooka',
    items: [
      { kind: 'bazooka', qty: 1, rarity: 2 },
      { kind: 'shotgun', qty: 1, rarity: 0 },
      { kind: 'shield', qty: 4, rarity: 0 },
      { kind: 'medkit', qty: 3, rarity: 0 },
      { kind: 'wall', qty: 3, rarity: 0 },
    ],
    ammo: { ammo_bazooka: 10, ammo_shotgun: 30 },
    stats: { alcance: 3, dano: 4, defensa: 3, area: 5 },
  },
};

export const KIT_IDS: readonly KitId[] = ['cazador', 'acechador', 'vigia', 'bombardero'];

export const isKitId = (v: unknown): v is KitId =>
  typeof v === 'string' && (KIT_IDS as readonly string[]).includes(v);

/** Cuantas balas de repuesto lleva un kit en total (para pruebas de equilibrio). */
export function kitAmmoTotal(kit: KitDef): number {
  return AMMO_KINDS.reduce((sum, k) => sum + (kit.ammo[k] ?? 0), 0);
}
