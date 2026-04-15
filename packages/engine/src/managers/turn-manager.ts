/**
 * TurnManager — current turn tracking and turn transitions.
 */
import type { GameState, PlayerState, ActionType, PlayerId } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import { isFrozen } from "../state/game-state-utils.js";

export interface ITurnManager {
  getCurrentPlayer(state: GameState): PlayerState | undefined;
  isActionAllowed(unitId: string, action: ActionType, state: GameState): boolean;
  endTurn(state: GameState): GameState;
  isRoundOver(state: GameState): boolean;
}

export class TurnManager implements ITurnManager {
  constructor(private readonly applicator: IStateApplicator) {}

  getCurrentPlayer(state: GameState): PlayerState | undefined {
    const slot = state.turnOrder[state.currentTurnIndex];
    if (slot === undefined) return undefined;
    return state.players[slot.playerId];
  }

  isActionAllowed(unitId: string, action: ActionType, state: GameState): boolean {
    const unit = state.units[unitId];
    if (unit === undefined || !unit.alive) return false;

    // Must be current player's unit
    const currentPlayer = this.getCurrentPlayer(state);
    if (currentPlayer === undefined) return false;
    if (unit.playerId !== currentPlayer.playerId) return false;

    // If this slot has a specific unitId, enforce it
    const slot = state.turnOrder[state.currentTurnIndex];
    if (slot?.unitId !== undefined && unit.unitId !== slot.unitId) return false;

    // Frozen: no actions
    if (isFrozen(unit)) return false;

    switch (action) {
      case "move":
        return !unit.actionsUsed.moved;
      case "attack":
        return !unit.actionsUsed.attacked;
      case "skill":
        return !unit.actionsUsed.attacked && !unit.actionsUsed.skillUsed;
      case "extinguish":
        return !unit.actionsUsed.extinguished && !unit.actionsUsed.attacked;
      case "pass":
        return true;
      case "draft_place":
        return state.phase === "draft";
      default:
        return false;
    }
  }

  endTurn(state: GameState): GameState {
    const nextIndex = state.currentTurnIndex + 1;

    if (nextIndex >= state.turnOrder.length) {
      // All turns in this round are done — signal round end
      // Round advance is handled by RoundManager
      return this.applicator.apply(
        [{ type: "turn_advance", from: { playerId: state.turnOrder[state.currentTurnIndex]!.playerId, turnIndex: state.currentTurnIndex }, to: { playerId: "" as PlayerId, turnIndex: nextIndex } }],
        state,
      );
    }

    const nextSlot = state.turnOrder[nextIndex]!;
    return this.applicator.apply(
      [
        {
          type: "turn_advance",
          from: {
            playerId: state.turnOrder[state.currentTurnIndex]!.playerId,
            turnIndex: state.currentTurnIndex,
          },
          to: { playerId: nextSlot.playerId, turnIndex: nextIndex },
        },
      ],
      state,
    );
  }

  isRoundOver(state: GameState): boolean {
    return state.currentTurnIndex >= state.turnOrder.length;
  }
}
