/**
 * AttackResolver — calculates GameChange[] for an attack action.
 *
 * 3-phase separation (no hardcoding):
 *
 *   Phase 1 — DAMAGE (공격 시)
 *     · Elemental reaction lookup (data-driven, elemental-reactions.json)
 *       — applies damage multiplier and removes effects from target
 *     · Attack damage (baseDamage × multiplier − armor)
 *     · Tile conversion at target position
 *
 *   Phase 2 — KNOCKBACK (타일 이동 시, 타의에 의한 이동)
 *     · Collision damage when blocked (data-driven removeConditions)
 *     · Tile transition effects at destination (via TileTransitionResolver)
 *
 *   Phase 3 — POST-CONVERSION TILE EFFECTS
 *     · After tile converts, any unit still standing on it receives
 *       tile-entry effects via TileTransitionResolver
 *
 * Turn-start damage (턴 시작 시 지형 효과 데미지) is handled by EffectResolver.
 */
import type {
  GameState,
  UnitState,
  UnitMeta,
  Position,
  GameChange,
  WeaponMeta,
  AttackAttribute,
  TileAttributeType,
  MetaId,
} from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IAttackValidator } from "../validators/attack-validator.js";
import type { ITileTransitionResolver } from "./tile-transition-resolver.js";
import { KNOCKBACK_COLLISION_DAMAGE } from "@ab/metadata";
import {
  getUnitAt,
  isInBounds,
  directionDelta,
  getTileAttribute,
  hasEffect,
} from "../state/game-state-utils.js";

/** Tile attributes that can be absorbed by skill_shield_defend */
const TILE_TO_ATTACK_ATTR: Partial<Record<TileAttributeType, AttackAttribute>> = {
  fire: "fire",
  water: "water",
  acid: "acid",
  electric: "electric",
  ice: "ice",
  sand: "sand",
};

export interface IAttackResolver {
  resolve(attacker: UnitState, target: Position, state: GameState): GameChange[];
}

export class AttackResolver implements IAttackResolver {
  constructor(
    private readonly validator: IAttackValidator,
    private readonly registry: IDataRegistry,
    private readonly tileTransition: ITileTransitionResolver,
  ) {}

  resolve(attacker: UnitState, target: Position, state: GameState): GameChange[] {
    const validation = this.validator.validateAttack(attacker, target, state);
    if (!validation.valid || !validation.affectedPositions) return [];

    const changes: GameChange[] = [];
    const unitMeta = this.registry.getUnit(attacker.metaId);
    const weapon = this.registry.getWeapon(unitMeta.primaryWeaponId);

    // ── Tile absorption (skill_shield_defend) ─────────────────────────────────
    // T1 absorbs the attribute of the tile it's standing on:
    //   · Attacker's tile loses its attribute (becomes plain)
    //   · Attacker's own matching effect is removed (cleansed)
    //   · Effective attack attribute = absorbed tile attribute
    const { attr: effectiveAttr, absorbed } = this.resolveEffectiveAttribute(
      weapon, attacker, unitMeta, state,
    );

    if (absorbed) {
      const attackerTileAttr = getTileAttribute(state, attacker.position);
      changes.push({
        type: "tile_attribute_change",
        position: attacker.position,
        from: attackerTileAttr,
        to: "plain",
        causedBy: { attackerId: attacker.unitId, attribute: effectiveAttr },
      });
      const matchingEffect = attacker.activeEffects.find((e) => e.effectType === effectiveAttr);
      if (matchingEffect !== undefined) {
        changes.push({
          type: "unit_effect_remove",
          unitId: attacker.unitId,
          effectId: matchingEffect.effectId,
          effectType: matchingEffect.effectType,
        });
      }
    }

    for (const affected of validation.affectedPositions) {
      const pos = affected.position;
      const hitUnit = getUnitAt(state, pos);

      // ── Phase 1: DAMAGE ────────────────────────────────────────────────────
      if (hitUnit !== undefined) {
        // Elemental reaction (data-driven): may block damage and remove effects
        const { multiplier, reactionChanges } = this.resolveElementalReaction(
          effectiveAttr, hitUnit,
        );
        changes.push(...reactionChanges);

        const baseDmg = calcDamage(weapon.damage, hitUnit, this.registry);
        const finalDmg = Math.floor(baseDmg * multiplier);
        if (finalDmg > 0) {
          changes.push({
            type: "unit_damage",
            unitId: hitUnit.unitId,
            amount: finalDmg,
            source: { type: "attack", attackerId: attacker.unitId, weaponId: weapon.id },
            hpAfter: Math.max(0, hitUnit.currentHealth - finalDmg),
          });
        }
      }

      // ── Phase 2: KNOCKBACK (타일 이동 시) ──────────────────────────────────
      // Includes: collision damage (data-driven), tile transition at destination
      let knockbackDestPos: Position | null = null; // null = unit did not move
      if (hitUnit !== undefined && weapon.knockback !== undefined && affected.isPrimary) {
        const kbChanges = this.resolveKnockback(weapon, attacker.position, hitUnit, state);
        changes.push(...kbChanges);

        // Determine where the unit ended up (for Phase 3)
        const freeKb = kbChanges.find(
          (c) =>
            c.type === "unit_knockback" &&
            (c as Extract<GameChange, { type: "unit_knockback" }>).blockedBy === undefined,
        ) as Extract<GameChange, { type: "unit_knockback" }> | undefined;
        const riverEntry = kbChanges.find(
          (c) => c.type === "unit_river_enter",
        ) as Extract<GameChange, { type: "unit_river_enter" }> | undefined;

        if (freeKb !== undefined) knockbackDestPos = freeKb.to;
        else if (riverEntry !== undefined) knockbackDestPos = riverEntry.position;
        // otherwise unit stayed at pos (blocked or no knockback)
      }

      // ── Phase 3: TILE CONVERSION + POST-CONVERSION EFFECTS ────────────────
      if (effectiveAttr !== "none") {
        // Convert the target tile
        changes.push(...this.resolveTileConversion(pos, effectiveAttr, attacker.unitId, weapon.id, state));

        // Apply tile-entry effects to whoever is on the converted tile after knockback.
        // If the unit was knocked away (knockbackDestPos !== null), it's no longer at pos.
        // If it stayed (pos), it now stands on the new tile type → get tile effects.
        if (hitUnit !== undefined && knockbackDestPos === null) {
          // Unit still at pos — tile just changed under it
          changes.push(...this.tileTransition.resolveUnitEntersTile(hitUnit, effectiveAttr as TileAttributeType, state));
        }
        // If the unit moved to another tile via knockback, tile effects there are
        // already applied by resolveKnockback → tileTransition.resolveUnitEntersTile().
      }
    }

    return changes;
  }

