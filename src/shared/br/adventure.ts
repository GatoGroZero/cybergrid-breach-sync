import type { Rng } from '../rng';

/**
 * Aventura: un roguelike cooperativo en un bosque encantado. Todo lo que define a los enemigos, los
 * jefes, las reliquias, la armadura y las mejoras entre partidas vive aqui, para que el servidor, el
 * cliente y las pruebas lean los mismos numeros.
 */

/** Vidas que comparte el grupo: cuando un gato cae, vuelve a levantarse mientras queden. */
export const SQUAD_LIVES = 7;
/** Vidas compartidas del grupo: 7 en solitario y 2 mas por cada amigo que se suma. */
export const squadLives = (players: number): number => SQUAD_LIVES + 2 * Math.max(0, players - 1);
/** Segundos que tarda un gato caido en levantarse si quedan vidas. */
export const REVIVE_S = 6;
/** Cuantos minijefes hay antes del jefe final. */
export const MINIBOSSES = 5;
/** Segundos de presentacion del jefe: todos quietos y la camara lo enfoca antes de que empiece la pelea. */
export const BOSS_INTRO_S = 3.6;

// ---------------------------------------------------------------- enemigos

export type MobBehavior =
  'chase' | 'flit' | 'shooter' | 'charger' | 'turret' | 'skirmisher' | 'brute' | 'boss';

export interface MobDef {
  kind: number;
  id: string;
  name: string;
  hp: number;
  speed: number;
  /** Mitad del lado de su caja de colision. */
  half: number;
  /** Dano de su ataque principal. */
  dmg: number;
  behavior: MobBehavior;
  /** Segundos entre ataques. */
  cooldown: number;
  /** Alto del sprite (para barra de vida y sombra). */
  size: number;
  boss?: boolean;
}

/** Codigos de enemigo. Los jefes empiezan en 10 y los invocados en 20. */
export const MOB = {
  rata: 0,
  buho: 1,
  perro: 2,
  hongo: 3,
  murcielago: 4,
  zorro: 5,
  golem: 6,
  reinaRata: 10,
  buhoAnciano: 11,
  mamaHongo: 12,
  perroGuardian: 13,
  zorroEspectral: 14,
  reyGato: 15,
  sombra: 20,
  clon: 21,
} as const;

