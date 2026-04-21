/**
 * StateApplicator — the ONLY place where GameState is mutated.
 * All changes come in as GameChange[] and produce a new GameState (immutable pattern).
 *
 * P-03: Pure function / immutable state
 */
import type {
  GameState,
  GameChange,
  UnitState,
  TileState,
  ActionsUsed,
  ActiveEffect,
  TileAttributeType,
} from "@ab/metadata";
import { posKey } from "./game-state-utils.js";

export interface IStateApplicator {
  apply(changes: GameChange[], state: GameState): GameState;
}

export class StateApplicator implements IStateApplicator {
  apply(changes: GameChange[], state: GameState): GameState {
    let current = state;
    for (const change of changes) {
      current = applyOne(change, current);
    }
    return { ...current, updatedAt: new Date().toISOString() };
  }
}

// ─── Individual change applicators ───────────────────────────────────────────

function applyOne(change: GameChange, state: GameState): GameState {
  switch (change.type) {
    case "unit_move":
      return applyUnitMove(change, state);
    case "unit_damage":
      return applyUnitDamage(change, state);
    case "unit_heal":
      return applyUnitHeal(change, state);
    case "unit_effect_add":
      return applyUnitEffectAdd(change, state);
    case "unit_effect_remove":
      return applyUnitEffectRemove(change, state);
    case "unit_death":
      return applyUnitDeath(change, state);
    case "unit_knockback":
      return applyUnitKnockback(change, state);
    case "unit_river_enter":
      return applyUnitRiverEnter(change, state);
    case "unit_river_exit":
      return applyUnitRiverExit(change, state);
    case "unit_pull":
      return applyUnitPull(change, state);
    case "unit_actions_reset":
      return applyUnitActionsReset(change, state);
    case "tile_attribute_change":
      return applyTileAttributeChange(change, state);
    case "tile_effect_tick":
      return applyTileEffectTick(change, state);
    case "turn_advance":
      return applyTurnAdvance(change, state);
    case "round_advance":
      return applyRoundAdvance(change, state);
    case "phase_change":
      return applyPhaseChange(change, state);
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateUnit(state: GameState, unitId: string, update: Partial<UnitState>): GameState {
  const existing = state.units[unitId];
  if (existing === undefined) return state;
  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: { ...existing, ...update },
    },
  };
}

function updateTile(state: GameState, key: string, update: Partial<TileState>): GameState {
  const existing: TileState = state.map.tiles[key] ?? {
    position: posKeyToPos(key),
    attribute: "plain" as TileAttributeType,
    attributeTurnsRemaining: undefined,
  };
  return {
    ...state,
    map: {
      ...state.map,
      tiles: {
        ...state.map.tiles,
        [key]: { ...existing, ...update },
      },
    },
  };
}

function posKeyToPos(key: string): { row: number; col: number } {
  const [r, c] = key.split(",").map(Number);
  return { row: r ?? 0, col: c ?? 0 };
}

// ─── Change implementations ───────────────────────────────────────────────────

function applyUnitMove(change: Extract<GameChange, { type: "unit_move" }>, state: GameState): GameState {
  const currentActions = state.units[change.unitId]?.actionsUsed;
  if (currentActions === undefined) return state;
  // Rush movement does NOT set moved:true (the unit's move action is still available)
  const newActions = change.isRushMovement
    ? currentActions
    : { ...currentActions, moved: true };
  return updateUnit(state, change.unitId, {
    position: change.to,
    actionsUsed: newActions,
  });
}

function applyUnitDamage(change: Extract<GameChange, { type: "unit_damage" }>, state: GameState): GameState {
  return updateUnit(state, change.unitId, { currentHealth: change.hpAfter });
}

function applyUnitHeal(change: Extract<GameChange, { type: "unit_heal" }>, state: GameState): GameState {
  return updateUnit(state, change.unitId, { currentHealth: change.hpAfter });
}

