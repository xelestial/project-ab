/**
 * RoundManager — round transitions and 30-round limit enforcement.
 */
import type { GameState } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import { MAX_ROUNDS } from "@ab/metadata";

export interface IRoundManager {
  startRound(state: GameState): GameState;
  endRound(state: GameState): GameState;
  isLastRound(state: GameState): boolean;
}

export class RoundManager implements IRoundManager {
  constructor(private readonly applicator: IStateApplicator) {}

  startRound(state: GameState): GameState {
    // Reset all unit actions for the new round
    // (Turn order is set by the game loop before this is called)
    const unitResets = Object.values(state.units)
      .filter((u) => u.alive)
      .map((u) => ({ type: "unit_actions_reset" as const, unitId: u.unitId }));

    const newState = this.applicator.apply(unitResets, state);
    return { ...newState, currentTurnIndex: 0 };
  }

  endRound(state: GameState): GameState {
    return this.applicator.apply(
      [{ type: "round_advance", from: state.round, to: state.round + 1 }],
      state,
    );
  }

  isLastRound(state: GameState): boolean {
    return state.round >= MAX_ROUNDS;
  }
}
