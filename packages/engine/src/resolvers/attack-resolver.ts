/**
 * AttackResolver — calculates GameChange[] for an attack action.
 * Handles: damage, knockback, effects, tile conversion, shield blocking.
 */
import type {
  GameState,
  UnitState,
  Position,
  GameChange,
  WeaponMeta,
  AttackAttribute,
  RemoveCondition,
} from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IAttackValidator } from "../validators/attack-validator.js";
import { KNOCKBACK_COLLISION_DAMAGE } from "@ab/metadata";
import {
  getUnitAt,
  posEqual,
  isInBounds,
  directionDelta,
  getTileAttribute,
  hasEffect,
} from "../state/game-state-utils.js";

export interface IAttackResolver {
  resolve(attacker: UnitState, target: Position, state: GameState): GameChange[];
}

export class AttackResolver implements IAttackResolver {
  constructor(
    private readonly validator: IAttackValidator,
    private readonly registry: IDataRegistry,
  ) {}

  resolve(attacker: UnitState, target: Position, state: GameState): GameChange[] {
    const validation = this.validator.validateAttack(attacker, target, state);
    if (!validation.valid || !validation.affectedPositions) return [];

    const changes: GameChange[] = [];
    const unitMeta = this.registry.getUnit(attacker.metaId);
    const weapon = this.registry.getWeapon(unitMeta.primaryWeaponId);

    for (const affected of validation.affectedPositions) {
      const pos = affected.position;
      const hitUnit = getUnitAt(state, pos);

      // Damage calculation for unit at this position
      if (hitUnit !== undefined) {
        const dmg = calcDamage(weapon.damage, hitUnit, this.registry);
        if (dmg > 0) {
          const hpAfter = Math.max(0, hitUnit.currentHealth - dmg);
          changes.push({
            type: "unit_damage",
            unitId: hitUnit.unitId,
            amount: dmg,
            source: {
              type: "attack",
              attackerId: attacker.unitId,
              weaponId: weapon.id,
            },
            hpAfter,
          });
        }

        // Knockback
        if (weapon.knockback !== undefined && affected.isPrimary) {
          const kbChanges = this.resolveKnockback(weapon, attacker.position, hitUnit, state);
          changes.push(...kbChanges);
        }
      }

      // Tile conversion (last attack attribute wins)
      if (weapon.attribute !== "none") {
        const tileChanges = this.resolveTileConversion(pos, weapon.attribute, attacker.unitId, weapon.id, state);
        changes.push(...tileChanges);

        // Immediate effect from tile conversion on the unit (if present)
        if (hitUnit !== undefined) {
          const tileEffectChanges = this.resolveTileConversionEffect(
            hitUnit,
            weapon.attribute,
            state,
          );
          changes.push(...tileEffectChanges);
        }
      }

      // Apply attack attribute effect to hit unit
      if (hitUnit !== undefined && weapon.attribute !== "none") {
        const effectChanges = this.resolveAttackAttributeEffect(hitUnit, weapon.attribute, state);
        changes.push(...effectChanges);
      }
    }

    // Mark attacker as having attacked
    changes.push({
      type: "unit_actions_reset",
      unitId: attacker.unitId,
    });
    // Override: we actually want to SET attacked=true, not reset.
    // Use a different approach — the ActionProcessor sets this directly.
    // Remove the reset and handle via manager.
    // (We pop the incorrectly added reset)
    changes.pop();

    return changes;
  }

  // ─── Knockback ─────────────────────────────────────────────────────────────

