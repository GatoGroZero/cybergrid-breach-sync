import { OUTFITS } from '../../shared/br/outfits';
import { line, px, rect, type Ctx } from './draw';

/**
 * Trajes de Halloween dibujados pixel por pixel sobre la cuadricula del gato (24 x 16, mirando a
 * la derecha). Cada traje tiene una capa de atras (capas, alas) y una de adelante (sombreros,
 * vendas). El lienzo ya viene desplazado hacia abajo, asi que las y negativas son aire sobre la
 * cabeza.
 */
export interface Pose {
  /** 0 quieto, 1 y 2 caminando, 3 y 4 galope. */
  frame: number;
  /** Cuanto sube el cuerpo y la cabeza en este marco (0 o -1). */
  dy: number;
}

type Layer = (c: Ctx, p: Pose) => void;
interface Outfit {
  back?: Layer;
  front?: Layer;
}

const K = '#1a1c2c';
const W = '#f4f4f4';

/** Pinta cada casilla del ovalo con lo que devuelva `color` (null la salta). */
function fillEll(
  c: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: (x: number, y: number) => string | null,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const col = color(x, y);
      if (col) px(c, x, y, col);
    }
  }
}

/** Cuerpo del gato (mismo ovalo que el sprite base), con un margen opcional. */
const body = (
  c: Ctx,
  p: Pose,
  color: (x: number, y: number) => string | null,
  grow = 0,
  cx = 10.5,
  rx = 7.6,
): void => fillEll(c, cx, 9.2 + p.dy, rx + grow, 4.3 + grow, color);

/** Cabeza del gato, con margen opcional. */
const head = (c: Ctx, p: Pose, color: (x: number, y: number) => string | null, grow = 0): void =>
  fillEll(c, 18.7, 7.6 + p.dy, 4.4 + grow, 3.8 + grow, color);

/** Filas de rangos de x: `[y, x0, x1]`, con el desplazamiento vertical del marco. */
function spans(c: Ctx, rows: [number, number, number][], color: string, dy = 0): void {
  c.fillStyle = color;
  for (const [y, x0, x1] of rows) c.fillRect(x0, y + dy, x1 - x0 + 1, 1);
}

// ------------------------------------------------------------------ bruja

const BRUJA: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    const P0 = '#2a1a3d';
    const P1 = '#46307f';
    const P2 = '#6a4fb0';
    // capa sobre el lomo
    spans(
      c,
      [
        [6, 6, 13],
        [7, 5, 13],
        [8, 5, 14],
        [9, 4, 14],
        [10, 4, 14],
        [11, 4, 14],
        [12, 5, 13],
      ],
      P1,
      d,
    );
    spans(c, [[12, 5, 13]], P0, d);
    for (const x of [5, 7, 9, 11, 13]) px(c, x, 13 + d, P1);
    for (const [x, y] of [
      [7, 8],
      [10, 10],
      [6, 11],
      [12, 7],
    ] as const)
      px(c, x, y + d, '#ffcd75');
    px(c, 14, 8 + d, '#ffcd75');
    px(c, 14, 9 + d, '#ef7d57');
    // sombrero de punta doblada
    spans(c, [[3, 13, 23]], P2, d);
    spans(c, [[4, 15, 22]], P0, d);
    spans(
      c,
      [
        [2, 15, 21],
        [1, 15, 21],
        [0, 16, 20],
        [-1, 16, 20],
        [-2, 17, 19],
        [-3, 18, 20],
        [-4, 19, 21],
        [-5, 21, 22],
      ],
      P1,
      d,
    );
    spans(c, [[2, 15, 21]], '#ef7d57', d);
    px(c, 18, 2 + d, '#ffcd75');
    px(c, 19, 2 + d, '#ffcd75');
    for (const [x, y] of [
      [16, 1],
      [16, 0],
      [17, -2],
    ] as const)
      px(c, x, y + d, P2);
    px(c, 19, 0 + d, '#ffcd75');
  },
};

// ------------------------------------------------------------------ calabaza

