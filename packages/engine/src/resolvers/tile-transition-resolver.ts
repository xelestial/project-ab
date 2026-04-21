/**
 * TileTransitionResolver — calculates GameChange[] when a unit enters a tile.
 *
 * Called from two entry points:
 *   - MovementResolver  : voluntary movement (unit_move)
 *   - AttackResolver    : involuntary knockback (unit_knockback)
 *
 * All tile-on-enter effects are defined in tiles.json (data-driven):
 *   appliesEffectId   — effect added when stepping onto this tile
 *   removesEffectTypes — effects removed when stepping onto this tile
 *   clearsAllEffects  — remove ALL existing effects first (e.g. ice tile)
 *
 * River entry is handled separately via unit_river_enter and is NOT routed here.
 */
import type { GameState, UnitState, GameChange, TileAttributeType } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";

export interface ITileTransitionResolver {
  /**
   * Unit enters a tile — voluntary move or knockback destination.
   * Does NOT handle river (that uses unit_river_enter).
   */
  resolveUnitEntersTile(
    unit: UnitState,
    tileAttr: TileAttributeType,
    state: GameState,
  ): GameChange[];
}

export class TileTransitionResolver implements ITileTransitionResolver {
  constructor(private readonly registry: IDataRegistry) {}

  resolveUnitEntersTile(
    unit: UnitState,
    tileAttr: TileAttributeType,
    state: GameState,
  ): GameChange[] {
    const tileMeta = this.registry.getTileByType(tileAttr);
    if (tileMeta === undefined) return [];

    const changes: GameChange[] = [];

    // ── Step 1: clear all effects if tile demands it (e.g. ice) ──────────────
    if (tileMeta.clearsAllEffects) {
      for (const e of unit.activeEffects) {
        changes.push({
          type: "unit_effect_remove",
          unitId: unit.unitId,
          effectId: e.effectId,
          effectType: e.effectType,
        });
      }
    } else {
      // ── Step 2: remove specific effect types (e.g. water removes fire/acid) ─
      for (const removeType of tileMeta.removesEffectTypes) {
        const eff = unit.activeEffects.find((e) => e.effectType === removeType);
        if (eff !== undefined) {
          changes.push({
            type: "unit_effect_remove",
            unitId: unit.unitId,
            effectId: eff.effectId,
            effectType: eff.effectType,
          });
        }
      }
    }

    // ── Step 3: apply the tile's own effect (if any) ──────────────────────────
    if (tileMeta.appliesEffectId !== undefined) {
      const alreadyHas = unit.activeEffects.some((e) => e.effectId === tileMeta.appliesEffectId);
      if (!alreadyHas) {
        const effectMeta = this.registry.getEffect(tileMeta.appliesEffectId);
        const turnsRemaining = effectMeta.removeConditions.find((c) => c.type === "turns")?.count;
        changes.push({
          type: "unit_effect_add",
          unitId: unit.unitId,
          effectId: effectMeta.id,
          effectType: effectMeta.effectType,
          turnsRemaining,
        });
      }
    }

    return changes;
  }
}
