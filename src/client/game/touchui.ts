import { C } from '../pixel/draw';
import { TOUCH_LABELS, touchCircles, type Circle, type TouchId, type TouchLayout } from './input';

const FONT = "'Press Start 2P', monospace";

function ring(
  ctx: CanvasRenderingContext2D,
  c: Circle,
  stroke: string,
  fill: string,
  width = 3,
): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

export interface TouchDrawState {
  stick: { x: number; y: number; active: boolean };
  pressed: Set<TouchId | 'slot'>;
  /** Boton que se esta editando (se resalta). */
  selected?: TouchId | null;
  editing?: boolean;
  interactReady?: boolean;
  /** Dibuja el contenido de los objetos; en edicion se muestran casillas vacias. */
  drawSlot?: (c: Circle, i: number) => void;
  bagIcon?: HTMLCanvasElement;
}

/** Joystick, fuego, interactuar, inventario, menu, mapa y la barra de objetos, en pixeles CSS. */
export function drawTouchControls(
  ctx: CanvasRenderingContext2D,
  layout: TouchLayout,
  w: number,
  h: number,
  st: TouchDrawState,
): void {
  const circles = touchCircles(layout, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const glow = (id: TouchId): number => (st.selected === id ? 1 : 0);

  // joystick
  const stick = circles.stick;
  ring(
    ctx,
    stick,
    st.selected === 'stick' ? C.yellow : 'rgba(115,239,247,0.75)',
    'rgba(26,28,44,0.35)',
  );
  ring(ctx, { ...stick, r: stick.r * 0.45 }, 'rgba(115,239,247,0.25)', 'rgba(0,0,0,0)', 2);
  const knob = {
    x: stick.x + st.stick.x * stick.r * 0.7,
    y: stick.y + st.stick.y * stick.r * 0.7,
    r: stick.r * 0.38,
  };
  ring(ctx, knob, C.cyan, st.stick.active ? 'rgba(115,239,247,0.7)' : 'rgba(115,239,247,0.35)', 3);

  // fuego
  const fire = circles.fire;
  const firing = st.pressed.has('fire');
  ring(
    ctx,
    fire,
    glow('fire') ? C.yellow : C.red,
    firing ? 'rgba(177,62,83,0.8)' : 'rgba(177,62,83,0.35)',
    4,
  );
  ctx.fillStyle = C.white;
  ctx.font = `${Math.max(9, fire.r * 0.26)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FUEGO', fire.x, fire.y);

  // interactuar
  const it = circles.interact;
  const pulse = st.interactReady ? 0.55 + 0.45 * Math.sin(performance.now() / 160) : 0;
  ring(
    ctx,
    it,
    glow('interact') ? C.yellow : st.interactReady ? C.lime : 'rgba(167,240,112,0.55)',
    st.interactReady ? `rgba(167,240,112,${0.25 + pulse * 0.3})` : 'rgba(26,28,44,0.4)',
  );
  ctx.fillStyle = C.white;
  ctx.font = `${Math.max(8, it.r * 0.3)}px ${FONT}`;
  ctx.fillText('ABRIR', it.x, it.y);

  // inventario (lata de sardinas)
  const bag = circles.bag;
  ring(ctx, bag, glow('bag') ? C.yellow : 'rgba(148,176,194,0.8)', 'rgba(26,28,44,0.55)');
  if (st.bagIcon) {
    const k = (bag.r * 1.5) / st.bagIcon.width;
    ctx.drawImage(
      st.bagIcon,
      bag.x - (st.bagIcon.width * k) / 2,
      bag.y - (st.bagIcon.height * k) / 2,
      st.bagIcon.width * k,
      st.bagIcon.height * k,
    );
  }

  // menu y mapa
  for (const id of ['menu', 'map'] as const) {
    const c = circles[id];
    ring(ctx, c, glow(id) ? C.yellow : 'rgba(148,176,194,0.7)', 'rgba(26,28,44,0.55)', 2);
    ctx.fillStyle = C.white;
    ctx.font = `${Math.max(8, c.r * 0.5)}px ${FONT}`;
    ctx.fillText(id === 'menu' ? '=' : 'M', c.x, c.y + 1);
  }

  // objetos
  if (st.selected === 'hotbar') {
    ctx.strokeStyle = C.yellow;
    ctx.lineWidth = 2;
    const first = circles.slots[0] as Circle;
    const last = circles.slots[4] as Circle;
    ctx.strokeRect(
      first.x - first.r - 4,
      first.y - first.r - 4,
      last.x - first.x + first.r * 2 + 8,
      first.r * 2 + 8,
    );
  }
  circles.slots.forEach((c, i) => {
    if (st.drawSlot) st.drawSlot(c, i);
    else ring(ctx, c, 'rgba(148,176,194,0.7)', 'rgba(26,28,44,0.6)', 2);
  });

  if (st.editing) {
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = 'rgba(244,244,244,0.85)';
    for (const id of ['stick', 'fire', 'interact', 'bag', 'menu', 'map'] as const) {
      const c = circles[id];
      ctx.fillText(TOUCH_LABELS[id], c.x, c.y + c.r + 12);
    }
    const first = circles.slots[2] as Circle;
    ctx.fillText(TOUCH_LABELS.hotbar, first.x, first.y + first.r + 12);
  }
  ctx.restore();
}
