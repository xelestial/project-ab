/**
 * GameLogger — records all actions and events for post-game analysis and replay.
 */
import type { GameState, GameChange, PlayerAction, Position } from "@ab/metadata";

export interface LogEntry {
  gameId: string;
  timestamp: number;
  round: number;
  turnIndex: number;
  playerId: string;
  unitId: string;
  actionType: string;
  positionBefore?: Position;
  positionAfter?: Position;
  damage?: number;
  effectsApplied?: string[];
  effectsRemoved?: string[];
  tilesChanged?: Array<{ position: Position; from: string; to: string }>;
}

export interface IGameLogger {
  logAction(action: PlayerAction, changes: GameChange[], state: GameState): void;
  logEvent(type: string, payload: unknown): void;
  getLog(gameId: string): LogEntry[];
  clear(gameId: string): void;
}

export class GameLogger implements IGameLogger {
  private readonly logs = new Map<string, LogEntry[]>();

  logAction(action: PlayerAction, changes: GameChange[], state: GameState): void {
    if (action.type === "draft_place") return;

    const entry: LogEntry = {
      gameId: state.gameId,
      timestamp: Date.now(),
      round: state.round,
      turnIndex: state.currentTurnIndex,
      playerId: action.playerId,
      unitId: action.unitId,
      actionType: action.type,
      effectsApplied: [],
      effectsRemoved: [],
      tilesChanged: [],
    };

    for (const change of changes) {
      switch (change.type) {
        case "unit_move":
          entry.positionBefore = change.from;
          entry.positionAfter = change.to;
          break;
        case "unit_damage":
          entry.damage = (entry.damage ?? 0) + change.amount;
          break;
        case "unit_effect_add":
          entry.effectsApplied!.push(change.effectType);
          break;
        case "unit_effect_remove":
          entry.effectsRemoved!.push(change.effectType);
          break;
        case "tile_attribute_change":
          entry.tilesChanged!.push({
            position: change.position,
            from: change.from,
            to: change.to,
          });
          break;
      }
    }

    const list = this.logs.get(state.gameId) ?? [];
    list.push(entry);
    this.logs.set(state.gameId, list);
  }

  logEvent(type: string, payload: unknown): void {
    // Console log for debugging; production would write to structured log
    // (no stdout in production — handled by server layer)
    void type;
    void payload;
  }

  getLog(gameId: string): LogEntry[] {
    return this.logs.get(gameId) ?? [];
  }

  clear(gameId: string): void {
    this.logs.delete(gameId);
  }
}
