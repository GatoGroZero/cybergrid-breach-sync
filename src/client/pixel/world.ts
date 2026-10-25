import { TILE } from '../../shared/br/constants';
import { G, type BRMap } from '../../shared/br/map';
import { thicketCanopy } from './art-bosque';
import { hash, shade, type Ctx } from './draw';

const T = TILE;

const fill = (c: Ctx, x: number, y: number, w: number, h: number, color: string): void => {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
};

const groundAt = (map: BRMap, tx: number, ty: number): number =>
  tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? -1 : (map.ground[ty * map.w + tx] as number);

// ------------------------------------------------------------------ tableros de madera

const WOOD_TONES: Record<number, string[]> = {
  [G.WOOD]: ['#dcab7c', '#d3a073', '#cc986b', '#d8a678', '#c9946a'],
  [G.WOOD2]: ['#bf8a60', '#b88259', '#b17b54', '#bc8660', '#a9744f'],
  [G.DECK]: ['#ecdfbd', '#e6d7b1', '#e9dab6', '#e1d0a8'],
  [G.DECK2]: ['#e0cfa8', '#dac79d', '#e3d2ab', '#d6c298'],
};

/**
 * Pisos de madera y tarima: tablones largos de 5 px que cruzan varias casillas con juntas
 * escalonadas, vetas y algun nudo. Pintado sobre el terreno ya horneado, en coordenadas del mundo,
 * para que las tablas sigan de una casilla a la siguiente sin costuras.
 */
function paintBoards(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const id = groundAt(map, tx, ty);
      const tones = WOOD_TONES[id];
      if (!tones) continue;
      const deck = id === G.DECK || id === G.DECK2;
      const rowH = deck ? 6 : 5;
      const x0 = tx * T;
      const y0 = ty * T;
      for (let Y = y0; Y < y0 + T;) {
        const r = Math.floor(Y / rowH);
        const rowStart = r * rowH;
        const rowEnd = Math.min(rowStart + rowH, y0 + T);
        const h = rowEnd - Y;
        const len = (deck ? 56 : 48) + Math.floor(hash(r, 7, seed) * 4) * 12;
        const off = Math.floor(hash(r, 13, seed) * len);
        for (let X = x0; X < x0 + T;) {
          const s = Math.floor((X + off) / len);
          const segStart = s * len - off;
          const segEnd = segStart + len;
          const X2 = Math.min(x0 + T, segEnd);
          const tone = tones[Math.floor(hash(r, s, seed + 3) * tones.length)] as string;
          fill(c, X, Y, X2 - X, h, tone);
          // separacion entre tablones (arriba) y junta de la tabla (al inicio)
          if (Y === rowStart) fill(c, X, Y, X2 - X, 1, shade(tone, deck ? 0.82 : 0.8));
          if (X === segStart) fill(c, X, Y, 1, h, shade(tone, 0.7));
          // vetas: lineas claras que no dependen de donde se corte la casilla
          const gy = rowStart + 2;
          if (gy >= Y && gy < Y + h) {
            for (let k = 0; k < 3; k++) {
              const gx = segStart + Math.floor(hash(r, s * 5 + k, seed + 9) * (len - 14)) + 3;
              const gl = 6 + Math.floor(hash(s, r * 3 + k, seed + 5) * 8);
              const a = Math.max(gx, X);
              const b = Math.min(gx + gl, X2);
              if (b > a) fill(c, a, gy, b - a, 1, shade(tone, 1.1));
            }
          }
          // un nudo de vez en cuando
          if (hash(r, s, seed + 21) < 0.06) {
            const kx = segStart + Math.floor(len / 2);
            const ky = rowStart + 2;
            if (kx >= X && kx < X2 && ky >= Y && ky < Y + h) {
              fill(c, kx - 1, ky, 3, 1, shade(tone, 0.62));
              fill(c, kx, ky - 1, 1, 3, shade(tone, 0.62));
            }
          }
          // clavos en la tarima
          if (deck && X === segStart && Y === rowStart) fill(c, X + 3, Y + 3, 1, 1, '#9c8761');
          X = X2;
        }
        Y = rowEnd;
      }
    }
  }
}

