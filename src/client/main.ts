import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import './styles.css';
import './zod-config';

import { CAT } from '../shared/br/constants';
import { MAP_NAMES, type MapKind } from '../shared/br/map';
import type {
  DiedPayload,
  GameEndPayload,
  GameStartPayload,
  PublicRoom,
  WinPayload,
  RoomState,
} from '../shared/br/protocol';
import { KIT_IDS, MODES, TEAM_COLORS, TEAM_NAMES, type DuelFormat } from '../shared/br/modes';
import { BOTS_FILL, maxHumans, type BotsSetting } from '../shared/br/rooms';
import { randomSkin } from '../shared/br/skin';
import type { BRSnapshot } from '../shared/br/types';
import { createRng } from '../shared/rng';
import { FrameLimiter } from '../shared/timing';
import { api, type User } from './api';
import { Sfx } from './audio';
import { BRRenderer } from './game/render';
import { InputController, keyLabel, type ControlMode } from './game/input';
import { ClientBR } from './game/state';
import { Net } from './net';
import { $, el, toast } from './ui/dom';
import { AuthScreen, authErrorText } from './ui/auth';
import { InventoryPanel } from './ui/inventory';
import { NicknameDialog, nicknameConfirmed } from './ui/nickname';
import {
  FORMAT_LABELS,
  ModePicker,
  fillFormatSelect,
  fillMapSelect,
  fillModeSelect,
  fillTeamSizeSelect,
  soloHelp,
  teamSizeLabel,
} from './ui/modes';
import { Painter, drawCatIcon, startWalker } from './ui/painter';
import { Settings } from './ui/settings';
import { Shrine } from './ui/santuario';
import { relicIcon } from './pixel/art-items';
import { RELICS } from '../shared/br/adventure';

const canvas = $<HTMLCanvasElement>('game');
const screenAuth = $('screen-auth');
const screenLobby = $('screen-lobby');
const hudEl = $('hud');
const countdownEl = $('countdown');
const resultsEl = $('results');
const menuEl = $('menu');
const deathEl = $('death');
const specBar = $('spec-bar');
const bagBtn = $<HTMLButtonElement>('btn-bag');
const menuBtn = $<HTMLButtonElement>('btn-menu');

const sfx = new Sfx();
/** Con ?debug en la URL se expone el estado local del juego para las pruebas del navegador. */
const DEBUG = new URLSearchParams(window.location.search).has('debug');
/** Con ?debug&hora=0.9 se fija la hora del dia (0 dia, 1 noche) para probar y tomar capturas. */
const FORCED_HOUR = (() => {
  const raw = new URLSearchParams(window.location.search).get('hora');
  const n = raw === null ? Number.NaN : Number(raw);
  return DEBUG && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
})();
const ERRORS: Record<string, string> = {
  sala_no_existe: 'Esa sala no existe',
  sala_llena: 'La sala está llena',
  partida_en_curso: 'La partida ya empezó',
  ya_estas_en_una_sala: 'Ya estás en una sala',
  codigo_invalido: 'Código inválido: son 5 caracteres',
  servidor_lleno: 'El servidor está lleno, intenta en un momento',
  datos_invalidos: 'Datos inválidos',
  sin_respuesta: 'El servidor no respondió, intenta de nuevo',
  no_estas_en_una_sala: 'No estás en una sala',
  solo_el_anfitrion: 'Solo el anfitrión puede hacer eso',
  demasiados_jugadores: 'Hay más personas en la sala que lugares con esos bots',
  faltan_jugadores: 'Con esos bots hacen falta al menos 2 personas',
  modo_no_disponible: 'Ese modo todavía no está listo',
  equipo_lleno: 'Ese equipo ya está completo',
  sin_equipos: 'Este modo no tiene equipos',
  fuera_de_tiempo: 'Ya pasó el tiempo para elegir',
};
/** Enlace de invitacion (?sala=ABCDE): se guarda para entrar a la sala cuando haya sesion. */
const INVITE_KEY = 'cg_invitacion';
let pendingInvite: string | null = null;
{
  const params = new URLSearchParams(window.location.search);
  let code = (params.get('sala') ?? '').trim().toUpperCase();
  // Al volver de Google la URL ya no trae la sala: se recupera la que se guardo antes de salir.
  try {
    if (!code) code = sessionStorage.getItem(INVITE_KEY) ?? '';
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // sin almacenamiento de sesion: solo funciona el enlace directo
  }
  if (/^[A-Z0-9]{5}$/.test(code)) pendingInvite = code;
  if (params.has('sala')) {
    params.delete('sala');
    const rest = params.toString();
    history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
}

let user: User | null = null;
let net: Net | null = null;
let room: RoomState | null = null;
let game: ClientBR | null = null;
let roomsTimer: number | null = null;
let lastCountdown = -1;

// ---------------------------------------------------------------- piezas de interfaz

const painter = new Painter();
const renderer = new BRRenderer(canvas, sfx);
renderer.dayOverride = FORCED_HOUR;

const input = new InputController(canvas, {
  onInteract: () => void doInteract(),
  onBag: () => inventory.toggle(),
  onMap: () => {
    renderer.mapOpen = !renderer.mapOpen;
  },
  onMenu: () => {
    if (inventory.isOpen) inventory.close();
    else if (renderer.mapOpen) renderer.mapOpen = false;
    else toggleMenu();
  },
  onSelect: (slot) => {
    // en la Aventura, si hay reliquias para elegir, los numeros 1 a 3 eligen una
    if (game?.adv?.choice) {
      game.sendRelic(slot);
      return;
    }
    // en la eleccion de kit, los numeros 1 a 4 eligen el kit
    if (game?.pvp?.phase === 'pick') {
      const id = KIT_IDS[slot];
      if (id) game.sendKit(id);
      return;
    }
    game?.select(slot);
  },
  onKit: (index) => {
    if (game?.adv?.choice) {
      game.sendRelic(index);
      return;
    }
    const id = KIT_IDS[index];
    if (id) game?.sendKit(id);
  },
  onEmote: (kind) => game?.sendEmote(kind),
  onReload: () => game?.sendReload(),
  onMute: () => {
    sfx.setMuted(!sfx.muted);
    toast(sfx.muted ? 'Sonido apagado' : 'Sonido encendido');
  },
  onFirstGesture: () => sfx.unlock(),
  onModeChange: (mode) => applyMode(mode),
});

const inventory = new InventoryPanel(renderer.assets, () => game);
const settings = new Settings(input, sfx, renderer.assets.can, renderer.assets.emote.face[0]);

inventory.onClose = () => syncActive();
settings.onClose = () => syncActive();

/** Los controles solo responden cuando no hay un panel encima. */
function syncActive(): void {
  const playing = !canvas.hidden;
  input.active = playing && menuEl.hidden === true && !settings.isOpen && resultsEl.hidden === true;
}

function applyMode(mode: ControlMode): void {
  $('hud-mode').textContent = mode === 'touch' ? 'táctil' : 'teclado';
  document.body.dataset.mode = mode;
  const inGame = !canvas.hidden;
  bagBtn.hidden = !inGame || mode === 'touch';
  menuBtn.hidden = !inGame || mode === 'touch';
  $('bag-key').textContent = keyLabel(input.keys.bag).toUpperCase();
}

// el icono de la lata de sardinas del boton de inventario (PC)
{
  const c = $<HTMLCanvasElement>('bag-icon');
  (c.getContext('2d') as CanvasRenderingContext2D).drawImage(renderer.assets.can, 0, 0);
}

// ---------------------------------------------------------------- pantalla completa en moviles

const isTouchDevice = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** Android permite pantalla completa y bloquear la orientacion; iOS no, ahi se usa la pantalla de aviso. */
function enterImmersive(): void {
  if (!isTouchDevice()) return;
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== 'function' || document.fullscreenElement) return;
  const orientation = screen.orientation as unknown as { lock?: (o: string) => Promise<void> };
  root
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => orientation.lock?.('landscape'))
    .catch(() => undefined);
}

