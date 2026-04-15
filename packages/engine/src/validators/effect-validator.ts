/**
 * EffectValidator — pure function validator for effect application/removal.
 */
import type { GameState, UnitState, ValidationResult } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import { VALID, invalid, ErrorCode } from "@ab/metadata";
import { hasEffect } from "../state/game-state-utils.js";

export type RemoveReason =
  | "turns_expired"
  | "manual_extinguish"
  | "river_entry"
  | "on_move"
  | "on_attack"
  | "collision_with_frozen";

export interface IEffectValidator {
  canApplyEffect(effectId: string, unit: UnitState, state: GameState): ValidationResult;
  canRemoveEffect(effectId: string, unit: UnitState, reason: RemoveReason): ValidationResult;
}

export class EffectValidator implements IEffectValidator {
  constructor(private readonly registry: IDataRegistry) {}

  canApplyEffect(effectId: string, unit: UnitState, state: GameState): ValidationResult {
    const meta = this.registry.getEffect(effectId);

    // Freeze can always be applied (clears other effects first)
    if (meta.effectType === "freeze") {
      return VALID;
    }

    // If unit is frozen, no other effects can be applied
    if (hasEffect(unit, "freeze")) {
      return invalid(ErrorCode.MOVE_FROZEN);
    }

    return VALID;
  }

  canRemoveEffect(effectId: string, unit: UnitState, reason: RemoveReason): ValidationResult {
    const meta = this.registry.getEffect(effectId);
    const existing = unit.activeEffects.find((e) => e.effectId === effectId);

    if (existing === undefined) {
      return invalid(ErrorCode.UNKNOWN_EFFECT);
    }

    // Check if the removeCondition matches the reason
    const allowed = meta.removeConditions.some((cond) => {
      switch (cond.type) {
        case "turns":
          return reason === "turns_expired";
        case "manual_extinguish":
          return reason === "manual_extinguish";
        case "river_entry":
          return reason === "river_entry";
        case "on_move":
          return reason === "on_move";
        case "on_attack":
          return reason === "on_attack";
        case "collision_with_frozen":
          return reason === "collision_with_frozen";
        default:
          return false;
      }
    });

    return allowed ? VALID : invalid(ErrorCode.INTERNAL_ERROR);
  }
}