// ------------------------------------------------------------------ azulejos

/** Piso de cuadros: crema y menta de 8 x 8 con un pequeno bisel, como una cocina limpia. */
function paintCheckers(c: Ctx, map: BRMap): void {
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (groundAt(map, tx, ty) !== G.TILE) continue;
      for (let qy = 0; qy < 2; qy++) {
        for (let qx = 0; qx < 2; qx++) {
          const X = tx * T + qx * 8;
          const Y = ty * T + qy * 8;
          const dark = ((X >> 3) + (Y >> 3)) % 2 === 0;
          const base = dark ? '#a8d4cb' : '#efe9d8';
          fill(c, X, Y, 8, 8, base);
          fill(c, X, Y, 8, 1, shade(base, 1.12));
          fill(c, X, Y, 1, 8, shade(base, 1.08));
          fill(c, X, Y + 7, 8, 1, shade(base, 0.82));
          fill(c, X + 7, Y, 1, 8, shade(base, 0.86));
          if (hash(X, Y, 4) < 0.18) fill(c, X + 3, Y + 3, 2, 1, shade(base, 1.2));
        }
      }
    }
  }
}

// ------------------------------------------------------------------ muros de la casa

/**
 * Muros de la casa de gatitos con volumen: arriba una cubierta crema bien clara y, cuando el piso
 * queda a su sur, el frente en papel tapiz oscuro con zocalo y una sombra suave en el suelo. Asi
 * se distinguen de un vistazo del piso, las alfombras y las camas.
 */
function paintHouseWalls(c: Ctx, map: BRMap): void {
  const isWall = (x: number, y: number): boolean => groundAt(map, x, y) === G.WALLTOP;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!isWall(tx, ty)) continue;
      const X = tx * T;
      const Y = ty * T;
      const below = groundAt(map, tx, ty + 1);
      const hasFace = ty + 1 < map.h && below !== G.WALLTOP && below !== -1;
      const capH = hasFace ? 6 : T;
      // cubierta
      fill(c, X, Y, T, capH, '#e8dcc6');
      fill(c, X, Y, T, 1, '#fff6e0');
      fill(c, X, Y + capH - 1, T, 1, '#b9a98c');
      if (!isWall(tx - 1, ty)) fill(c, X, Y, 1, capH, '#fff6e0');
      if (!isWall(tx + 1, ty)) fill(c, X + T - 1, Y, 1, capH, '#b9a98c');
      if (!hasFace) {
        // tramo largo: junta de tablas cada 8 px para que no se vea una mancha lisa
        for (let k = 8; k < T; k += 8) fill(c, X + k, Y + 1, 1, capH - 2, '#cdbfa5');
        fill(c, X + 1, Y + 1, T - 2, 1, '#f4ead6');
      }
      if (hasFace) {
        // frente: papel tapiz con rayas, y zocalo de madera oscura
        fill(c, X, Y + capH, T, T - capH, '#4b3d58');
        for (let k = 1; k < T; k += 4) fill(c, X + k, Y + capH, 2, T - capH - 3, '#5c4a69');
        fill(c, X, Y + capH, T, 1, '#2f2438');
        fill(c, X, Y + T - 3, T, 3, '#3a2a22');
        fill(c, X, Y + T - 3, T, 1, '#6d4530');
        // sombra sobre el piso
        if (below !== G.WALLTOP) {
          fill(c, X, Y + T, T, 3, 'rgba(26,28,44,0.26)');
          fill(c, X, Y + T + 3, T, 2, 'rgba(26,28,44,0.12)');
        }
      }
    }
  }
}

// ------------------------------------------------------------------ alfombras