export const MOB_DEFS: Record<number, MobDef> = {
  [MOB.rata]: {
    kind: MOB.rata,
    id: 'rata',
    name: 'Ratón del bosque',
    hp: 18,
    speed: 74,
    half: 4,
    dmg: 6,
    behavior: 'chase',
    cooldown: 0.9,
    size: 12,
  },
  [MOB.murcielago]: {
    kind: MOB.murcielago,
    id: 'murcielago',
    name: 'Murciélago',
    hp: 12,
    speed: 92,
    half: 4,
    dmg: 5,
    behavior: 'flit',
    cooldown: 0.8,
    size: 10,
  },
  [MOB.buho]: {
    kind: MOB.buho,
    id: 'buho',
    name: 'Búho sombrío',
    hp: 30,
    speed: 46,
    half: 5,
    dmg: 9,
    behavior: 'shooter',
    cooldown: 2.1,
    size: 16,
  },
  [MOB.perro]: {
    kind: MOB.perro,
    id: 'perro',
    name: 'Perro callejero',
    hp: 56,
    speed: 60,
    half: 6,
    dmg: 14,
    behavior: 'charger',
    cooldown: 2.6,
    size: 16,
  },
  [MOB.hongo]: {
    kind: MOB.hongo,
    id: 'hongo',
    name: 'Hongo espora',
    hp: 42,
    speed: 0,
    half: 6,
    dmg: 5,
    behavior: 'turret',
    cooldown: 3.8,
    size: 16,
  },
  [MOB.zorro]: {
    kind: MOB.zorro,
    id: 'zorro',
    name: 'Zorro astuto',
    hp: 40,
    speed: 98,
    half: 5,
    dmg: 10,
    behavior: 'skirmisher',
    cooldown: 1.4,
    size: 14,
  },
  [MOB.golem]: {
    kind: MOB.golem,
    id: 'golem',
    name: 'Guardián de piedra',
    hp: 130,
    speed: 34,
    half: 8,
    dmg: 20,
    behavior: 'brute',
    cooldown: 3.2,
    size: 22,
  },
  [MOB.reinaRata]: {
    kind: MOB.reinaRata,
    id: 'reinaRata',
    name: 'La Reina de los Ratones',
    hp: 520,
    speed: 58,
    half: 10,
    dmg: 16,
    behavior: 'boss',
    cooldown: 2.2,
    size: 30,
    boss: true,
  },
  [MOB.buhoAnciano]: {
    kind: MOB.buhoAnciano,
    id: 'buhoAnciano',
    name: 'El Búho Anciano',
    hp: 640,
    speed: 50,
    half: 11,
    dmg: 14,
    behavior: 'boss',
    cooldown: 2.4,
    size: 34,
    boss: true,
  },
  [MOB.mamaHongo]: {
    kind: MOB.mamaHongo,
    id: 'mamaHongo',
    name: 'Mamá Hongo',
    hp: 820,
    speed: 22,
    half: 13,
    dmg: 14,
    behavior: 'boss',
    cooldown: 2.6,
    size: 38,
    boss: true,
  },
  [MOB.perroGuardian]: {
    kind: MOB.perroGuardian,
    id: 'perroGuardian',
    name: 'El Perro Guardián',
    hp: 940,
    speed: 64,
    half: 12,
    dmg: 22,
    behavior: 'boss',
    cooldown: 2.2,
    size: 36,
    boss: true,
  },
  [MOB.zorroEspectral]: {
    kind: MOB.zorroEspectral,
    id: 'zorroEspectral',
    name: 'El Zorro Espectral',
    hp: 1020,
    speed: 88,
    half: 10,
    dmg: 18,
    behavior: 'boss',
    cooldown: 1.8,
    size: 32,
    boss: true,
  },
  [MOB.reyGato]: {
    kind: MOB.reyGato,
    id: 'reyGato',
    name: 'El Rey Gato de las Sombras',
    hp: 2300,
    speed: 66,
    half: 13,
    dmg: 24,
    behavior: 'boss',
    cooldown: 1.7,
    size: 42,
    boss: true,
  },
  [MOB.sombra]: {
    kind: MOB.sombra,
    id: 'sombra',
    name: 'Sombra',
    hp: 30,
    speed: 80,
    half: 5,
    dmg: 9,
    behavior: 'chase',
    cooldown: 1,
    size: 14,
  },
  [MOB.clon]: {
    kind: MOB.clon,
    id: 'clon',
    name: 'Clon espectral',
    hp: 24,
    speed: 70,
    half: 5,
    dmg: 8,
    behavior: 'shooter',
    cooldown: 1.8,
    size: 14,
  },
};

export const mobDef = (kind: number): MobDef => MOB_DEFS[kind] ?? (MOB_DEFS[MOB.rata] as MobDef);

/** Jefes en el orden en que aparecen: cinco minijefes y el jefe final. */
export const BOSS_ORDER: readonly number[] = [
  MOB.reinaRata,
  MOB.buhoAnciano,
  MOB.mamaHongo,
  MOB.perroGuardian,
  MOB.zorroEspectral,
  MOB.reyGato,
];

/** Banderas de un enemigo en la instantanea. */
export const MOB_FLAG = {
  windup: 1,
  hurt: 2,
  boss: 4,
  stunned: 8,
  dashing: 16,
  shielded: 32,
  phase2: 64,
  phase3: 128,
  slowed: 256,
} as const;

/** Proyectiles de los enemigos: el `kind` de una bala enemiga empieza en 64. */
export const HOSTILE_SHOT = {
  pluma: 64,
  espora: 65,
  fuego: 66,
  orbe: 67,
  onda: 68,
  chispa: 69,
  dardo: 70,
} as const;

export const isHostileShot = (kind: number): boolean => kind >= 64;

/** Tipos de zona de peligro en el piso. */
export const HAZARD = { charco: 0, onda: 1, aviso: 2, fuego: 3, sombra: 4, espora: 5 } as const;

// ---------------------------------------------------------------- oleadas

/** Enemigos que pueden salir en cada acto (0 a 4) antes de cada minijefe. */
const ACT_POOLS: number[][] = [
  [MOB.rata, MOB.rata, MOB.murcielago],
  [MOB.rata, MOB.murcielago, MOB.buho, MOB.hongo],
  [MOB.murcielago, MOB.buho, MOB.hongo, MOB.perro, MOB.perro],
  [MOB.buho, MOB.perro, MOB.zorro, MOB.golem, MOB.murcielago],
  [MOB.perro, MOB.zorro, MOB.zorro, MOB.golem, MOB.buho, MOB.hongo],
];

/**
 * Oleadas de una sala de combate: cada oleada es una lista de enemigos. Entre mas actos y mas
 * gatos en el grupo, mas enemigos.
 */