const CALABAZA: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    body(
      c,
      p,
      (x, y) => {
        if (x < 5 || x > 16) return null;
        if (y <= 6 + d && x % 3 === 1) return '#cf5a2b';
        if (y >= 11 + d && x % 3 === 1) return '#cf5a2b';
        if (y <= 7 + d && x < 9) return '#f6a15f';
        return '#ef7d57';
      },
      -0.4,
      10.5,
      7.3,
    );
    // cara tallada que brilla
    const glow = '#ffcd75';
    for (const [x, y] of [
      [7, 8],
      [8, 8],
      [8, 9],
      [12, 8],
      [13, 8],
      [12, 9],
      [7, 11],
      [8, 11],
      [9, 11],
      [10, 11],
      [11, 11],
      [12, 11],
      [13, 11],
      [8, 10],
      [10, 10],
      [12, 10],
    ] as const)
      px(c, x, y + d, glow);
    for (const [x, y] of [
      [9, 11],
      [11, 11],
    ] as const)
      px(c, x, y + d, '#a3411e');
    // tallo y hoja entre las orejas
    rect(c, 18, 1 + d, 2, 3, '#38b764');
    px(c, 18, 1 + d, '#a7f070');
    px(c, 19, 0 + d, '#257179');
    px(c, 20, 0 + d, '#a7f070');
    px(c, 17, 3 + d, '#2f9b57');
    px(c, 16, 4 + d, '#2f9b57');
    px(c, 21, 4 + d, '#2f9b57');
  },
};

// ------------------------------------------------------------------ fantasma

const FANTASMA: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    const S1 = '#e8f0ff';
    const S2 = '#bccbe6';
    const wave = p.frame % 2;
    // sabana: domo sobre la cabeza y cuerpo largo que cae hasta el suelo
    fillEll(c, 10.5, 9.4 + d, 8.6, 4.9, (x, y) => (y >= 11 + d && x < 9 ? S2 : S1));
    fillEll(c, 18.7, 6.5 + d, 5.4, 5.6, (x, y) => (y >= 10 + d ? S2 : S1));
    // la sabana tambien tapa las orejas
    spans(
      c,
      [
        [1, 15, 16],
        [1, 20, 21],
        [2, 15, 16],
        [2, 20, 21],
      ],
      S1,
      d,
    );
    // dobladillo ondulado
    for (let x = 3; x <= 19; x++) {
      const drop = (x + wave) % 4 < 2 ? 1 : 0;
      px(c, x, 13 + d + drop, x < 9 ? S2 : S1);
      if ((x + wave) % 4 === 0) px(c, x, 14 + d + drop, S2);
    }
    // pliegues
    for (const [x, y] of [
      [6, 8],
      [7, 10],
      [11, 11],
      [14, 10],
      [15, 12],
    ] as const)
      px(c, x, y + d, S2);
    // ojos grandes y boca de susto
    rect(c, 19, 4 + d, 2, 3, K);
    rect(c, 22, 4 + d, 2, 3, K);
    rect(c, 20, 8 + d, 2, 3, K);
    px(c, 19, 4 + d, '#6a7aa8');
    px(c, 22, 4 + d, '#6a7aa8');
  },
};
// ------------------------------------------------------------------ vampiro

const VAMPIRO: Outfit = {
  back: (c, p) => {
    const d = p.dy;
    const flare = p.frame === 3 ? 1 : 0;
    // cuello alto detras de la cabeza
    spans(
      c,
      [
        [2, 13, 13],
        [3, 12, 13],
        [4, 12, 14],
        [5, 12, 14],
        [6, 12, 14],
      ],
      '#2b2d42',
      d,
    );
    px(c, 14, 4 + d, '#b13e53');
    px(c, 14, 5 + d, '#b13e53');
    px(c, 13, 3 + d, '#b13e53');
    // capa que cae por detras
    spans(
      c,
      [
        [6, 7, 14],
        [7, 4, 14],
        [8, 3, 13],
        [9, 2, 13],
        [10, 2, 13],
        [11, 1, 13],
        [12, 1 - flare, 13],
        [13, 0 - flare, 12],
      ],
      '#2b2d42',
      d,
    );
    // forro rojo y bordes rotos
    spans(
      c,
      [
        [10, 2, 3],
        [11, 1, 4],
        [12, 1 - flare, 5],
        [13, 0 - flare, 6],
      ],
      '#b13e53',
      d,
    );
    for (let x = 0; x <= 12; x += 2) px(c, x - flare, 14 + d, '#2b2d42');
  },
  front: (c, p) => {
    const d = p.dy;
    // capa negra sobre el lomo con forro rojo en el borde
    spans(
      c,
      [
        [6, 6, 13],
        [7, 5, 13],
        [8, 5, 14],
        [9, 4, 14],
        [10, 4, 14],
        [11, 4, 14],
        [12, 5, 13],
      ],
      '#2b2d42',
      d,
    );
    for (const x of [7, 10, 13]) rect(c, x, 8 + d, 1, 4, '#3d4163');
    spans(
      c,
      [
        [12, 5, 13],
        [13, 5, 12],
      ],
      '#b13e53',
      d,
    );
    px(c, 14, 8 + d, '#ffcd75');
    // pelo peinado hacia atras con pico en la frente
    spans(
      c,
      [
        [4, 16, 20],
        [5, 18, 19],
      ],
      K,
      d,
    );
    // ojo rojo brillante y colmillos
    px(c, 19, 7 + d, W);
    px(c, 20, 7 + d, '#ff4d6d');
    px(c, 21, 7 + d, W);
    rect(c, 19, 10 + d, 1, 2, W);
    rect(c, 21, 10 + d, 1, 2, W);
  },
};
// ------------------------------------------------------------------ momia

