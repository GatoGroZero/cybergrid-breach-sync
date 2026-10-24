import { G, type BRMap } from '../../src/shared/br/map';

/** Mapa vacio y abierto para probar movimiento y tiempos sin obstaculos. */
export function openMap(w: number, h: number): BRMap {
  const ground = new Uint8Array(w * h).fill(G.GRASS);
  const solid = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    solid[x] = 1;
    solid[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    solid[y * w] = 1;
    solid[y * w + w - 1] = 1;
  }
  return {
    seed: 0,
    kind: 'bosque',
    w,
    h,
    ground,
    solid,
    houses: [],
    props: [],
    chests: [],
    spawns: [],
    landmarks: [],
  };
}
