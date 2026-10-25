import { KITS, KIT_IDS, MAX_ROUNDS, TEAM_COLORS, TEAM_NAMES } from '../../shared/br/modes';
import type { Assets } from '../pixel/art';
import { C } from '../pixel/draw';
import { keyLabel } from './input';
import { PIX, VT, panel, text, type HudFrame } from './hud';

const STAT_LABELS: [keyof (typeof KITS)['cazador']['stats'], string][] = [
  ['alcance', 'Alcance'],
  ['dano', 'Daño'],
  ['defensa', 'Defensa'],
  ['area', 'Área'],
];

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** La fuente de los titulos no tiene letras con acento: se escriben sin ellas. */
const plain = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Tamano de letra mas grande (hasta `max`) con el que `s` cabe en `width` pixeles. */
function fitSize(
  ctx: CanvasRenderingContext2D,
  s: string,
  width: number,
  max: number,
  font: string,
): number {
  let size = max;
  ctx.font = `${size}px ${font}`;
  while (size > 11 && ctx.measureText(s).width > width) {
    size -= 1;
    ctx.font = `${size}px ${font}`;
  }
  return size;
}

/** Marcador de la partida por rondas: equipos, rondas ganadas y numero de ronda. */
function drawScoreboard(f: HudFrame, top: number): void {
  const { ctx, g, w } = f;
  const pvp = g.pvp;
  if (!pvp) return;
  const mine = pvp.team >= 0 ? pvp.team : 0;
  const order = [mine, mine === 0 ? 1 : 0] as const;
  const wTot = 300;
  const x0 = Math.round(w / 2 - wTot / 2);
  const y0 = top;
  panel(ctx, x0, y0, wTot, 26, 'rgba(26,28,44,0.86)');
  const half = wTot / 2;
  order.forEach((team, i) => {
    const color = TEAM_COLORS[team] as string;
    const cx = x0 + (i === 0 ? 14 : wTot - 14);
    const align = i === 0 ? 'left' : 'right';
    // las rondas ganadas se ven como bolitas llenas
    const pips = MAX_ROUNDS - 1;
    for (let k = 0; k < pips; k++) {
      const px0 = i === 0 ? x0 + 112 + k * 12 : x0 + wTot - 112 - 8 - k * 12;
      ctx.fillStyle = C.black;
      ctx.fillRect(px0 - 1, y0 + 8, 10, 10);
      ctx.fillStyle = k < (pvp.wins[team] as number) ? color : '#333c57';
      ctx.fillRect(px0, y0 + 9, 8, 8);
    }
    text(ctx, TEAM_NAMES[team] as string, cx, y0 + 14, 17, color, align, VT);
  });
  text(ctx, `RONDA ${pvp.round}`, x0 + half, y0 + 14, 15, C.white, 'center', PIX, null);
}