export function wavePlan(rng: Rng, act: number, players: number): number[][] {
  const pool = ACT_POOLS[Math.min(ACT_POOLS.length - 1, Math.max(0, act))] as number[];
  const waves = act >= 3 ? 3 : 2;
  const plan: number[][] = [];
  for (let w = 0; w < waves; w++) {
    const count = Math.round(3 + act * 1.1 + w * 1.3 + (players - 1) * 1.4);
    const wave: number[] = [];
    for (let i = 0; i < count; i++) {
      let kind = rng.pick(pool);
      // los pesados no salen mas de dos veces por oleada
      if ((kind === MOB.golem || kind === MOB.hongo) && wave.filter((k) => k === kind).length >= 2)
        kind = MOB.rata;
      wave.push(kind);
    }
    plan.push(wave);
  }
  return plan;
}

/** Cuanta vida extra tienen los enemigos segun el acto y cuantos gatos juegan. */
export function hpScale(act: number, players: number): number {
  return (1 + 0.18 * act) * (1 + 0.55 * (players - 1));
}

/** Cuanto dano hacen los enemigos segun el acto. */
export function dmgScale(act: number): number {
  return 1 + 0.12 * act;
}

// ---------------------------------------------------------------- reliquias y armadura

export interface RelicDef {
  id: number;
  name: string;
  desc: string;
}

/** Reliquias: mejoras que duran toda la partida y se apilan. */
export const RELICS: readonly RelicDef[] = [
  { id: 0, name: 'Cascabel de la suerte', desc: '+12 % de daño con las armas' },
  { id: 1, name: 'Garras afiladas', desc: '+45 % de daño con las garras' },
  { id: 2, name: 'Bigotes de rayo', desc: '+8 % de velocidad' },
  { id: 3, name: 'Sardina dorada', desc: 'Recuperas 3 de vida por cada baja' },
  { id: 4, name: 'Ovillo infinito', desc: '12 % de probabilidad de no gastar bala' },
  { id: 5, name: 'Collar de luna', desc: '+25 de vida máxima' },
  { id: 6, name: 'Almohadilla suave', desc: 'Recibes 12 % menos de daño' },
  { id: 7, name: 'Ojo de búho', desc: '+25 % de alcance en las balas' },
  { id: 8, name: 'Leche tibia', desc: 'Recargas 22 % más rápido' },
  { id: 9, name: 'Pata de resorte', desc: 'La voltereta se recupera 35 % antes' },
  { id: 10, name: 'Siete vidas', desc: '+1 vida para todo el grupo' },
  { id: 11, name: 'Instinto cazador', desc: '15 % de probabilidad de golpe doble' },
  { id: 12, name: 'Hocico de sabueso', desc: 'Los botines traen 35 % más balas' },
  { id: 13, name: 'Lengüeta curativa', desc: 'Regeneras 1 de vida por segundo' },
];

export const ARMOR_SLOTS = ['head', 'body', 'paws'] as const;
export const ARMOR_NAMES: Record<(typeof ARMOR_SLOTS)[number], [string, string, string]> = {
  head: ['Capucha de hojas', 'Gorro con orejas', 'Casco de luna'],
  body: ['Chaleco de cuero', 'Capa de musgo', 'Peto de escarcha'],
  paws: ['Calcetines de lana', 'Botitas de gamuza', 'Zapatillas de viento'],
};

export interface Mods {
  dmg: number;
  claw: number;
  speed: number;
  maxHp: number;
  maxShield: number;
  /** Dano que se recibe (1 = normal, 0.8 = 20 % menos). */
  taken: number;
  reload: number;
  range: number;
  ammoSave: number;
  crit: number;
  lifesteal: number;
  regen: number;
  dashCd: number;
  lootAmmo: number;
  lives: number;
}

export const NO_MODS: Mods = {
  dmg: 1,
  claw: 1,
  speed: 1,
  maxHp: 100,
  maxShield: 100,
  taken: 1,
  reload: 1,
  range: 1,
  ammoSave: 0,
  crit: 0,
  lifesteal: 0,
  regen: 0,
  dashCd: 1,
  lootAmmo: 1,
  lives: 0,
};

/** Armadura: indice de pieza (0 a 2) por casilla (cabeza, cuerpo, patas); -1 si no lleva. */
export type Equip = [number, number, number];

export interface MetaLevels {
  vida: number;
  garras: number;
  municion: number;
  botiquin: number;
  esencia: number;
  vidas: number;
  reliquia: number;
}