  private resolveKnockback(
    weapon: WeaponMeta,
    attackerPos: Position,
    target: UnitState,
    state: GameState,
  ): GameChange[] {
    const kbSpec = weapon.knockback!;
    let delta: { dRow: number; dCol: number };

    if (kbSpec.direction === "away") {
      const d = directionDelta(attackerPos, target.position);
      if (d === null) return [];
      delta = d;
    } else {
      delta = kbSpec.fixedDelta ?? { dRow: 0, dCol: 1 };
    }

    const changes: GameChange[] = [];

    for (let step = 0; step < kbSpec.distance; step++) {
      const newPos: Position = {
        row: target.position.row + delta.dRow * (step + 1),
        col: target.position.col + delta.dCol * (step + 1),
      };

      // Wall / out of bounds — no move, no damage
      if (!isInBounds(newPos, state.map.gridSize)) {
        changes.push({
          type: "unit_knockback",
          unitId: target.unitId,
          from: target.position,
          to: newPos,
          blockedBy: "wall",
        });
        return changes;
      }

      // Occupied by another unit
      const blocker = getUnitAt(state, newPos);
      if (blocker !== undefined) {
        // Check if blocker is frozen — collision breaks freeze, 0 damage to frozen unit
        if (hasEffect(blocker, "freeze")) {
          changes.push({
            type: "unit_effect_remove",
            unitId: blocker.unitId,
            effectId: blocker.activeEffects.find((e) => e.effectType === "freeze")!.effectId,
            effectType: "freeze",
          });
          // Pushed unit takes 1 collision damage
          changes.push({
            type: "unit_damage",
            unitId: target.unitId,
            amount: KNOCKBACK_COLLISION_DAMAGE,
            source: { type: "collision" },
            hpAfter: Math.max(0, target.currentHealth - KNOCKBACK_COLLISION_DAMAGE),
          });
        } else {
          // Normal collision: knocked unit takes 1 damage, doesn't move
          changes.push({
            type: "unit_damage",
            unitId: target.unitId,
            amount: KNOCKBACK_COLLISION_DAMAGE,
            source: { type: "collision" },
            hpAfter: Math.max(0, target.currentHealth - KNOCKBACK_COLLISION_DAMAGE),
          });
          changes.push({
            type: "unit_knockback",
            unitId: target.unitId,
            from: target.position,
            to: newPos,
            blockedBy: blocker.unitId,
          });
        }
        return changes;
      }

      // River tile: pushed into river
      const attr = getTileAttribute(state, newPos);
      if (attr === "river") {
        const clearedEffectIds = target.activeEffects.map((e) => e.effectId);
        changes.push({
          type: "unit_river_enter",
          unitId: target.unitId,
          position: newPos,
          clearedEffectIds,
          clearedAttributes: [],
        });
        return changes;
      }

      // Free tile: move only, no damage
      changes.push({
        type: "unit_knockback",
        unitId: target.unitId,
        from: target.position,
        to: newPos,
        blockedBy: undefined,
      });
    }

    return changes;
  }

  // ─── Tile conversion ────────────────────────────────────────────────────────

  private resolveTileConversion(
    pos: Position,
    attr: AttackAttribute,
    attackerId: string,
    weaponId: string,
    state: GameState,
  ): GameChange[] {
    if (attr === "none") return [];
    const current = getTileAttribute(state, pos);
    if (current === (attr as string)) return []; // no change
    if (current === "mountain") {
      // Mountains can be converted (fire on mountain = fire mountain)
      // No special restriction per confirmed rules
    }
    return [
      {
        type: "tile_attribute_change",
        position: pos,
        from: current,
        to: attr as import("@ab/metadata").TileAttributeType,
        causedBy: { attackerId: attackerId as import("@ab/metadata").UnitId, attribute: attr },
      },
    ];
  }

  /**
   * After tile conversion, check if standing unit needs immediate effect update.
   * Example: fire tile → water tile means fire effect should be removed from standing unit.
   */
  private resolveTileConversionEffect(
    unit: UnitState,
    newAttr: AttackAttribute,
    _state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];

    if (newAttr === "water") {
      // Tile became water: remove fire and acid from unit
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

    return changes;
  }

  // ─── Attack attribute effect on unit ───────────────────────────────────────

  private resolveAttackAttributeEffect(
    unit: UnitState,
    attr: AttackAttribute,
    _state: GameState,
  ): GameChange[] {
    if (attr === "none") return [];

    const effectMeta = this.registry.getEffectByType(attr);
    if (effectMeta === undefined) return [];

    const changes: GameChange[] = [];

    // Freeze: clear all existing effects first
    if (attr === "ice") {
      for (const e of unit.activeEffects) {
        changes.push({
          type: "unit_effect_remove",
          unitId: unit.unitId,
          effectId: e.effectId,
          effectType: e.effectType,
        });
      }
    }

    changes.push({
      type: "unit_effect_add",
      unitId: unit.unitId,
      effectId: effectMeta.id,
      effectType: effectMeta.effectType,
      turnsRemaining: effectMeta.removeConditions
        .find((c: RemoveCondition) => c.type === "turns")
        ?.count,
    });

    return changes;
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function calcDamage(
  baseDamage: number,
  target: UnitState,
  _registry: IDataRegistry,
): number {
  let dmg = baseDamage - target.currentArmor;
  if (dmg < 0) dmg = 0;

  // Acid effect: damage doubled
  if (hasEffect(target, "acid")) {
    dmg = dmg * 2;
  }

  return dmg;
}
