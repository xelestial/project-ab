/**
 * AttackResolver — calculates GameChange[] for an attack action.
 *
 * Phases:
 *   0a — Rush movement
 *   0b — Adjacent tile absorb (ranger A)
 *   0c — Attacker passive tile absorb (passive_tile_absorb_attack)
 *
 *   1  — Damage
 *     · Elemental reactions (data-driven): multiplier / fixedDamage / appliesEffect / removeTileAttr
 *     · Passive modifiers: immune_damage_type, vulnerability, damage_reduction, amplify_damage_type
 *     · Freeze: on_hit always releases freeze; blocksDamage blocks damage unless piercesFreeze
 *
 *   2a — Knockback (including leftRight wide knockback)
 *   2b — Pull
 *
 *   3  — Tile effects at target position
 *     · applyTileEffect (+ tileEffectWidth leftRight)
 *     · applyThroughPenetrate for non-primary hits
 *     · convertTileTo
 *     · Fallback: attribute-based tile conversion (for tile-absorb attacks)
 *     · splashTileEffect (all 4 adjacent tiles of primary target)
 *     · Tile-entry effects for unit standing on converted tile
 *
 *   4  — Area / chain effects (once per attack)
 *     · splash: adjacent unit damage
 *     · shockwave: push adjacent units
 *     · chainShock: BFS electric damage through all adjacent-connected units
 *     · selfTileEffect: apply tile effect under attacker
 *     · spawnObstacle: place an obstacle unit at the target tile
 */
import type {
  GameState,
  UnitState,
  Position,
  GameChange,
  WeaponMeta,
  AttackAttribute,
  TileAttributeType,
  UnitEffectType,
} from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IAttackValidator, AttackOptions } from "../validators/attack-validator.js";
import type { ITileTransitionResolver } from "./tile-transition-resolver.js";
import { KNOCKBACK_COLLISION_DAMAGE } from "@ab/metadata";
import {
  getUnitAt,
  isInBounds,
  directionDelta,
  getTileAttribute,
  hasEffect,
  orthogonalNeighbors,
  posKey,
} from "../state/game-state-utils.js";

/** Tile attributes that can be absorbed via passive_tile_absorb_attack */
const TILE_TO_ATTACK_ATTR: Partial<Record<TileAttributeType, AttackAttribute>> = {
  fire: "fire",
  water: "water",
  acid: "acid",
  electric: "electric",
  ice: "ice",
  sand: "sand",
};

export interface IAttackResolver {
  resolve(attacker: UnitState, target: Position, state: GameState, options?: AttackOptions): GameChange[];
}

export class AttackResolver implements IAttackResolver {
  constructor(
    private readonly validator: IAttackValidator,
    private readonly registry: IDataRegistry,
    private readonly tileTransition: ITileTransitionResolver,
  ) {}

