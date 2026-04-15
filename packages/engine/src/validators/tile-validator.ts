/**
 * TileValidator — pure function validator for tile attribute conversion.
 */
import type { GameState, Position, ValidationResult, TileAttributeType, AttackAttribute } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import { VALID } from "@ab/metadata";
import { getTileAttribute, orthogonalNeighbors } from "../state/game-state-utils.js";

export interface ITileValidator {
  /** Can this tile be converted to the given attribute? */
  canConvertTile(position: Position, newAttribute: AttackAttribute, state: GameState): ValidationResult;
  /** Returns the effective tile attribute after applying the given attack attribute */
  resolveConversion(current: TileAttributeType, attackAttr: AttackAttribute): TileAttributeType;
}

export class TileValidator implements ITileValidator {
  constructor(private readonly _registry: IDataRegistry) {}

  canConvertTile(position: Position, newAttribute: AttackAttribute, _state: GameState): ValidationResult {
    // Rule: last attack attribute always wins — no restrictions on conversion
    // (mountain is impassable but can still be hit and converted)
    if (newAttribute === "none") return VALID; // "none" = no conversion
    return VALID;
  }

  /**
   * Helper: count how many orthogonal neighbors have water/river attribute.
   * Used by TileResolver to decide if river should form.
   * (Not currently triggered — reserved for future river-formation rule)
   */
  countWaterNeighbors(position: Position, state: GameState): number {
    return orthogonalNeighbors(position).filter((n) => {
      const attr = getTileAttribute(state, n);
      return attr === "water" || attr === "river";
    }).length;
  }

  /**
   * Returns the effective tile attribute after a given attack attribute is applied.
   * Rule: last attack attribute overwrites tile attribute.
   * "none" → no change.
   */
  resolveConversion(current: TileAttributeType, attackAttr: AttackAttribute): TileAttributeType {
    if (attackAttr === "none") return current;
    // Attack attributes map directly to tile attributes of the same name
    return attackAttr as TileAttributeType;
  }
}
