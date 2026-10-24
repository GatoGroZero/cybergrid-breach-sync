import '@fontsource/orbitron/latin-700.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './styles.css';

import type { GameEndPayload, GameStartPayload, PublicRoom, RoomState } from '../shared/protocol';
import { credentialsSchema } from '../shared/protocol';
import type { Snapshot } from '../shared/types';
import { FrameLimiter } from '../shared/timing';
import { api, ApiError, type User } from './api';
import { Sfx } from './audio';
import { ClientGame } from './game';
import { Input } from './input';
import { Net } from './net';
import { Renderer } from './render';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('game');
const screenAuth = $('screen-auth');
const screenLobby = $('screen-lobby');
const hud = $('hud');
const btnMute = $<HTMLButtonElement>('btn-mute');
const countdownEl = $('countdown');
const resultsEl = $('results');

const sfx = new Sfx();
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
};

let user: User | null = null;
let net: Net | null = null;
let room: RoomState | null = null;
let game: ClientGame | null = null;
let input: Input | null = null;
let renderer: Renderer | null = null;
let roomsTimer: number | null = null;
let lastCountdown = -1;
let toastTimer: number | null = null;

// ---------------------------------------------------------------- utilidades de interfaz

function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type View = 'auth' | 'lobby' | 'game';

function showView(view: View): void {
  screenAuth.hidden = view !== 'auth';
  screenLobby.hidden = view !== 'lobby';
  canvas.hidden = view !== 'game';
  hud.hidden = view !== 'game';
  btnMute.hidden = view !== 'game';
  document.body.classList.toggle('playing', view === 'game');
  if (input) input.active = view === 'game';
  if (view === 'game') renderer?.resize();
}

function navigate(path: string, replace = false): void {
  if (location.pathname === path) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
}

// ---------------------------------------------------------------- autenticacion

let authMode: 'login' | 'register' = 'login';

function setAuthMode(mode: 'login' | 'register'): void {
  authMode = mode;
  $('tab-login').classList.toggle('is-active', mode === 'login');
  $('tab-register').classList.toggle('is-active', mode === 'register');
  $('tab-login').setAttribute('aria-selected', String(mode === 'login'));
  $('tab-register').setAttribute('aria-selected', String(mode === 'register'));
  $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  $<HTMLInputElement>('auth-pass').autocomplete =
    mode === 'login' ? 'current-password' : 'new-password';
  $('auth-error').textContent = '';
}

function showAuth(message = ''): void {
  user = null;
  room = null;
  setAuthMode('login');
  showView('auth');
  navigate('/login', true);
  $('auth-error').textContent = message;
}

$('tab-login').addEventListener('click', () => setAuthMode('login'));
$('tab-register').addEventListener('click', () => setAuthMode('register'));
$('fill-demo').addEventListener('click', () => {
  $<HTMLInputElement>('auth-user').value = 'demo1';
  $<HTMLInputElement>('auth-pass').value = 'CyberGrid26';
  setAuthMode('login');
});

$<HTMLFormElement>('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = $('auth-error');
  const submit = $<HTMLButtonElement>('auth-submit');
  const username = $<HTMLInputElement>('auth-user').value.trim();
  const password = $<HTMLInputElement>('auth-pass').value;
  errorEl.textContent = '';

  if (authMode === 'register') {
    const parsed = credentialsSchema.safeParse({ username, password });
    if (!parsed.success) {
      errorEl.textContent = parsed.error.issues[0]?.message ?? 'Datos inválidos';
      return;
    }
  } else if (!username || !password) {
    errorEl.textContent = 'Escribe tu usuario y tu contraseña';
    return;
  }

  submit.disabled = true;
  try {
    user =
      authMode === 'login'
        ? await api.login(username, password)
        : await api.register(username, password);
    $<HTMLInputElement>('auth-pass').value = '';
    navigate('/lobby');
    await enterLobby();
  } catch (err) {
    errorEl.textContent =
      err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor';
  } finally {
    submit.disabled = false;
  }
});

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
  stopRoomsPolling();
  net?.close();
  net = null;
  room = null;
  game = null;
}

// ---------------------------------------------------------------- lobby

function setNetChip(online: boolean): void {
  const chip = $('lobby-net');
  chip.dataset.state = online ? 'online' : 'offline';
  chip.textContent = online ? 'conectado' : 'sin conexión';
}

async function enterLobby(): Promise<void> {
  if (!user) return;
  showView('lobby');
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
}