  resolve(attacker: UnitState, target: Position, state: GameState, options?: AttackOptions): GameChange[] {
    const validation = this.validator.validateAttack(attacker, target, state, options);
    if (!validation.valid || !validation.affectedPositions) return [];

    const changes: GameChange[] = [];
    const unitMeta = this.registry.getUnit(attacker.metaId);
    const weaponId = options?.overrideWeaponId ?? unitMeta.primaryWeaponId;
    if (weaponId === undefined) return []; // obstacle-class units have no weapon
    const weapon = this.registry.getWeapon(weaponId);

    // ── Phase 0a: Rush movement ────────────────────────────────────────────────
    let effectiveAttackerPos = attacker.position;
    if (weapon.rush !== undefined) {
      const adjacentPos = getAdjacentToTarget(attacker.position, target);
      if (adjacentPos !== null && !posEqual(adjacentPos, attacker.position)) {
        changes.push({
          type: "unit_move",
          unitId: attacker.unitId,
          from: attacker.position,
          to: adjacentPos,
          isRushMovement: true,
        });
        const attrAtAdj = getTileAttribute(state, adjacentPos);
        if (attrAtAdj !== "river") {
          changes.push(...this.tileTransition.resolveUnitEntersTile(attacker, adjacentPos, attrAtAdj, state));
        }
        effectiveAttackerPos = adjacentPos;
      }
    }

    // ── Phase 0b: Adjacent tile absorb (ranger A) ──────────────────────────────
    let effectiveAttr = weapon.attribute as AttackAttribute;
    let tileAbsorbed = false; // true when a tile attribute was absorbed — enables fallback conversion
    if (weapon.adjacentTileAbsorb && options?.sourceTile !== undefined) {
      const st = options.sourceTile;
      const sourceTileAttr = getTileAttribute(state, st);
      const mapped = TILE_TO_ATTACK_ATTR[sourceTileAttr];
      if (mapped !== undefined) {
        effectiveAttr = mapped;
        tileAbsorbed = true;
        changes.push({
          type: "tile_attribute_change",
          position: st,
          from: sourceTileAttr,
          to: "plain",
          causedBy: { attackerId: attacker.unitId as import("@ab/metadata").UnitId, attribute: mapped },
        });
      }
    }

    // ── Phase 0c: Attacker passive tile absorb (passive_tile_absorb_attack) ───
    if (!weapon.adjacentTileAbsorb) {
      const { attr: absorbedAttr, absorbed } = this.resolveEffectiveAttribute(weapon, attacker, state);
      if (absorbed) {
        effectiveAttr = absorbedAttr;
        tileAbsorbed = true;
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
    }

    // ── Per-position loop ──────────────────────────────────────────────────────
    for (const affected of validation.affectedPositions) {
      const pos = affected.position;
      const hitUnit = getUnitAt(state, pos);

      // ── Phase 1: DAMAGE ──────────────────────────────────────────────────────
      if (hitUnit !== undefined) {
        const { multiplier, fixedDmg, reactionChanges, isElementalImmune } = this.resolveElementalReaction(
          effectiveAttr, hitUnit, pos, state,
        );
        changes.push(...reactionChanges);

        let finalDmg: number;
        if (fixedDmg !== undefined) {
          // Fixed damage bypasses armor and all multipliers
          finalDmg = fixedDmg;
        } else {
          finalDmg = Math.floor(calcBaseDamage(weapon.damage, hitUnit, this.registry) * multiplier);
          // Passive: immune_damage_type (e.g. insulator vs electric)
          finalDmg = applyDamageImmunity(finalDmg, effectiveAttr, hitUnit, this.registry);
          // Passive: vulnerability (e.g. fire_weakness +1 vs fire)
          finalDmg = applyVulnerability(finalDmg, effectiveAttr, hitUnit, this.registry);
          // Passive: damage_reduction (e.g. melee_mastery -1 vs melee)
          finalDmg = applyDamageReduction(finalDmg, weapon.attackType, hitUnit, this.registry);
          // Passive: amplify_damage_type (e.g. generator ×2 electric near u3)
          finalDmg = applyAmplify(finalDmg, effectiveAttr, hitUnit, state, this.registry);
        }

        // Freeze: on_hit releases unless target is immune to elemental effects;
        // blocksDamage still applies (freeze armor is separate from elemental immunity)
        const freezeEffect = hitUnit.activeEffects.find((e) => e.effectType === "freeze");
        let damageBlocked = false;
        if (freezeEffect !== undefined) {
          if (!isElementalImmune) {
            changes.push({
              type: "unit_effect_remove",
              unitId: hitUnit.unitId,
              effectId: freezeEffect.effectId,
              effectType: freezeEffect.effectType,
            });
          }
          const freezeMeta = this.registry.getEffectByType("freeze");
          if (freezeMeta?.blocksDamage === true && !weapon.piercesFreeze) {
            damageBlocked = true;
          }
        }

        if (!damageBlocked && finalDmg > 0) {
          changes.push({
            type: "unit_damage",
            unitId: hitUnit.unitId,
            amount: finalDmg,
            source: { type: "attack", attackerId: attacker.unitId, weaponId: weapon.id },
            hpAfter: Math.max(0, hitUnit.currentHealth - finalDmg),
          });
        }

        // ── Phase 1b: Confusion effect (primary hit only) ──────────────────
        if (affected.isPrimary && weapon.confusion !== undefined) {
          const confusionEffMeta = this.registry.getAllEffects().find(
            (e) => e.effectType === "confused" && e.blocksAttackType === weapon.confusion!.blocksAttackType,
          );
          if (confusionEffMeta !== undefined) {
            const alreadyHas = hitUnit.activeEffects.some((e) => e.effectId === confusionEffMeta.id);
            if (!alreadyHas) {
              const turnsRemaining = confusionEffMeta.removeConditions.find((c) => c.type === "turns")?.count;
              changes.push({
                type: "unit_effect_add",
                unitId: hitUnit.unitId,
                effectId: confusionEffMeta.id,
                effectType: confusionEffMeta.effectType,
                turnsRemaining,
              });
            }
          }
        }
      }

      // ── Phase 2a: KNOCKBACK ────────────────────────────────────────────────
      let knockbackDestPos: Position | null = null;
      if (hitUnit !== undefined && weapon.knockback !== undefined && affected.isPrimary) {
        const kbChanges = this.resolveKnockbackUnit(weapon.knockback, effectiveAttackerPos, hitUnit, state);
        changes.push(...kbChanges);

        const freeKb = kbChanges.find(
          (c) => c.type === "unit_knockback" &&
            (c as Extract<GameChange, { type: "unit_knockback" }>).blockedBy === undefined,
        ) as Extract<GameChange, { type: "unit_knockback" }> | undefined;
        const riverEntry = kbChanges.find(
          (c) => c.type === "unit_river_enter",
        ) as Extract<GameChange, { type: "unit_river_enter" }> | undefined;

        if (freeKb !== undefined) knockbackDestPos = freeKb.to;
        else if (riverEntry !== undefined) knockbackDestPos = riverEntry.position;

        // Wide knockback: also push units on side tiles
        if (weapon.knockback.width === "leftRight") {
          const sides = getSidePositions(effectiveAttackerPos, pos, state.map.gridSize);
          for (const sidePos of sides) {
            const sideUnit = getUnitAt(state, sidePos);
            if (sideUnit !== undefined) {
              changes.push(...this.resolveKnockbackUnit(weapon.knockback, effectiveAttackerPos, sideUnit, state));
            }
          }
        }
      }

      // ── Phase 2b: PULL ────────────────────────────────────────────────────
      if (hitUnit !== undefined && weapon.pull !== undefined && affected.isPrimary) {
        const pullDest = getAdjacentToTarget(hitUnit.position, effectiveAttackerPos);
        if (pullDest !== null && !posEqual(pullDest, hitUnit.position)) {
          if (isInBounds(pullDest, state.map.gridSize) && getUnitAt(state, pullDest) === undefined) {
            changes.push({
              type: "unit_pull",
              unitId: hitUnit.unitId,
              from: hitUnit.position,
              to: pullDest,
            });
            const attrAtPullDest = getTileAttribute(state, pullDest);
            if (attrAtPullDest !== "river") {
              changes.push(...this.tileTransition.resolveUnitEntersTile(hitUnit, pullDest, attrAtPullDest, state));
            }
          }
        }
      }

      // ── Phase 3: TILE EFFECTS at this position ────────────────────────────

      // Determine the tile attribute to apply at target position
      const explicitTileEffect = weapon.applyTileEffect ?? weapon.convertTileTo;

      if (explicitTileEffect !== undefined && affected.isPrimary) {
        // Primary target tile
        changes.push(...this.applyTileEffectAt(pos, explicitTileEffect, attacker.unitId, hitUnit, knockbackDestPos, state));

        // Left/right tiles
        if (weapon.tileEffectWidth === "leftRight") {
          const sides = getSidePositions(effectiveAttackerPos, pos, state.map.gridSize);
          for (const sidePos of sides) {
            const sideUnit = getUnitAt(state, sidePos);
            changes.push(...this.applyTileEffectAt(sidePos, explicitTileEffect, attacker.unitId, sideUnit, null, state));
          }
        }

        // Splash tile effect (all 4 adjacent tiles of primary target)
        if (weapon.splashTileEffect !== undefined) {
          for (const neighbor of orthogonalNeighbors(pos, state.map.gridSize)) {
            const neighborAttr = getTileAttribute(state, neighbor);
            if (neighborAttr !== weapon.splashTileEffect && neighborAttr !== "mountain") {
              const neighborUnit = getUnitAt(state, neighbor);
              changes.push(...this.applyTileEffectAt(neighbor, weapon.splashTileEffect, attacker.unitId, neighborUnit, null, state));
            }
          }
        }
      } else if (!affected.isPrimary && weapon.applyThroughPenetrate && weapon.applyTileEffect !== undefined) {
        // Penetrating shot: apply tile effect to tiles behind primary target too
        changes.push(...this.applyTileEffectAt(pos, weapon.applyTileEffect, attacker.unitId, hitUnit, null, state));
      } else if (tileAbsorbed && explicitTileEffect === undefined && effectiveAttr !== "none" && affected.isPrimary) {
        // Fallback: convert target tile to absorbed attribute (tile-absorb passive only)
        const current = getTileAttribute(state, pos);
        if (current !== effectiveAttr as string) {
          changes.push({
            type: "tile_attribute_change",
            position: pos,
            from: current,
            to: effectiveAttr as TileAttributeType,
            causedBy: { attackerId: attacker.unitId, attribute: effectiveAttr },
          });
          if (hitUnit !== undefined && knockbackDestPos === null) {
            changes.push(...this.tileTransition.resolveUnitEntersTile(hitUnit, pos, effectiveAttr as TileAttributeType, state));
          }
        }
      }

      // ── Phase 3b: Splash damage to adjacent units (primary target only) ───
      if (weapon.splash !== undefined && affected.isPrimary && weapon.splash.adjacentDamage > 0) {
        for (const neighbor of orthogonalNeighbors(pos, state.map.gridSize)) {
          const neighborUnit = getUnitAt(state, neighbor);
          if (neighborUnit !== undefined && neighborUnit.unitId !== attacker.unitId) {
            const splashDmg = Math.max(0, weapon.splash.adjacentDamage - neighborUnit.currentArmor);
            if (splashDmg > 0) {
              changes.push({
                type: "unit_damage",
                unitId: neighborUnit.unitId,
                amount: splashDmg,
                source: { type: "attack", attackerId: attacker.unitId, weaponId: weapon.id },
                hpAfter: Math.max(0, neighborUnit.currentHealth - splashDmg),
              });
            }
          }
        }
      }

      // ── Phase 3c: Shockwave — push adjacent units away from target ─────────
      if (weapon.shockwave !== undefined && affected.isPrimary) {
        for (const neighbor of orthogonalNeighbors(pos, state.map.gridSize)) {
          const neighborUnit = getUnitAt(state, neighbor);
          if (neighborUnit !== undefined && neighborUnit.unitId !== attacker.unitId) {
            const pushDelta = directionDelta(pos, neighbor);
            if (pushDelta !== null) {
              const pushDest: Position = {
                row: neighbor.row + pushDelta.dRow,
                col: neighbor.col + pushDelta.dCol,
              };
              if (isInBounds(pushDest, state.map.gridSize) && getUnitAt(state, pushDest) === undefined) {
                changes.push({
                  type: "unit_knockback",
                  unitId: neighborUnit.unitId,
                  from: neighbor,
                  to: pushDest,
                  blockedBy: undefined,
                });
                const destAttr = getTileAttribute(state, pushDest);
                if (destAttr !== "river") {
                  changes.push(...this.tileTransition.resolveUnitEntersTile(neighborUnit, pushDest, destAttr, state));
                }
              }
            }
          }
        }
      }
    } // end per-position loop

    // ── Phase 4: Attack-level effects ─────────────────────────────────────────

    // selfTileEffect: apply tile effect to attacker's own tile
    if (weapon.selfTileEffect !== undefined) {
      const selfAttr = getTileAttribute(state, attacker.position);
      if (selfAttr !== weapon.selfTileEffect) {
        changes.push({
          type: "tile_attribute_change",
          position: attacker.position,
          from: selfAttr,
          to: weapon.selfTileEffect,
          causedBy: { attackerId: attacker.unitId, attribute: weapon.attribute },
        });
      }
    }

    // chainShock: BFS electric damage through all adjacent units
    if (weapon.chainShock === true) {
      const primaryTarget = validation.affectedPositions.find((a) => a.isPrimary);
      if (primaryTarget !== undefined) {
        const primaryHitUnit = getUnitAt(state, primaryTarget.position);
        changes.push(
          ...this.resolveChainShock(primaryHitUnit, attacker.unitId, weapon, state),
        );
      }
    }

    // spawnObstacle: place an obstacle unit at the target tile
    if (weapon.spawnObstacle !== undefined) {
      const primaryTarget = validation.affectedPositions.find((a) => a.isPrimary);
      if (primaryTarget !== undefined && getUnitAt(state, primaryTarget.position) === undefined) {
        const obstacleMeta = this.registry.getUnit(weapon.spawnObstacle);
        const spawnId =
          `obstacle_${obstacleMeta.id}_${attacker.unitId}_t${Date.now()}` as import("@ab/metadata").UnitId;
        changes.push({
          type: "unit_spawn",
          unitId: spawnId,
          metaId: obstacleMeta.id,
          playerId: attacker.playerId,
          position: primaryTarget.position,
          currentHealth: obstacleMeta.baseHealth,
          currentArmor: obstacleMeta.baseArmor,
          movementPoints: obstacleMeta.baseMovement,
        });
      }
    }

    return changes;
  }

  // ── Elemental reaction (data-driven) ──────────────────────────────────────

  private resolveElementalReaction(
    attackAttr: AttackAttribute,
    target: UnitState,
    targetPos: Position,
    state: GameState,
  ): { multiplier: number; fixedDmg: number | undefined; reactionChanges: GameChange[]; isElementalImmune: boolean } {
    // Check immune_elemental_effects passive
    const passives = this.registry.getUnitPassives(target.metaId as string);
    for (const passive of passives) {
      if (passive.trigger.type === "always_on") {
        if (passive.actions.some((a) => a.type === "immune_elemental_effects")) {
          return { multiplier: 1, fixedDmg: undefined, reactionChanges: [], isElementalImmune: true };
        }
      }
    }

    const reactions = this.registry.getElementalReactions();
    const reactionChanges: GameChange[] = [];
    let multiplier = 1;
    let fixedDmg: number | undefined;

    for (const reaction of reactions) {
      if (reaction.attackAttr !== attackAttr) continue;

      // targetEffect "none" always fires; otherwise target must have that effect
      const matches =
        reaction.targetEffect === "none" ||
        hasEffect(target, reaction.targetEffect as UnitEffectType);
      if (!matches) continue;

      if (reaction.fixedDamage !== undefined) {
        fixedDmg = reaction.fixedDamage;
      } else {
        multiplier *= reaction.damageMultiplier;
      }

      // Remove specified effects
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

      // Apply new effect (e.g. ice base → freeze, ice+water → freeze, electric+water → stun)
      if (reaction.appliesEffectId !== undefined) {
        const effMeta = this.registry.getEffect(reaction.appliesEffectId);
        // Check immune_effect passive
        const isImmune = passives.some((p) =>
          p.actions.some((a) => a.type === "immune_effect" && a.effectType === effMeta.effectType),
        );
        if (!isImmune) {
          const alreadyHas = target.activeEffects.some((e) => e.effectId === effMeta.id);
          if (!alreadyHas) {
            const turnsRemaining = effMeta.removeConditions.find((c) => c.type === "turns")?.count;
            reactionChanges.push({
              type: "unit_effect_add",
              unitId: target.unitId,
              effectId: effMeta.id,
              effectType: effMeta.effectType,
              turnsRemaining,
            });
          }
        }
      }

      // Remove tile attribute (e.g. electric+water reaction removes water tile)
      if (reaction.removeTileAttr !== undefined) {
        const curTileAttr = getTileAttribute(state, targetPos);
        if (curTileAttr === reaction.removeTileAttr) {
          reactionChanges.push({
            type: "tile_attribute_change",
            position: targetPos,
            from: curTileAttr,
            to: "plain",
            causedBy: undefined,
          });
        }
      }
    }

    return { multiplier, fixedDmg, reactionChanges, isElementalImmune: false };
  }

  // ── Attacker passive tile absorb ───────────────────────────────────────────

  private resolveEffectiveAttribute(
    weapon: WeaponMeta,
    attacker: UnitState,
    state: GameState,
  ): { attr: AttackAttribute; absorbed: boolean } {
    const passives = this.registry.getUnitPassives(attacker.metaId as string);
    const hasTileAbsorb = passives.some((p) =>
      p.actions.some((a) => a.type === "absorb_tile_at_attacker"),
    );
    if (hasTileAbsorb) {
      const tileAttr = getTileAttribute(state, attacker.position);
      const mapped = TILE_TO_ATTACK_ATTR[tileAttr];
      if (mapped !== undefined) {
        return { attr: mapped, absorbed: true };
      }
    }
    return { attr: weapon.attribute, absorbed: false };
  }

  // ── Knockback ──────────────────────────────────────────────────────────────

  private resolveKnockbackUnit(
    kbSpec: NonNullable<WeaponMeta["knockback"]>,
    attackerPos: Position,
    target: UnitState,
    state: GameState,
  ): GameChange[] {
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

      const blocker = getUnitAt(state, newPos);
      if (blocker !== undefined) {
        // Collision with frozen unit releases freeze (collision_with_frozen condition)
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
        return changes;
      }

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

      changes.push({
        type: "unit_knockback",
        unitId: target.unitId,
        from: target.position,
        to: newPos,
        blockedBy: undefined,
      });
      changes.push(...this.tileTransition.resolveUnitEntersTile(target, newPos, attr, state));
    }

    return changes;
  }