const RUGS = [
  { base: '#b13e53', trim: '#f4a6c0', accent: '#ffcd75' },
  { base: '#3b5dc9', trim: '#73eff7', accent: '#f4f4f4' },
  { base: '#257179', trim: '#a7f070', accent: '#ffcd75' },
  { base: '#5d275d', trim: '#ffcd75', accent: '#f4a6c0' },
] as const;

/** Alfombras con sombra, borde, un dibujo en el centro y flecos en los extremos. */
function paintRugs(c: Ctx, map: BRMap): void {
  for (const p of map.props) {
    if (p.kind !== 'rug') continue;
    const pick = Math.floor(hash(p.x, p.y, 9) * RUGS.length);
    const { base, trim, accent } = RUGS[pick] as (typeof RUGS)[number];
    const x = p.x * T;
    const y = p.y * T;
    const w = p.w * T;
    const h = p.h * T;
    // sombra y flecos
    fill(c, x - 1, y + 2, w + 2, h, 'rgba(26,28,44,0.25)');
    for (let k = 2; k < h - 2; k += 3) {
      fill(c, x - 2, y + k, 3, 1, trim);
      fill(c, x + w - 1, y + k, 3, 1, trim);
    }
    fill(c, x, y, w, h, shade(base, 0.7));
    fill(c, x + 1, y + 1, w - 2, h - 2, trim);
    fill(c, x + 3, y + 3, w - 6, h - 6, base);
    fill(c, x + 5, y + 5, w - 10, h - 10, shade(base, 0.86));
    // dibujo: rombos sobre fondo liso
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let dx = -Math.floor(w / 2) + 10; dx < w / 2 - 8; dx += 10) {
      for (let r = 0; r < 4; r++) {
        fill(c, cx + dx - r, cy - 3 + r, r * 2 + 1, 1, r % 2 === 0 ? accent : trim);
        fill(c, cx + dx - r, cy + 3 - r, r * 2 + 1, 1, r % 2 === 0 ? accent : trim);
      }
    }
    fill(c, x + 5, y + 5, w - 10, 1, shade(base, 1.2));
  }
}

// ------------------------------------------------------------------ huellitas hacia las camas

/** Huellitas en el suelo que llevan a las puertas de cada cama: se ve por donde se entra. */
function paintPawTrails(c: Ctx, map: BRMap): void {
  for (const house of map.houses) {
    if (house.kind !== 'bed') continue;
    for (const d of house.doors) {
      const north = d.y === house.y;
      const south = d.y === house.y + house.h - 1;
      const dir = north ? { dx: 0, dy: -1 } : south ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
      for (let i = 0; i < 3; i++) {
        const px0 =
          (d.x + 0.5) * T +
          dir.dx * (T * (1.1 + i * 0.75)) +
          (i % 2 ? 3 : -3) * (dir.dy !== 0 ? 1 : 0);
        const py0 =
          (d.y + 0.5) * T +
          dir.dy * (T * (1.1 + i * 0.75)) +
          (i % 2 ? 3 : -3) * (dir.dx !== 0 ? 1 : 0);
        const g = groundAt(map, Math.floor(px0 / T), Math.floor(py0 / T));
        if (g === G.WALLTOP || g === G.BEDSHADE || g < 0) continue;
        const a = 0.42 - i * 0.1;
        c.fillStyle = `rgba(110,72,48,${a})`;
        const px1 = Math.round(px0);
        const py1 = Math.round(py0);
        c.fillRect(px1 - 1, py1, 3, 2);
        c.fillRect(px1 - 2, py1 - 2, 1, 1);
        c.fillRect(px1, py1 - 3, 1, 1);
        c.fillRect(px1 + 2, py1 - 2, 1, 1);
      }
    }
  }
}

// ------------------------------------------------------------------ detalles del suelo