type View = 'auth' | 'lobby' | 'game';

function showView(view: View): void {
  screenAuth.hidden = view !== 'auth';
  screenLobby.hidden = view !== 'lobby';
  canvas.hidden = view !== 'game';
  hudEl.hidden = view !== 'game';
  document.body.classList.toggle('playing', view === 'game');
  if (view !== 'game') {
    menuEl.hidden = true;
    deathEl.hidden = true;
    specBar.hidden = true;
    resultsEl.hidden = true;
    inventory.close();
  }
  applyMode(input.mode);
  input.active = view === 'game';
  if (view === 'game') renderer.resize();
}

function navigate(path: string, replace = false): void {
  if (location.pathname === path) {
    // Misma ruta: solo se limpia lo que sobre en la URL (por ejemplo ?error= al volver de Google).
    if (location.search) history.replaceState(null, '', path);
    return;
  }
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
}

// ---------------------------------------------------------------- autenticacion

const auth = new AuthScreen();
const nickname = new NicknameDialog();

auth.onLeaveForGoogle = () => {
  if (!pendingInvite) return;
  try {
    sessionStorage.setItem(INVITE_KEY, pendingInvite);
  } catch {
    // sin almacenamiento de sesion: se pierde la invitacion, el codigo sigue sirviendo
  }
};
auth.onLogin = async (loggedIn) => {
  user = loggedIn;
  navigate('/lobby');
  await enterLobby();
};

function showAuth(message = ''): void {
  user = null;
  room = null;
  showView('auth');
  navigate('/login', true);
  void auth.prepare(message);
}

$('btn-logout').addEventListener('click', async () => {
  try {
    await api.logout();
  } catch {
    // la sesion se descarta igual en el cliente
  }
  disconnect();
  showAuth();
});

function disconnect(): void {
  hasConnectedBefore = false;
  stopRoomsPolling();
  net?.close();
  net = null;
  room = null;
  leaveGameView();
}

// ---------------------------------------------------------------- lobby

function setNetChip(online: boolean): void {
  const chip = $('lobby-net');
  chip.dataset.state = online ? 'online' : 'offline';
  chip.textContent = online ? 'conectado' : 'sin conexión';
}

const mapSelect = $<HTMLSelectElement>('room-map');
const picker = new ModePicker();
const refreshSoloHelp = (): void => {
  $('solo-help').textContent = soloHelp(picker.mode, picker.format, picker.teamSize);
};
const shrine = new Shrine();
const shrineBtn = $('btn-shrine');
const refreshMode = (): void => {
  refreshSoloHelp();
  shrineBtn.hidden = picker.mode !== 'aventura';
};
picker.onChange = refreshMode;
refreshMode();
shrineBtn.addEventListener('click', () => shrine.open());
$('btn-results-shrine').addEventListener('click', () => shrine.open());
shrine.onChange = (levels) => net?.socket.emit('room:meta', levels);

/** Opciones de bots: llenar, o una cantidad exacta de 0 a 9. */
function fillBotsSelect(select: HTMLSelectElement): void {
  const fill = el('option', '', 'Llenar con bots');
  fill.value = BOTS_FILL;
  select.append(fill);
  for (let n = 0; n <= 9; n++) {
    const o = el(
      'option',
      '',
      n === 0 ? 'Sin bots (solo personas)' : n === 1 ? '1 bot' : `${n} bots`,
    );
    o.value = String(n);
    select.append(o);
  }
}

