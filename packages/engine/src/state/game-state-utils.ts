/**
 * Pure helper functions for reading GameState.
 * No mutations — all functions take state and return derived values.
 */
import type {
  GameState,
  UnitState,
  TileState,
  PlayerState,
  Position,
  TileAttributeType,
  UnitEffectType,
} from "@ab/metadata";
import { GRID_SIZE } from "@ab/metadata";

// ─── Position helpers ─────────────────────────────────────────────────────────

export function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

export function posFromKey(key: string): Position {
  const [r, c] = key.split(",").map(Number);
  if (r === undefined || c === undefined || isNaN(r) || isNaN(c)) {
    throw new Error(`Invalid position key: ${key}`);
  }
  return { row: r, col: c };
}

export function posEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export function isInBounds(p: Position, gridSize: number = GRID_SIZE): boolean {
  return p.row >= 0 && p.row < gridSize && p.col >= 0 && p.col < gridSize;
}

/** All 4 orthogonal neighbors within bounds */
export function orthogonalNeighbors(p: Position, gridSize: number = GRID_SIZE): Position[] {
  return [
    { row: p.row - 1, col: p.col },
    { row: p.row + 1, col: p.col },
    { row: p.row, col: p.col - 1 },
    { row: p.row, col: p.col + 1 },
  ].filter((n) => isInBounds(n, gridSize));
}

/** All 8 neighbors within bounds */
export function allNeighbors(p: Position, gridSize: number = GRID_SIZE): Position[] {
  const result: Position[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const n = { row: p.row + dr, col: p.col + dc };
      if (isInBounds(n, gridSize)) result.push(n);
    }
  }
  return result;
}

/**
 * Returns the direction delta from `from` to `to` (only orthogonal/diagonal).
 * Returns null if not a simple unit-step direction.
 */
export function directionDelta(from: Position, to: Position): { dRow: number; dCol: number } | null {
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  if (dr === 0 && dc === 0) return null;
  return { dRow: dr, dCol: dc };
}

// ─── Unit lookups ─────────────────────────────────────────────────────────────

export function getUnitAt(state: GameState, pos: Position): UnitState | undefined {
  for (const unit of Object.values(state.units)) {
    if (unit.alive && posEqual(unit.position, pos)) return unit;
  }
  return undefined;
}

export function getAliveUnits(state: GameState): UnitState[] {
  return Object.values(state.units).filter((u) => u.alive);
}

export function getPlayerUnits(state: GameState, playerId: string): UnitState[] {
  return Object.values(state.units).filter((u) => u.alive && u.playerId === playerId);
}

export function getCurrentTurnPlayer(state: GameState): PlayerState | undefined {
  const slot = state.turnOrder[state.currentTurnIndex];
  if (slot === undefined) return undefined;
  return state.players[slot.playerId];
}

export function getCurrentTurnUnit(state: GameState): UnitState | undefined {
  const slot = state.turnOrder[state.currentTurnIndex];
  if (slot === undefined) return undefined;
  // The slot represents a player's turn — return first un-acted unit of that player
  // In this game each player moves all their units per turn, but the turn order
  // determines which player acts. The specific unit within a turn is chosen by the player.
  // For single-unit-per-turn resolution, the GameLoop tracks this externally.
  return state.players[slot.playerId] !== undefined
    ? Object.values(state.units).find(
        (u) => u.alive && u.playerId === slot.playerId,
      )
    : undefined;
}

// ─── Tile lookups ─────────────────────────────────────────────────────────────

export function getTileState(state: GameState, pos: Position): TileState {
  const key = posKey(pos);
  return (
    state.map.tiles[key] ?? {
      position: pos,
      attribute: "plain" as TileAttributeType,
      attributeTurnsRemaining: undefined,
    }
  );
}

export function getTileAttribute(state: GameState, pos: Position): TileAttributeType {
  return getTileState(state, pos).attribute;
}

// ─── Effect helpers ───────────────────────────────────────────────────────────

export function hasEffect(unit: UnitState, effectType: UnitEffectType): boolean {
  return unit.activeEffects.some((e) => e.effectType === effectType);
}

export function isFrozen(unit: UnitState): boolean {
  return hasEffect(unit, "freeze");
}

export function isOnFire(unit: UnitState): boolean {
  return hasEffect(unit, "fire");
}

export function getEffect(unit: UnitState, effectType: UnitEffectType) {
  return unit.activeEffects.find((e) => e.effectType === effectType);
}

// ─── Position list helpers ────────────────────────────────────────────────────

/**
 * Returns all positions in a straight line from `from` toward `to`
 * (orthogonal only; stops at grid boundary). Does NOT include `from`.
 */
export function linePositions(from: Position, to: Position, gridSize: number = GRID_SIZE): Position[] {
  const delta = directionDelta(from, to);
  if (delta === null) return [];
  const positions: Position[] = [];
  let cur: Position = { row: from.row + delta.dRow, col: from.col + delta.dCol };
  while (isInBounds(cur, gridSize)) {
    positions.push(cur);
    if (posEqual(cur, to)) break; // stop at target
    cur = { row: cur.row + delta.dRow, col: cur.col + delta.dCol };
  }
  return positions;
}

/**
 * Returns all positions within manhattan `radius` of `center`.
 */
export function areaPositions(center: Position, radius: number, includeCenter: boolean, gridSize: number = GRID_SIZE): Position[] {
  const results: Position[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (!includeCenter && dr === 0 && dc === 0) continue;
      if (Math.abs(dr) + Math.abs(dc) > radius) continue;
      const p = { row: center.row + dr, col: center.col + dc };
      if (isInBounds(p, gridSize)) results.push(p);
    }
  }
  return results;
}