/** Manchas suaves de pasto mas claro y mas oscuro: rompen el patron repetido del terreno. */
function paintGrassPatches(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const g = groundAt(map, tx, ty);
      if (g !== G.GRASS && g !== G.GRASS2 && g !== G.GRASS3 && g !== G.FLOWER && g !== G.FLOWER2)
        continue;
      // ruido de baja frecuencia: la misma mancha cubre varias casillas
      const n =
        hash(Math.floor(tx / 4), Math.floor(ty / 4), seed) * 0.6 +
        hash(tx >> 1, ty >> 1, seed + 1) * 0.4;
      const X = tx * T;
      const Y = ty * T;
      if (n > 0.66) fill(c, X, Y, T, T, 'rgba(167,240,112,0.10)');
      else if (n < 0.3) fill(c, X, Y, T, T, 'rgba(19,74,46,0.14)');
      // detalles sueltos
      const r = hash(tx, ty, seed + 17);
      if (r < 0.018) {
        // piedrita
        fill(c, X + 5, Y + 9, 3, 2, '#8a96a6');
        fill(c, X + 5, Y + 9, 3, 1, '#b9c4d0');
      } else if (r < 0.03) {
        // hojas caidas
        fill(c, X + 4, Y + 6, 2, 1, '#c9954f');
        fill(c, X + 10, Y + 10, 2, 1, '#e0b060');
        fill(c, X + 7, Y + 12, 1, 1, '#b36b3a');
      } else if (r < 0.04) {
        // hongo
        fill(c, X + 7, Y + 10, 1, 3, '#f4f4f4');
        fill(c, X + 6, Y + 8, 3, 2, '#e8553d');
        fill(c, X + 7, Y + 8, 1, 1, '#f4f4f4');
      }
    }
  }
}

/** Mosaico de la alberca: el borde blanco brilla y las esquinas llevan rayitas de luz. */
function paintPoolShine(c: Ctx, map: BRMap): void {
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (groundAt(map, tx, ty) !== G.POOLEDGE) continue;
      const X = tx * T;
      const Y = ty * T;
      for (let k = 0; k < T; k += 8) {
        fill(c, X + k, Y, 7, 1, 'rgba(255,255,255,0.55)');
        fill(c, X + k, Y + 8, 7, 1, 'rgba(26,28,44,0.1)');
      }
      fill(c, X, Y, 1, T, 'rgba(26,28,44,0.1)');
    }
  }
}

/** Detalles de interior: rodapies y sombras bajo muebles, y un poco de polvo en el suelo. */
function paintIndoorDetails(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const g = groundAt(map, tx, ty);
      if (g !== G.WOOD && g !== G.WOOD2 && g !== G.TILE) continue;
      const r = hash(tx, ty, seed + 31);
      const X = tx * T;
      const Y = ty * T;
      if (r < 0.012) {
        // rasguno de gato
        for (let k = 0; k < 3; k++) fill(c, X + 4 + k * 2, Y + 4 + k, 5, 1, 'rgba(60,40,30,0.28)');
      } else if (r < 0.02) {
        // pelusa
        fill(c, X + 6, Y + 9, 3, 1, 'rgba(255,255,255,0.35)');
        fill(c, X + 7, Y + 8, 1, 1, 'rgba(255,255,255,0.35)');
      }
    }
  }
}

// ------------------------------------------------------------------ techos

const isRoofWall = (id: number): boolean => id === G.PARAPETO;

/**
 * Bordes de un techo: el parapeto muestra su frente de ladrillo (mas oscuro) donde da al tejado y
 * deja una sombra en el suelo, el canalon se hunde junto al muro y la cumbrera se ve como un
 * lomo redondeado (claro arriba, oscuro abajo) con su sombra.
 */