const botsSelect = $<HTMLSelectElement>('room-bots');
fillBotsSelect(botsSelect);
const setBotsSelect = $<HTMLSelectElement>('set-bots');
fillBotsSelect(setBotsSelect);
const setMapSelect = $<HTMLSelectElement>('set-map');
const setModeSelect = $<HTMLSelectElement>('set-mode');
fillModeSelect(setModeSelect);
const setFormatSelect = $<HTMLSelectElement>('set-format');
fillFormatSelect(setFormatSelect);
const setTeamSizeSelect = $<HTMLSelectElement>('set-teamsize');
fillTeamSizeSelect(setTeamSizeSelect);

const parseBots = (value: string): BotsSetting => (value === BOTS_FILL ? BOTS_FILL : Number(value));

async function enterLobby(): Promise<void> {
  if (!user) return;
  showView('lobby');
  if (!nicknameConfirmed(user)) {
    // Primera vez en este navegador: se confirma el apodo antes de abrir la conexion.
    $('lobby-user').textContent = user.username;
    const renamed = await nickname.open(user);
    if (renamed) user = renamed;
  }
  $('lobby-user').textContent = user.username;
  renderRoom();
  if (!net) {
    net = new Net();
    wireNet(net);
  }
  try {
    await net.ready();
  } catch {
    disconnect();
    showAuth('Tu sesión expiró, entra de nuevo');
    return;
  }
  setNetChip(true);
  await refreshRooms();
  startRoomsPolling();
  if (pendingInvite && !room) {
    const code = pendingInvite;
    pendingInvite = null;
    await joinRoom(code);
  }
}

let resumeTimer: number | null = null;
let gotStateSinceConnect = false;
let hasConnectedBefore = false;

/** Tras reconectar, el servidor reengancha la sala o la partida. Si no lo hace es que se reinicio. */
function watchResume(): void {
  if (resumeTimer !== null) window.clearTimeout(resumeTimer);
  gotStateSinceConnect = false;
  resumeTimer = window.setTimeout(() => {
    resumeTimer = null;
    if (gotStateSinceConnect) return;
    if (game && !game.result) {
      leaveGameView();
      room = null;
      countdownEl.hidden = true;
      navigate('/lobby');
      toast('El servidor se reinició, crea la sala de nuevo');
      void enterLobby();
    } else if (room) {
      room = null;
      renderRoom();
    }
  }, 2500);
}

function wireNet(n: Net): void {
  const s = n.socket;
  s.on('connect', () => {
    setNetChip(true);
    s.emit('skin:set', painter.skin);
    s.emit('room:meta', shrine.save.levels);
    if (hasConnectedBefore) watchResume();
    hasConnectedBefore = true;
  });
  s.on('disconnect', () => setNetChip(false));
  s.on('session:replaced', () => {
    disconnect();
    showAuth('Abriste tu sesión en otra pestaña');
  });
  s.on('rooms:update', (list: PublicRoom[]) => {
    if (!room) renderRoomList(list);
  });
  s.on('room:state', (state: RoomState) => {
    gotStateSinceConnect = true;
    room = state;
    renderRoom();
    updateCountdown(state);
  });
  s.on('game:start', (payload: GameStartPayload) => startGame(payload));
  s.on('game:snap', (snap: BRSnapshot) => game?.onSnapshot(snap));
  s.on('game:died', (payload: DiedPayload) => onDied(payload));
  s.on('game:win', (payload: WinPayload) => {
    deathEl.hidden = true;
    specBar.hidden = true;
    menuEl.hidden = true;
    inventory.close();
    game?.onWin(payload);
  });
  s.on('game:end', (payload: GameEndPayload) => endGame(payload));
}

painter.onChange = (skin) => net?.socket.emit('skin:set', skin);

function updateCountdown(state: RoomState): void {
  if (state.phase !== 'countdown') {
    countdownEl.hidden = true;
    lastCountdown = -1;
    return;
  }
  countdownEl.hidden = false;
  $('count-number').textContent = String(state.countdown);
  if (state.countdown !== lastCountdown) {
    lastCountdown = state.countdown;
    sfx.tick();
  }
}

async function refreshRooms(): Promise<void> {
  if (!net || room) return;
  const res = await net.ack<PublicRoom[]>('rooms:list');
  if (!res.ok || room) return;
  renderRoomList(res.data ?? []);
}

function botsLabel(n: number): string {
  return n === 1 ? '1 bot' : `${n} bots`;
}

function renderRoomList(rooms: PublicRoom[]): void {
  const list = $('room-list');
  list.replaceChildren();
  $('room-empty').hidden = rooms.length > 0;
  for (const r of rooms) {
    const li = el('li');
    li.dataset.testid = 'public-room';
    li.dataset.code = r.code;
    const joinable = r.phase === 'lobby' || r.phase === 'countdown';
    const full = r.players >= r.maxPlayers;
    li.dataset.busy = String(!joinable);
    const info = el('div', 'info');
    const mapName = MAP_NAMES[r.map as keyof typeof MAP_NAMES] ?? 'Mapa al azar';
    info.append(
      el('strong', '', r.name),
      el('div', 'muted', `Anfitrión: ${r.host}`),
      el('div', 'muted', `${MODES[r.mode ?? 'br'].name} · ${mapName}`),
      el('div', 'muted', `${r.players}/${r.maxPlayers} personas · ${botsLabel(r.bots)}`),
    );
    const join = el('button', 'btn small', !joinable ? 'En curso' : full ? 'Llena' : 'Entrar');
    join.type = 'button';
    join.disabled = !joinable || full;
    join.addEventListener('click', () => void joinRoom(r.code));
    li.append(info, join);
    list.append(li);
  }
}