  // ── Tile effect application ────────────────────────────────────────────────

  /**
   * Apply a tile attribute to a position and trigger tile-entry effects
   * for any unit currently on that tile (if they didn't move away).
   */
  private applyTileEffectAt(
    pos: Position,
    tileAttr: TileAttributeType,
    attackerId: string,
    unitOnTile: UnitState | undefined,
    unitKnockbackDest: Position | null,
    state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];
    const current = getTileAttribute(state, pos);
    if (current !== tileAttr) {
      changes.push({
        type: "tile_attribute_change",
        position: pos,
        from: current,
        to: tileAttr,
        causedBy: {
          attackerId: attackerId as import("@ab/metadata").UnitId,
          attribute: tileAttr as unknown as import("@ab/metadata").AttackAttribute,
        },
      });
    }
    // Trigger tile-entry effects for unit still on this tile
    if (unitOnTile !== undefined && unitKnockbackDest === null) {
      changes.push(...this.tileTransition.resolveUnitEntersTile(unitOnTile, pos, tileAttr, state));
    }
    return changes;
  }

  // ── Chain shock ────────────────────────────────────────────────────────────

  /**
   * BFS electric chain: damage all units reachable via orthogonal adjacency
   * from the primary hit unit (excluding the primary target and the attacker).
   *
   * Units with block_chain_conductor passive (insulators) receive no chain
   * damage and do NOT propagate the chain further.
   *
   * The electric_pylon obstacle has no passives, so it acts as a transparent
   * relay — it takes chain damage and conducts the chain through it.
   *
   * No tile conversion: electric chain only deals damage, does not change tiles.
   */
  private resolveChainShock(
    primaryHitUnit: UnitState | undefined,
    attackerUnitId: string,
    weapon: WeaponMeta,
    state: GameState,
  ): GameChange[] {
    if (primaryHitUnit === undefined) return [];

    const changes: GameChange[] = [];

    // Build position → unit lookup for all living units
    const posToUnit = new Map<string, UnitState>();
    for (const unit of Object.values(state.units)) {
      if (unit.alive) posToUnit.set(posKey(unit.position), unit);
    }

    // BFS — visited tracks unitIds to avoid duplicates
    const visited = new Set<string>([primaryHitUnit.unitId, attackerUnitId]);
    const queue: UnitState[] = [primaryHitUnit];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Does this unit block chain propagation?
      const passives = this.registry.getUnitPassives(current.metaId as string);
      const blocksChain = passives.some((p) =>
        p.actions.some((a) => a.type === "block_chain_conductor"),
      );
      if (blocksChain) continue; // insulator: chain stops here (no further propagation)

      // Propagate to orthogonal neighbors
      for (const neighbor of orthogonalNeighbors(current.position, state.map.gridSize)) {
        const neighborUnit = posToUnit.get(posKey(neighbor));
        if (neighborUnit === undefined) continue;
        if (visited.has(neighborUnit.unitId)) continue;

        visited.add(neighborUnit.unitId);
        queue.push(neighborUnit);

        // Apply chain damage to this unit (primary target already hit by normal attack)
        let chainDmg = Math.max(0, weapon.damage - neighborUnit.currentArmor);
        chainDmg = applyDamageImmunity(chainDmg, "electric", neighborUnit, this.registry);

        if (chainDmg > 0) {
          changes.push({
            type: "unit_damage",
            unitId: neighborUnit.unitId,
            amount: chainDmg,
            source: {
              type: "attack",
              attackerId: attackerUnitId as import("@ab/metadata").UnitId,
              weaponId: weapon.id,
            },
            hpAfter: Math.max(0, neighborUnit.currentHealth - chainDmg),
          });
        }
      }
    }

    return changes;
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function calcBaseDamage(
  baseDamage: number,
  target: UnitState,
  registry: IDataRegistry,
): number {
  let dmg = baseDamage - target.currentArmor;
  if (dmg < 0) dmg = 0;
  for (const activeEffect of target.activeEffects) {
    const meta = registry.getEffectByType(activeEffect.effectType);
    if (meta !== undefined && meta.incomingDamageMultiplier !== 1) {
      dmg = Math.floor(dmg * meta.incomingDamageMultiplier);
    }
  }
  return dmg;
}

