import {
  ADVENTURE_MAPS,
  DUEL_MAPS,
  MAP_KINDS,
  MAP_NAMES,
  TERRITORY_MAPS,
  type MapKind,
} from '../../shared/br/map';
import {
  DUEL_FORMATS,
  ENABLED_MODES,
  GAME_MODES,
  MODES,
  TERRITORY_MAX_TEAM,
  TERRITORY_MIN_TEAM,
  isGameMode,
  type DuelFormat,
  type GameMode,
} from '../../shared/br/modes';
import { $, el } from './dom';

const MODE_KEY = 'cg_modo';

/** Mapas que existen en cada modo. */
export function mapsOf(mode: GameMode): readonly MapKind[] {
  return mode === 'techo'
    ? DUEL_MAPS
    : mode === 'territorio'
      ? TERRITORY_MAPS
      : mode === 'aventura'
        ? ADVENTURE_MAPS
        : MAP_KINDS;
}

export const FORMAT_LABELS: Record<DuelFormat, string> = {
  '1v1': '1 contra 1',
  '2v2': '2 contra 2',
};

export const teamSizeLabel = (n: number): string => `${n} contra ${n}`;

/** Llena un selector con "Mapa al azar" y los mapas del modo, sin perder lo elegido si todavia sirve. */
export function fillMapSelect(select: HTMLSelectElement, mode: GameMode): void {
  const keep = select.value;
  select.replaceChildren();
  const random = el('option', '', 'Mapa al azar');
  random.value = 'azar';
  select.append(random);
  for (const kind of mapsOf(mode)) {
    const o = el('option', '', MAP_NAMES[kind]);
    o.value = kind;
    select.append(o);
  }
  select.value = [...select.options].some((o) => o.value === keep) ? keep : 'azar';
}

export function fillModeSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (const mode of GAME_MODES) {
    if (!ENABLED_MODES.includes(mode)) continue;
    const o = el('option', '', MODES[mode].name);
    o.value = mode;
    select.append(o);
  }
}

export function fillFormatSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (const f of DUEL_FORMATS) {
    const o = el('option', '', FORMAT_LABELS[f]);
    o.value = f;
    select.append(o);
  }
}

export function fillTeamSizeSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (let n = TERRITORY_MAX_TEAM; n >= TERRITORY_MIN_TEAM; n--) {
    const o = el('option', '', teamSizeLabel(n));
    o.value = String(n);
    select.append(o);
  }
}

/** Lo que dice el boton de jugar solo segun el modo. */
export function soloHelp(mode: GameMode, format: DuelFormat, teamSize: number): string {
  if (mode === 'techo')
    return format === '2v2'
      ? 'Tú y un bot contra dos bots. Eliges kit y peleas a tres rondas.'
      : 'Tú contra un bot en un tejado. Eliges kit y peleas a tres rondas.';
  if (mode === 'territorio')
    return `Tu equipo de ${teamSize} (con bots) contra otro de ${teamSize}. Dominen los patios.`;
  if (mode === 'aventura') return 'Explora un bosque encantado tú solo, o invita amigos.';
  return 'Tú contra 11 bots. La partida empieza al instante.';
}

/** Lo que explica el boton (i) de cada modo. */
export const MODE_INFO: Record<
  GameMode,
  { lead: string; bullets: string[]; players: string; maps: string }