function paintRoofEdges(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const id = groundAt(map, tx, ty);
      const X = tx * T;
      const Y = ty * T;
      if (isRoofWall(id)) {
        const south = groundAt(map, tx, ty + 1);
        if (south >= 0 && !isRoofWall(south)) {
          // frente del parapeto
          fill(c, X, Y + T - 6, T, 6, '#6b4b40');
          for (let k = 0; k < T; k += 8) fill(c, X + k, Y + T - 6, 1, 6, '#53392f');
          fill(c, X, Y + T - 6, T, 1, '#8f6c5e');
          fill(c, X, Y + T - 1, T, 1, '#3e2a23');
        }
        const north = groundAt(map, tx, ty - 1);
        if (north >= 0 && !isRoofWall(north)) fill(c, X, Y, T, 1, '#c4a090');
      } else if (id === G.CANALON) {
        const n = groundAt(map, tx, ty - 1);
        const s2 = groundAt(map, tx, ty + 1);
        const w = groundAt(map, tx - 1, ty);
        const e = groundAt(map, tx + 1, ty);
        // sombra del parapeto sobre el canalon
        if (isRoofWall(s2)) fill(c, X, Y + T - 4, T, 4, 'rgba(10,12,24,0.35)');
        if (isRoofWall(n)) fill(c, X, Y, T, 4, 'rgba(10,12,24,0.3)');
        if (isRoofWall(w)) fill(c, X, Y, 4, T, 'rgba(10,12,24,0.3)');
        if (isRoofWall(e)) fill(c, X + T - 4, Y, 4, T, 'rgba(10,12,24,0.3)');
        // una gota que escurre de vez en cuando
        if (hash(tx, ty, seed + 5) < 0.12) fill(c, X + 7, Y + 5, 2, 3, '#7ea6d8');
      } else if (id === G.CUMBRERA) {
        const top = groundAt(map, tx, ty - 1) !== G.CUMBRERA;
        const bottom = groundAt(map, tx, ty + 1) !== G.CUMBRERA;
        if (!top && !bottom) continue;
        if (top) fill(c, X, Y, T, 2, 'rgba(255,255,255,0.18)');
        if (bottom) {
          fill(c, X, Y + T - 2, T, 2, 'rgba(0,0,0,0.3)');
          // sombra sobre las tejas de abajo
          fill(c, X, Y + T, T, 4, 'rgba(10,12,24,0.28)');
          fill(c, X, Y + T + 4, T, 2, 'rgba(10,12,24,0.14)');
        }
      }
    }
  }
}

// ------------------------------------------------------------------ calles y patios

/**
 * Detalles de la calle: bordillos con sombra donde la acera toca el asfalto, tapas de alcantarilla,
 * manchas de aceite y el emblema pintado de cada equipo en su base.
 */
function paintStreet(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  const road = (id: number): boolean =>
    id === G.ASFALTO || id === G.ASFALTO2 || id === G.CEBRA || id === G.RAYA;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const id = groundAt(map, tx, ty);
      const X = tx * T;
      const Y = ty * T;
      if (id === G.ACERA) {
        // bordillo: una linea clara en el borde y una sombra sobre el asfalto
        if (road(groundAt(map, tx, ty + 1))) {
          fill(c, X, Y + T - 2, T, 2, '#e4e0d8');
          fill(c, X, Y + T, T, 3, 'rgba(10,12,24,0.28)');
        }
        if (road(groundAt(map, tx, ty - 1))) {
          fill(c, X, Y, T, 2, '#e4e0d8');
          fill(c, X, Y - 3, T, 3, 'rgba(10,12,24,0.28)');
        }
        if (road(groundAt(map, tx + 1, ty))) fill(c, X + T - 2, Y, 2, T, '#e4e0d8');
        if (road(groundAt(map, tx - 1, ty))) fill(c, X, Y, 2, T, '#e4e0d8');
      } else if (road(id) && hash(tx, ty, seed + 12) < 0.012) {
        // tapa de alcantarilla
        fill(c, X + 4, Y + 4, 8, 8, '#2e323e');
        fill(c, X + 5, Y + 5, 6, 6, '#464c5c');
        fill(c, X + 6, Y + 8, 4, 1, '#2e323e');
        fill(c, X + 8, Y + 6, 1, 4, '#2e323e');
      } else if (road(id) && hash(tx, ty, seed + 31) < 0.025) {
        fill(c, X + 3, Y + 5, 7, 4, 'rgba(20,22,30,0.35)');
        fill(c, X + 5, Y + 4, 4, 1, 'rgba(20,22,30,0.35)');
      } else if (id === G.CESPED && hash(tx, ty, seed + 18) < 0.01) {
        // un charco de tierra en el pasto
        fill(c, X + 4, Y + 6, 8, 4, '#7d5a3c');
        fill(c, X + 5, Y + 5, 6, 1, '#7d5a3c');
      }
    }
  }
  paintTeamBases(c, map);
}

