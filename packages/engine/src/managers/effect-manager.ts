/**
 * EffectManager — per-turn effect processing and tile-entry effects.
 */
import type { GameState, Position } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import type { IEffectResolver } from "../resolvers/effect-resolver.js";
import { getAliveUnits } from "../state/game-state-utils.js";

export interface IEffectManager {
  processTurnStart(unitId: string, state: GameState): GameState;
  processTileEntry(unitId: string, position: Position, state: GameState): GameState;
}

export class EffectManager implements IEffectManager {
  constructor(
    private readonly resolver: IEffectResolver,
    private readonly applicator: IStateApplicator,
  ) {}

  processTurnStart(unitId: string, state: GameState): GameState {
    const unit = state.units[unitId];
    if (unit === undefined || !unit.alive) return state;

    const changes = this.resolver.resolveTurnTick(unit, state);
    if (changes.length === 0) return state;
    return this.applicator.apply(changes, state);
  }

  processTileEntry(unitId: string, position: Position, state: GameState): GameState {
    // After move, tile-entry effects are resolved by MovementResolver.
    // This method provides a hook for cases outside normal movement (e.g. teleport skills).
    return state;
  }
}
