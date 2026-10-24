import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, NODE, TILE } from '../../src/shared/constants';
import { pathDistance } from '../../src/shared/flow';
import { countFloor, generateMap, isWallTile, reachableFloor } from '../../src/shared/map';

describe('generador procedural de mapas', () => {
  it('es determinista: la misma semilla produce exactamente la misma cuadricula', () => {
    const a = generateMap(12345);
    const b = generateMap(12345);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.nodes).toEqual(b.nodes);
    expect(a.exit).toEqual(b.exit);
    const c = generateMap(54321);
    expect(Array.from(c.tiles)).not.toEqual(Array.from(a.tiles));
  });

  it('todo el piso esta conectado y los nodos y la salida son alcanzables desde el spawn', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const map = generateMap(seed);
      const sx = Math.floor(map.spawn.x / TILE);
      const sy = Math.floor(map.spawn.y / TILE);
      expect(reachableFloor(map, sx, sy)).toBe(countFloor(map));
      for (const node of map.nodes) expect(pathDistance(map, map.spawn, node)).toBeGreaterThan(0);
      expect(pathDistance(map, map.spawn, map.exit)).toBeGreaterThan(0);
    }
  });

  it('cumple las reglas de diseno: bordes de muro, 3 nodos y salida en salas distintas', () => {
    for (let seed = 100; seed < 120; seed++) {
      const map = generateMap(seed);
      expect(map.w).toBe(MAP_W);
      expect(map.h).toBe(MAP_H);
      for (let x = 0; x < map.w; x++) {
        expect(isWallTile(map, x, 0)).toBe(true);
        expect(isWallTile(map, x, map.h - 1)).toBe(true);
      }
      for (let y = 0; y < map.h; y++) {
        expect(isWallTile(map, 0, y)).toBe(true);
        expect(isWallTile(map, map.w - 1, y)).toBe(true);
      }
      expect(map.nodes).toHaveLength(NODE.count);
      const used = new Set([map.spawnRoom, ...map.nodeRooms, map.exitRoom]);
      expect(used.size).toBe(NODE.count + 2);
      for (const node of map.nodes) {
        expect(isWallTile(map, Math.floor(node.x / TILE), Math.floor(node.y / TILE))).toBe(false);
      }
    }
  });
});