/** Eleccion de kit: cuatro tarjetas con su arma, su estilo y cuatro barritas. */
function drawPick(f: HudFrame, assets: Assets): void {
  const { ctx, g, w, h, now } = f;
  const pvp = g.pvp;
  if (!pvp || pvp.phase !== 'pick') {
    g.input.kitRects = [];
    return;
  }
  const touch = g.input.mode === 'touch';
  // En pantallas bajas (celular en horizontal) las tarjetas se compactan.
  const compact = h < 560;
  ctx.fillStyle = 'rgba(10,12,24,0.78)';
  ctx.fillRect(0, 0, w, h);

  const title = Math.round(clamp(w * 0.028, 13, 24));
  const top = compact ? f.safe.t + 104 : Math.max(h * 0.17, f.safe.t + 96);
  const left = pvp.left;
  const urgent = left <= 4;
  const numColor = urgent && Math.floor(now / 250) % 2 === 0 ? C.red : C.white;
  if (compact) {
    text(ctx, `RONDA ${pvp.round}: ELIGE TU KIT`, w / 2 - 28, top, title, C.yellow, 'center', PIX);
    ctx.font = `${title}px ${PIX}`;
    const half = ctx.measureText(`RONDA ${pvp.round}: ELIGE TU KIT`).width / 2;
    text(
      ctx,
      String(left),
      w / 2 - 28 + half + 28,
      top,
      Math.round(title * 1.3),
      numColor,
      'center',
      PIX,
    );
  } else {
    text(ctx, `RONDA ${pvp.round}: ELIGE TU KIT`, w / 2, top, title, C.yellow, 'center', PIX);
    text(
      ctx,
      String(left),
      w / 2,
      top + title * 1.9,
      Math.round(title * 1.7),
      numColor,
      'center',
      PIX,
    );
  }

  const gap = Math.round(clamp(w * 0.012, 8, 16));
  const cardW = Math.round(clamp((w - gap * 5) / 4, 110, 210));
  const y0 = compact ? Math.round(top + 24) : Math.round(top + title * 1.9 + 44);
  const footer = compact ? 54 : 100;
  const cardH = compact
    ? Math.min(140, Math.max(112, h - y0 - footer))
    : Math.round(clamp(h - y0 - footer, 190, 270));
  const total = cardW * 4 + gap * 3;
  const x0 = Math.round(w / 2 - total / 2);
  const rowH = compact ? 16 : 20;
  const barW = compact ? 8 : 10;
  g.input.kitRects = [];
  KIT_IDS.forEach((id, i) => {
    const kit = KITS[id];
    const x = x0 + i * (cardW + gap);
    g.input.kitRects.push({ x, y: y0, w: cardW, h: cardH });
    const chosen = pvp.kit === id;
    const lift = chosen ? -6 : 0;
    const cy0 = y0 + lift;
    panel(
      ctx,
      x,
      cy0,
      cardW,
      cardH,
      chosen ? 'rgba(61,72,112,0.98)' : 'rgba(41,54,111,0.92)',
      chosen ? C.yellow : C.black,
    );
    const icon = assets.icon[kit.main];
    const k = compact ? 2 : Math.max(2, Math.min(4, Math.floor(cardW / 52)));
    ctx.imageSmoothingEnabled = false;
    const iconW = icon.width * k;
    const iconH = icon.height * k;
    const nm = plain(kit.name.toUpperCase());
    let ty: number;
    if (compact) {
      // icono a la izquierda y el nombre a su lado
      ctx.drawImage(icon, Math.round(x + 10), Math.round(cy0 + 10), iconW, iconH);
      text(
        ctx,
        nm,
        x + 10 + iconW + 8,
        cy0 + 10 + iconH / 2,
        fitSize(ctx, nm, cardW - iconW - 28, 12, PIX),
        chosen ? C.yellow : C.white,
        'left',
        PIX,
      );
      ty = cy0 + 10 + iconH + 6;
    } else {
      ctx.drawImage(
        icon,
        Math.round(x + cardW / 2 - iconW / 2),
        Math.round(cy0 + 14),
        iconW,
        iconH,
      );
      ty = cy0 + 14 + iconH + 16;
      text(
        ctx,
        nm,
        x + cardW / 2,
        ty,
        fitSize(ctx, nm, cardW - 16, 14, PIX),
        chosen ? C.yellow : C.white,
        'center',
        PIX,
      );
      text(
        ctx,
        kit.style,
        x + cardW / 2,
        ty + 20,
        fitSize(ctx, kit.style, cardW - 14, 20, VT),
        C.lime,
        'center',
        VT,
        null,
      );
      ty += 26;
    }
    STAT_LABELS.forEach(([key, label], r) => {
      const ry = ty + 12 + r * rowH;
      text(ctx, label, x + 10, ry, compact ? 15 : 16, C.lgray, 'left', VT, null);
      const val = kit.stats[key];
      for (let p = 0; p < 5; p++) {
        const bx = x + cardW - 10 - (5 - p) * (barW + 1);
        ctx.fillStyle = C.black;
        ctx.fillRect(bx - 1, ry - 6, barW + 1, 12);
        ctx.fillStyle = p < val ? (chosen ? C.yellow : C.cyan) : '#333c57';
        ctx.fillRect(bx, ry - 5, barW - 1, 10);
      }
    });
    if (!touch) text(ctx, `[${i + 1}]`, x + cardW - 18, cy0 + 14, 18, C.yellow, 'center', VT);
    const hint = chosen ? '¡ELEGIDO!' : touch ? 'TOCA' : 'ELEGIR';
    if (!compact || chosen)
      text(
        ctx,
        hint,
        x + cardW / 2,
        cy0 + cardH - 12,
        compact ? 11 : chosen ? 15 : 14,
        chosen ? C.yellow : C.lgray,
        'center',
        PIX,
        null,
      );
  });

  // quien de tu equipo ya eligio
  const mates = pvp.picks.filter((p) => g.teamOf(p.id) === pvp.team);
  const labels = mates.map((p) => {
    const nm = g.cats.get(p.id)?.name ?? '?';
    return `${nm}: ${p.kit ? KITS[p.kit].name : '...'}`;
  });
  const teamId = (pvp.team === 1 ? 1 : 0) as 0 | 1;
  const fy = y0 + cardH + (compact ? 18 : 28);
  text(
    ctx,
    `Tu equipo (${TEAM_NAMES[teamId]}): ${labels.join('   ')}`,
    w / 2,
    fy,
    compact ? 17 : 20,
    TEAM_COLORS[teamId] as string,
    'center',
    VT,
  );
  if (!pvp.kit && !touch && !compact)
    text(
      ctx,
      `Pulsa ${keyLabel(g.input.keys.slot1)} a ${keyLabel(g.input.keys.slot4)} o haz clic en un kit`,
      w / 2,
      fy + 24,
      18,
      C.lgray,
      'center',
      VT,
      null,
    );
}

