/**
 * TileResolver — calculates GameChange[] for tile attribute conversions.
 */
import type { GameState, Position, GameChange, AttackAttribute, RemoveCondition } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { ITileValidator } from "../validators/tile-validator.js";
import { getTileAttribute, getUnitAt } from "../state/game-state-utils.js";

export interface ITileResolver {
  resolveAttributeConversion(
    position: Position,
    attackAttribute: AttackAttribute,
    attackerId: string,
    weaponId: string,
    state: GameState,
  ): GameChange[];
}

export class TileResolver implements ITileResolver {
  constructor(
    private readonly validator: ITileValidator,
    private readonly registry: IDataRegistry,
  ) {}

  resolveAttributeConversion(
    position: Position,
    attackAttribute: AttackAttribute,
    attackerId: string,
    _weaponId: string,
    state: GameState,
  ): GameChange[] {
    if (attackAttribute === "none") return [];

    const validation = this.validator.canConvertTile(position, attackAttribute, state);
    if (!validation.valid) return [];

    const current = getTileAttribute(state, position);
    const newAttr = this.validator.resolveConversion(current, attackAttribute);

    if (newAttr === current) return [];

    const changes: GameChange[] = [
      {
        type: "tile_attribute_change",
        position,
        from: current,
        to: newAttr,
        causedBy: {
          attackerId: attackerId as import("@ab/metadata").UnitId,
          attribute: attackAttribute,
        },
      },
    ];

    // Immediately apply tile effect to unit standing on this tile, if any
    const unitOnTile = getUnitAt(state, position);
    if (unitOnTile !== undefined) {
      const effectChanges = this.resolveTileEffectOnUnit(unitOnTile, newAttr, state);
      changes.push(...effectChanges);
    }

    return changes;
  }

  /**
   * When a tile changes attribute, units standing on it may gain/lose effects.
   */
  private resolveTileEffectOnUnit(
    unit: import("@ab/metadata").UnitState,
    newAttr: import("@ab/metadata").TileAttributeType,
    _state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];

    // Water tile conversion removes fire/acid from standing unit
    if (newAttr === "water") {
      for (const eff of unit.activeEffects) {
        if (eff.effectType === "fire" || eff.effectType === "acid") {
          changes.push({
            type: "unit_effect_remove",
            unitId: unit.unitId,
            effectId: eff.effectId,
            effectType: eff.effectType,
          });
        }
      }
    }

    // Fire/acid/electric tile — apply matching effect to standing unit
    const effectType =
      newAttr === "fire"
        ? "fire"
        : newAttr === "acid"
          ? "acid"
          : newAttr === "electric"
            ? "electric"
            : newAttr === "ice"
              ? "freeze"
              : null;

    if (effectType !== null) {
      const effectMeta = this.registry.getEffectByType(effectType);
      if (effectMeta !== undefined) {
        const alreadyHas = unit.activeEffects.some((e) => e.effectType === effectType);
        if (!alreadyHas) {
          const turnsRemaining = effectMeta.removeConditions.find((c: RemoveCondition) => c.type === "turns")?.count;
          changes.push({
            type: "unit_effect_add",
            unitId: unit.unitId,
            effectId: effectMeta.id,
            effectType: effectMeta.effectType,
            turnsRemaining,
          });
        }
      }
    }

    return changes;
  }
}
