/**
 * TerrainGenerator — random terrain placement for game maps.
 *
 * 11×11: 4 rocks ("mountain"), 4 water tiles, rest = random plain base
 * 16×16: 8 rocks, 8 water tiles, rest = random plain base
 * Water adjacency rule: 3+ connected water → all become "river"
 * Protected: spawn points are never blocked
 */
import type { TileState, TileAttributeType, SpawnPoint } from "@ab/metadata";

const PLAIN_BASES: TileAttributeType[] = ["plain", "sand", "road"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface TerrainResult {
  tiles: Record<string, TileState>;
  baseTile: TileAttributeType;
}

export function generateTerrain(
  gridSize: number,
  spawnPoints: SpawnPoint[],
): TerrainResult {
  const baseTile = PLAIN_BASES[Math.floor(Math.random() * PLAIN_BASES.length)]!;
  const rockCount = gridSize <= 11 ? 4 : 8;
  const waterCount = gridSize <= 11 ? 4 : 8;

  // Protected spawn positions
  const protectedSet = new Set<string>();
  for (const sp of spawnPoints) {
    for (const pos of sp.positions) {
      protectedSet.add(`${pos.row},${pos.col}`);
    }
  }

  // Candidate cells (not protected)
  const candidates: { row: number; col: number }[] = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (!protectedSet.has(`${r},${c}`)) {
        candidates.push({ row: r, col: c });
      }
    }
  }

  const shuffled = shuffle(candidates);
  const rocks = shuffled.slice(0, rockCount);
  const waters = shuffled.slice(rockCount, rockCount + waterCount);

  const tiles: Record<string, TileState> = {};

  for (const pos of rocks) {
    tiles[`${pos.row},${pos.col}`] = {
      position: pos,
      attribute: "mountain",
      attributeTurnsRemaining: undefined,
    };
  }

  // Place water first (may be upgraded to river)
  const waterSet = new Set<string>(waters.map((p) => `${p.row},${p.col}`));
  for (const pos of waters) {
    tiles[`${pos.row},${pos.col}`] = {
      position: pos,
      attribute: "water",
      attributeTurnsRemaining: undefined,
    };
  }

  // BFS to find connected water groups; 3+ → river
  const visited = new Set<string>();
  for (const pos of waters) {
    const key = `${pos.row},${pos.col}`;
    if (visited.has(key)) continue;

    const group: { row: number; col: number }[] = [];
    const queue: { row: number; col: number }[] = [pos];
    visited.add(key);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      group.push(curr);
      for (const [dr, dc] of [
        [-1, 0], [1, 0], [0, -1], [0, 1],
      ] as [number, number][]) {
        const n = { row: curr.row + dr, col: curr.col + dc };
        const nk = `${n.row},${n.col}`;
        if (waterSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(n);
        }
      }
    }

    if (group.length >= 3) {
      for (const p of group) {
        tiles[`${p.row},${p.col}`]!.attribute = "river";
      }
    }
  }

  return { tiles, baseTile };
}