/** La base de cada equipo: un recuadro de rayas del color del equipo y una franja al centro. */
function paintTeamBases(c: Ctx, map: BRMap): void {
  const teams = map.teamSpawns;
  if (!teams) return;
  const colors = ['rgba(239,125,87,0.8)', 'rgba(65,166,246,0.8)'];
  teams.forEach((spots, t) => {
    const xs = spots.map((s) => s.x);
    const ys = spots.map((s) => s.y);
    const x0 = Math.round(Math.min(...xs) - 56);
    const x1 = Math.round(Math.max(...xs) + 56);
    const y0 = Math.round(Math.min(...ys) - 26);
    const y1 = Math.round(Math.max(...ys) + 26);
    c.fillStyle = colors[t] as string;
    // recuadro de rayas de 6 px con una pausa de 4
    for (let x = x0; x <= x1; x += 10) {
      c.fillRect(x, y0, Math.min(6, x1 - x + 1), 2);
      c.fillRect(x, y1, Math.min(6, x1 - x + 1), 2);
    }
    for (let y = y0; y <= y1; y += 10) {
      c.fillRect(x0, y, 2, Math.min(6, y1 - y + 1));
      c.fillRect(x1, y, 2, Math.min(6, y1 - y + 1));
    }
    // un lugar pintado para cada gato
    for (const sp of spots) {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        c.fillRect(
          Math.round(sp.x + Math.cos(a) * 10),
          Math.round(sp.y + 6 + Math.sin(a) * 4),
          1,
          1,
        );
      }
    }
  });
}

/** Charcos y manchas de humedad sobre el alquitran y las tejas (la lluvia no perdona). */
function paintRoofPuddles(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  for (let ty = 3; ty < map.h - 3; ty++) {
    for (let tx = 3; tx < map.w - 3; tx++) {
      if (map.solid[ty * map.w + tx]) continue;
      const id = groundAt(map, tx, ty);
      if (id === G.CANALON || id === G.CUMBRERA) continue;
      const r = hash(tx, ty, seed + 77);
      if (r > 0.035) continue;
      const X = tx * T + 2 + Math.floor(hash(tx, ty, 3) * 4);
      const Y = ty * T + 4 + Math.floor(hash(tx, ty, 5) * 4);
      fill(c, X, Y, 9, 4, 'rgba(120,170,230,0.32)');
      fill(c, X + 1, Y - 1, 7, 1, 'rgba(120,170,230,0.32)');
      fill(c, X + 1, Y + 4, 7, 1, 'rgba(120,170,230,0.32)');
      fill(c, X + 2, Y + 1, 4, 1, 'rgba(255,255,255,0.35)');
    }
  }
}

/**
 * Bosque encantado: el espinar que rodea los claros se cubre de copas de arbusto con volumen (se
 * pintan de arriba abajo para que se encimen), y el suelo junto a los espinos queda en sombra.
 */
