/**
 * Terrain generator — modular, fully injectable.
 *
 * All sub-functions are exported for unit testing.
 * Randomness is injected via Rng so tests can be seeded/deterministic.
 *
 * Composition:
 *   pickBaseTile / pickElementalType / pickSideCount
 *   → getSideCandidates (available positions per side)
 *   → placeSideTiles    (place rock / water / elemental on one side)
 *   → applyRiverFormation (connected water 3+ → river)
 *   → generateTerrain   (orchestrates everything)
 */

import type { TileState, TileAttributeType, SpawnPoint } from "@ab/metadata";
import {
  TERRAIN_PER_SIDE_MIN,
  TERRAIN_PER_SIDE_MAX,
  ELEMENTAL_PER_SIDE,
  RIVER_FORMATION_MIN_SIZE,
} from "@ab/metadata";
import { MathRng, type Rng } from "./rng.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PLAIN_BASES: readonly TileAttributeType[] = ["plain", "sand", "road"];
export const ELEMENTAL_TYPES: readonly TileAttributeType[] = ["fire", "acid", "electric", "ice"];

// ─── Config ───────────────────────────────────────────────────────────────────

/** Optional overrides — any omitted field is randomised at runtime. */
export interface TerrainConfig {
  baseTile?: TileAttributeType;
  elementalType?: TileAttributeType;
  elementalPerSide?: number;
  /** Per-side overrides. If absent both sides use random counts. */
  sideA?: { rockCount?: number; waterCount?: number };
  sideB?: { rockCount?: number; waterCount?: number };
  /** Global count bounds (used when sideA/B counts are not fixed). */
  rockMin?: number;
  rockMax?: number;
  waterMin?: number;
  waterMax?: number;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface TerrainResult {
  tiles: Record<string, TileState>;
  baseTile: TileAttributeType;
  elementalType: TileAttributeType;
  /** Diagnostic: counts actually placed per side. */
  sides: {
    a: { rockCount: number; waterCount: number; elementalCount: number };
    b: { rockCount: number; waterCount: number; elementalCount: number };
  };
}

// ─── Sub-functions ────────────────────────────────────────────────────────────

export function pickBaseTile(rng: Rng): TileAttributeType {
  return rng.pick(PLAIN_BASES);
}

export function pickElementalType(rng: Rng): TileAttributeType {
  return rng.pick(ELEMENTAL_TYPES);
}

export function pickSideCount(min: number, max: number, rng: Rng): number {
  return rng.randInt(min, max);
}

/**
 * Returns all grid positions in the given rows that are not in excludedKeys.
 * Deterministic (no RNG) — purely filters.
 */
export function getSideCandidates(
  rows: number[],
  gridSize: number,
  excludedKeys: ReadonlySet<string>,
): { row: number; col: number }[] {
  return rows
    .flatMap((r) => Array.from({ length: gridSize }, (_, c) => ({ row: r, col: c })))
    .filter((pos) => !excludedKeys.has(`${pos.row},${pos.col}`));
}

export interface PlaceSideOpts {
  rows: number[];
  gridSize: number;
  excludedKeys: ReadonlySet<string>;
  rockCount: number;
  waterCount: number;
  elementalType: TileAttributeType;
  elementalPerSide: number;
  rng: Rng;
}

/**
 * Places mountain / water / elemental tiles on one side.
 * Returns only the newly placed tiles (does not mutate shared state).
 */
export function placeSideTiles(opts: PlaceSideOpts): {
  tiles: Record<string, TileState>;
  placed: { rockCount: number; waterCount: number; elementalCount: number };
} {
  const { rows, gridSize, excludedKeys, rockCount, waterCount, elementalType, elementalPerSide, rng } = opts;
  const candidates = getSideCandidates(rows, gridSize, excludedKeys);
  const shuffled = rng.shuffle(candidates);

  const tiles: Record<string, TileState> = {};
  let idx = 0;
  let placedRocks = 0;
  let placedWater = 0;
  let placedElemental = 0;

  for (let i = 0; i < rockCount && idx < shuffled.length; i++, idx++) {
    const pos = shuffled[idx]!;
    tiles[`${pos.row},${pos.col}`] = { position: pos, attribute: "mountain", attributeTurnsRemaining: undefined };
    placedRocks++;
  }

  for (let i = 0; i < waterCount && idx < shuffled.length; i++, idx++) {
    const pos = shuffled[idx]!;
    tiles[`${pos.row},${pos.col}`] = { position: pos, attribute: "water", attributeTurnsRemaining: undefined };
    placedWater++;
  }

  for (let i = 0; i < elementalPerSide && idx < shuffled.length; i++, idx++) {
    const pos = shuffled[idx]!;
    tiles[`${pos.row},${pos.col}`] = { position: pos, attribute: elementalType, attributeTurnsRemaining: undefined };
    placedElemental++;
  }

  return { tiles, placed: { rockCount: placedRocks, waterCount: placedWater, elementalCount: placedElemental } };
}

/**
 * Promotes connected groups of water tiles (size ≥ minGroupSize) to river.
 * Pure function — returns a new tiles object.
 */
export function applyRiverFormation(
  tiles: Record<string, TileState>,
  minGroupSize: number = RIVER_FORMATION_MIN_SIZE,
): Record<string, TileState> {
  const result: Record<string, TileState> = { ...tiles };
  const waterKeys = new Set(Object.entries(result).filter(([, t]) => t.attribute === "water").map(([k]) => k));
  const visited = new Set<string>();

  for (const key of waterKeys) {
    if (visited.has(key)) continue;
    const pos = result[key]!.position;
    const group: { row: number; col: number }[] = [];
    const queue = [pos];
    visited.add(key);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      group.push(curr);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        const nk = `${curr.row + dr},${curr.col + dc}`;
        if (waterKeys.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push({ row: curr.row + dr, col: curr.col + dc });
        }
      }
    }

