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
import type { GameState, PlayerAction, UnitId } from "@ab/metadata";
import type { LogEntry } from "@ab/engine";

export class ReplayAdapter implements IPlayerAdapter {
  readonly type = "replay" as const;

  private cursor = 0;

  constructor(
    readonly playerId: string,
    private readonly entries: LogEntry[],
  ) {}

  async requestDraftPlacement(
    _state: GameState,
    _timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    // Draft placements are not logged — return a no-op; the GameLoop's
    // applyTimeout will fill remaining slots automatically.
    return {
      type: "draft_place",
      playerId: this.playerId as import("@ab/metadata").PlayerId,
      metaId: "" as import("@ab/metadata").MetaId,
      position: { row: 0, col: 0 },
    };
  }

  async requestAction(_state: GameState, _timeoutMs: number): Promise<PlayerAction> {
    const entry = this.entries[this.cursor];

    // Advance cursor only for actions belonging to this player
    while (
      this.cursor < this.entries.length &&
      this.entries[this.cursor]?.playerId !== this.playerId
    ) {
      this.cursor++;
    }

    const current = this.entries[this.cursor];
    if (current === undefined || current.playerId !== this.playerId) {
      // No more recorded actions — pass
      return {
        type: "pass",
        playerId: this.playerId as import("@ab/metadata").PlayerId,
        unitId: (entry?.unitId ?? "") as import("@ab/metadata").UnitId,
      };
    }

    this.cursor++;
    return this.entryToAction(current);
  }

  async requestUnitOrder(
    _state: GameState,
    aliveUnitIds: UnitId[],
    _timeoutMs: number,
  ): Promise<UnitId[]> {
    // Submit default order — the original game's order is encoded in the log
    // entry sequence, so the replay will naturally follow the recorded flow.
    return aliveUnitIds;
  }

  onStateUpdate(_state: GameState): void {
    // no-op
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private entryToAction(entry: LogEntry): PlayerAction {
    const playerId = entry.playerId as import("@ab/metadata").PlayerId;
    const unitId = entry.unitId as import("@ab/metadata").UnitId;

    switch (entry.actionType) {
      case "move":
        if (entry.positionAfter !== undefined) {
          return { type: "move", playerId, unitId, destination: entry.positionAfter };
        }
        return { type: "pass", playerId, unitId };

      case "attack":
        if (entry.positionAfter !== undefined) {
          return { type: "attack", playerId, unitId, target: entry.positionAfter };
        }
        return { type: "pass", playerId, unitId };

      case "extinguish":
        return { type: "extinguish", playerId, unitId };

      case "pass":
      default:
        return { type: "pass", playerId, unitId };
    }
  }
}