function applyUnitEffectAdd(
  change: Extract<GameChange, { type: "unit_effect_add" }>,
  state: GameState,
): GameState {
  const unit = state.units[change.unitId];
  if (unit === undefined) return state;

  // Remove existing effect of same type first (replace)
  const filtered = unit.activeEffects.filter((e) => e.effectType !== change.effectType);
  const newEffect: ActiveEffect = {
    effectId: change.effectId,
    effectType: change.effectType,
    turnsRemaining: change.turnsRemaining,
    appliedOnTurn: state.round,
  };
  return updateUnit(state, change.unitId, {
    activeEffects: [...filtered, newEffect],
  });
}

function applyUnitEffectRemove(
  change: Extract<GameChange, { type: "unit_effect_remove" }>,
  state: GameState,
): GameState {
  const unit = state.units[change.unitId];
  if (unit === undefined) return state;
  return updateUnit(state, change.unitId, {
    activeEffects: unit.activeEffects.filter(
      (e) => !(e.effectType === change.effectType && e.effectId === change.effectId),
    ),
  });
}

function applyUnitDeath(change: Extract<GameChange, { type: "unit_death" }>, state: GameState): GameState {
  return updateUnit(state, change.unitId, { alive: false });
}

function applyUnitKnockback(
  change: Extract<GameChange, { type: "unit_knockback" }>,
  state: GameState,
): GameState {
  // Only move if not blocked
  if (change.blockedBy !== undefined) return state;
  return updateUnit(state, change.unitId, { position: change.to });
}

function applyUnitRiverEnter(
  change: Extract<GameChange, { type: "unit_river_enter" }>,
  state: GameState,
): GameState {
  const unit = state.units[change.unitId];
  if (unit === undefined) return state;
  // Clear all effects and attributes
  return updateUnit(state, change.unitId, {
    position: change.position,
    activeEffects: [],
    // attributes restore on exit — tracked externally
  });
}

function applyUnitRiverExit(
  change: Extract<GameChange, { type: "unit_river_exit" }>,
  state: GameState,
): GameState {
  return updateUnit(state, change.unitId, { position: change.position });
}

function applyUnitPull(
  change: Extract<GameChange, { type: "unit_pull" }>,
  state: GameState,
): GameState {
  return updateUnit(state, change.unitId, { position: change.to });
}

function applyUnitActionsReset(
  change: Extract<GameChange, { type: "unit_actions_reset" }>,
  state: GameState,
): GameState {
  const resetActions: ActionsUsed = {
    moved: false,
    attacked: false,
    skillUsed: state.units[change.unitId]?.actionsUsed.skillUsed ?? false,
    extinguished: false,
  };
  return updateUnit(state, change.unitId, { actionsUsed: resetActions });
}

function applyTileAttributeChange(
  change: Extract<GameChange, { type: "tile_attribute_change" }>,
  state: GameState,
): GameState {
  const key = posKey(change.position);
  return updateTile(state, key, { attribute: change.to });
}

function applyTileEffectTick(
  change: Extract<GameChange, { type: "tile_effect_tick" }>,
  state: GameState,
): GameState {
  const key = posKey(change.position);
  if (change.turnsRemaining !== undefined && change.turnsRemaining <= 0) {
    // Tile effect expired — revert to plain
    return updateTile(state, key, { attribute: "plain", attributeTurnsRemaining: undefined });
  }
  return updateTile(state, key, { attributeTurnsRemaining: change.turnsRemaining });
}

function applyTurnAdvance(
  change: Extract<GameChange, { type: "turn_advance" }>,
  state: GameState,
): GameState {
  return { ...state, currentTurnIndex: change.to.turnIndex };
}

function applyRoundAdvance(
  change: Extract<GameChange, { type: "round_advance" }>,
  state: GameState,
): GameState {
  return { ...state, round: change.to };
}

function applyPhaseChange(
  change: Extract<GameChange, { type: "phase_change" }>,
  state: GameState,
): GameState {
  return { ...state, phase: change.to as GameState["phase"] };
}
