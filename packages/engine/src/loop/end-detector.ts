/**
 * EndDetector — pure function. Detects game-over conditions.
 * P-03: No side effects.
 *
 * Conditions:
 * 1. A player's all units dead → opponent wins
 * 2. Round limit (30) reached → most alive units wins; tie = draw
 * 3. Surrender
 */
import type { GameState } from "@ab/metadata";
import { MAX_ROUNDS } from "@ab/metadata";

export interface EndResult {
  ended: boolean;
  winnerIds: string[];
  reason: "all_units_dead" | "round_limit" | "surrender" | "disconnect" | null;
}

export interface IEndDetector {
  check(state: GameState): EndResult;
}

export class EndDetector implements IEndDetector {
  check(state: GameState): EndResult {
    const notEnded: EndResult = { ended: false, winnerIds: [], reason: null };

    // Surrender
    const surrendered = Object.values(state.players).filter((p) => p.surrendered);
    if (surrendered.length > 0) {
      const winners = Object.values(state.players)
        .filter((p) => !p.surrendered)
        .map((p) => p.playerId);
      return { ended: true, winnerIds: winners, reason: "surrender" };
    }

    // All units dead for a player
    const playerUnitCounts = this.countAliveUnits(state);

    for (const [playerId, count] of playerUnitCounts) {
      if (count === 0) {
        const winners = [...playerUnitCounts.entries()]
          .filter(([pid, cnt]) => pid !== playerId && cnt > 0)
          .map(([pid]) => pid);
        return {
          ended: true,
          winnerIds: winners,
          reason: "all_units_dead",
        };
      }
    }

    // Round limit
    if (state.round > MAX_ROUNDS && state.currentTurnIndex >= state.turnOrder.length) {
      return this.resolveRoundLimitResult(state, playerUnitCounts);
    }

    return notEnded;
  }

  private countAliveUnits(state: GameState): Map<string, number> {
    const counts = new Map<string, number>();
    for (const player of Object.values(state.players)) {
      counts.set(player.playerId, 0);
    }
    for (const unit of Object.values(state.units)) {
      if (unit.alive) {
        counts.set(unit.playerId, (counts.get(unit.playerId) ?? 0) + 1);
      }
    }
    return counts;
  }

  private resolveRoundLimitResult(
    _state: GameState,
    playerUnitCounts: Map<string, number>,
  ): EndResult {
    const maxCount = Math.max(...playerUnitCounts.values());
    const winners = [...playerUnitCounts.entries()]
      .filter(([, cnt]) => cnt === maxCount)
      .map(([pid]) => pid);

    if (winners.length > 1) {
      // Draw
      return { ended: true, winnerIds: [], reason: "round_limit" };
    }

    return { ended: true, winnerIds: winners, reason: "round_limit" };
  }
}