function startRoomsPolling(): void {
  stopRoomsPolling();
  roomsTimer = window.setInterval(() => void refreshRooms(), 15000);
}

function stopRoomsPolling(): void {
  if (roomsTimer !== null) window.clearInterval(roomsTimer);
  roomsTimer = null;
}

function lobbyError(code: string | undefined): void {
  $('lobby-error').textContent = code ? (ERRORS[code] ?? 'No se pudo completar la acción') : '';
}

async function createRoom(
  isPrivate: boolean,
  name?: string,
  bots: BotsSetting = BOTS_FILL,
): Promise<boolean> {
  if (!net) return false;
  const res = await net.ack<{ code: string }>('room:create', {
    name: name || undefined,
    isPrivate,
    map: mapSelect.value,
    bots,
    mode: picker.mode,
    format: picker.format,
    teamSize: picker.teamSize,
  });
  lobbyError(res.ok ? undefined : res.error);
  return res.ok;
}

async function joinRoom(code: string): Promise<void> {
  if (!net) return;
  const res = await net.ack<{ code: string }>('room:join', { code });
  lobbyError(res.ok ? undefined : res.error);
}

$<HTMLFormElement>('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  enterImmersive();
  const name = $<HTMLInputElement>('room-name').value.trim();
  await createRoom($<HTMLInputElement>('room-private').checked, name, parseBots(botsSelect.value));
});

$<HTMLFormElement>('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await joinRoom($<HTMLInputElement>('join-code').value.trim().toUpperCase());
});

$('btn-solo').addEventListener('click', async () => {
  enterImmersive();
  if (!net) return;
  if (await createRoom(true)) await net.ack('room:ready', { ready: true });
});

$('btn-leave').addEventListener('click', async () => {
  if (!net) return;
  await net.ack('room:leave');
  room = null;
  renderRoom();
  void refreshRooms();
});

$('btn-ready').addEventListener('click', async () => {
  enterImmersive();
  if (!net || !room || !user) return;
  const me = room.members.find((m) => m.userId === user?.id);
  const res = await net.ack('room:ready', { ready: !me?.ready });
  if (!res.ok) toast(ERRORS[res.error] ?? 'No se pudo marcar Listo, intenta de nuevo');
});

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
}

$('btn-copy').addEventListener('click', () => {
  if (room) void copyText(room.code, 'Código copiado');
});

$('btn-copy-link').addEventListener('click', () => {
  if (room) void copyText(`${window.location.origin}/?sala=${room.code}`, 'Enlace copiado');
});

/** Ajustes del anfitrion: cada cambio se manda al servidor y el estado de vuelta lo confirma. */
async function sendSettings(settings: Record<string, unknown>): Promise<void> {
  if (!net) return;
  const res = await net.ack('room:settings', settings);
  if (!res.ok) {
    toast(ERRORS[res.error] ?? 'No se pudo cambiar el ajuste');
    renderRoom();
  }
}

setMapSelect.addEventListener('change', () => void sendSettings({ map: setMapSelect.value }));
setModeSelect.addEventListener('change', () => void sendSettings({ mode: setModeSelect.value }));
setFormatSelect.addEventListener(
  'change',
  () => void sendSettings({ format: setFormatSelect.value as DuelFormat }),
);
setTeamSizeSelect.addEventListener(
  'change',
  () => void sendSettings({ teamSize: Number(setTeamSizeSelect.value) }),
);
setBotsSelect.addEventListener(
  'change',
  () => void sendSettings({ bots: parseBots(setBotsSelect.value) }),
);
$<HTMLInputElement>('set-private').addEventListener(
  'change',
  (e) => void sendSettings({ isPrivate: (e.target as HTMLInputElement).checked }),
);

$('btn-start').addEventListener('click', async () => {
  enterImmersive();
  if (!net) return;
  const res = await net.ack('room:start');
  if (!res.ok) toast(ERRORS[res.error] ?? 'No se pudo iniciar la partida');
});

$('btn-settings').addEventListener('click', () => settings.open());

$('lobby-user').addEventListener('click', async () => {
  if (!user || nickname.isOpen) return;
  if (room) {
    toast('Sal de la sala para cambiar tu apodo');
    return;
  }
  if (user.provider === 'local') {
    toast('Tu usuario no se puede cambiar');
    return;
  }
  const renamed = await nickname.open(user);
  if (!renamed) return;
  // El servidor conoce el apodo desde que se abre la conexion: se reconecta con el nuevo.
  user = renamed;
  disconnect();
  await enterLobby();
});