> = {
  br: {
    lead: 'Hasta 12 gatos caen a un mapa lleno de cofres. Una ola de agua lo va cerrando y solo uno queda en pie.',
    bullets: [
      'Los cofres traen armas, balas, botiquines, escudos y muros. Los dorados traen más.',
      'La ola cierra el mapa en tres tiempos, en unos 2 minutos: quédate dentro del círculo seguro.',
      'Al caer dejas una lápida con tus cosas. El último gato en pie gana.',
    ],
    players: 'De 1 a 12 gatos (los lugares libres los llenan bots)',
    maps: 'Bosque, Casa de gatitos y Piscina',
  },
  techo: {
    lead: 'Un duelo por rondas sobre un tejado bajo la tormenta, de 1 contra 1 o de 2 contra 2.',
    bullets: [
      'Antes de cada ronda eliges un kit: Cazador, Acechador, Vigía o Bombardero. Cada uno se juega distinto.',
      'Gana quien se lleve 2 rondas (mejor de 3).',
      'La tormenta cierra el tejado: llueve, caen rayos y el borde se vuelve peligroso.',
    ],
    players: '1 contra 1 o 2 contra 2 (los lugares libres los llenan bots)',
    maps: 'Tejado a dos aguas, Azotea con antenas y Mansarda de pizarra',
  },
  territorio: {
    lead: 'Dos equipos de hasta 5 gatos se pelean tres patios del barrio.',
    bullets: [
      'Quédate dentro de un patio para capturarlo: baja la bandera rival y sube la tuya.',
      'Dominar los tres patios 18 segundos seguidos gana la ronda. Mejor de 3 rondas.',
      'Si caes, reapareces a los 4 segundos en un patio de tu equipo. Sin patios, solo en tu base y con tu última vida.',
      'Las balas son infinitas y reapareces con tu kit completo.',
    ],
    players: 'De 1 contra 1 a 5 contra 5 (los lugares libres los llenan bots)',
    maps: 'Calle del barrio y Patios traseros',
  },
  aventura: {
    lead: 'Un roguelike cooperativo: de 1 a 4 gatos cruzan un bosque encantado, vencen a 5 minijefes y al Rey Gato de las Sombras.',
    bullets: [
      'Las puertas de enredadera se cierran mientras peleas y se abren al ganar la sala.',
      'Cada jefe suelta armas, curas y una habilidad nueva para elegir. También hay reliquias y armadura.',
      'Hay 7 vidas compartidas y la voltereta te salva de un golpe. Quien cae sin vidas vuelve al terminar la sala.',
      'La esencia lunar que ganas, aunque pierdas, compra mejoras eternas en el Santuario.',
    ],
    players: 'De 1 a 4 gatos, sin bots (con amigos hay más enemigos y más botín)',
    maps: 'Bosque encantado',
  },
};

/**
 * Selector de modo del lobby: tarjetas con la foto del modo, su nombre y un boton (i) que lo explica.
 * El anfitrion de una sala puede cambiar de modo desde aqui; los demas solo lo ven. Recuerda el
 * ultimo modo elegido en este navegador.
 */
export class ModePicker {
  mode: GameMode = 'br';
  format: DuelFormat = '1v1';
  teamSize = TERRITORY_MAX_TEAM;
  onChange: () => void = () => undefined;
  /** El boton (i) de una tarjeta. */
  onInfo: (mode: GameMode) => void = () => undefined;
  /** Si no es null, elegir modo lo decide otra cosa (por ejemplo el anfitrion de una sala). */
  intercept: ((mode: GameMode) => boolean) | null = null;

  private readonly box = $('mode-picker');
  private readonly mapSelect = $<HTMLSelectElement>('room-map');
  private readonly botsField = $('room-bots-field');
  private readonly formatField = $('room-format-field');
  private readonly teamField = $('room-teamsize-field');
  private readonly formatSelect = $<HTMLSelectElement>('room-format');
  private readonly teamSelect = $<HTMLSelectElement>('room-teamsize');
  private locked = false;