  // ── Elemental reaction (data-driven) ──────────────────────────────────────

  /**
   * Looks up all matching elemental reactions for the given attack attribute
   * against the target's current effects. Returns a damage multiplier (product
   * of all matching reactions) and effect-removal changes.
   */
  private resolveElementalReaction(
    attackAttr: AttackAttribute,
    target: UnitState,
  ): { multiplier: number; reactionChanges: GameChange[] } {
    const reactions = this.registry.getElementalReactions();
    const reactionChanges: GameChange[] = [];
    let multiplier = 1;

    for (const reaction of reactions) {
      if (reaction.attackAttr !== attackAttr) continue;
      if (!hasEffect(target, reaction.targetEffect)) continue;

      multiplier *= reaction.damageMultiplier;

      for (const removeType of reaction.removedEffects) {
        const eff = target.activeEffects.find((e) => e.effectType === removeType);
        if (eff !== undefined) {
          reactionChanges.push({
            type: "unit_effect_remove",
            unitId: target.unitId,
            effectId: eff.effectId,
            effectType: eff.effectType,
          });
        }
      }
    }

    return { multiplier, reactionChanges };
  }

  // ── Tile absorption ────────────────────────────────────────────────────────

  private resolveEffectiveAttribute(
    weapon: WeaponMeta,
    attacker: UnitState,
    unitMeta: UnitMeta,
    state: GameState,
  ): { attr: AttackAttribute; absorbed: boolean } {
    if (unitMeta.skillIds.includes("skill_shield_defend" as MetaId)) {
      const tileAttr = getTileAttribute(state, attacker.position);
      const mapped = TILE_TO_ATTACK_ATTR[tileAttr];
      if (mapped !== undefined) {
        return { attr: mapped, absorbed: true };
      }
    }
    return { attr: weapon.attribute, absorbed: false };
  }

  // ── Knockback (Phase 2: 타일 이동 시) ─────────────────────────────────────

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

      // Wall / out-of-bounds — blocked, no damage, no move
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

      // Occupied — collision damage (밀어냄 데미지)
      const blocker = getUnitAt(state, newPos);
      if (blocker !== undefined) {
        // Data-driven: remove blocker effects whose removeConditions include collision_with_frozen
        for (const eff of blocker.activeEffects) {
          const meta = this.registry.getEffect(eff.effectId);
          if (meta.removeConditions.some((c) => c.type === "collision_with_frozen")) {
            changes.push({
              type: "unit_effect_remove",
              unitId: blocker.unitId,
              effectId: eff.effectId,
              effectType: eff.effectType,
            });
          }
        }
        // Pushed unit takes collision damage (밀어냄 데미지 처리)
        changes.push({
          type: "unit_damage",
          unitId: target.unitId,
          amount: KNOCKBACK_COLLISION_DAMAGE,
          source: { type: "collision" },
          hpAfter: Math.max(0, target.currentHealth - KNOCKBACK_COLLISION_DAMAGE),
        });
        // Pushed unit is blocked
        changes.push({
          type: "unit_knockback",
          unitId: target.unitId,
          from: target.position,
          to: newPos,
          blockedBy: blocker.unitId,
        });
        return changes;
      }

      // River tile — pushed into river (special handling, clears all effects)
      const attr = getTileAttribute(state, newPos);
      if (attr === "river") {
        changes.push({
          type: "unit_river_enter",
          unitId: target.unitId,
          position: newPos,
          clearedEffectIds: target.activeEffects.map((e) => e.effectId),
          clearedAttributes: [],
        });
        return changes;
      }

      // Free tile — unit moves (타일 이동 시 → 지형 효과 획득/손실)
      changes.push({
        type: "unit_knockback",
        unitId: target.unitId,
        from: target.position,
        to: newPos,
        blockedBy: undefined,
      });
      // Apply tile-entry effects at destination
      changes.push(...this.tileTransition.resolveUnitEntersTile(target, attr, state));
    }

    return changes;
  }

  // ── Tile conversion ────────────────────────────────────────────────────────

  private resolveTileConversion(
    pos: Position,
    attr: AttackAttribute,
    attackerId: string,
    weaponId: string,
    state: GameState,
  ): GameChange[] {
    if (attr === "none") return [];
    const current = getTileAttribute(state, pos);
    if (current === (attr as string)) return [];
    return [
      {
        type: "tile_attribute_change",
        position: pos,
        from: current,
        to: attr as TileAttributeType,
        causedBy: {
          attackerId: attackerId as import("@ab/metadata").UnitId,
          attribute: attr,
        },
      },
    ];
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

  // Acid effect: damage doubled (data property on EffectMeta could encode this in future)
  if (hasEffect(target, "acid")) {
    dmg = dmg * 2;
  }

  return dmg;
}
