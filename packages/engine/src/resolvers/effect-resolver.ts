/**
 * EffectResolver — calculates GameChange[] for effect ticks and state transitions.
 */
import type { GameState, UnitState, GameChange, MetaId } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IEffectValidator, RemoveReason } from "../validators/effect-validator.js";
import { getTileAttribute } from "../state/game-state-utils.js";

export interface IEffectResolver {
  /** Process all active effect ticks for a unit at start of their turn */
  resolveTurnTick(unit: UnitState, state: GameState): GameChange[];

  /** Apply a specific effect to a unit */
  resolveApply(effectId: string, unit: UnitState, state: GameState): GameChange[];

  /** Remove a specific effect from a unit */
  resolveRemove(effectId: string, unit: UnitState, reason: RemoveReason): GameChange[];
}

export class EffectResolver implements IEffectResolver {
  constructor(
    private readonly validator: IEffectValidator,
    private readonly registry: IDataRegistry,
  ) {}

  resolveTurnTick(unit: UnitState, state: GameState): GameChange[] {
    const changes: GameChange[] = [];

    for (const activeEffect of unit.activeEffects) {
      const meta = this.registry.getEffect(activeEffect.effectId);

      // 1. Damage per turn
      if (meta.damagePerTurn > 0) {
        const hpAfter = Math.max(0, unit.currentHealth - meta.damagePerTurn);
        changes.push({
          type: "unit_damage",
          unitId: unit.unitId,
          amount: meta.damagePerTurn,
          source: { type: "effect", effectId: activeEffect.effectId },
          hpAfter,
        });
      }

      // 2. Turn countdown — decrement and possibly remove
      if (activeEffect.turnsRemaining !== undefined) {
        const newTurns = activeEffect.turnsRemaining - 1;
        if (newTurns <= 0) {
          changes.push({
            type: "unit_effect_remove",
            unitId: unit.unitId,
            effectId: activeEffect.effectId,
            effectType: activeEffect.effectType,
          });
        } else {
          // Update turnsRemaining in state — encoded as a re-add with new count
          changes.push({
            type: "unit_effect_add",
            unitId: unit.unitId,
            effectId: activeEffect.effectId,
            effectType: activeEffect.effectType,
            turnsRemaining: newTurns,
          });
        }
      }
    }

    // 3. Tile periodic damage (standing on fire/acid/electric tile)
    // Skip if unit has always_on immune_tile_damage passive (e.g. b2)
    const passives = this.registry.getUnitPassives(unit.metaId);
    let immuneTileDamage = false;
    for (const passive of passives) {
      if (passive.trigger.type === "always_on") {
        for (const action of passive.actions) {
          if (action.type === "immune_tile_damage") {
            immuneTileDamage = true;
          }
        }
      }
    }

    if (!immuneTileDamage) {
      const tileAttr = getTileAttribute(state, unit.position);
      const tileMeta = this.registry.getTileByType(tileAttr);
      if (tileMeta !== undefined && tileMeta.damagePerTurn > 0) {
        const hpAfter = Math.max(0, unit.currentHealth - tileMeta.damagePerTurn);
        changes.push({
          type: "unit_damage",
          unitId: unit.unitId,
          amount: tileMeta.damagePerTurn,
          source: { type: "tile", tileAttribute: tileAttr },
          hpAfter,
        });
      }
    }

    return changes;
  }

  resolveApply(effectId: string, unit: UnitState, state: GameState): GameChange[] {
    const validation = this.validator.canApplyEffect(effectId, unit, state);
    if (!validation.valid) return [];

    const meta = this.registry.getEffect(effectId);
    const changes: GameChange[] = [];

    // Data-driven: clear all existing effects if the effect meta says so
    // (e.g. freeze has clearsAllEffectsOnApply: true)
    if (meta.clearsAllEffectsOnApply) {
      for (const e of unit.activeEffects) {
        changes.push({
          type: "unit_effect_remove",
          unitId: unit.unitId,
          effectId: e.effectId,
          effectType: e.effectType,
        });
      }
    }

    const turnsRemaining = meta.removeConditions.find((c) => c.type === "turns")?.count;

    changes.push({
      type: "unit_effect_add",
      unitId: unit.unitId,
      effectId: meta.id,
      effectType: meta.effectType,
      turnsRemaining,
    });

    // Acid also affects tile
    if (meta.alsoAffectsTile) {
      const tileAttr = getTileAttribute(state, unit.position);
      if (tileAttr !== "acid") {
        changes.push({
          type: "tile_attribute_change",
          position: unit.position,
          from: tileAttr,
          to: "acid",
          causedBy: undefined,
        });
      }
    }

    return changes;
  }

  resolveRemove(effectId: string, unit: UnitState, reason: RemoveReason): GameChange[] {
    const validation = this.validator.canRemoveEffect(effectId, unit, reason);
    if (!validation.valid) return [];

    const existing = unit.activeEffects.find((e) => e.effectId === effectId);
    if (existing === undefined) return [];

    return [
      {
        type: "unit_effect_remove",
        unitId: unit.unitId,
        effectId: effectId as MetaId,
        effectType: existing.effectType,
      },
    ];
  }
}
