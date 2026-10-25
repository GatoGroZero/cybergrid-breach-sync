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
  /** Joystick de la mira: perilla, y si ya hay linea de mira. */
  aim?: { x: number; y: number; active: boolean; aiming: boolean };
  /** El gato esta corriendo: el aro del joystick se pone amarillo. */
  running?: boolean;
  /** Color del arma en mano (rareza) para la mira. */
  aimColor?: string;
  pressed: Set<TouchId | 'slot'>;
  /** Boton que se esta editando (se resalta). */
  selected?: TouchId | null;
  editing?: boolean;
  interactReady?: boolean;
  /** Con una cura, pocion o muro en la mano y nada que abrir cerca, el boton dice USAR. */
  useLabel?: boolean;
  /** Dibuja el contenido de los objetos; en edicion se muestran casillas vacias. */
  drawSlot?: (c: Circle, i: number) => void;
  bagIcon?: HTMLCanvasElement;
  /** Cara que se dibuja en el boton de emotes. */
  emoteIcon?: HTMLCanvasElement;
  /** La barra de emotes esta abierta (el boton se resalta). */
  emoteOpen?: boolean;
  /** Recarga en curso (0 a 1): el boton de recargar se llena. */
  reloadFrac?: number;
  /** Aventura: el boton de la voltereta y cuanto falta para poder usarla (1 = lista). */
  dash?: { ready: number };
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
    st.selected === 'stick' || st.running ? C.yellow : 'rgba(115,239,247,0.75)',
    st.running ? 'rgba(255,205,117,0.18)' : 'rgba(26,28,44,0.35)',
    st.running ? 5 : 3,
  );
  ring(ctx, { ...stick, r: stick.r * 0.45 }, 'rgba(115,239,247,0.25)', 'rgba(0,0,0,0)', 2);
  // aro punteado: empujar el joystick hasta aqui es correr
  ctx.beginPath();
  ctx.arc(stick.x, stick.y, stick.r * 0.9 * 0.85, 0, Math.PI * 2);
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,205,117,0.5)';
  ctx.stroke();
  ctx.setLineDash([]);
  const knob = {
    x: stick.x + st.stick.x * stick.r * 0.85,
    y: stick.y + st.stick.y * stick.r * 0.85,
    r: stick.r * 0.38,
  };
  ring(
    ctx,
    knob,
    st.running ? C.yellow : C.cyan,
    st.running
      ? 'rgba(255,205,117,0.75)'
      : st.stick.active
        ? 'rgba(115,239,247,0.7)'
        : 'rgba(115,239,247,0.35)',
    3,
  );

  // joystick de la mira
  const aimC = circles.aim;
  const aimSt = st.aim;
  const aiming = aimSt?.aiming === true;
  ring(
    ctx,
    aimC,
    glow('aim') ? C.yellow : aiming ? C.orange : C.red,
    aiming ? 'rgba(239,125,87,0.22)' : 'rgba(177,62,83,0.3)',
    4,
  );
  ctx.beginPath();
  ctx.arc(aimC.x, aimC.y, aimC.r * 0.2, 0, Math.PI * 2);
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(244,244,244,0.4)';
  ctx.stroke();
  ctx.setLineDash([]);
  const kx = aimC.x + (aimSt?.x ?? 0) * aimC.r * 0.72;
  const ky = aimC.y + (aimSt?.y ?? 0) * aimC.r * 0.72;
  ring(
    ctx,
    { x: kx, y: ky, r: aimC.r * 0.34 },
    aiming ? C.orange : C.red,
    aiming ? 'rgba(255,205,117,0.75)' : 'rgba(177,62,83,0.5)',
    3,
  );
  ctx.fillStyle = C.white;
  ctx.font = `${Math.max(8, aimC.r * 0.17)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!aimSt?.active) ctx.fillText('APUNTA', aimC.x, aimC.y + aimC.r * 0.62);

  // interactuar
  const it = circles.interact;
  const hot = st.interactReady || st.useLabel === true;
  const pulse = hot ? 0.55 + 0.45 * Math.sin(performance.now() / 160) : 0;
  ring(
    ctx,
    it,
    glow('interact') ? C.yellow : hot ? C.lime : 'rgba(167,240,112,0.55)',
    hot ? `rgba(167,240,112,${0.25 + pulse * 0.3})` : 'rgba(26,28,44,0.4)',
  );
  ctx.fillStyle = C.white;
  ctx.font = `${Math.max(8, it.r * 0.3)}px ${FONT}`;
  ctx.fillText(st.useLabel ? 'USAR' : 'ABRIR', it.x, it.y);

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

  // emotes
  const em = circles.emote;
  ring(
    ctx,
    em,
    glow('emote') || st.emoteOpen ? C.yellow : 'rgba(148,176,194,0.8)',
    st.emoteOpen ? 'rgba(255,205,117,0.25)' : 'rgba(26,28,44,0.55)',
  );
  if (st.emoteIcon) {
    const k = (em.r * 1.3) / st.emoteIcon.width;
    ctx.drawImage(
      st.emoteIcon,
      em.x - (st.emoteIcon.width * k) / 2,
      em.y - (st.emoteIcon.height * k) / 2,
      st.emoteIcon.width * k,
      st.emoteIcon.height * k,
    );
  }

  // recargar
  const rl = circles.reload;
  const reloading = (st.reloadFrac ?? 0) > 0;
  ring(
    ctx,
    rl,
    glow('reload') ? C.yellow : reloading ? C.cyan : 'rgba(148,176,194,0.8)',
    reloading ? 'rgba(115,239,247,0.22)' : 'rgba(26,28,44,0.55)',
  );
  if (reloading) {
    ctx.beginPath();
    ctx.arc(rl.x, rl.y, rl.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (st.reloadFrac ?? 0));
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.cyan;
    ctx.stroke();
  }
  ctx.fillStyle = C.white;
  ctx.font = `${Math.max(9, rl.r * 0.8)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', rl.x, rl.y + 1);

  // voltereta (solo en la Aventura; al editar la disposicion tambien se ve)
  if (st.dash || st.editing) {
    const dc = circles.dash;
    const ready = st.dash?.ready ?? 1;
    ring(
      ctx,
      dc,
      glow('dash') ? C.yellow : ready >= 1 ? 'rgba(115,239,247,0.9)' : 'rgba(148,176,194,0.6)',
      ready >= 1 ? 'rgba(115,239,247,0.18)' : 'rgba(26,28,44,0.6)',
    );
    if (ready < 1) {
      ctx.beginPath();
      ctx.arc(dc.x, dc.y, dc.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.cyan;
      ctx.stroke();
    }
    // una flecha curva: dar una voltereta
    ctx.beginPath();
    ctx.arc(dc.x, dc.y, dc.r * 0.45, Math.PI * 0.15, Math.PI * 1.55);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ready >= 1 ? C.white : 'rgba(244,244,244,0.5)';
    ctx.stroke();
    ctx.beginPath();
    const tipX = dc.x + Math.cos(Math.PI * 1.55) * dc.r * 0.45;
    const tipY = dc.y + Math.sin(Math.PI * 1.55) * dc.r * 0.45;
    ctx.moveTo(tipX - 5, tipY + 1);
    ctx.lineTo(tipX + 4, tipY - 5);
    ctx.lineTo(tipX + 5, tipY + 5);
    ctx.fillStyle = ready >= 1 ? C.white : 'rgba(244,244,244,0.5)';
    ctx.fill();
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
    ctx.fillStyle = 'rgba(244,244,244,0.9)';
    ctx.textBaseline = 'middle';
    const put = (label: string, x: number, y: number, align: CanvasTextAlign): void => {
      const tw = ctx.measureText(label).width;
      const cx = align === 'center' ? Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, x)) : x;
      ctx.textAlign = align;
      ctx.fillText(label, cx, y);
    };
    for (const id of ['stick', 'aim', 'interact', 'menu', 'emote', 'reload', 'dash'] as const) {
      const c = circles[id];
      put(TOUCH_LABELS[id], c.x, Math.min(h - 8, c.y + c.r + 12), 'center');
    }
    for (const id of ['bag', 'map'] as const) {
      const c = circles[id];
      put(TOUCH_LABELS[id], c.x - c.r - 8, c.y, 'right');
    }
    const first = circles.slots[0] as Circle;
    const mid = circles.slots[2] as Circle;
    put(TOUCH_LABELS.hotbar, mid.x, first.y - first.r - 12, 'center');
  }
  ctx.restore();
}
