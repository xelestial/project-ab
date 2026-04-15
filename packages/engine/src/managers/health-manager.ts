/**
 * HealthManager — death detection and cleanup.
 */
import type { GameState, GameChange, MetaId } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";

export interface IHealthManager {
  checkDeaths(state: GameState): GameChange[];
  applyDeaths(state: GameState): GameState;
}

export class HealthManager implements IHealthManager {
  constructor(private readonly applicator: IStateApplicator) {}

  checkDeaths(state: GameState): GameChange[] {
    const changes: GameChange[] = [];

    for (const unit of Object.values(state.units)) {
      if (!unit.alive) continue;
      if (unit.currentHealth <= 0) {
        changes.push({
          type: "unit_death",
          unitId: unit.unitId,
          position: unit.position,
          killedBy: { type: "effect", effectId: "unknown" as MetaId }, // Resolved by caller
        });
      }
    }

    return changes;
  }

  applyDeaths(state: GameState): GameState {
    const deathChanges = this.checkDeaths(state);
    if (deathChanges.length === 0) return state;
    return this.applicator.apply(deathChanges, state);
  }
}