  constructor(private readonly postal: (mode: GameMode) => HTMLCanvasElement) {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      if (isGameMode(saved) && ENABLED_MODES.includes(saved)) this.mode = saved;
    } catch {
      // sin almacenamiento: se queda el Battle Royale
    }
    fillFormatSelect(this.formatSelect);
    fillTeamSizeSelect(this.teamSelect);
    this.formatSelect.addEventListener('change', () => {
      this.format = this.formatSelect.value as DuelFormat;
      this.onChange();
    });
    this.teamSelect.addEventListener('change', () => {
      this.teamSize = Number(this.teamSelect.value);
      this.onChange();
    });
    this.build();
    this.sync();
  }

  private build(): void {
    this.box.replaceChildren();
    for (const mode of GAME_MODES) {
      const info = MODES[mode];
      const ready = ENABLED_MODES.includes(mode);
      const card = el('div', 'mode');
      card.dataset.mode = mode;
      card.setAttribute('role', 'radio');
      card.tabIndex = ready ? 0 : -1;
      card.setAttribute('aria-label', info.name + (ready ? '' : ' (próximamente)'));
      if (!ready) card.setAttribute('aria-disabled', 'true');
      card.title = info.blurb;
      const pic = this.postal(mode);
      pic.classList.add('postal');
      const body = el('div', 'm-body');
      body.append(
        el('strong', '', info.name),
        el('span', 'm-sub', ready ? PLAYERS[mode] : 'Próximamente'),
      );
      const i = el('button', 'm-info', 'i');
      i.type = 'button';
      i.setAttribute('aria-label', `Información de ${info.name}`);
      i.dataset.testid = `info-${mode}`;
      i.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onInfo(mode);
      });
      card.append(pic, body, i);
      card.addEventListener('click', () => this.pick(mode));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.pick(mode);
        } else if (
          e.key === 'ArrowDown' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowLeft'
        ) {
          e.preventDefault();
          const order = GAME_MODES.filter((m) => ENABLED_MODES.includes(m));
          const at = order.indexOf(mode);
          const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
          const next = order[(at + dir + order.length) % order.length] as GameMode;
          this.box.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
          this.pick(next);
        }
      });
      this.box.append(card);
    }
  }

  pick(mode: GameMode): void {
    if (!ENABLED_MODES.includes(mode) || this.locked) return;
    if (this.intercept && this.intercept(mode)) return;
    this.setMode(mode);
    this.onChange();
  }

  /** Cambia el modo mostrado sin avisar a nadie (la sala ya lo decidio). */
  setMode(mode: GameMode, remember = true): void {
    this.mode = mode;
    if (remember) {
      try {
        window.localStorage.setItem(MODE_KEY, mode);
      } catch {
        // sin almacenamiento
      }
    }
    this.sync();
  }

  /** Vuelve a dibujar las fotos (por ejemplo cuando el gato cambio de pelaje). */
  refreshPostals(): void {
    for (const card of this.box.querySelectorAll<HTMLElement>('.mode')) {
      const old = card.querySelector('canvas.postal');
      const fresh = this.postal(card.dataset.mode as GameMode);
      fresh.classList.add('postal');
      if (old) old.replaceWith(fresh);
    }
  }

  /** Dentro de una sala solo el anfitrion cambia el modo: a los demas las tarjetas se les apagan. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    for (const c of this.box.querySelectorAll<HTMLElement>('.mode')) {
      if (ENABLED_MODES.includes(c.dataset.mode as GameMode))
        c.setAttribute('aria-disabled', String(locked));
    }
  }

  /** Muestra solo lo que corresponde al modo elegido. */
  private sync(): void {
    for (const b of this.box.querySelectorAll<HTMLElement>('.mode'))
      b.setAttribute('aria-checked', String(b.dataset.mode === this.mode));
    fillMapSelect(this.mapSelect, this.mode);
    this.botsField.hidden = this.mode !== 'br';
    this.formatField.hidden = this.mode !== 'techo';
    this.teamField.hidden = this.mode !== 'territorio';
    this.formatSelect.value = this.format;
    this.teamSelect.value = String(this.teamSize);
  }
}

/** Cuantos gatos caben, en una linea corta para la tarjeta. */
const PLAYERS: Record<GameMode, string> = {
  br: 'Hasta 12 gatos',
  techo: '1 contra 1 o 2 contra 2',
  territorio: 'Hasta 5 contra 5',
  aventura: '1 a 4, en equipo',
};
