/**
 * MovementResolver — calculates GameChange[] for a move action.
 * Does NOT apply state — returns changes only.
 *
 * Tile entry effects are fully delegated to TileTransitionResolver (data-driven).
 */
import type { GameState, UnitState, Position, GameChange } from "@ab/metadata";
import type { IMovementValidator } from "../validators/movement-validator.js";
import type { ITileTransitionResolver } from "./tile-transition-resolver.js";
import { getTileAttribute } from "../state/game-state-utils.js";

export interface IMovementResolver {
  resolve(unit: UnitState, destination: Position, state: GameState): GameChange[];
}

export class MovementResolver implements IMovementResolver {
  constructor(
    private readonly validator: IMovementValidator,
    private readonly tileTransition: ITileTransitionResolver,
  ) {}

  resolve(unit: UnitState, destination: Position, state: GameState): GameChange[] {
    const validation = this.validator.validateMove(unit, destination, state);
    if (!validation.valid || !validation.path) return [];

    const changes: GameChange[] = [];
    const path = validation.path;

    for (let i = 0; i < path.length; i++) {
      const pos = path[i]!;
      const isLastStep = i === path.length - 1;
      const attr = getTileAttribute(state, pos);

      // River: pass-through only — cannot stop (validator guarantees this)
      if (attr === "river") continue;

      if (isLastStep) {
        changes.push({
          type: "unit_move",
          unitId: unit.unitId,
          from: unit.position,
          to: destination,
        });

        // ── Tile transition (타일 이동 시 → 지형 효과 획득/손실) ──────────────
        changes.push(...this.tileTransition.resolveUnitEntersTile(unit, attr, state));
      }
    }

    return changes;
  }
}

// ─── River push resolver ──────────────────────────────────────────────────────

/**
 * Resolves the special case where a unit is PUSHED into a river tile
 * (by knockback). This is different from voluntary river crossing.
 */
export function resolveRiverPush(
  unit: UnitState,
  riverPos: Position,
  _state: GameState,
): GameChange[] {
  const changes: GameChange[] = [];

  const clearedEffectIds = unit.activeEffects.map((e) => e.effectId);
  const clearedAttributes: string[] = []; // unit intrinsic attributes (future use)

  changes.push({
    type: "unit_river_enter",
    unitId: unit.unitId,
    position: riverPos,
    clearedEffectIds,
    clearedAttributes: [],
  });

  return changes;
}