const MOMIA: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    const A = '#e8d8b4';
    const B = '#b9a67c';
    const wrap = (x: number, y: number): string => ((x + y) % 4 === 0 ? B : A);
    // cuerpo y cabeza envueltos, con la ventana de los ojos al aire
    body(c, p, (x, y) => ((x * 7 + y * 13) % 29 === 0 ? null : wrap(x, y)), 0, 10.5, 7.6);
    head(c, p, (x, y) => (y >= 6 + d && y <= 8 + d && x >= 19 ? null : wrap(x + 1, y)), 0.3);
    spans(
      c,
      [
        [4, 16, 20],
        [3, 15, 16],
        [3, 20, 21],
        [2, 15, 16],
        [2, 20, 21],
      ],
      A,
      d,
    );
    for (const x of [16, 18, 20]) px(c, x, 4 + d, B);
    px(c, 15, 1 + d, B);
    px(c, 21, 1 + d, B);
    // ojo que brilla
    rect(c, 19, 6 + d, 4, 3, K);
    rect(c, 19, 6 + d, 3, 2, W);
    px(c, 21, 7 + d, K);
    // punta de venda suelta que ondea sobre el lomo
    const sway = p.frame === 1 || p.frame === 3 ? -1 : p.frame === 2 || p.frame === 4 ? 1 : 0;
    for (const [x, y] of [
      [14, 5],
      [13, 4],
      [12, 4],
      [11, 3],
      [10, 3],
    ] as const)
      px(c, x, y + d + (x < 13 ? sway : 0), x % 2 ? A : B);
    // munecas vendadas
    for (const x of [7, 8, 9, 10, 15, 16, 17, 18]) {
      px(c, x, 13, x % 2 ? B : A);
      px(c, x, 14, A);
    }
  },
};
// ------------------------------------------------------------------ esqueleto

const ESQUELETO: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    const bone = '#f4f4f4';
    const boneD = '#c8d0e0';
    body(c, p, () => K, 0, 10.5, 7.4);
    // columna y costillas
    for (let x = 5; x <= 14; x++) px(c, x, 6 + d, bone);
    for (const x of [8, 10, 12, 14]) {
      rect(c, x, 7 + d, 1, 4, bone);
      px(c, x - 1, 10 + d, boneD);
    }
    for (let x = 6; x <= 15; x += 1) if (x % 2 === 0) px(c, x, 11 + d, boneD);
    // pelvis
    rect(c, 5, 10 + d, 2, 2, bone);
    // huesos de las patas
    for (const x of [8, 16]) {
      rect(c, x, 12, 1, 4, bone);
      px(c, x - 1, 15, bone);
      px(c, x + 1, 15, bone);
    }
    // craneo
    head(c, p, (x, y) => (y >= 10 + d ? boneD : bone), 0.5);
    spans(
      c,
      [
        [1, 15, 16],
        [2, 15, 16],
        [3, 15, 16],
        [1, 20, 21],
        [2, 20, 21],
        [3, 20, 21],
      ],
      bone,
      d,
    );
    rect(c, 19, 6 + d, 2, 2, K);
    px(c, 22, 9 + d, K);
    px(c, 22, 10 + d, K);
    for (const x of [18, 20, 22]) px(c, x, 11 + d, K);
    for (const x of [17, 19, 21]) px(c, x, 11 + d, bone);
    px(c, 17, 9 + d, boneD);
  },
};

// ------------------------------------------------------------------ pirata