function renderRoom(): void {
  const inRoom = room !== null;
  $('lobby-browse').hidden = inRoom;
  $('room-view').hidden = !inRoom;
  if (!room || !user) return;

  $('room-title').textContent = room.name;
  const mapName = MAP_NAMES[room.map as keyof typeof MAP_NAMES] ?? 'Mapa al azar';
  const people = room.members.length === 1 ? '1 persona' : `${room.members.length} personas`;
  const modeText =
    room.mode === 'techo'
      ? `${MODES.techo.name} (${FORMAT_LABELS[room.format]})`
      : room.mode === 'territorio'
        ? `${MODES.territorio.name} (${teamSizeLabel(room.teamSize)})`
        : MODES[room.mode].name;
  $('room-meta').textContent =
    `${modeText} · ${room.isPrivate ? 'Privada' : 'Pública'} · ${mapName} · ${people}${room.mode === 'aventura' ? '' : ` + ${botsLabel(room.botCount)}`}`;
  $('room-code').textContent = room.code;
  $('bots-line').textContent =
    room.mode === 'aventura'
      ? 'La aventura es de 1 a 4 gatos, sin bots: entre más amigos, más enemigos y más vidas.'
      : room.teamSize > 0
        ? `Cada equipo es de ${room.teamSize}; los lugares libres se llenan con bots.`
        : room.bots === BOTS_FILL
          ? `Los lugares libres se llenan con bots (hasta ${room.maxPlayers} gatos).`
          : `${botsLabel(room.bots)} fijos: caben ${room.maxHumans} personas.`;

  const list = $('member-list');
  list.replaceChildren();
  list.hidden = room.teamSize > 0;
  renderTeamBoard(room);
  let ready = 0;
  for (const m of room.members) {
    if (m.ready) ready++;
    const li = el('li');
    li.dataset.testid = 'member';
    li.dataset.name = m.name;
    const left = el('div', 'who');
    const icon = el('canvas');
    drawCatIcon(icon, m.skin, 2);
    const label = el('div');
    label.append(el('strong', '', m.name));
    if (m.host) label.append(el('span', 'badge', 'anfitrión'));
    left.append(icon, label);
    const state = el('span', m.connected ? (m.ready ? 'badge ready' : 'badge') : 'badge off');
    state.textContent = m.connected ? (m.ready ? 'Listo' : 'Esperando') : 'Desconectado';
    state.dataset.testid = 'member-state';
    li.append(left, state);
    list.append(li);
  }

  const me = room.members.find((m) => m.userId === user?.id);
  const isHost = me?.host === true;
  const open = room.phase === 'lobby' || room.phase === 'countdown';
  $('btn-ready').textContent = me?.ready ? 'Cancelar listo' : 'Estoy listo';
  $<HTMLButtonElement>('btn-ready').disabled = !open;

  const startBtn = $<HTMLButtonElement>('btn-start');
  startBtn.hidden = !isHost;
  startBtn.disabled = room.phase !== 'lobby' || !room.canStart;

  const settingsBox = $('room-settings');
  settingsBox.hidden = !isHost;
  if (isHost) {
    if (setModeSelect.value !== room.mode) setModeSelect.value = room.mode;
    fillMapSelect(setMapSelect, room.mode);
    setMapSelect.value = room.map;
    setFormatSelect.value = room.format;
    if (room.teamSize > 0 && room.mode === 'territorio')
      setTeamSizeSelect.value = String(room.teamSize);
    $('set-bots-field').hidden = room.mode !== 'br';
    $('set-format-field').hidden = room.mode !== 'techo';
    $('set-teamsize-field').hidden = room.mode !== 'territorio';
    setBotsSelect.value = String(room.bots);
    $<HTMLInputElement>('set-private').checked = room.isPrivate;
    for (const o of setBotsSelect.options) {
      const n = o.value === BOTS_FILL ? 0 : Number(o.value);
      o.disabled = room.members.length > maxHumans(n);
    }
    for (const c of settingsBox.querySelectorAll<HTMLElement>('select, input'))
      (c as HTMLSelectElement | HTMLInputElement).disabled = !open;
  }

  const status = $('room-status');
  if (!room.canStart && room.teamSize > 0)
    status.textContent = 'Hay más personas en un equipo de las que caben: pasen a otro equipo.';
  else if (room.phase === 'countdown') status.textContent = 'Iniciando…';
  else if (room.phase === 'playing') status.textContent = 'Partida en curso';
  else if (room.phase === 'ended') status.textContent = 'Partida terminada, preparando la sala...';
  else if (!room.canStart)
    status.textContent = 'Faltan jugadores: sin bots hacen falta al menos 2 personas.';
  else
    status.textContent = `Listos: ${ready} de ${room.members.length}. ${
      isHost
        ? 'Empieza cuando todos estén listos o cuando pulses Iniciar ya.'
        : 'Empieza cuando todos estén listos o cuando el anfitrión inicie.'
    }`;
}

/** Los dos equipos con sus personas, los lugares de bots y el boton para cambiarte de lado. */
function renderTeamBoard(state: RoomState): void {
  const board = $('team-board');
  board.hidden = state.teamSize <= 0;
  board.replaceChildren();
  if (state.teamSize <= 0) return;
  const me = state.members.find((m) => m.userId === user?.id);
  const open = state.phase === 'lobby' || state.phase === 'countdown';
  for (const team of [0, 1] as const) {
    const box = el('section', 'team');
    box.dataset.testid = `team-${team}`;
    box.style.setProperty('--team', TEAM_COLORS[team]);
    const mates = state.members.filter((m) => (m.team ?? 0) === team);
    const head = el('div', 'team-head');
    head.append(
      el('strong', '', `Equipo ${TEAM_NAMES[team]}`),
      el('span', 'muted', `${mates.length}/${state.teamSize}`),
    );
    box.append(head);
    const ul = el('ul', 'member-list');
    for (const m of mates) {
      const li = el('li');
      li.dataset.testid = 'member';
      li.dataset.name = m.name;
      const left = el('div', 'who');
      const icon = el('canvas');
      drawCatIcon(icon, m.skin, 2);
      const label = el('div');
      label.append(el('strong', '', m.name));
      if (m.host) label.append(el('span', 'badge', 'anfitrión'));
      left.append(icon, label);
      const badge = el('span', m.connected ? (m.ready ? 'badge ready' : 'badge') : 'badge off');
      badge.textContent = m.connected ? (m.ready ? 'Listo' : 'Esperando') : 'Desconectado';
      badge.dataset.testid = 'member-state';
      li.append(left, badge);
      ul.append(li);
    }
    for (let k = mates.length; k < state.teamSize; k++) {
      const li = el('li', 'team-open');
      li.append(el('span', 'muted', 'Un bot ocupará este lugar'));
      ul.append(li);
    }
    box.append(ul);
    if (me && (me.team ?? 0) !== team) {
      const b = el('button', 'btn small', 'Pasarme a este equipo');
      b.type = 'button';
      b.dataset.testid = `btn-team-${team}`;
      b.disabled = !open || mates.length >= state.teamSize;
      b.addEventListener('click', async () => {
        const res = await net?.ack('room:team', { team });
        if (res && !res.ok) toast(ERRORS[res.error] ?? 'No se pudo cambiar de equipo');
      });
      box.append(b);
    }
    board.append(box);
  }
}