export const NO_META: MetaLevels = {
  vida: 0,
  garras: 0,
  municion: 0,
  botiquin: 0,
  esencia: 0,
  vidas: 0,
  reliquia: 0,
};

const count = (list: readonly number[], id: number): number => list.filter((r) => r === id).length;

/** Junta reliquias, armadura y mejoras permanentes en los numeros que usa el juego. */
export function computeMods(
  relics: readonly number[],
  equip: Equip,
  meta: MetaLevels = NO_META,
): Mods {
  const m: Mods = { ...NO_MODS };
  m.dmg += 0.12 * count(relics, 0);
  m.claw += 0.45 * count(relics, 1) + 0.1 * meta.garras;
  m.speed += 0.08 * count(relics, 2);
  m.lifesteal += 3 * count(relics, 3);
  m.ammoSave += 0.12 * count(relics, 4);
  m.maxHp += 25 * count(relics, 5) + 10 * meta.vida;
  m.taken *= 0.88 ** count(relics, 6);
  m.range += 0.25 * count(relics, 7);
  m.reload *= 0.78 ** count(relics, 8);
  m.dashCd *= 0.65 ** count(relics, 9);
  m.lives += count(relics, 10);
  m.crit += 0.15 * count(relics, 11);
  m.lootAmmo += 0.35 * count(relics, 12);
  m.regen += 1 * count(relics, 13);
  const head = equip[0];
  const body = equip[1];
  const paws = equip[2];
  if (head >= 0) m.maxShield += [10, 20, 35][head] ?? 0;
  if (body >= 0) m.taken *= 1 - ([0.08, 0.14, 0.22][body] ?? 0);
  if (paws >= 0) {
    m.speed += [0.04, 0.08, 0.13][paws] ?? 0;
    m.dashCd *= 1 - ([0.08, 0.14, 0.2][paws] ?? 0);
  }
  m.taken = Math.max(0.4, m.taken);
  m.crit = Math.min(0.6, m.crit);
  m.ammoSave = Math.min(0.5, m.ammoSave);
  return m;
}

// ---------------------------------------------------------------- habilidades de jefe

/** Casillas de habilidad: cada gato puede llevar hasta tres a la vez. */
export const POWER_SLOTS = 3;
/** Una habilidad que se vuelve a elegir sube de nivel hasta este tope. */
export const POWER_MAX_LEVEL = 3;

export interface PowerDef {
  id: number;
  name: string;
  desc: string;
  /** Segundos de espera tras usarla (nivel 1). */
  cooldown: number;
  /** Segundos que dura el efecto (0 si es instantaneo). */
  duration: number;
}

/** Habilidades que se ganan al derrotar jefes: cada una se activa con su tecla o boton. */
export const POWERS: readonly PowerDef[] = [
  { id: 0, name: 'Furia felina', desc: 'Disparas el doble de rápido', cooldown: 30, duration: 6 },
  { id: 1, name: 'Mirada de búho', desc: '+80 % de daño y de alcance', cooldown: 32, duration: 6 },
  {
    id: 2,
    name: 'Esporas curativas',
    desc: 'Una nube cura a quien esté dentro',
    cooldown: 30,
    duration: 5,
  },
  {
    id: 3,
    name: 'Rugido guardián',
    desc: 'Onda que daña, aturde y empuja',
    cooldown: 26,
    duration: 0,
  },
  {
    id: 4,
    name: 'Paso espectral',
    desc: 'Intocable y veloz unos segundos',
    cooldown: 28,
    duration: 3.5,
  },
  {
    id: 5,
    name: 'Nova de fuego',
    desc: 'Estalla y quema todo alrededor',
    cooldown: 25,
    duration: 0,
  },
  {
    id: 6,
    name: 'Escudo de luna',
    desc: 'Un escudo que absorbe golpes',
    cooldown: 32,
    duration: 0,
  },
  {
    id: 7,
    name: 'Maullido hipnótico',
    desc: 'Ralentiza a los enemigos cercanos',
    cooldown: 26,
    duration: 5,
  },
];

/** La habilidad que ensena cada jefe (el jefe final no ensena: ahi termina la aventura). */
export const BOSS_POWER: Record<number, number> = {
  [MOB.reinaRata]: 0,
  [MOB.buhoAnciano]: 1,
  [MOB.mamaHongo]: 2,
  [MOB.perroGuardian]: 3,
  [MOB.zorroEspectral]: 4,
};

export interface OwnedPower {
  id: number;
  level: number;
}

