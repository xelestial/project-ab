/**
 * RoundManager — round transitions and 30-round limit enforcement.
 */
import type { GameState } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import type { IDraftManager } from "./draft-manager.js";
import { MAX_ROUNDS } from "@ab/metadata";

export interface IRoundManager {
  startRound(state: GameState): GameState;
  endRound(state: GameState): GameState;
  isLastRound(state: GameState): boolean;
}

export class RoundManager implements IRoundManager {
  constructor(
    private readonly applicator: IStateApplicator,
    private readonly draftManager: IDraftManager,
  ) {}

  startRound(state: GameState): GameState {
    // Reset all unit actions for the new round
    const unitResets = Object.values(state.units)
      .filter((u) => u.alive)
      .map((u) => ({ type: "unit_actions_reset" as const, unitId: u.unitId }));

    let newState = this.applicator.apply(unitResets, state);

    // Build new turn order (DraftManager handles priority / alternation)
    // For subsequent rounds, pass last first player for alternation
    const lastFirstPlayerId =
      state.turnOrder[0]?.playerId ?? null;

    const turnOrder = (this.draftManager as import("./draft-manager.js").DraftManager)
      .buildTurnOrder(newState, newState.round, lastFirstPlayerId);

    newState = { ...newState, turnOrder, currentTurnIndex: 0 };

    return newState;
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