function applyDamageImmunity(
  dmg: number,
  attackAttr: AttackAttribute,
  target: UnitState,
  registry: IDataRegistry,
): number {
  if (attackAttr === "none") return dmg;
  const passives = registry.getUnitPassives(target.metaId as string);
  for (const passive of passives) {
    for (const action of passive.actions) {
      if (action.type === "immune_damage_type" && action.damageType === attackAttr) return 0;
    }
  }
  return dmg;
}

function applyVulnerability(
  dmg: number,
  attackAttr: AttackAttribute,
  target: UnitState,
  registry: IDataRegistry,
): number {
  if (attackAttr === "none") return dmg;
  const passives = registry.getUnitPassives(target.metaId as string);
  for (const passive of passives) {
    for (const action of passive.actions) {
      if (action.type === "vulnerability" && action.damageType === attackAttr) {
        dmg += action.extraDamage;
      }
    }
  }
  return dmg;
}

function applyDamageReduction(
  dmg: number,
  attackType: import("@ab/metadata").AttackType,
  target: UnitState,
  registry: IDataRegistry,
): number {
  const passives = registry.getUnitPassives(target.metaId as string);
  for (const passive of passives) {
    for (const action of passive.actions) {
      if (action.type === "damage_reduction" && action.attackType === attackType) {
        dmg = Math.max(0, dmg - action.amount);
      }
    }
  }
  return dmg;
}