// ---------------------------------------------------------------- partida

const limiter = new FrameLimiter(60);
let raf = 0;
let lastTick = 0;
let lastRender = 0;
let frames = 0;
let fpsStart = 0;
let fps = 0;
let lastHud = 0;
let drawMs = 0;
let deathTimer: number | null = null;
let tipTimer: number | null = null;
let resultsTimer: number | null = null;

function startGame(payload: GameStartPayload): void {
  if (!net) return;
  gotStateSinceConnect = true;
  countdownEl.hidden = true;
  resultsEl.hidden = true;
  deathEl.hidden = true;
  specBar.hidden = true;
  showView('game');
  navigate('/play');
  game = new ClientBR(payload, net, input, sfx);
  game.onInventory = () => inventory.refresh();
  game.onLootChanged = () => {
    if (game?.loot) inventory.open();
    else inventory.refresh();
  };
  renderer.setGame(game);
  if (DEBUG) {
    (window as unknown as { __game?: ClientBR; __net?: Net }).__game = game;
    (window as unknown as { __net?: Net }).__net = net;
  }
  input.active = true;
  applyMode(input.mode);
  // El sonido y el cartel de inicio los pone la cuenta regresiva (o, sin ella, no hay ninguno).
  sfx.startAmbient(payload.map as MapKind);
  if (tipTimer !== null) window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => {
    tipTimer = null;
    // el consejo de buscar un cofre solo sirve en el Battle Royale (en equipos nadie abre cofres)
    if (!game || !game.alive || game.result || game.mode !== 'br') return;
    const how =
      input.mode === 'touch'
        ? 'Acércate a un cofre y toca ABRIR'
        : `Busca un cofre: acércate y pulsa ${keyLabel(input.keys.interact).toUpperCase()}`;
    game.say(how, 'good', 4500);
  }, 9000);
  if (!raf) {
    lastTick = lastRender = fpsStart = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const g = game;
  if (!g || !net) return;
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  g.update(dt);
  if (!limiter.shouldRender(now)) return;

  const rdt = Math.min(0.1, (now - lastRender) / 1000);
  lastRender = now;
  const t0 = performance.now();
  renderer.draw(now, rdt);
  drawMs += (performance.now() - t0 - drawMs) * 0.1;

  frames++;
  if (now - fpsStart >= 500) {
    fps = Math.round((frames * 1000) / (now - fpsStart));
    frames = 0;
    fpsStart = now;
  }
  if (now - lastHud >= 100) {
    lastHud = now;
    updateHud(g, net);
    watchLoot(g);
  }
}

function updateHud(g: ClientBR, n: Net): void {
  const x = Math.round(g.x);
  const y = Math.round(g.y);
  const coords = $('hud-coords');
  if (coords.dataset.x !== String(x) || coords.dataset.y !== String(y)) {
    coords.dataset.x = String(x);
    coords.dataset.y = String(y);
    coords.textContent = `${x}, ${y}`;
  }
  $('hud-fps').textContent = `${fps} FPS`;
  $('hud-rtt').textContent = n.connected ? `ping ${Math.round(n.rttMedian)} ms` : 'sin red';
  $('hud-rtt').dataset.q =
    !n.connected || n.rttMedian >= 160 ? 'bad' : n.rttMedian >= 100 ? 'warn' : 'ok';
  // por equipos nadie "queda en un puesto": el eliminado mira a su equipo mientras dura la ronda
  if (g.pvp) specBar.hidden = g.alive || g.pvp.phase !== 'fight' || g.result !== null;
  if (!specBar.hidden) {
    const spec = g.latest?.spectating;
    $('spec-name').textContent =
      spec !== undefined ? (g.cats.get(spec)?.name ?? 'Observando') : 'Observando';
  }
  window.__cybergrid = {
    fps,
    rtt: Math.round(n.rttMedian * 10) / 10,
    x,
    y,
    mode: input.mode,
    snapshots: g.snapshotsPerSecond,
    connected: n.connected,
    quality: renderer.scale,
    hp: Math.round(g.me?.hp ?? 0),
    alive: g.alive,
    players: g.latest?.alive ?? 0,
    intro: g.intro,
    drawMs: Math.round(drawMs * 100) / 100,
    daytime: Math.round(renderer.daylight.p * 1000) / 1000,
    dayName: renderer.daylight.name,
    pvpPhase: g.pvp?.phase ?? '',
    round: g.pvp?.round ?? 0,
    wins: g.pvp ? `${g.pvp.wins[0]}-${g.pvp.wins[1]}` : '',
    advRoom: g.adv?.room ?? -1,
    advLives: g.adv?.lives ?? -1,
    advMobs: g.latest?.mobs?.length ?? 0,
    advChoice: g.adv?.choice?.length ?? 0,
    advRelics: g.adv?.relics.length ?? 0,
    advClosed: g.closedRooms.size,
  };
}

