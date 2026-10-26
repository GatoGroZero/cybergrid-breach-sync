import type { MateTuple } from '../../shared/br/types';
import { C } from '../pixel/draw';
import { VT, panel, text, type HudFrame } from './hud';
import { hudPrefs, withScale } from './hudprefs';

const ROW = 30;
const ROW_COMPACT = 25;

/**
 * Vida y escudo de tu equipo (Aventura, Territorio, 2 contra 2): asi se ve a tiempo si alguien
 * esta por caer. Las filas se acomodan hacia arriba (PC) o hacia abajo (celular) desde `anchorY`.
 */
export function drawMates(f: HudFrame, x: number, anchorY: number, down: boolean): void {
  const { ctx, g, now } = f;
  const mates = g.mates;
  if (mates.length === 0 || g.result) return;
  const compact = down;
  const row = compact ? ROW_COMPACT : ROW;
  const w = compact ? 118 : 132;
  const total = mates.length * row;
  const top = down ? anchorY : anchorY - total;
  withScale(ctx, x, anchorY, hudPrefs.bars, () => {
    mates.forEach((m: MateTuple, i) => {
      const y = top + i * row;
      drawMate(f, m, x, y, w, row - 3, now);
    });
  });
}

function drawMate(
  f: HudFrame,
  m: MateTuple,
  x: number,
  y: number,
  w: number,
  h: number,
  now: number,
): void {
  const { ctx, g } = f;
  const [id, hp, shield, maxHp, maxShield] = m;
  const down = hp <= 0;
  const frac = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  const danger = !down && frac <= 0.3;
  const pulse = danger && Math.floor(now / 250) % 2 === 0;
  panel(ctx, x, y, w, h, 'rgba(26,28,44,0.78)', down ? '#566c86' : pulse ? C.red : C.black);
  const name = (g.cats.get(id)?.name ?? `Gato ${id}`).slice(0, 10);
  text(ctx, name, x + 5, y + 8, 17, down ? C.lgray : C.white, 'left', VT, null);
  text(
    ctx,
    down ? 'CAIDO' : `${hp}`,
    x + w - 5,
    y + 8,
    17,
    down ? C.red : danger ? C.red : C.lime,
    'right',
    VT,
    null,
  );
  if (down) return;
  const bw = w - 10;
  const bx = x + 5;
  const by = y + h - 9;
  ctx.fillStyle = '#333c57';
  ctx.fillRect(bx, by, bw, 4);
  ctx.fillStyle = danger ? '#d94a63' : '#e0566d';
  ctx.fillRect(bx, by, Math.round(bw * frac), 4);
  ctx.fillStyle = '#333c57';
  ctx.fillRect(bx, by + 5, bw, 3);
  ctx.fillStyle = '#3b7fe0';
  ctx.fillRect(bx, by + 5, Math.round((bw * Math.max(0, shield)) / Math.max(1, maxShield)), 3);
}