function wireNet(n: Net): void {
  const s = n.socket;
  s.on('connect', () => setNetChip(true));
  s.on('disconnect', () => setNetChip(false));
  s.on('session:replaced', () => {
    disconnect();
    showAuth('Abriste tu sesión en otra pestaña');
  });
  s.on('room:state', (state: RoomState) => {
    room = state;
    renderRoom();
    updateCountdown(state);
  });
  s.on('game:start', (payload: GameStartPayload) => startGame(payload));
  s.on('game:snap', (snap: Snapshot) => game?.onSnapshot(snap));
  s.on('game:end', (payload: GameEndPayload) => endGame(payload));
}

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
  if (!res.ok) return;
  const list = $('room-list');
  list.replaceChildren();
  const rooms = res.data ?? [];
  $('room-empty').hidden = rooms.length > 0;
  for (const r of rooms) {
    const li = el('li');
    const info = el('div');
    info.append(
      el('strong', '', r.name),
      el('div', 'muted small', `${r.players}/${r.maxPlayers} jugadores`),
    );
    const join = el(
      'button',
      'btn small',
      r.phase === 'lobby' || r.phase === 'countdown' ? 'Entrar' : 'En curso',
    );
    join.type = 'button';
    join.disabled = r.phase === 'playing' || r.phase === 'ended' || r.players >= r.maxPlayers;
    join.addEventListener('click', () => void joinRoom(r.code));
    li.append(info, join);
    list.append(li);
  }
}

function startRoomsPolling(): void {
  stopRoomsPolling();
  roomsTimer = window.setInterval(() => void refreshRooms(), 3000);
}

function stopRoomsPolling(): void {
  if (roomsTimer !== null) window.clearInterval(roomsTimer);
  roomsTimer = null;
}

function lobbyError(code: string | undefined): void {
  $('lobby-error').textContent = code ? (ERRORS[code] ?? 'No se pudo completar la acción') : '';
}

async function createRoom(isPrivate: boolean, name?: string): Promise<boolean> {
  if (!net) return false;
  const res = await net.ack<{ code: string }>('room:create', {
    name: name || undefined,
    isPrivate,
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
  const name = $<HTMLInputElement>('room-name').value.trim();
  await createRoom($<HTMLInputElement>('room-private').checked, name);
});

$<HTMLFormElement>('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await joinRoom($<HTMLInputElement>('join-code').value.trim().toUpperCase());
});

$('btn-solo').addEventListener('click', async () => {
  if (!net) return;
  if (await createRoom(true)) {
    await net.ack('room:ready', { ready: true });
  }
});

$('btn-leave').addEventListener('click', async () => {
  if (!net) return;
  await net.ack('room:leave');
  room = null;
  renderRoom();
  void refreshRooms();
});

$('btn-ready').addEventListener('click', async () => {
  if (!net || !room || !user) return;
  const me = room.members.find((m) => m.userId === user?.id);
  await net.ack('room:ready', { ready: !me?.ready });
});

$('btn-copy').addEventListener('click', async () => {
  if (!room) return;
  try {
    await navigator.clipboard.writeText(room.code);
    toast('Código copiado');
  } catch {
    toast(`Código: ${room.code}`);
  }
});