const PIRATA: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    // camisa de rayas
    body(c, p, (x) => (x < 6 || x > 15 ? null : x % 2 === 0 ? W : '#b13e53'), -0.6, 10.5, 7.4);
    // panuelo en el cuello
    spans(
      c,
      [
        [8, 13, 16],
        [9, 13, 16],
        [10, 14, 16],
        [11, 15, 16],
      ],
      '#b13e53',
      d,
    );
    px(c, 14, 9 + d, W);
    px(c, 15, 10 + d, W);
    // tricornio: ala ancha con las puntas hacia arriba y calavera
    spans(
      c,
      [
        [3, 14, 22],
        [2, 13, 23],
        [1, 15, 21],
        [0, 17, 19],
        [-1, 18, 18],
      ],
      '#2b2d42',
      d,
    );
    spans(c, [[4, 15, 21]], K, d);
    for (let x = 14; x <= 22; x += 2) px(c, x, 3 + d, '#ffcd75');
    px(c, 13, 2 + d, '#ffcd75');
    px(c, 23, 2 + d, '#ffcd75');
    px(c, 18, 1 + d, W);
    px(c, 20, 1 + d, W);
    px(c, 19, 1 + d, K);
    rect(c, 18, 2 + d, 3, 1, W);
    // parche en el ojo con su cuerda
    rect(c, 19, 7 + d, 3, 2, K);
    for (const [x, y] of [
      [18, 6],
      [17, 5],
      [16, 4],
      [22, 7],
    ] as const)
      px(c, x, y + d, K);
    // arete
    px(c, 16, 10 + d, '#ffcd75');
  },
};
// ------------------------------------------------------------------ murcielago

const MURCIELAGO: Outfit = {
  back: (c, p) => {
    const d = p.dy;
    const M = '#46307f';
    const bone = '#8a6fd0';
    // alas de abanico: arriba al caminar, a media altura al estar quieto o bajar
    const up = p.frame === 1 || p.frame === 3;
    const rows: [number, number, number][] = up
      ? [
          [-4, 3, 4],
          [-3, 3, 6],
          [-2, 2, 8],
          [-1, 2, 9],
          [0, 3, 10],
          [1, 4, 10],
          [2, 5, 11],
          [3, 7, 11],
          [4, 9, 12],
          [5, 11, 12],
        ]
      : [
          [0, 3, 4],
          [1, 2, 7],
          [2, 2, 9],
          [3, 2, 10],
          [4, 3, 11],
          [5, 4, 12],
          [6, 6, 12],
          [7, 9, 11],
        ];
    spans(c, rows, M, d);
    // costillas del ala y borde festoneado
    const tipY = up ? -3 : 1;
    const tipX = up ? 3 : 3;
    line(c, 11, 5 + d, tipX, tipY + d, bone);
    line(c, 11, 5 + d, up ? 2 : 2, (up ? -1 : 3) + d, bone);
    line(c, 11, 5 + d, up ? 4 : 3, (up ? 1 : 5) + d, bone);
    px(c, up ? 5 : 5, (up ? -1 : 2) + d, K);
    px(c, up ? 7 : 8, (up ? 1 : 4) + d, K);
  },
  front: (c, p) => {
    const d = p.dy;
    const M = '#2a1a3d';
    // orejas largas
    spans(
      c,
      [
        [-1, 15, 15],
        [0, 15, 16],
        [1, 15, 16],
        [2, 15, 16],
        [3, 15, 16],
        [-1, 21, 21],
        [0, 20, 21],
        [1, 20, 21],
        [2, 20, 21],
        [3, 20, 21],
      ],
      M,
      d,
    );
    px(c, 16, 1 + d, '#e8738a');
    px(c, 20, 1 + d, '#e8738a');
    // antifaz con el ojo encendido
    spans(
      c,
      [
        [6, 17, 22],
        [7, 17, 22],
      ],
      K,
      d,
    );
    px(c, 20, 7 + d, '#ffcd75');
    px(c, 21, 7 + d, '#ffcd75');
    // colmillos
    px(c, 20, 10 + d, W);
    px(c, 22, 10 + d, W);
    // peto oscuro con su murcielaguito
    body(c, p, (x, y) => (x >= 10 && x <= 15 && y >= 8 + d ? M : null), -0.8, 10.5, 7.4);
    px(c, 12, 9 + d, '#ffcd75');
    px(c, 14, 9 + d, '#ffcd75');
    px(c, 13, 10 + d, '#ffcd75');
    px(c, 13, 9 + d, '#ffcd75');
  },
};
// ------------------------------------------------------------------ diablillo

