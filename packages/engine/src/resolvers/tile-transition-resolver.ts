/**
 * TileTransitionResolver — calculates GameChange[] when a unit enters a tile.
 *
 * Called from two entry points:
 *   - MovementResolver  : voluntary movement (unit_move)
 *   - AttackResolver    : involuntary knockback (unit_knockback)
 *
 * Passive support:
 *   - always_on passives are checked first for immunity flags
 *   - on_tile_entry_of and on_tile_entry_any_attribute passives run before normal tile effects
 *
 * River entry is handled separately via unit_river_enter and is NOT routed here.
 */
import type { GameState, UnitState, GameChange, TileAttributeType, Position } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import { posKey } from "../state/game-state-utils.js";

export interface ITileTransitionResolver {
  /**
   * Unit enters a tile — voluntary move or knockback destination.
   * Does NOT handle river (that uses unit_river_enter).
   */
  resolveUnitEntersTile(
    unit: UnitState,
    destinationPos: Position,
    tileAttr: TileAttributeType,
    state: GameState,
  ): GameChange[];
}

export class TileTransitionResolver implements ITileTransitionResolver {
  constructor(private readonly registry: IDataRegistry) {}

  resolveUnitEntersTile(
    unit: UnitState,
    destinationPos: Position,
    tileAttr: TileAttributeType,
    state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];

    // ── Step 0: Check passives ────────────────────────────────────────────────
    const passives = this.registry.getUnitPassives(unit.metaId);

    // always_on passives: extract immunity flags
    let immuneTileEffects = false;
    for (const passive of passives) {
      if (passive.trigger.type === "always_on") {
        for (const action of passive.actions) {
          if (action.type === "immune_tile_effects") immuneTileEffects = true;
        }
      }
    }

    // Track effective tile attr (passives may convert the entered tile)
    let effectiveTileAttr: TileAttributeType = tileAttr;

    // ── Step 1: Process tile-entry passive triggers ───────────────────────────
    for (const passive of passives) {
      const trigger = passive.trigger;

      const matchesEntry =
        (trigger.type === "on_tile_entry_of" && trigger.tileAttribute === tileAttr) ||
        (trigger.type === "on_tile_entry_any_attribute" && !isPlainOrRoad(tileAttr));

      if (!matchesEntry) continue;

      for (const action of passive.actions) {
        if (action.type === "convert_entered_tile") {
          const currentAttr = effectiveTileAttr;
          if (currentAttr !== action.to) {
            changes.push({
              type: "tile_attribute_change",
              position: destinationPos,
              from: currentAttr,
              to: action.to,
            });
            effectiveTileAttr = action.to;
          }
        } else if (action.type === "heal_self") {
          const unitMeta = this.registry.getUnit(unit.metaId);
          const maxHp = unitMeta.baseHealth;
          const hpAfter = Math.min(maxHp, unit.currentHealth + action.amount);
          if (hpAfter > unit.currentHealth) {
            changes.push({
              type: "unit_heal",
              unitId: unit.unitId,
              amount: hpAfter - unit.currentHealth,
              hpAfter,
            });
          }
        } else if (action.type === "spread_entered_tile_attr") {
          // Spread the original tileAttr to 4 orthogonal neighbors
          const neighbors = getOrthogonalNeighbors(destinationPos, state.map.gridSize);
          for (const neighbor of neighbors) {
            const neighborKey = posKey(neighbor);
            const neighborTile = state.map.tiles[neighborKey];
            const neighborAttr: TileAttributeType = neighborTile?.attribute ?? state.map.baseTile ?? "plain";
            if (neighborAttr !== tileAttr) {
              changes.push({
                type: "tile_attribute_change",
                position: neighbor,
                from: neighborAttr,
                to: tileAttr,
              });
            }
          }
        }
      }
    }

    // ── Step 2: Normal tile entry effects (if not immune) ─────────────────────
    if (!immuneTileEffects) {
      const tileMeta = this.registry.getTileByType(effectiveTileAttr);
      if (tileMeta === undefined) return changes;

      // Clear all effects if tile demands it (e.g. ice)
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
        // Remove specific effect types (e.g. water removes fire/acid)
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

      // Apply the tile's own effect (if any)
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
    }

    return changes;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPlainOrRoad(attr: TileAttributeType): boolean {
  return attr === "plain" || attr === "road";
}

function getOrthogonalNeighbors(pos: Position, gridSize: number): Position[] {
  const neighbors: Position[] = [];
  const deltas = [{ dRow: -1, dCol: 0 }, { dRow: 1, dCol: 0 }, { dRow: 0, dCol: -1 }, { dRow: 0, dCol: 1 }];
  for (const d of deltas) {
    const r = pos.row + d.dRow;
    const c = pos.col + d.dCol;
    if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
      neighbors.push({ row: r, col: c });
    }
  }
  return neighbors;
}
