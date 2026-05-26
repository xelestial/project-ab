/**
 * ReplayAdapter — replays a saved game log by returning pre-recorded actions.
 * Implements IPlayerAdapter so it can be plugged into GameLoop identically to
 * a human or AI adapter.
 *
 * Usage:
 *   const entries = await replayStore.getLog(gameId);
 *   const adapter = new ReplayAdapter(playerId, entries);
 *   // pass adapter into GameLoop.start() adapters map
 */
import type { IPlayerAdapter } from "@ab/engine";
import type { GameState, PlayerAction, UnitId, MetaId, PlayerId } from "@ab/metadata";
import type { GameLogEntry, ActionEntry, RoundStartEntry } from "@ab/engine";

export class ReplayAdapter implements IPlayerAdapter {
  readonly type = "replay" as const;

  private cursor = 0;

  constructor(
    readonly playerId: string,
    private readonly entries: GameLogEntry[],
  ) {}

  async requestDraftPlacement(
    _state: GameState,
    _timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    // Draft placements are not logged — return a no-op; the GameLoop's
    // applyTimeout will fill remaining slots automatically.
    return {
      type: "draft_place",
      playerId: this.playerId as PlayerId,
      metaId: "" as MetaId,
      position: { row: 0, col: 0 },
    };
  }

  async requestAction(state: GameState, _timeoutMs: number): Promise<PlayerAction> {
    // Which unit is expected to act this slot?
    const currentSlot = state.turnOrder?.[state.currentTurnIndex];
    const expectedUnitId = currentSlot?.unitId;

    // Advance cursor to the next accepted action entry for this player
    while (this.cursor < this.entries.length) {
      const entry = this.entries[this.cursor];
      if (
        entry !== undefined &&
        entry.type === "action" &&
        entry.accepted &&
        entry.playerId === this.playerId
      ) {
        break;
      }
      this.cursor++;
    }

    const current = this.entries[this.cursor];
    if (
      current === undefined ||
      current.type !== "action" ||
      current.playerId !== this.playerId
    ) {
      // No more recorded actions — pass
      return {
        type: "pass",
        playerId: this.playerId as PlayerId,
        unitId: (expectedUnitId ?? "") as UnitId,
      };
    }

    // If the next action belongs to a DIFFERENT unit than the current slot,
    // this turn was originally a pass — return pass WITHOUT advancing cursor
    // so the action stays available for its correct unit's turn.
    if (expectedUnitId !== undefined && current.unitId !== expectedUnitId) {
      return {
        type: "pass",
        playerId: this.playerId as PlayerId,
        unitId: expectedUnitId as UnitId,
      };
    }

    this.cursor++;
    return this.entryToAction(current as ActionEntry);
  }

  async requestUnitOrder(
    state: GameState,
    aliveUnitIds: UnitId[],
    _timeoutMs: number,
  ): Promise<UnitId[]> {
    // Find the round_start entry for the current round and reconstruct order
    const roundStart = this.entries.find(
      (e): e is RoundStartEntry =>
        e.type === "round_start" && (e as RoundStartEntry).round === state.round,
    );

    if (roundStart === undefined) return aliveUnitIds;

    // Extract this player's unit IDs in recorded activation order
    const aliveSet = new Set<string>(aliveUnitIds);
    const recorded = roundStart.turnOrder
      .filter((slot) => slot.playerId === this.playerId && slot.unitId !== undefined)
      .map((slot) => slot.unitId!)
      .filter((uid) => aliveSet.has(uid)) as UnitId[];

    // Append any alive units not captured in the recorded order (defensive)
    const missing = aliveUnitIds.filter((uid) => !recorded.includes(uid));
    return [...recorded, ...missing];
  }

  onStateUpdate(_state: GameState): void {
    // no-op
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private entryToAction(entry: ActionEntry): PlayerAction {
    const playerId = entry.playerId as PlayerId;
    const unitId = entry.unitId as UnitId;

    switch (entry.actionType) {
      case "move":
        if (entry.movedTo !== undefined) {
          return { type: "move", playerId, unitId, destination: entry.movedTo };
        }
        return { type: "pass", playerId, unitId };

      case "attack":
        if (entry.targetPosition !== undefined) {
          return { type: "attack", playerId, unitId, target: entry.targetPosition };
        }
        return { type: "pass", playerId, unitId };

      case "skill":
        return {
          type: "skill",
          playerId,
          unitId,
          skillId: "" as MetaId,
          target: entry.targetPosition,
        };

      case "extinguish":
        return { type: "extinguish", playerId, unitId };

      case "pass":
      default:
        return { type: "pass", playerId, unitId };
    }
  }
}