/** Espera de una habilidad segun su nivel (12 % menos por nivel). */
export const powerCooldown = (def: PowerDef, level: number): number =>
  def.cooldown * (1 - 0.12 * (Math.max(1, level) - 1));

/** Cuanto mas fuerte es el efecto segun el nivel (20 % mas por nivel). */
export const powerEffect = (level: number): number => 1 + 0.2 * (Math.max(1, level) - 1);

/**
 * Lo que se ofrece al derrotar un jefe: tres habilidades distintas. Con casillas libres salen
 * habilidades nuevas (siempre la del jefe si todavia no la tienes); con las casillas llenas salen
 * las que ya tienes, para subirlas de nivel. Devuelve una lista vacia si no hay nada que ofrecer.
 */
export function powerOffer(rng: Rng, owned: readonly OwnedPower[], boss: number): number[] {
  const free = owned.length < POWER_SLOTS;
  const pool = free
    ? POWERS.filter((p) => !owned.some((o) => o.id === p.id)).map((p) => p.id)
    : owned.filter((o) => o.level < POWER_MAX_LEVEL).map((o) => o.id);
  if (pool.length === 0) return [];
  const picks: number[] = [];
  const signature = BOSS_POWER[boss];
  if (free && signature !== undefined && pool.includes(signature)) picks.push(signature);
  const rest = rng.shuffle(pool.filter((id) => !picks.includes(id)));
  while (picks.length < 3 && rest.length > 0) picks.push(rest.shift() as number);
  return rng.shuffle(picks);
}

// ---------------------------------------------------------------- mejoras entre partidas

export interface MetaUpgrade {
  key: keyof MetaLevels;
  name: string;
  desc: string;
  max: number;
  /** Costo de cada nivel, en esencia lunar. */
  costs: number[];
}

/** Lo que se compra con la esencia lunar que dejan las partidas (se guarda en este navegador). */
export const META_UPGRADES: readonly MetaUpgrade[] = [
  {
    key: 'vida',
    name: 'Corazón fuerte',
    desc: '+10 de vida máxima por nivel',
    max: 5,
    costs: [20, 40, 70, 110, 160],
  },
  {
    key: 'garras',
    name: 'Garras de acero',
    desc: '+10 % de daño de garras por nivel',
    max: 5,
    costs: [20, 40, 70, 110, 160],
  },
  {
    key: 'municion',
    name: 'Mochila con balas',
    desc: '+25 balas de tu arma al empezar',
    max: 3,
    costs: [30, 60, 100],
  },
  {
    key: 'botiquin',
    name: 'Botiquines de bolsillo',
    desc: 'Empiezas con un botiquín más',
    max: 3,
    costs: [30, 60, 100],
  },
  {
    key: 'esencia',
    name: 'Olfato de luna',
    desc: '+10 % de esencia lunar por nivel',
    max: 3,
    costs: [50, 100, 160],
  },
  {
    key: 'vidas',
    name: 'Siempre cae de pie',
    desc: '+1 vida para el grupo por nivel',
    max: 3,
    costs: [80, 160, 280],
  },
  {
    key: 'reliquia',
    name: 'Regalo del bosque',
    desc: 'Eliges una reliquia al empezar (hasta 2)',
    max: 2,
    costs: [120, 260],
  },
];

export function clampMeta(raw: unknown): MetaLevels {
  const out: MetaLevels = { ...NO_META };
  if (typeof raw !== 'object' || raw === null) return out;
  for (const up of META_UPGRADES) {
    const v = (raw as Record<string, unknown>)[up.key];
    if (typeof v === 'number' && Number.isFinite(v))
      out[up.key] = Math.max(0, Math.min(up.max, Math.floor(v)));
  }
  return out;
}

/** Esencia lunar que deja una partida: salas, jefes, bajas y una gran recompensa por ganar. */
export function essenceFor(
  rooms: number,
  bosses: number,
  kills: number,
  won: boolean,
  meta: MetaLevels = NO_META,
): number {
  const base = rooms * 4 + bosses * 30 + Math.floor(kills / 8) + (won ? 120 : 0);
  return Math.round(base * (1 + 0.1 * meta.esencia));
}

// ---------------------------------------------------------------- pociones

/** Segundos de cada pocion. */
export const POTION = {
  catnip: { seconds: 14, dmg: 1.4, speed: 1.18 },
  valerian: { seconds: 16, speed: 1.3, dash: 0.5 },
} as const;

/** Voltereta: salto rapido con invulnerabilidad corta. */
export const DASH = {
  distance: 54,
  seconds: 0.18,
  invuln: 0.3,
  cooldown: 2.4,
} as const;