/** Si te alejas del cofre mientras esta abierto, se cierra solo. */
function watchLoot(g: ClientBR): void {
  if (!g.loot) return;
  const box = g.boxes.find((b) => b[0] === g.loot?.id);
  if (!box || Math.hypot(box[1] - g.x, box[2] - g.y) > CAT.interactRange + 14) inventory.close();
}

async function doInteract(): Promise<void> {
  const g = game;
  if (!g || !g.alive || g.result) return;
  if (inventory.isOpen && g.loot) {
    inventory.close();
    return;
  }
  const box = g.nearestBox();
  if (!box) {
    toast('No hay nada cerca para abrir');
    return;
  }
  const loot = await g.interact();
  if (loot) sfx.pickup();
}

function toggleMenu(): void {
  if (canvas.hidden || resultsEl.hidden === false) return;
  const open = menuEl.hidden;
  menuEl.hidden = !open;
  $('btn-quit').textContent = 'Salir de la partida';
  quitArmed = false;
  input.active = !open;
  if (open) $('menu-resume').focus({ preventScroll: true });
}

let quitArmed = false;

function onDied(payload: DiedPayload): void {
  if (!game) return;
  game.onDied(payload);
  inventory.close();
  if (deathTimer !== null) window.clearTimeout(deathTimer);
  deathTimer = window.setTimeout(() => {
    deathTimer = null;
    if (!game || game.result) return;
    $('death-sub').textContent = payload.killerName
      ? `${payload.killerName} te eliminó. Quedaste en el puesto ${payload.placement}, con ${payload.kills} ${payload.kills === 1 ? 'baja' : 'bajas'}.`
      : `La ola te alcanzó. Quedaste en el puesto ${payload.placement}, con ${payload.kills} ${payload.kills === 1 ? 'baja' : 'bajas'}.`;
    deathEl.hidden = false;
    $('btn-spectate').focus({ preventScroll: true });
  }, 1100);
}

$('btn-spectate').addEventListener('click', () => {
  deathEl.hidden = true;
  specBar.hidden = false;
});
$('spec-prev').addEventListener('click', () => game?.spectate(-1));
$('spec-next').addEventListener('click', () => game?.spectate(1));

function placementText(n: number): string {
  return `#${n}`;
}

function endGame(payload: GameEndPayload): void {
  if (!game) return;
  game.onEnd(payload);
  deathEl.hidden = true;
  specBar.hidden = true;
  menuEl.hidden = true;
  inventory.close();
  const me = payload.rows.find((r) => r.id === game?.you);
  const advGame = payload.adv !== undefined;
  $('results-adv').hidden = !advGame;
  if (advGame && payload.adv) showAdventureResults(payload, me);
  const teamGame = payload.winnerTeam !== undefined;
  const myTeam = game.teamOf(game.you);
  const win = advGame
    ? payload.adv?.victory === true
    : teamGame
      ? payload.winnerTeam === myTeam
      : payload.winnerId === game.you;
  const title = $('results-title');
  title.textContent = advGame
    ? win
      ? '¡EL BOSQUE ESTÁ A SALVO!'
      : 'El bosque los venció'
    : win
      ? teamGame
        ? '¡VICTORIA DEL EQUIPO!'
        : '¡VICTORIA REAL!'
      : 'Fin de la partida';
  title.dataset.win = String(win);
  const winner = payload.rows.find((r) => r.placement === 1);
  if (advGame && payload.adv) {
    $('results-sub').textContent = win
      ? `Derrotaron al Rey Gato de las Sombras en ${fmtClock(payload.durationS)}.`
      : `Llegaron a la sala ${Math.min(payload.adv.totalRooms, payload.adv.rooms + 1)} de ${payload.adv.totalRooms}. Cada intento los hace más fuertes.`;
  } else if (teamGame) {
    const score = payload.score ?? [0, 0];
    const name =
      payload.winnerTeam === null ? 'Nadie' : `Equipo ${TEAM_NAMES[payload.winnerTeam as 0 | 1]}`;
    $('results-sub').textContent =
      `${name} gana ${Math.max(...score)} a ${Math.min(...score)} en rondas. ${me?.kills ?? 0} bajas tuyas.`;
  } else {
    $('results-sub').textContent = win
      ? `Eres el último gato en pie. ${me?.kills ?? 0} bajas en ${Math.round(payload.durationS)} s.`
      : `${winner ? `Ganó ${winner.name}. ` : ''}Quedaste en el puesto ${me?.placement ?? '?'} de ${payload.rows.length}.`;
  }
  const head = $('results-head');
  head.replaceChildren();
  (advGame
    ? ['Gato', 'Bajas', 'Daño', 'Esencia']
    : ['Puesto', 'Gato', 'Bajas', 'Daño', 'Tiempo']
  ).forEach((t) => head.append(el('th', '', t)));
  const body = $('results-body');
  body.replaceChildren();
  for (const r of [...payload.rows].sort((a, b) => a.placement - b.placement)) {
    const tr = el('tr', r.id === game.you ? 'me' : '');
    (advGame
      ? [r.name, String(r.kills), String(r.damageDealt), `+${payload.adv?.essence[r.id] ?? 0}`]
      : [
          teamGame ? (r.placement === 1 ? 'Ganó' : 'Perdió') : placementText(r.placement),
          r.name + (r.bot ? ' (bot)' : ''),
          String(r.kills),
          String(r.damageDealt),
          `${Math.round(r.survivalS)} s`,
        ]
    ).forEach((t) => tr.append(el('td', '', t)));
    body.append(tr);
  }
  if (resultsTimer !== null) window.clearTimeout(resultsTimer);
  resultsTimer = window.setTimeout(
    () => {
      resultsTimer = null;
      if (game?.result) {
        resultsEl.hidden = false;
        input.active = false;
        $('btn-back').focus({ preventScroll: true });
        // En pantallas bajas la tabla se desplaza: se deja a la vista la fila del jugador.
        document.querySelector('#results-body tr.me')?.scrollIntoView({ block: 'nearest' });
      }
    },
    win ? 1600 : 900,
  );
}