    if (group.length >= minGroupSize) {
      for (const p of group) {
        result[`${p.row},${p.col}`] = { ...result[`${p.row},${p.col}`]!, attribute: "river" };
      }
    }
  }

  return result;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function generateTerrain(
  gridSize: number,
  spawnPoints: SpawnPoint[],
  rng: Rng = new MathRng(),
  config: TerrainConfig = {},
): TerrainResult {
  const baseTile = config.baseTile ?? pickBaseTile(rng);
  const elementalType = config.elementalType ?? pickElementalType(rng);
  const elementalPerSide = config.elementalPerSide ?? ELEMENTAL_PER_SIDE;
  const midRow = Math.floor(gridSize / 2);

  const rockMin = config.rockMin ?? TERRAIN_PER_SIDE_MIN;
  const rockMax = config.rockMax ?? TERRAIN_PER_SIDE_MAX;
  const waterMin = config.waterMin ?? TERRAIN_PER_SIDE_MIN;
  const waterMax = config.waterMax ?? TERRAIN_PER_SIDE_MAX;

  const protectedKeys = new Set<string>();
  for (const sp of spawnPoints) {
    for (const pos of sp.positions) protectedKeys.add(`${pos.row},${pos.col}`);
  }

  const sideARows = Array.from({ length: midRow }, (_, i) => i);
  const sideBRows = Array.from({ length: gridSize - midRow }, (_, i) => midRow + i);

  const rockCountA = config.sideA?.rockCount ?? pickSideCount(rockMin, rockMax, rng);
  const waterCountA = config.sideA?.waterCount ?? pickSideCount(waterMin, waterMax, rng);

  const { tiles: tilesA, placed: placedA } = placeSideTiles({
    rows: sideARows, gridSize, excludedKeys: protectedKeys,
    rockCount: rockCountA, waterCount: waterCountA,
    elementalType, elementalPerSide, rng,
  });

  // Side B excludes both protected spawn cells and all side-A placements
  const excludedB = new Set<string>([...protectedKeys, ...Object.keys(tilesA)]);

  const rockCountB = config.sideB?.rockCount ?? pickSideCount(rockMin, rockMax, rng);
  const waterCountB = config.sideB?.waterCount ?? pickSideCount(waterMin, waterMax, rng);

  const { tiles: tilesB, placed: placedB } = placeSideTiles({
    rows: sideBRows, gridSize, excludedKeys: excludedB,
    rockCount: rockCountB, waterCount: waterCountB,
    elementalType, elementalPerSide, rng,
  });

  const merged = applyRiverFormation({ ...tilesA, ...tilesB });

  return {
    tiles: merged,
    baseTile,
    elementalType,
    sides: { a: placedA, b: placedB },
  };
}
