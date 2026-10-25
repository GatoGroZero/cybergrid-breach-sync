import { MOB } from '../../shared/br/adventure';
import type { GameMode } from '../../shared/br/modes';
import { TEAM_COLORS } from '../../shared/br/modes';
import { defaultSkin, type Skin } from '../../shared/br/skin';
import { mobSprite } from '../pixel/art-mobs';
import { CAT_H, CAT_W, catSprites } from '../pixel/cat';
import { ell, make, rect, type Ctx } from '../pixel/draw';
import { STAGE_H, STAGE_W, sceneFor, type SceneArt } from './escenarios';

/** Tamano de la foto de referencia de cada modo (se agranda con CSS sin suavizar). */
export const POSTAL_W = 160;
export const POSTAL_H = 88;

function cat(c: Ctx, skin: Skin, x: number, y: number, face: 'left' | 'right', scale = 1): void {
  const sprites = catSprites(skin);
  const frame = (face === 'left' ? sprites.left : sprites.right)[0] as HTMLCanvasElement;
  ell(c, x, y - 1, (CAT_W * scale) / 2.4, 2.2 * scale, 'rgba(8,12,24,0.45)');
  c.drawImage(
    frame,
    Math.round(x - (CAT_W * scale) / 2),
    y - CAT_H * scale,
    CAT_W * scale,
    CAT_H * scale,
  );
}

/**
 * La "foto" de un modo: el escenario del mapa con los personajes que lo definen. Se dibuja una
 * vez con el arte del juego, asi que no hay imagenes que descargar.
 */
export function buildPostal(
  mode: GameMode,
  art: SceneArt,
  skin: Skin,
  map = 'azar',
): HTMLCanvasElement {
  const [cv, c] = make(POSTAL_W, POSTAL_H);
  c.imageSmoothingEnabled = false;
  const scene = sceneFor(mode, map);
  c.drawImage(
    art.background(scene, STAGE_W, STAGE_H),
    0,
    0,
    STAGE_W,
    STAGE_H,
    0,
    0,
    POSTAL_W,
    POSTAL_H,
  );
  const floor = POSTAL_H - 6;
  const rival = defaultSkin((skin.base + 3) % 8);
  const rival2 = defaultSkin((skin.base + 5) % 8);
  switch (mode) {
    case 'br': {
      // una ola de agua avanza por un lado
      c.fillStyle = 'rgba(65,166,246,0.72)';
      c.fillRect(POSTAL_W - 30, 0, 30, POSTAL_H);
      for (let y = 0; y < POSTAL_H; y += 4) {
        c.fillStyle = 'rgba(244,244,244,0.9)';
        c.fillRect(POSTAL_W - 31 + (y % 8 === 0 ? 0 : 2), y, 2, 2);
      }
      cat(c, skin, 56, floor, 'right', 2);
      cat(c, rival, 104, floor - 8, 'left', 1);
      cat(c, rival2, 28, floor - 12, 'right', 1);
      break;
    }
    case 'techo': {
      c.fillStyle = 'rgba(190,210,255,0.55)';
      for (let i = 0; i < 46; i++) c.fillRect((i * 37) % POSTAL_W, (i * 53) % POSTAL_H, 1, 3);
      // un rayo
      c.fillStyle = '#fff6b8';
      for (const [x, y, w, h] of [
        [118, 0, 3, 14],
        [115, 12, 3, 10],
        [118, 20, 3, 12],
      ] as const)
        c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(230,240,255,0.12)';
      c.fillRect(0, 0, POSTAL_W, POSTAL_H);
      for (const [x, face, team, s] of [
        [44, 'right', 0, skin],
        [116, 'left', 1, rival],
      ] as const) {
        c.strokeStyle = TEAM_COLORS[team] as string;
        c.beginPath();
        c.ellipse(x, floor - 1, 15, 4, 0, 0, Math.PI * 2);
        c.stroke();
        cat(c, s, x, floor, face, 2);
      }
      break;
    }
    case 'territorio': {
      // tres banderas de patio y un gato de cada equipo
      for (const [x, col] of [
        [34, TEAM_COLORS[0]],
        [80, '#e8ecf4'],
        [126, TEAM_COLORS[1]],
      ] as const) {
        c.strokeStyle = 'rgba(244,244,244,0.55)';
        c.beginPath();
        c.ellipse(x, floor - 3, 22, 7, 0, 0, Math.PI * 2);
        c.stroke();
        rect(c, x, floor - 34, 1, 32, '#2a2d38');
        rect(c, x + 1, floor - 34, 12, 7, col);
        rect(c, x + 1, floor - 34, 12, 1, 'rgba(255,255,255,0.45)');
      }
      cat(c, skin, 22, floor, 'right', 1);
      cat(c, rival, 140, floor - 2, 'left', 1);
      cat(c, rival2, 50, floor - 8, 'right', 1);
      break;
    }
    default: {
      // la reina de los ratones frente a un gato, entre cristales
      const queen = mobSprite(MOB.reinaRata).frames[0] as HTMLCanvasElement;
      ell(c, 116, floor - 1, 18, 3, 'rgba(8,12,24,0.5)');
      c.drawImage(queen, Math.round(116 - queen.width / 2), floor - queen.height + 4);
      cat(c, skin, 42, floor, 'right', 2);
      c.fillStyle = 'rgba(201,251,255,0.8)';
      for (const [x, y] of [
        [20, 18],
        [70, 12],
        [96, 26],
        [140, 16],
        [58, 34],
      ] as const)
        c.fillRect(x, y, 2, 2);
    }
  }
  // marco de pixeles
  c.strokeStyle = 'rgba(14,16,28,0.9)';
  c.lineWidth = 2;
  c.strokeRect(1, 1, POSTAL_W - 2, POSTAL_H - 2);
  return cv;
}