const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Aventura: resumen, reliquias reunidas y la esencia lunar que se lleva este gato. */
function showAdventureResults(
  payload: GameEndPayload,
  me: GameEndPayload['rows'][number] | undefined,
): void {
  const adv = payload.adv;
  if (!adv) return;
  const stats = $('adv-stats');
  stats.replaceChildren();
  const add = (value: string, label: string): void => {
    const li = el('li');
    li.append(el('b', '', value), el('span', '', label));
    stats.append(li);
  };
  add(`${adv.rooms}/${adv.totalRooms}`, 'salas superadas');
  add(`${adv.bosses}/6`, 'jefes derrotados');
  add(String(adv.kills), 'enemigos vencidos');
  add(fmtClock(payload.durationS), 'tiempo');
  const relics = $('adv-relics');
  relics.replaceChildren();
  for (const id of adv.relics) {
    const c = el('canvas');
    const icon = relicIcon(id);
    c.width = icon.width;
    c.height = icon.height;
    (c.getContext('2d') as CanvasRenderingContext2D).drawImage(icon, 0, 0);
    c.title = RELICS[id]?.name ?? '';
    relics.append(c);
  }
  const mine = me ? (adv.essence[me.id] ?? 0) : 0;
  if (game && !game.essenceBanked) {
    game.essenceBanked = true;
    shrine.bank(mine, adv.rooms, adv.victory);
  }
  $('adv-essence').textContent = `+${mine} de esencia lunar (en tu bolsa: ${shrine.save.essence})`;
}

function leaveGameView(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (deathTimer !== null) window.clearTimeout(deathTimer);
  if (resultsTimer !== null) window.clearTimeout(resultsTimer);
  if (tipTimer !== null) window.clearTimeout(tipTimer);
  deathTimer = resultsTimer = tipTimer = null;
  sfx.stopAmbient();
  game = null;
  renderer.setGame(null);
  window.__cybergrid = undefined;
}

async function quitToLobby(): Promise<void> {
  if (!net) return;
  await net.ack('room:leave');
  room = null;
  countdownEl.hidden = true;
  leaveGameView();
  navigate('/lobby');
  void enterLobby();
}

$('btn-quit').addEventListener('click', () => {
  if (!quitArmed) {
    quitArmed = true;
    $('btn-quit').textContent = 'Toca otra vez para salir';
    return;
  }
  menuEl.hidden = true;
  void quitToLobby();
});
$('menu-resume').addEventListener('click', () => toggleMenu());
$('menu-settings').addEventListener('click', () => {
  settings.open('keys');
});
$('btn-death-leave').addEventListener('click', () => void quitToLobby());
$('spec-leave').addEventListener('click', () => void quitToLobby());
bagBtn.addEventListener('click', () => inventory.toggle());
menuBtn.addEventListener('click', () => toggleMenu());

$('btn-back').addEventListener('click', () => {
  resultsEl.hidden = true;
  leaveGameView();
  navigate('/lobby');
  void enterLobby();
});

window.addEventListener(
  'keydown',
  (e) => {
    if (e.code === 'Escape') {
      if (settings.isOpen) {
        e.stopImmediatePropagation();
        if (!$('touch-editor').hidden) return;
        settings.close();
        return;
      }
      if (!menuEl.hidden) {
        e.stopImmediatePropagation();
        toggleMenu();
        return;
      }
      return;
    }
    const g = game;
    if (g && !g.alive && !g.result && deathEl.hidden && !(e.target instanceof HTMLInputElement)) {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') g.spectate(-1);
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') g.spectate(1);
    }
  },
  true,
);

document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
// Clic de interfaz en cualquier boton de las pantallas (no en el canvas del juego).
document.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('button:not([disabled])')) sfx.click();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('popstate', () => {
  if (game && !game.result) navigate('/play');
});

// ---------------------------------------------------------------- arranque

async function boot(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('12px "Press Start 2P"'),
      document.fonts.load('20px VT323'),
    ]);
  } catch {
    // si las fuentes no cargan se usa la fuente del sistema
  }
  startWalker($<HTMLCanvasElement>('auth-cat'), () => authSkin, 4);
  const problem = new URLSearchParams(window.location.search).get('error');
  try {
    user = await api.me();
  } catch {
    showAuth('No se pudo conectar con el servidor');
    return;
  }
  if (!user) {
    showAuth(authErrorText(problem));
    return;
  }
  navigate('/lobby', true);
  await enterLobby();
}

const authSkin = randomSkin(createRng((Math.random() * 2 ** 31) >>> 0));
void boot();

declare global {
  interface Window {
    __cybergrid?: {
      fps: number;
      rtt: number;
      x: number;
      y: number;
      mode: string;
      snapshots: number;
      connected: boolean;
      quality: number;
      hp: number;
      alive: boolean;
      players: number;
      intro: number;
      drawMs: number;
      daytime: number;
      dayName: string;
      pvpPhase: string;
      round: number;
      wins: string;
      advRoom: number;
      advLives: number;
      advMobs: number;
      advChoice: number;
      advRelics: number;
      advClosed: number;
    };
  }
}
