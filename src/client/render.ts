import {
  EXIT,
  ITEM_KINDS,
  MAP_H,
  MAP_W,
  NODE,
  PLAYER,
  STATUS,
  TILE,
  VIEW_H,
  VIEW_W,
  WORLD_H,
  WORLD_W,
} from '../shared/constants';
import { isWallTile } from '../shared/map';
import { colorOf, type ClientGame, type DroneView } from './game';
import { actionCircle, joystickCircle, slotCircle, type Input } from './input';

const C = {
  bg: '#04060c',
  floorA: '#0a1428',
  floorB: '#0b172d',
  floorC: '#091224',
  grid: '#133257',
  wall: '#05080f',
  wallEdge: '#19f2ff',
  cyan: '#19f2ff',
  magenta: '#ff2bd6',
  amber: '#ffb020',
  green: '#3dff8b',
  red: '#ff3b5c',
  text: '#e8faff',
  dim: '#7a93b3',
};

const DRONE_COLOR = ['#ff3b5c', '#c85bff', '#ff9d2e'];
const ITEM_COLOR = ['#3dff8b', '#ffb020', '#4da3ff'];
const ITEM_NAME = ['PARCHE', 'OVERCLOCK', 'EMP'];

const tileHash = (x: number, y: number): number => ((x * 73856093) ^ (y * 19349663)) >>> 0;

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  cssW = 960;
  cssH = 540;
  private readonly glows = new Map<string, HTMLCanvasElement>();
  private minimap: HTMLCanvasElement | null = null;
  private minimapSeed = -1;
  private minimapW = 168;
  private minimapH = 105;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: Input,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Este navegador no soporta Canvas 2D');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.resize(), 120));
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
  }

  resize(): void {
    const w = Math.max(320, Math.round(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(240, Math.round(this.canvas.clientHeight || window.innerHeight));
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Tope de pixeles: en celulares de alta densidad un lienzo enorme baja los cuadros por segundo.
    while (w * h * dpr * dpr > 2_600_000 && dpr > 1) dpr = Math.max(1, dpr - 0.25);
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    this.input.layout = { w, h };
    this.minimapW = w < 700 ? 120 : 168;
    this.minimapH = Math.round((this.minimapW * MAP_H) / MAP_W);
    this.minimapSeed = -1;
  }

  /** Pantalla de espera mientras no hay partida. */
  clear(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.fillStyle = C.bg;
    this.ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  private glow(color: string, size: number): HTMLCanvasElement {
    const key = `${color}|${size}`;
    let sprite = this.glows.get(key);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = size * 2;
      const g = sprite.getContext('2d') as CanvasRenderingContext2D;
      const grad = g.createRadialGradient(size, size, 0, size, size, size);
      grad.addColorStop(0, color);
      grad.addColorStop(0.35, `${color}66`);
      grad.addColorStop(1, `${color}00`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size * 2, size * 2);
      this.glows.set(key, sprite);
    }
    return sprite;
  }

  private drawGlow(x: number, y: number, color: string, size: number, alpha = 1): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.glow(color, 32), x - size, y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  draw(game: ClientGame, dt: number, now: number): void {
    const ctx = this.ctx;
    const fx = game.fx;
    fx.update(dt);
    game.processEvents();
    const world = game.sampleWorld();

    // --- camara: sigue al jugador (o a un companero vivo si estas fuera de linea)
    const scale = Math.min(this.cssW / VIEW_W, this.cssH / VIEW_H);
    const viewW = this.cssW / scale;
    const viewH = this.cssH / scale;
    let fx0 = game.drawX;
    let fy0 = game.drawY;
    if (game.dead) {
      for (const p of world.players.values()) {
        if (p.id !== game.you && (p.status & STATUS.dead) === 0) {
          fx0 = p.x;
          fy0 = p.y;
          break;
        }
      }
    }
    const camX =
      viewW >= WORLD_W ? WORLD_W / 2 : Math.min(WORLD_W - viewW / 2, Math.max(viewW / 2, fx0));
    const camY =
      viewH >= WORLD_H ? WORLD_H / 2 : Math.min(WORLD_H - viewH / 2, Math.max(viewH / 2, fy0));
    const cam = game.camera;
    cam.x = camX;
    cam.y = camY;
    cam.scale = scale;
    cam.cssW = this.cssW;
    cam.cssH = this.cssH;

    const sx = fx.shake > 0 ? (Math.random() - 0.5) * fx.shake : 0;
    const sy = fx.shake > 0 ? (Math.random() - 0.5) * fx.shake : 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const k = this.dpr * scale;
    ctx.setTransform(
      k,
      0,
      0,
      k,
      (this.cssW / 2 + sx - camX * scale) * this.dpr,
      (this.cssH / 2 + sy - camY * scale) * this.dpr,
    );

    this.drawMap(game, camX, camY, viewW, viewH);
    this.drawObjectives(game, now);
    this.drawPickups(game, now);

    for (const p of world.projectiles.values()) this.drawProjectile(p.x, p.y, p.owner);
    for (const d of world.drones.values()) this.drawDrone(d, now);

    const aim = game.aimAngle;
    for (const p of world.players.values()) {
      const isMe = p.id === game.you;
      this.drawPlayer(
        game,
        isMe ? game.drawX : p.x,
        isMe ? game.drawY : p.y,
        isMe ? aim : p.ang,
        p.id,
        isMe ? (game.latest?.pl.find((t) => t[0] === p.id)?.[3] ?? p.hp) : p.hp,
        p.status,
        p.respawnIn,
        isMe,
        now,
      );
    }
    fx.draw(ctx);

    // --- interfaz
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(game, world.players, now);
    if (fx.hurtFlash > 0) this.drawHurt(fx.hurtFlash);
    if (this.input.mode === 'touch') this.drawTouchControls(game);
  }

  // ------------------------------------------------------------------ mapa

  private drawMap(
    game: ClientGame,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    const ctx = this.ctx;
    const map = game.map;
    const x0 = Math.max(0, Math.floor((camX - viewW / 2) / TILE) - 1);
    const x1 = Math.min(MAP_W - 1, Math.ceil((camX + viewW / 2) / TILE) + 1);
    const y0 = Math.max(0, Math.floor((camY - viewH / 2) / TILE) - 1);
    const y1 = Math.min(MAP_H - 1, Math.ceil((camY + viewH / 2) / TILE) + 1);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isWallTile(map, tx, ty)) continue;
        const h = tileHash(tx, ty) % 3;
        ctx.fillStyle = h === 0 ? C.floorA : h === 1 ? C.floorB : C.floorC;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    ctx.strokeStyle = C.grid;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ty = y0; ty <= y1 + 1; ty++) {
      ctx.moveTo(x0 * TILE, ty * TILE);
      ctx.lineTo((x1 + 1) * TILE, ty * TILE);
    }
    for (let tx = x0; tx <= x1 + 1; tx++) {
      ctx.moveTo(tx * TILE, y0 * TILE);
      ctx.lineTo(tx * TILE, (y1 + 1) * TILE);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = C.wall;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isWallTile(map, tx, ty)) ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }

    // Bordes de neon solo en los lados de muro que dan al piso.
    ctx.beginPath();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isWallTile(map, tx, ty)) continue;
        const px = tx * TILE;
        const py = ty * TILE;
        if (!isWallTile(map, tx, ty - 1)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + TILE, py);
        }
        if (!isWallTile(map, tx, ty + 1)) {
          ctx.moveTo(px, py + TILE);
          ctx.lineTo(px + TILE, py + TILE);
        }
        if (!isWallTile(map, tx - 1, ty)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + TILE);
        }
        if (!isWallTile(map, tx + 1, ty)) {
          ctx.moveTo(px + TILE, py);
          ctx.lineTo(px + TILE, py + TILE);
        }
      }
    }
    ctx.strokeStyle = C.wallEdge;
    ctx.globalAlpha = 0.13;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawObjectives(game: ClientGame, now: number): void {
    const ctx = this.ctx;
    const t = now / 1000;
    const nodes = game.nodes;
    ctx.textAlign = 'center';
    game.map.nodes.forEach((node, i) => {
      const [pct, open] = nodes[i] ?? [0, 0];
      const color = open ? C.green : C.amber;
      const pulse = 0.6 + 0.4 * Math.sin(t * 3 + i);
      this.drawGlow(node.x, node.y, color, 54, open ? 0.5 : 0.25 + 0.25 * pulse);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const a = (Math.PI / 3) * s + t * (open ? 0 : 0.6);
        const px = node.x + Math.cos(a) * 24;
        const py = node.y + Math.sin(a) * 24;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = open ? 0.28 : 0.1;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE.radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pct / 100));
      ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.font = '700 12px Rajdhani, sans-serif';
      ctx.fillText(
        open ? `NODO ${i + 1} ABIERTO` : `NODO ${i + 1}`,
        node.x,
        node.y - NODE.radius - 8,
      );
    });

    const ex = game.map.exit;
    const open = (game.latest?.ex[0] ?? 0) === 1;
    const sync = game.latest?.ex[1] ?? 0;
    const color = open ? C.magenta : '#3a4a66';
    if (open) this.drawGlow(ex.x, ex.y, C.magenta, 90, 0.35 + 0.25 * Math.sin(t * 4));
    ctx.strokeStyle = color;
    for (let r = 0; r < 3; r++) {
      ctx.globalAlpha = open ? 0.9 - r * 0.25 : 0.5 - r * 0.12;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        ex.x,
        ex.y,
        EXIT.radius - r * 14 + (open ? Math.sin(t * 3 + r) * 3 : 0),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (open && sync > 0) {
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, EXIT.radius + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (sync / 100));
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.font = '700 13px Rajdhani, sans-serif';
    ctx.fillText(open ? 'SALIDA: SINCRONIZAR' : 'SALIDA BLOQUEADA', ex.x, ex.y - EXIT.radius - 10);
  }

  private drawPickups(game: ClientGame, now: number): void {
    const ctx = this.ctx;
    const t = now / 1000;
    for (const [id, kind, x, y] of game.pickups) {
      const bob = Math.sin(t * 4 + id) * 2.5;
      const color = ITEM_COLOR[kind] ?? C.green;
      this.drawGlow(x, y + bob, color, 24, 0.55);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.save();
      ctx.translate(x, y + bob);
      if (ITEM_KINDS[kind] === 'patch') {
        ctx.fillRect(-2.5, -8, 5, 16);
        ctx.fillRect(-8, -2.5, 16, 5);
      } else if (ITEM_KINDS[kind] === 'overclock') {
        ctx.beginPath();
        ctx.moveTo(3, -9);
        ctx.lineTo(-5, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-3, 9);
        ctx.lineTo(6, -2);
        ctx.lineTo(1, -2);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawProjectile(x: number, y: number, owner: number): void {
    const ctx = this.ctx;
    const color = owner === 0 ? C.red : colorOf(owner);
    this.drawGlow(x, y, color, owner === 0 ? 18 : 15, 0.9);
    ctx.fillStyle = owner === 0 ? '#ffd0d8' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, owner === 0 ? 3.6 : 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawDrone(d: DroneView, now: number): void {
    const ctx = this.ctx;
    const t = now / 1000;
    const color = DRONE_COLOR[d.kind] ?? C.red;
    const r = d.kind === 2 ? 15 : 9;
    this.drawGlow(d.x, d.y, color, r * 2.4, 0.4);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (d.kind === 0) {
      ctx.rotate(t * 2.2 + d.id);
      ctx.beginPath();
      ctx.moveTo(0, -r - 2);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r + 2);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (d.kind === 1) {
      ctx.rotate(-t * 1.4 + d.id);
      ctx.beginPath();
      for (let s = 0; s < 3; s++) {
        const a = (Math.PI * 2 * s) / 3 - Math.PI / 2;
        const px = Math.cos(a) * (r + 2);
        const py = Math.sin(a) * (r + 2);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.rotate(t * 0.6 + d.id);
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const a = (Math.PI / 3) * s;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (d.stun) {
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r + 5 + Math.sin(t * 30) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (d.hp < 100) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(d.x - 11, d.y - r - 9, 22, 3);
      ctx.fillStyle = color;
      ctx.fillRect(d.x - 11, d.y - r - 9, 22 * (d.hp / 100), 3);
    }
  }

  private drawPlayer(
    game: ClientGame,
    x: number,
    y: number,
    ang: number,
    id: number,
    hp: number,
    status: number,
    respawnIn: number,
    isMe: boolean,
    now: number,
  ): void {
    const ctx = this.ctx;
    const color = colorOf(id);
    const name = game.names.get(id) ?? `J${id}`;
    ctx.textAlign = 'center';

    if (status & STATUS.dead) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 7);
      ctx.lineTo(x + 7, y + 7);
      ctx.moveTo(x + 7, y - 7);
      ctx.lineTo(x - 7, y + 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (respawnIn > 0) {
        ctx.fillStyle = color;
        ctx.font = '700 12px Rajdhani, sans-serif';
        ctx.fillText(`${name} reinicia en ${Math.ceil(respawnIn)}`, x, y - 16);
      }
      return;
    }

    const blink = status & STATUS.invuln ? (Math.floor(now / 90) % 2 === 0 ? 0.35 : 0.9) : 1;
    ctx.globalAlpha = status & STATUS.disconnected ? 0.35 : blink;
    this.drawGlow(x, y, color, 30, status & STATUS.boosted ? 0.8 : 0.45);

    if (isMe && this.input.mode === 'keyboard' && game.input.mouse) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * 16, y + Math.sin(ang) * 16);
      ctx.lineTo(x + Math.cos(ang) * 120, y + Math.sin(ang) * 120);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = blink;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-9, 9);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-9, -9);
    ctx.closePath();
    ctx.globalAlpha *= 0.28;
    ctx.fill();
    ctx.globalAlpha = status & STATUS.disconnected ? 0.35 : blink;
    ctx.stroke();
    if (status & STATUS.boosted) {
      ctx.fillStyle = C.amber;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-18 - Math.random() * 6, 3);
      ctx.lineTo(-18 - Math.random() * 6, -3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if (isMe) {
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, PLAYER.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 13, y - 24, 26, 3);
      ctx.fillStyle = color;
      ctx.fillRect(x - 13, y - 24, 26 * Math.max(0, hp / PLAYER.maxHp), 3);
      ctx.font = '600 12px Rajdhani, sans-serif';
      ctx.fillStyle = C.text;
      ctx.globalAlpha = 0.85;
      ctx.fillText(name, x, y - 30);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ interfaz

  private panel(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    rrect(ctx, x, y, w, h, 6);
    ctx.fillStyle = 'rgba(4, 8, 18, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(25, 242, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawHud(
    game: ClientGame,
    players: Map<number, { id: number; x: number; y: number; status: number }>,
    now: number,
  ): void {
    const ctx = this.ctx;
    const snap = game.latest;
    const compact = this.cssW < 700;
    const pad = compact ? 8 : 14;
    ctx.textBaseline = 'alphabetic';

    // --- jugador: vida, respaldos, arma
    const hpNow = snap?.pl.find((p) => p[0] === game.you)?.[3] ?? PLAYER.maxHp;
    const lives = snap?.pl.find((p) => p[0] === game.you)?.[6] ?? PLAYER.respawns;
    const pw = compact ? 150 : 200;
    this.panel(pad, pad, pw, compact ? 48 : 58);
    ctx.textAlign = 'left';
    ctx.font = '700 12px Rajdhani, sans-serif';
    ctx.fillStyle = C.dim;
    ctx.fillText('INTEGRIDAD', pad + 10, pad + 17);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(pad + 10, pad + 22, pw - 20, 9);
    const ratio = Math.max(0, hpNow / PLAYER.maxHp);
    ctx.fillStyle = ratio > 0.5 ? C.green : ratio > 0.25 ? C.amber : C.red;
    ctx.fillRect(pad + 10, pad + 22, (pw - 20) * ratio, 9);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(String(hpNow), pad + pw - 10, pad + 17);
    ctx.textAlign = 'left';
    if (!compact) {
      ctx.fillStyle = C.dim;
      ctx.fillText(`RESPALDOS`, pad + 10, pad + 49);
      for (let i = 0; i < PLAYER.respawns; i++) {
        ctx.fillStyle = i < lives ? C.cyan : 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(pad + 86 + i * 14, pad + 45, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.amber;
      ctx.textAlign = 'right';
      ctx.fillText(`ARMA Nv ${snap?.wl ?? 0}`, pad + pw - 10, pad + 49);
    }

    // --- objetivo y reloj (centro)
    const open = snap ? snap.nd.filter((n) => n[1] === 1).length : 0;
    const exitOpen = (snap?.ex[0] ?? 0) === 1;
    const clock = snap?.clock ?? 0;
    const mm = Math.floor(clock / 60);
    const ss = Math.floor(clock % 60);
    const cw = compact ? 200 : 260;
    const cx = this.cssW / 2 - cw / 2;
    this.panel(cx, pad, cw, compact ? 44 : 52);
    ctx.textAlign = 'center';
    ctx.font = '700 20px Orbitron, sans-serif';
    ctx.fillStyle = clock < 30 ? C.red : C.text;
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, this.cssW / 2, pad + 24);
    ctx.font = '700 12px Rajdhani, sans-serif';
    ctx.fillStyle = exitOpen ? C.magenta : C.amber;
    ctx.fillText(
      exitOpen
        ? 'SYNC: TODOS A LA SALIDA'
        : `BREACH ${open}/${NODE.count}  ·  OLEADA ${snap?.wave ?? 0}`,
      this.cssW / 2,
      pad + (compact ? 38 : 42),
    );

    this.drawMinimap(game, players, pad);
    this.drawInventory(game);

    // --- aviso temporal
    const banner = game.banner;
    if (banner && banner.until > now) {
      const a = Math.min(1, (banner.until - now) / 500);
      ctx.globalAlpha = a;
      ctx.font = `700 ${compact ? 15 : 20}px Orbitron, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = banner.tone === 'good' ? C.green : banner.tone === 'bad' ? C.red : C.cyan;
      ctx.fillText(banner.text.toUpperCase(), this.cssW / 2, pad + (compact ? 78 : 96));
      ctx.globalAlpha = 1;
    }

    // --- fuera de linea
    if (game.dead && !game.result) {
      const t = snap?.pl.find((p) => p[0] === game.you);
      const wait = (t?.[7] ?? 0) / 10;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.textAlign = 'center';
      ctx.fillStyle = C.red;
      ctx.font = `700 ${compact ? 20 : 28}px Orbitron, sans-serif`;
      ctx.fillText('FUERA DE LÍNEA', this.cssW / 2, this.cssH / 2 - 8);
      ctx.fillStyle = C.text;
      ctx.font = '600 16px Rajdhani, sans-serif';
      ctx.fillText(
        wait > 0 ? `Reiniciando en ${Math.ceil(wait)} s` : 'Sin respaldos: observas a tu equipo',
        this.cssW / 2,
        this.cssH / 2 + 22,
      );
    }
  }

  private drawMinimap(
    game: ClientGame,
    players: Map<number, { id: number; x: number; y: number; status: number }>,
    pad: number,
  ): void {
    const ctx = this.ctx;
    const mw = this.minimapW;
    const mh = this.minimapH;
    if (!this.minimap || this.minimapSeed !== game.map.seed) {
      const off = document.createElement('canvas');
      off.width = mw;
      off.height = mh;
      const g = off.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = 'rgba(4, 8, 18, 0.78)';
      g.fillRect(0, 0, mw, mh);
      const cw = mw / MAP_W;
      const ch = mh / MAP_H;
      g.fillStyle = 'rgba(25, 242, 255, 0.22)';
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (!isWallTile(game.map, x, y)) g.fillRect(x * cw, y * ch, cw + 0.4, ch + 0.4);
        }
      }
      this.minimap = off;
      this.minimapSeed = game.map.seed;
    }
    const x = this.cssW - mw - pad;
    const y = pad;
    ctx.drawImage(this.minimap, x, y);
    ctx.strokeStyle = 'rgba(25, 242, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, mw - 1, mh - 1);
    const px = (wx: number): number => x + (wx / WORLD_W) * mw;
    const py = (wy: number): number => y + (wy / WORLD_H) * mh;

    game.map.nodes.forEach((n, i) => {
      ctx.fillStyle = game.nodes[i]?.[1] ? C.green : C.amber;
      ctx.fillRect(px(n.x) - 2, py(n.y) - 2, 4, 4);
    });
    if ((game.latest?.ex[0] ?? 0) === 1) {
      ctx.fillStyle = C.magenta;
      ctx.fillRect(px(game.map.exit.x) - 3, py(game.map.exit.y) - 3, 6, 6);
    }
    ctx.fillStyle = C.red;
    for (const d of game.latest?.dr ?? []) ctx.fillRect(px(d[2]) - 1, py(d[3]) - 1, 2, 2);
    for (const p of players.values()) {
      if (p.status & STATUS.dead) continue;
      ctx.fillStyle = colorOf(p.id);
      const mx = p.id === game.you ? game.x : p.x;
      const my = p.id === game.you ? game.y : p.y;
      ctx.beginPath();
      ctx.arc(px(mx), py(my), p.id === game.you ? 3 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawInventory(game: ClientGame): void {
    const ctx = this.ctx;
    const inv = game.inventory;
    const touch = this.input.mode === 'touch';
    for (let i = 0; i < 3; i++) {
      let cx: number;
      let cy: number;
      let r: number;
      if (touch) {
        const c = slotCircle({ w: this.cssW, h: this.cssH }, i);
        cx = c.x;
        cy = c.y;
        r = c.r;
      } else {
        r = 24;
        cx = this.cssW / 2 + (i - 1) * 60;
        cy = this.cssH - 44;
      }
      const item = inv[i] ?? -1;
      const color = item >= 0 ? (ITEM_COLOR[item] ?? C.green) : 'rgba(255,255,255,0.18)';
      ctx.fillStyle = 'rgba(4, 8, 18, 0.72)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = item >= 0 ? 2 : 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      if (item >= 0) {
        ctx.fillStyle = color;
        ctx.font = '700 10px Rajdhani, sans-serif';
        ctx.fillText(ITEM_NAME[item] ?? '', cx, cy + 4);
      }
      if (!touch) {
        ctx.fillStyle = C.dim;
        ctx.font = '700 12px Rajdhani, sans-serif';
        ctx.fillText(String(i + 1), cx, cy - r - 5);
      }
    }
  }

  private drawHurt(amount: number): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.cssW / 2,
      this.cssH / 2,
      Math.min(this.cssW, this.cssH) * 0.35,
      this.cssW / 2,
      this.cssH / 2,
      Math.max(this.cssW, this.cssH) * 0.7,
    );
    g.addColorStop(0, 'rgba(255, 59, 92, 0)');
    g.addColorStop(1, `rgba(255, 59, 92, ${0.55 * amount})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  /** Joystick abajo a la izquierda y boton de accion abajo a la derecha, dibujados en el canvas. */
  private drawTouchControls(game: ClientGame): void {
    void game;
    const ctx = this.ctx;
    const layout = { w: this.cssW, h: this.cssH };
    const stick = joystickCircle(layout);
    const action = actionCircle(layout);
    const s = this.input.stick;

    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.cyan;
    ctx.fillStyle = 'rgba(25, 242, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(stick.x, stick.y, stick.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(stick.x, stick.y, stick.r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = s.active ? 0.85 : 0.5;
    ctx.fillStyle = C.cyan;
    ctx.beginPath();
    ctx.arc(stick.x + s.x * stick.r, stick.y + s.y * stick.r, stick.r * 0.42, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = this.input.actionHeld ? 0.85 : 0.5;
    ctx.strokeStyle = C.magenta;
    ctx.fillStyle = this.input.actionHeld ? 'rgba(255, 43, 214, 0.5)' : 'rgba(255, 43, 214, 0.12)';
    ctx.beginPath();
    ctx.arc(action.x, action.y, action.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = C.text;
    ctx.font = '700 13px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FUEGO', action.x, action.y + 4);
    ctx.globalAlpha = 1;
  }
}