function renderRoom(): void {
  const inRoom = room !== null;
  $('lobby-browse').hidden = inRoom;
  $('room-view').hidden = !inRoom;
  if (!room || !user) return;

  $('room-title').textContent = room.name;
  $('room-meta').textContent = room.isPrivate ? 'Sala privada: solo con código' : 'Sala pública';
  $('room-code').textContent = room.code;

  const list = $('member-list');
  list.replaceChildren();
  let ready = 0;
  for (const m of room.members) {
    if (m.ready) ready++;
    const li = el('li');
    li.dataset.testid = 'member';
    li.dataset.name = m.name;
    const left = el('div');
    left.append(el('strong', '', m.name));
    if (m.host) left.append(el('span', 'badge', 'anfitrión'));
    const state = el('span', m.connected ? (m.ready ? 'badge ready' : 'badge') : 'badge off');
    state.textContent = m.connected ? (m.ready ? 'Listo' : 'Esperando') : 'Desconectado';
    state.dataset.testid = 'member-state';
    li.append(left, state);
    list.append(li);
  }

  const me = room.members.find((m) => m.userId === user?.id);
  $('btn-ready').textContent = me?.ready ? 'Cancelar listo' : 'Estoy listo';
  const status = $('room-status');
  if (room.phase === 'countdown') status.textContent = 'Todos listos, iniciando…';
  else if (room.phase === 'playing') status.textContent = 'Partida en curso';
  else if (room.phase === 'ended') status.textContent = 'Partida terminada';
  else
    status.textContent = `Listos: ${ready} de ${room.members.length}. La partida empieza cuando todos estén listos.`;
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

function startGame(payload: GameStartPayload): void {
  if (!net) return;
  countdownEl.hidden = true;
  resultsEl.hidden = true;
  showView('game');
  navigate('/play');
  input ??= new Input(canvas);
  input.onFirstGesture = () => sfx.unlock();
  input.onToggleMute = toggleMute;
  input.onModeChange = (mode) => {
    $('hud-mode').textContent = mode === 'touch' ? 'táctil' : 'teclado';
  };
  input.active = true;
  renderer ??= new Renderer(canvas, input);
  renderer.resize();
  game = new ClientGame(payload, net, input, sfx);
  $('hud-mode').textContent = input.mode === 'touch' ? 'táctil' : 'teclado';
  sfx.go();
  if (!raf) {
    lastTick = lastRender = fpsStart = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (!game || !renderer || !net) return;

  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  game.update(dt);
  if (!limiter.shouldRender(now)) return;

  const rdt = Math.min(0.1, (now - lastRender) / 1000);
  lastRender = now;
  renderer.draw(game, rdt, now);

  frames++;
  if (now - fpsStart >= 500) {
    fps = Math.round((frames * 1000) / (now - fpsStart));
    frames = 0;
    fpsStart = now;
  }
  if (now - lastHud >= 100) {
    lastHud = now;
    updateHud(game, net);
  }
}

function updateHud(g: ClientGame, n: Net): void {
  const x = Math.round(g.x);
  const y = Math.round(g.y);
  const coords = $('hud-coords');
  if (coords.dataset.x !== String(x) || coords.dataset.y !== String(y)) {
    coords.dataset.x = String(x);
    coords.dataset.y = String(y);
    coords.textContent = `${x}, ${y}`;
  }
  $('hud-fps').textContent = `${fps} FPS`;
  $('hud-rtt').textContent = n.connected ? `${Math.round(n.rttMedian)} ms` : 'sin red';
  window.__cybergrid = {
    fps,
    rtt: Math.round(n.rttMedian * 10) / 10,
    x,
    y,
    mode: input?.mode ?? 'keyboard',
    snapshots: g.snapshotsPerSecond,
    connected: n.connected,
  };
}

function endGame(payload: GameEndPayload): void {
  if (!game) return;
  game.onEnd(payload);
  const win = payload.result === 'win';
  const title = $('results-title');
  title.textContent = win ? 'Misión cumplida' : 'Misión fallida';
  title.dataset.result = payload.result;
  const reasons = {
    sync: 'Todo el equipo sincronizó en la salida',
    wipe: 'El equipo quedó fuera de línea',
    timeout: 'Se acabó el tiempo',
  } as const;
  $('results-sub').textContent =
    `${reasons[payload.reason]} · ${Math.round(payload.durationS)} s · oleada ${payload.wave}`;
  const body = $('results-body');
  body.replaceChildren();
  for (const p of payload.players) {
    const tr = el('tr');
    const cells = [
      p.name,
      String(p.kills),
      String(p.deaths),
      String(p.damageDealt),
      p.survived ? 'Vivo' : 'Caído',
    ];
    cells.forEach((text) => tr.append(el('td', '', text)));
    body.append(tr);
  }
  window.setTimeout(() => {
    if (game?.result) resultsEl.hidden = false;
  }, 900);
}

$('btn-back').addEventListener('click', () => {
  resultsEl.hidden = true;
  cancelAnimationFrame(raf);
  raf = 0;
  game = null;
  navigate('/lobby');
  void enterLobby();
});

function toggleMute(): void {
  sfx.setMuted(!sfx.muted);
  btnMute.dataset.muted = String(sfx.muted);
  btnMute.textContent = sfx.muted ? 'Sonido: no' : 'Sonido: sí';
}
btnMute.addEventListener('click', toggleMute);
btnMute.dataset.muted = String(sfx.muted);
btnMute.textContent = sfx.muted ? 'Sonido: no' : 'Sonido: sí';

document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('popstate', () => {
  if (game && !game.result) navigate('/play');
});

// ---------------------------------------------------------------- arranque

async function boot(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('700 20px Orbitron'),
      document.fonts.load('600 14px Rajdhani'),
      document.fonts.load('700 14px Rajdhani'),
    ]);
  } catch {
    // si las fuentes no cargan se usa la fuente del sistema
  }
  try {
    user = await api.me();
  } catch {
    showAuth('No se pudo conectar con el servidor');
    return;
  }
  if (!user) {
    showAuth();
    return;
  }
  navigate('/lobby', true);
  await enterLobby();
}

setAuthMode('login');
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
    };
  }
}
