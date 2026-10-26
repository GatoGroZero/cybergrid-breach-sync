import { mobDef } from '../../shared/br/adventure';
import { C } from '../pixel/draw';
import { BOSS_AURA, BOSS_EPITHET, INTRO_NAME_AT } from './bossinfo';
import { PIX, VT, text, type HudFrame } from './hud';

const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Presentacion del jefe: franjas negras de cine, la pantalla se oscurece en las orillas y, cuando
 * la camara ya llego a el, su nombre aparece letra por letra con su frase. No hay nada mas en pantalla.
 */
export function drawBossIntro(f: HudFrame): void {
  const { ctx, g, w, h, now } = f;
  const view = g.introView(now);
  const bi = g.bossIntro;
  if (!view || !bi) return;
  const k = view.focus;
  const def = mobDef(bi.kind);
  const color = BOSS_AURA[bi.kind] ?? C.white;

  // oscurece las orillas para dejar al jefe en el centro
  const vg = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.25,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  vg.addColorStop(0, 'rgba(10,8,22,0)');
  vg.addColorStop(1, `rgba(10,8,22,${0.62 * k})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // franjas de cine que entran por arriba y por abajo
  const bar = Math.round(h * 0.13 * k);
  ctx.fillStyle = '#05040c';
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7 * k;
  ctx.fillRect(0, bar, w, 2);
  ctx.fillRect(0, h - bar - 2, w, 2);
  ctx.globalAlpha = 1;

  // nombre del jefe, letra por letra, con un temblor al aparecer
  const t = view.elapsed - INTRO_NAME_AT;
  if (t < 0 || view.left < 0.35) return;
  // una sombra suave detras del nombre para que se lea sobre cualquier fondo
  const shade = ctx.createLinearGradient(0, h - bar - h * 0.34, 0, h - bar);
  shade.addColorStop(0, 'rgba(5,4,12,0)');
  shade.addColorStop(1, 'rgba(5,4,12,0.78)');
  ctx.globalAlpha = Math.min(1, view.left / 0.6);
  ctx.fillStyle = shade;
  ctx.fillRect(0, h - bar - h * 0.34, w, h * 0.34);
  ctx.globalAlpha = 1;
  const fade = Math.min(1, view.left / 0.6);
  const name = plain(def.name).toUpperCase();
  const size = Math.round(Math.max(14, Math.min(30, w * 0.028)));
  const shown = Math.min(name.length, Math.floor(t / 0.045) + 1);
  const y = h - bar - Math.round(size * 2.3);
  const shake = t < 0.4 ? Math.round(Math.sin(t * 90) * (3 - t * 7)) : 0;
  ctx.globalAlpha = fade;
  const label = bi.kind === 15 ? 'EL JEFE FINAL' : 'MINIJEFE';
  text(ctx, label, w / 2, y - size * 1.5, Math.round(size * 0.45), color, 'center', PIX);
  text(ctx, name.slice(0, shown), w / 2 + shake, y, size, C.white, 'center', PIX);
  const epithet = BOSS_EPITHET[bi.kind];
  if (epithet && t > 0.5) {
    const a = Math.min(1, (t - 0.5) / 0.4);
    ctx.globalAlpha = fade * a;
    text(ctx, epithet, w / 2, y + size * 1.55, Math.round(size * 0.95), color, 'center', VT);
  }
  ctx.globalAlpha = 1;
}
