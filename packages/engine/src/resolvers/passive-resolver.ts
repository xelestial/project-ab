/**
 * PassiveResolver — calculates GameChange[] for passive triggers.
 *
 * Handles two trigger types:
 *   on_turn_start  — fires at the start of the unit's turn (before actions)
 *   on_attack      — fires after the unit successfully attacks
 *
 * Actions implemented here:
 *   heal_adjacent_allies        — heal ally units within radius
 *   heal_self_per               — heal self × count of matching neighbors
 *   apply_tile_effect_to_adjacent_enemies — convert enemy tiles to a tile attribute
 *   remove_adjacent_tile_effect — clear a tile attribute within radius
 *   remove_adjacent_unit_effect — remove a unit effect within radius
 *   bonus_move                  — restore movement after attack
 */
import type {
  GameState,
  UnitState,
  GameChange,
  TileAttributeType,
} from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import {
  getUnitAt,
  getTileAttribute,
  isInBounds,
  hasEffect,
  manhattanDistance,
  orthogonalNeighbors,
} from "../state/game-state-utils.js";

export interface IPassiveResolver {
  /** Called at the start of a unit's turn, before any actions. */
  resolveTurnStart(unit: UnitState, state: GameState): GameChange[];

  /** Called immediately after the unit performs a successful attack. */
  resolveOnAttack(unit: UnitState, state: GameState): GameChange[];
}

export class PassiveResolver implements IPassiveResolver {
  constructor(private readonly registry: IDataRegistry) {}

  resolveTurnStart(unit: UnitState, state: GameState): GameChange[] {
    const changes: GameChange[] = [];
    const passives = this.registry.getUnitPassives(unit.metaId as string);

    for (const passive of passives) {
      if (passive.trigger.type !== "on_turn_start") continue;

      // Check optional condition
      if (!this.checkTurnStartCondition(passive.trigger.condition, unit, state)) continue;

      for (const action of passive.actions) {
        switch (action.type) {
          case "heal_adjacent_allies":
            changes.push(...this.resolveHealAdjacentAllies(unit, action.amount, action.radius, action.excludeSelf, state));
            break;

          case "heal_self_per":
            changes.push(...this.resolveHealSelfPer(unit, action.amount, action.perCondition, state));
            break;

          case "apply_tile_effect_to_adjacent_enemies":
            changes.push(...this.resolveApplyTileEffectToAdjacentEnemies(unit, action.effect, state));
            break;

          case "remove_adjacent_tile_effect":
            changes.push(...this.resolveRemoveAdjacentTileEffect(unit, action.effect, action.radius, state));
            break;

          case "remove_adjacent_unit_effect":
            changes.push(...this.resolveRemoveAdjacentUnitEffect(unit, action.effectType, action.radius, state));
            break;

          default:
            break;
        }
      }
    }

    return changes;
  }

  resolveOnAttack(unit: UnitState, state: GameState): GameChange[] {
    const changes: GameChange[] = [];
    const passives = this.registry.getUnitPassives(unit.metaId as string);

    for (const passive of passives) {
      if (passive.trigger.type !== "on_attack") continue;

      for (const action of passive.actions) {
        if (action.type === "bonus_move") {
          changes.push({
            type: "unit_movement_restore",
            unitId: unit.unitId,
            movementPoints: action.distance,
          });
        }
        // absorb_tile_at_attacker is handled directly in AttackResolver (Phase 0c)
      }
    }

    return changes;
  }

  // ─── Private action implementations ─────────────────────────────────────────

  private checkTurnStartCondition(
    condition: string | undefined,
    unit: UnitState,
    state: GameState,
  ): boolean {
    if (condition === undefined) return true;

    if (condition === "adjacent_enemy_exists") {
      return orthogonalNeighbors(unit.position, state.map.gridSize).some((pos) => {
        const neighbor = getUnitAt(state, pos);
        return neighbor !== undefined && neighbor.playerId !== unit.playerId;
      });
    }

    if (condition === "adjacent_frozen_enemy_exists") {
      return orthogonalNeighbors(unit.position, state.map.gridSize).some((pos) => {
        const neighbor = getUnitAt(state, pos);
        return neighbor !== undefined && neighbor.playerId !== unit.playerId && hasEffect(neighbor, "freeze");
      });
    }

    return true;
  }

