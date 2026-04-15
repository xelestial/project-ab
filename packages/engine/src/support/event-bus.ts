/**
 * EventBus — P-08: event-driven state propagation.
 * Engine emits events; subscribers (network layer, logger) listen without coupling.
 */
import type { GameState, GameChange, PlayerAction } from "@ab/metadata";

// ─── Event types ──────────────────────────────────────────────────────────────

export type GameEventType =
  | "game.start"
  | "game.end"
  | "round.start"
  | "round.end"
  | "draft.start"
  | "draft.end"
  | "draft.timeout"
  | "turn.start"
  | "turn.end"
  | "action.accepted"
  | "action.rejected"
  | "unit.moved"
  | "unit.attacked"
  | "unit.died"
  | "effect.applied"
  | "effect.removed"
  | "tile.changed"
  | "state.update";

export type GameEvent =
  | { type: "game.start"; state: GameState }
  | { type: "game.end"; state: GameState; winnerIds: string[]; reason: string }
  | { type: "round.start"; round: number; state: GameState }
  | { type: "round.end"; round: number; state: GameState }
  | { type: "draft.start"; state: GameState }
  | { type: "draft.end"; state: GameState }
  | { type: "draft.timeout"; state: GameState }
  | { type: "turn.start"; playerId: string; turnIndex: number; state: GameState }
  | { type: "turn.end"; playerId: string; turnIndex: number; state: GameState }
  | { type: "action.accepted"; action: PlayerAction; changes: GameChange[]; state: GameState }
  | { type: "action.rejected"; action: PlayerAction; errorCode: string }
  | { type: "unit.moved"; unitId: string; state: GameState }
  | { type: "unit.attacked"; unitId: string; state: GameState }
  | { type: "unit.died"; unitId: string; state: GameState }
  | { type: "effect.applied"; unitId: string; effectType: string; state: GameState }
  | { type: "effect.removed"; unitId: string; effectType: string; state: GameState }
  | { type: "tile.changed"; position: { row: number; col: number }; state: GameState }
  | { type: "state.update"; state: GameState };

export type Unsubscribe = () => void;

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IEventBus {
  emit(event: GameEvent): void;
  on(type: GameEventType, handler: (event: GameEvent) => void): Unsubscribe;
  onAny(handler: (event: GameEvent) => void): Unsubscribe;
  clear(): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class EventBus implements IEventBus {
  private readonly handlers = new Map<GameEventType, Set<(e: GameEvent) => void>>();
  private readonly anyHandlers = new Set<(e: GameEvent) => void>();

  emit(event: GameEvent): void {
    const specific = this.handlers.get(event.type);
    if (specific !== undefined) {
      for (const h of specific) h(event);
    }
    for (const h of this.anyHandlers) h(event);
  }

  on(type: GameEventType, handler: (event: GameEvent) => void): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAny(handler: (event: GameEvent) => void): Unsubscribe {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}