/** La cuenta de tres antes de pelear: equipos enfrentados y un numero grande. */
function drawReady(f: HudFrame): void {
  const { ctx, g, w, h } = f;
  const pvp = g.pvp;
  if (!pvp || pvp.phase !== 'ready') return;
  const unit = Math.min(w, h);
  ctx.fillStyle = 'rgba(10,12,24,0.28)';
  ctx.fillRect(0, 0, w, h);
  const n = Math.max(1, pvp.left);
  const color = n >= 3 ? C.yellow : n === 2 ? C.orange : C.red;
  text(ctx, String(n), w / 2, h * 0.3, Math.round(unit * 0.22), color, 'center', PIX);
  text(
    ctx,
    `RONDA ${pvp.round}`,
    w / 2,
    h * 0.09,
    Math.round(clamp(w * 0.03, 15, 26)),
    C.yellow,
    'center',
    PIX,
  );
  // tu kit
  if (pvp.kit) {
    text(
      ctx,
      `Kit: ${KITS[pvp.kit].name}`,
      w / 2,
      h * 0.7,
      Math.round(clamp(w * 0.024, 18, 28)),
      C.white,
      'center',
      VT,
    );
    text(
      ctx,
      KITS[pvp.kit].blurb,
      w / 2,
      h * 0.7 + 30,
      Math.round(clamp(w * 0.018, 16, 22)),
      C.lgray,
      'center',
      VT,
      null,
    );
  }
}

/** Pausa entre rondas y final de la partida. */
function drawBetween(f: HudFrame): void {
  const { ctx, g, w, h, now } = f;
  const pvp = g.pvp;
  if (!pvp || (pvp.phase !== 'between' && pvp.phase !== 'over')) return;
  const rw = pvp.roundWinner;
  const over = pvp.phase === 'over';
  const unit = Math.min(w, h);
  const band = Math.round(unit * 0.2);
  const cy = Math.max(h * 0.2, f.safe.t + band / 2 + 62);
  const won = rw !== null && rw >= 0 && rw === pvp.team;
  const draw = rw === null || rw < 0;
  const color = draw ? C.white : won ? C.lime : C.orange;
  ctx.fillStyle = 'rgba(26,28,44,0.88)';
  ctx.fillRect(0, Math.round(cy - band / 2), w, band);
  ctx.fillStyle = draw ? C.lgray : (TEAM_COLORS[(rw as 0 | 1) ?? 0] as string);
  ctx.fillRect(0, Math.round(cy - band / 2) - 4, w, 4);
  ctx.fillRect(0, Math.round(cy + band / 2), w, 4);
  const big = Math.round(clamp(w * 0.05, 20, 48));
  const title = draw
    ? 'EMPATE'
    : over
      ? won
        ? '¡VICTORIA!'
        : 'DERROTA'
      : won
        ? '¡RONDA GANADA!'
        : 'RONDA PERDIDA';
  const pop = 1 + Math.max(0, 0.25 - ((now / 1000) % 10) * 0.05);
  ctx.save();
  ctx.translate(w / 2, cy - band * 0.1);
  ctx.scale(pop, pop);
  text(ctx, title, 0, 0, big, color, 'center', PIX);
  ctx.restore();
  const sub = draw
    ? 'Se repite la ronda'
    : `${TEAM_NAMES[rw as 0 | 1]} se lleva la ronda  ·  ${pvp.wins[0]} - ${pvp.wins[1]}`;
  text(
    ctx,
    sub,
    w / 2,
    cy + band * 0.28,
    Math.round(clamp(w * 0.022, 17, 26)),
    C.white,
    'center',
    VT,
  );
  if (!over) {
    text(
      ctx,
      `Siguiente ronda en ${pvp.left}`,
      w / 2,
      cy + band * 0.28 + 28,
      20,
      C.lgray,
      'center',
      VT,
      null,
    );
  }
}

/** Todo lo de las rondas: marcador, eleccion de kit, cuenta y pausas. */
export function drawPvpHud(f: HudFrame, assets: Assets, scoreTop: number): void {
  if (!f.g.pvp) return;
  drawScoreboard(f, scoreTop);
  drawReady(f);
  drawBetween(f);
  drawPick(f, assets);
}