const DIABLILLO: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    const R = '#b13e53';
    const RD = '#7e2638';
    // capa roja
    spans(
      c,
      [
        [6, 6, 13],
        [7, 5, 13],
        [8, 5, 14],
        [9, 4, 14],
        [10, 4, 14],
        [11, 4, 14],
        [12, 5, 13],
      ],
      R,
      d,
    );
    spans(
      c,
      [
        [10, 4, 14],
        [11, 4, 14],
      ],
      RD,
      d,
    );
    // llamas que titilan en el borde
    const flick = p.frame % 2;
    for (let x = 4; x <= 14; x++) {
      const tall = (x + flick) % 3 === 0;
      px(c, x, 12 + d, tall ? '#ffcd75' : '#ef7d57');
      if (tall) px(c, x, 13 + d, '#ef7d57');
    }
    px(c, 14, 8 + d, '#ffcd75');
    // cuernos
    for (const [x, y] of [
      [16, 3],
      [16, 2],
      [15, 1],
      [14, 0],
      [20, 3],
      [20, 2],
      [21, 1],
      [22, 0],
    ] as const)
      px(c, x, y + d, R);
    px(c, 14, -1 + d, '#ff8fa3');
    px(c, 22, -1 + d, '#ff8fa3');
    px(c, 15, 2 + d, RD);
    px(c, 21, 2 + d, RD);
    // ceja enojada y colmillo
    px(c, 19, 6 + d, K);
    px(c, 20, 5 + d, K);
    px(c, 21, 5 + d, K);
    px(c, 20, 10 + d, W);
    // cola con punta de flecha (sigue a la cola en el galope)
    const gallop = p.frame >= 3;
    const spade: [number, number][] = gallop
      ? [
          [1, 3],
          [0, 4],
          [1, 4],
          [2, 4],
          [1, 5],
        ]
      : [
          [1, -1],
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
          [1, 1],
        ];
    for (const [x, y] of spade) px(c, x, y + d, R);
  },
};

// ------------------------------------------------------------------ frankenstein

const FRANKENSTEIN: Outfit = {
  front: (c, p) => {
    const d = p.dy;
    const G1 = '#7cc063';
    const G2 = '#4f9a49';
    // saco oscuro con solapa
    body(c, p, (x) => (x < 5 ? null : x > 14 ? null : '#333c57'), -0.4, 10.5, 7.2);
    for (let y = 7; y <= 11; y++) px(c, 14, y + d, '#566c86');
    px(c, 13, 8 + d, W);
    px(c, 13, 9 + d, W);
    rect(c, 8, 10 + d, 2, 2, '#ffcd75');
    px(c, 8, 10 + d, '#ef7d57');
    px(c, 6, 8 + d, '#566c86');
    px(c, 7, 8 + d, '#566c86');
    // cabeza verde
    head(c, p, (x, y) => (y >= 10 + d ? G2 : G1), 0.3);
    // pelo plano
    rect(c, 15, 1 + d, 7, 4, K);
    rect(c, 14, 3 + d, 1, 3, K);
    rect(c, 22, 3 + d, 1, 2, K);
    // cicatriz con puntadas
    for (let x = 16; x <= 21; x++) px(c, x, 5 + d, '#b13e53');
    for (const x of [17, 19, 21]) {
      px(c, x, 4 + d, K);
      px(c, x, 6 + d, K);
    }
    // ojos y boca
    px(c, 19, 7 + d, W);
    px(c, 20, 7 + d, K);
    px(c, 21, 7 + d, W);
    for (let x = 19; x <= 22; x++) px(c, x, 10 + d, K);
    px(c, 20, 11 + d, K);
    // tornillo del cuello
    rect(c, 13, 9 + d, 2, 1, '#94b0c2');
    rect(c, 12, 8 + d, 1, 3, '#94b0c2');
  },
};

const BY_ID: Record<string, Outfit> = {
  bruja: BRUJA,
  calabaza: CALABAZA,
  fantasma: FANTASMA,
  vampiro: VAMPIRO,
  momia: MOMIA,
  esqueleto: ESQUELETO,
  pirata: PIRATA,
  murcielago: MURCIELAGO,
  diablillo: DIABLILLO,
  frankenstein: FRANKENSTEIN,
};

/** Dibuja una capa del traje `code` (1 a N). Los codigos fuera de rango no dibujan nada. */
export function drawOutfit(code: number, layer: 'back' | 'front', c: Ctx, pose: Pose): void {
  const info = OUTFITS[code - 1];
  if (!info) return;
  BY_ID[info.id]?.[layer]?.(c, pose);
}