function paintForest(c: Ctx, map: BRMap): void {
  const seed = map.seed & 0xffff;
  const canopies = [0, 1, 2, 3].map(thicketCanopy);
  const wall = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= map.w || y >= map.h || groundAt(map, x, y) === G.ZARZAL;
  // sombra del espinar sobre el claro (arriba y a los lados de cada pared)
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (groundAt(map, tx, ty) === G.ZARZAL) continue;
      const X = tx * T;
      const Y = ty * T;
      if (wall(tx, ty - 1)) fill(c, X, Y, T, 4, 'rgba(8,20,16,0.5)');
      if (wall(tx, ty - 1)) fill(c, X, Y + 4, T, 2, 'rgba(8,20,16,0.22)');
      if (wall(tx - 1, ty)) fill(c, X, Y, 3, T, 'rgba(8,20,16,0.38)');
      if (wall(tx + 1, ty)) fill(c, X + T - 3, Y, 3, T, 'rgba(8,20,16,0.38)');
      if (wall(tx, ty + 1)) fill(c, X, Y + T - 2, T, 2, 'rgba(8,20,16,0.3)');
    }
  }
  // senderos: tierra oscura de bosque con orillas de musgo
  const path = (x: number, y: number): boolean => groundAt(map, x, y) === G.PATH;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!path(tx, ty)) continue;
      const X = tx * T;
      const Y = ty * T;
      fill(c, X, Y, T, T, '#5a4a37');
      for (let i = 0; i < 16; i++) {
        const sx = Math.floor(hash(tx * 17 + i, ty, seed + 21) * T);
        const sy = Math.floor(hash(tx, ty * 13 + i, seed + 22) * T);
        fill(
          c,
          X + sx,
          Y + sy,
          1,
          1,
          i % 3 === 0 ? '#76623f' : i % 3 === 1 ? '#483a2b' : '#6b5940',
        );
      }
      // piedritas y hojas secas
      if (hash(tx, ty, seed + 23) < 0.22)
        fill(
          c,
          X + 4 + Math.floor(hash(ty, tx, 5) * 7),
          Y + 5 + Math.floor(hash(tx, tx, 6) * 6),
          2,
          1,
          '#8e8168',
        );
      if (hash(tx, ty, seed + 24) < 0.12) fill(c, X + 9, Y + 11, 2, 1, '#b3683a');
      // orillas de musgo donde el sendero toca otra cosa
      if (!path(tx, ty - 1)) fill(c, X, Y, T, 2, '#3a7a4c');
      if (!path(tx, ty + 1)) fill(c, X, Y + T - 2, T, 2, '#2b6b4a');
      if (!path(tx - 1, ty)) fill(c, X, Y, 2, T, '#3a7a4c');
      if (!path(tx + 1, ty)) fill(c, X + T - 2, Y, 2, T, '#2b6b4a');
    }
  }
  // copas: solo donde el espinar toca un claro, para no pintar de mas en el fondo del mapa
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (groundAt(map, tx, ty) !== G.ZARZAL) continue;
      const edge = !wall(tx, ty + 1) || !wall(tx - 1, ty) || !wall(tx + 1, ty) || !wall(tx, ty - 1);
      if (!edge && hash(tx, ty, seed + 9) > 0.35) continue;
      const sprite = canopies[Math.floor(hash(tx, ty, seed + 11) * 4)] as HTMLCanvasElement;
      const ox = Math.floor(hash(tx, ty, seed + 12) * 5) - 2;
      c.drawImage(sprite, tx * T - 5 + ox, ty * T - 8);
    }
  }
}

/** Todo lo que se hornea encima del terreno base, segun el mapa. */
export function paintWorld(c: Ctx, map: BRMap): void {
  if (map.kind === 'encantado') {
    paintForest(c, map);
    return;
  }
  if (map.kind === 'tejado' || map.kind === 'azotea' || map.kind === 'mansarda') {
    paintRoofEdges(c, map);
    paintRoofPuddles(c, map);
    return;
  }
  if (map.kind === 'calle' || map.kind === 'patios') {
    paintBoards(c, map);
    paintStreet(c, map);
    return;
  }
  paintGrassPatches(c, map);
  paintBoards(c, map);
  paintCheckers(c, map);
  paintPoolShine(c, map);
  paintIndoorDetails(c, map);
  if (map.kind === 'casa') {
    paintHouseWalls(c, map);
    paintPawTrails(c, map);
  }
  paintRugs(c, map);
}