function applyAmplify(
  dmg: number,
  attackAttr: AttackAttribute,
  target: UnitState,
  state: GameState,
  registry: IDataRegistry,
): number {
  if (attackAttr === "none" || dmg === 0) return dmg;
  for (const unit of Object.values(state.units)) {
    if (!unit.alive) continue;
    const passives = registry.getUnitPassives(unit.metaId as string);
    for (const passive of passives) {
      for (const action of passive.actions) {
        if (action.type === "amplify_damage_type" && action.damageType === attackAttr) {
          // Diagonal distance counts as 2 (per passive_generator spec)
          const dr = Math.abs(unit.position.row - target.position.row);
          const dc = Math.abs(unit.position.col - target.position.col);
          const dist = dr + dc;
          if (dist <= action.radius) {
            dmg = Math.floor(dmg * action.multiplier);
          }
        }
      }
    }
  }
  return dmg;
}

function posEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function getAdjacentToTarget(from: Position, to: Position): Position | null {
  const delta = directionDelta(from, to);
  if (delta === null) return null;
  return { row: to.row - delta.dRow, col: to.col - delta.dCol };
}

/**
 * Returns the two tile positions perpendicular to the attack direction at the target.
 * E.g. attack going East → returns target's North and South neighbors.
 */
function getSidePositions(attackerPos: Position, targetPos: Position, gridSize: number): Position[] {
  const delta = directionDelta(attackerPos, targetPos);
  if (delta === null) return [];
  // 90° CW and CCW rotations of the direction vector
  const perp1: Position = { row: targetPos.row + delta.dCol, col: targetPos.col - delta.dRow };
  const perp2: Position = { row: targetPos.row - delta.dCol, col: targetPos.col + delta.dRow };
  return [perp1, perp2].filter((p) => isInBounds(p, gridSize));
}