  private resolveHealAdjacentAllies(
    unit: UnitState,
    amount: number,
    radius: number,
    excludeSelf: boolean,
    state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];
    const gridSize = state.map.gridSize;

    for (const [, candidate] of Object.entries(state.units)) {
      if (!candidate.alive) continue;
      if (candidate.playerId !== unit.playerId) continue;
      if (excludeSelf && candidate.unitId === unit.unitId) continue;
      if (manhattanDistance(unit.position, candidate.position) > radius) continue;

      const meta = this.registry.getUnit(candidate.metaId);
      const maxHp = meta.baseHealth;
      if (candidate.currentHealth >= maxHp) continue;

      const hpAfter = Math.min(maxHp, candidate.currentHealth + amount);
      changes.push({
        type: "unit_heal",
        unitId: candidate.unitId,
        amount: hpAfter - candidate.currentHealth,
        hpAfter,
      });
    }

    return changes;
  }

  private resolveHealSelfPer(
    unit: UnitState,
    amount: number,
    perCondition: string,
    state: GameState,
  ): GameChange[] {
    if (perCondition !== "adjacent_frozen_enemy") return [];

    const frozenCount = orthogonalNeighbors(unit.position, state.map.gridSize).filter((pos) => {
      const neighbor = getUnitAt(state, pos);
      return neighbor !== undefined && neighbor.playerId !== unit.playerId && hasEffect(neighbor, "freeze");
    }).length;

    if (frozenCount === 0) return [];

    const meta = this.registry.getUnit(unit.metaId);
    const maxHp = meta.baseHealth;
    if (unit.currentHealth >= maxHp) return [];

    const healAmount = amount * frozenCount;
    const hpAfter = Math.min(maxHp, unit.currentHealth + healAmount);
    return [{
      type: "unit_heal",
      unitId: unit.unitId,
      amount: hpAfter - unit.currentHealth,
      hpAfter,
    }];
  }

  private resolveApplyTileEffectToAdjacentEnemies(
    unit: UnitState,
    effect: TileAttributeType,
    state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];

    for (const pos of orthogonalNeighbors(unit.position, state.map.gridSize)) {
      const neighbor = getUnitAt(state, pos);
      if (neighbor === undefined || neighbor.playerId === unit.playerId) continue;

      const currentAttr = getTileAttribute(state, pos);
      if (currentAttr !== effect) {
        changes.push({
          type: "tile_attribute_change",
          position: pos,
          from: currentAttr,
          to: effect,
          causedBy: undefined,
        });
      }
    }

    return changes;
  }

  private resolveRemoveAdjacentTileEffect(
    unit: UnitState,
    effect: TileAttributeType,
    radius: number,
    state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];
    const gridSize = state.map.gridSize;

    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.abs(dr) + Math.abs(dc) > radius) continue;
        const pos = { row: unit.position.row + dr, col: unit.position.col + dc };
        if (!isInBounds(pos, gridSize)) continue;

        const currentAttr = getTileAttribute(state, pos);
        if (currentAttr === effect) {
          changes.push({
            type: "tile_attribute_change",
            position: pos,
            from: currentAttr,
            to: "plain",
            causedBy: undefined,
          });
        }
      }
    }

    return changes;
  }

  private resolveRemoveAdjacentUnitEffect(
    unit: UnitState,
    effectType: import("@ab/metadata").UnitEffectType,
    radius: number,
    state: GameState,
  ): GameChange[] {
    const changes: GameChange[] = [];

    for (const [, candidate] of Object.entries(state.units)) {
      if (!candidate.alive) continue;
      if (manhattanDistance(unit.position, candidate.position) > radius) continue;

      const eff = candidate.activeEffects.find((e) => e.effectType === effectType);
      if (eff !== undefined) {
        changes.push({
          type: "unit_effect_remove",
          unitId: candidate.unitId,
          effectId: eff.effectId,
          effectType: eff.effectType,
        });
      }
    }

    return changes;
  }
}
