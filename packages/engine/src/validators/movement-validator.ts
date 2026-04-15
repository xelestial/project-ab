/**
 * MovementValidator — pure function validator for unit movement.
 * P-03: No side effects. Same input → same output.
 */
import type { GameState, UnitState, Position, ValidationResult } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import {
  ErrorCode,
  VALID,
  invalid,
  MOVE_COST_RIVER,
  MOVE_COST_SAND,
} from "@ab/metadata";
import {
  posKey,
  posEqual,
  isInBounds,
  orthogonalNeighbors,
  getTileAttribute,
  isFrozen,
  getUnitAt,
} from "../state/game-state-utils.js";

// ─── Return types ─────────────────────────────────────────────────────────────

export interface MoveValidation {
  valid: boolean;
  errorCode?: string;
  path?: Position[];
  cost?: number;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IMovementValidator {
  /** Can this unit enter this tile at all (ignoring MP)? */
  canEnterTile(unit: UnitState, target: Position, state: GameState): ValidationResult;

  /** Full BFS validation: can unit reach destination this turn? */
  validateMove(unit: UnitState, destination: Position, state: GameState): MoveValidation;

  /** All reachable tiles this turn (for UI highlighting) */
  getReachableTiles(unit: UnitState, state: GameState): Position[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class MovementValidator implements IMovementValidator {
  constructor(private readonly registry: IDataRegistry) {}

  canEnterTile(unit: UnitState, target: Position, state: GameState): ValidationResult {
    if (!isInBounds(target, state.map.gridSize)) return invalid(ErrorCode.MOVE_OUT_OF_RANGE);

    const attr = getTileAttribute(state, target);

    // Mountain: impassable
    if (attr === "mountain") return invalid(ErrorCode.MOVE_BLOCKED_MOUNTAIN);

    return VALID;
  }

  validateMove(unit: UnitState, destination: Position, state: GameState): MoveValidation {
    // 1. Frozen check
    if (isFrozen(unit)) {
      return { valid: false, errorCode: ErrorCode.MOVE_FROZEN };
    }

    // 2. Already moved check
    if (unit.actionsUsed.moved) {
      return { valid: false, errorCode: ErrorCode.MOVE_ALREADY_MOVED };
    }

    // 3. Bounds check
    if (!isInBounds(destination, state.map.gridSize)) {
      return { valid: false, errorCode: ErrorCode.MOVE_OUT_OF_RANGE };
    }

    // 4. Destination cannot be occupied (by any alive unit)
    const occupant = getUnitAt(state, destination);
    if (occupant !== undefined) {
      return { valid: false, errorCode: ErrorCode.MOVE_BLOCKED_UNIT };
    }

    // 5. Destination cannot be a river tile (cannot stop on river)
    const destAttr = getTileAttribute(state, destination);
    if (destAttr === "river") {
      return { valid: false, errorCode: ErrorCode.MOVE_BLOCKED_UNIT };
    }

    // 6. Mountain impassable
    if (destAttr === "mountain") {
      return { valid: false, errorCode: ErrorCode.MOVE_BLOCKED_MOUNTAIN };
    }

    // 7. BFS to find path
    const result = this.bfs(unit, destination, state);
    if (result === null) {
      return { valid: false, errorCode: ErrorCode.MOVE_NO_PATH };
    }

    return { valid: true, path: result.path, cost: result.cost };
  }

  getReachableTiles(unit: UnitState, state: GameState): Position[] {
    if (isFrozen(unit) || unit.actionsUsed.moved) return [];
    return this.bfsAll(unit, state);
  }

  // ─── BFS ─────────────────────────────────────────────────────────────────

  private moveCost(pos: Position, state: GameState): number {
    const attr = getTileAttribute(state, pos);
    if (attr === "river") return MOVE_COST_RIVER;
    if (attr === "sand") return MOVE_COST_SAND;
    return 1;
  }

  /**
   * Dijkstra/BFS to find shortest (cheapest) path to destination.
   * Returns null if unreachable within unit's movement.
   */
  private bfs(
    unit: UnitState,
    destination: Position,
    state: GameState,
  ): { path: Position[]; cost: number } | null {
    const mp = unit.currentHealth > 0 ? unit.actionsUsed.moved ? 0 : getMovementPoints(unit, state) : 0;
    if (mp <= 0) return null;

    // Priority queue (min-heap via sorted array for simplicity at 11×11 grid)
    type Node = { pos: Position; cost: number; path: Position[] };
    const queue: Node[] = [{ pos: unit.position, cost: 0, path: [] }];
    const visited = new Map<string, number>(); // key → min cost seen

    while (queue.length > 0) {
      // Pop minimum cost node
      queue.sort((a, b) => a.cost - b.cost);
      const node = queue.shift()!;
      const key = posKey(node.pos);

      if ((visited.get(key) ?? Infinity) <= node.cost) continue;
      visited.set(key, node.cost);

      if (posEqual(node.pos, destination)) {
        return { path: node.path, cost: node.cost };
      }

      for (const neighbor of orthogonalNeighbors(node.pos, state.map.gridSize)) {
        const nKey = posKey(neighbor);
        const attr = getTileAttribute(state, neighbor);

        // Cannot enter mountain
        if (attr === "mountain") continue;

        const cost = node.cost + this.moveCost(neighbor, state);
        if (cost > mp) continue;
        if ((visited.get(nKey) ?? Infinity) <= cost) continue;

        // Cannot stop on river (but can pass through)
        // Cannot stop on occupied tile (but can pass through)
        const isRiver = attr === "river";
        const isOccupied = getUnitAt(state, neighbor) !== undefined;

        // We track paths that end on river/occupied only as intermediate steps
        if (posEqual(neighbor, destination) && (isRiver || isOccupied)) {
          // Invalid final position
          continue;
        }

        queue.push({ pos: neighbor, cost, path: [...node.path, neighbor] });
      }
    }

    return null;
  }

  /**
   * BFS all reachable positions (for UI range display).
   * Returns positions where the unit can *stop* (not river, not occupied).
   */
  private bfsAll(unit: UnitState, state: GameState): Position[] {
    const mp = getMovementPoints(unit, state);
    if (mp <= 0) return [];

    type Node = { pos: Position; cost: number };
    const queue: Node[] = [{ pos: unit.position, cost: 0 }];
    const visited = new Map<string, number>();
    const reachable: Position[] = [];

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const node = queue.shift()!;
      const key = posKey(node.pos);

      if ((visited.get(key) ?? Infinity) <= node.cost) continue;
      visited.set(key, node.cost);

      // Add to reachable if it's not the start, not river, and not occupied
      if (!posEqual(node.pos, unit.position)) {
        const attr = getTileAttribute(state, node.pos);
        const isOccupied = getUnitAt(state, node.pos) !== undefined;
        if (attr !== "river" && !isOccupied) {
          reachable.push(node.pos);
        }
      }

      for (const neighbor of orthogonalNeighbors(node.pos, state.map.gridSize)) {
        const nKey = posKey(neighbor);
        const attr = getTileAttribute(state, neighbor);
        if (attr === "mountain") continue;

        const cost = node.cost + this.moveCost(neighbor, state);
        if (cost > mp) continue;
        if ((visited.get(nKey) ?? Infinity) <= cost) continue;

        queue.push({ pos: neighbor, cost });
      }
    }

    return reachable;
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getMovementPoints(unit: UnitState, _state: GameState): number {
  return unit.movementPoints;
}
