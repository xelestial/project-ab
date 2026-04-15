/**
 * MovementResolver — calculates GameChange[] for a move action.
 * Does NOT apply state — returns changes only.
 */
import type { GameState, UnitState, Position, GameChange } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IMovementValidator } from "../validators/movement-validator.js";
import {
  getTileAttribute,
  posEqual,
  getUnitAt,
  isFrozen,
} from "../state/game-state-utils.js";

export interface IMovementResolver {
  resolve(unit: UnitState, destination: Position, state: GameState): GameChange[];
}

export class MovementResolver implements IMovementResolver {
  constructor(
    private readonly validator: IMovementValidator,
    private readonly registry: IDataRegistry,
  ) {}

  resolve(unit: UnitState, destination: Position, state: GameState): GameChange[] {
    const validation = this.validator.validateMove(unit, destination, state);
    if (!validation.valid || !validation.path) return [];

    const changes: GameChange[] = [];

    // Walk the path collecting per-tile effects
    let currentState = state;
    const path = validation.path;

    for (let i = 0; i < path.length; i++) {
      const pos = path[i]!;
      const isLastStep = i === path.length - 1;
      const attr = getTileAttribute(currentState, pos);

      // River tile: pass-through only (cannot stop, handled by validator)
      if (attr === "river") {
        // If this is somehow the last step (shouldn't happen after validation), skip
        // River entry during movement (voluntary crossing) — no special effect
        continue;
      }

      if (isLastStep) {
        // Landing on destination
        changes.push({
          type: "unit_move",
          unitId: unit.unitId,
          from: unit.position,
          to: destination,
        });

        // Tile entry effects
        const entryChanges = this.resolveTileEntry(unit, pos, state);
        changes.push(...entryChanges);
      }
    }

    return changes;
  }

  /**
   * Resolve effects when a unit lands on a tile.
   */
  private resolveTileEntry(unit: UnitState, pos: Position, state: GameState): GameChange[] {
    const changes: GameChange[] = [];
    const attr = getTileAttribute(state, pos);

    switch (attr) {
      case "fire": {
        // Stepping on fire tile: applies fire effect (if not already on fire)
        const hasFire = unit.activeEffects.some((e) => e.effectType === "fire");
        if (!hasFire) {
          const effectMeta = this.registry.getEffectByType("fire");
          if (effectMeta !== undefined) {
            changes.push({
              type: "unit_effect_add",
              unitId: unit.unitId,
              effectId: effectMeta.id,
              effectType: "fire",
              turnsRemaining: 3,
            });
          }
        }
        break;
      }

      case "water": {
        // Water tile removes fire and acid effects
        for (const effect of unit.activeEffects) {
          if (effect.effectType === "fire" || effect.effectType === "acid") {
            changes.push({
              type: "unit_effect_remove",
              unitId: unit.unitId,
              effectId: effect.effectId,
              effectType: effect.effectType,
            });
          }
        }
        break;
      }

      case "acid": {
        const hasFire = unit.activeEffects.some((e) => e.effectType === "acid");
        if (!hasFire) {
          const effectMeta = this.registry.getEffectByType("acid");
          if (effectMeta !== undefined) {
            changes.push({
              type: "unit_effect_add",
              unitId: unit.unitId,
              effectId: effectMeta.id,
              effectType: "acid",
              turnsRemaining: 3,
            });
          }
        }
        break;
      }

      case "electric": {
        const effectMeta = this.registry.getEffectByType("electric");
        if (effectMeta !== undefined) {
          changes.push({
            type: "unit_effect_add",
            unitId: unit.unitId,
            effectId: effectMeta.id,
            effectType: "electric",
            turnsRemaining: 1,
          });
        }
        break;
      }

      case "ice": {
        const effectMeta = this.registry.getEffectByType("freeze");
        if (effectMeta !== undefined) {
          // Freeze clears other effects first
          for (const e of unit.activeEffects) {
            changes.push({
              type: "unit_effect_remove",
              unitId: unit.unitId,
              effectId: e.effectId,
              effectType: e.effectType,
            });
          }
          changes.push({
            type: "unit_effect_add",
            unitId: unit.unitId,
            effectId: effectMeta.id,
            effectType: "freeze",
            turnsRemaining: 1,
          });
        }
        break;
      }

      case "sand": {
        const effectMeta = this.registry.getEffectByType("sand");
        if (effectMeta !== undefined) {
          changes.push({
            type: "unit_effect_add",
            unitId: unit.unitId,
            effectId: effectMeta.id,
            effectType: "sand",
            turnsRemaining: undefined,
          });
        }
        break;
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
