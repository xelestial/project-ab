/**
 * PassThroughAdapter — IPlayerAdapter for human players connected via REST (no WebSocket).
 * Actions are submitted externally via `submitAction()` and queued.
 * On each turn, it blocks until an action is submitted or the timeout fires (auto-pass).
 */
import type { GameState, PlayerAction, PlayerId, UnitId } from "@ab/metadata";

import type { IPlayerAdapter } from "@ab/engine";

export class PassThroughAdapter implements IPlayerAdapter {
  readonly type = "human" as const;

  private pendingResolve: ((action: PlayerAction) => void) | undefined = undefined;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  private stateListeners: ((state: GameState) => void)[] = [];
  private pendingUnitOrderResolve: ((order: UnitId[]) => void) | undefined = undefined;
  private pendingUnitOrderTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(readonly playerId: string) {}

  /**
   * Submit an action from an external source (e.g. REST endpoint).
   */
  submitAction(action: PlayerAction): void {
    if (this.pendingResolve !== undefined) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
      const resolve = this.pendingResolve;
      this.pendingResolve = undefined;
      resolve(action);
    }
  }

  /**
   * Register a listener that receives state updates (e.g. for long-polling).
   */
  onStateChange(fn: (state: GameState) => void): () => void {
    this.stateListeners.push(fn);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== fn);
    };
  }

  /**
   * Submit a unit order externally (e.g. from the REST endpoint).
   */
  submitUnitOrder(order: UnitId[]): void {
    if (this.pendingUnitOrderResolve !== undefined) {
      clearTimeout(this.pendingUnitOrderTimer);
      this.pendingUnitOrderTimer = undefined;
      const resolve = this.pendingUnitOrderResolve;
      this.pendingUnitOrderResolve = undefined;
      resolve(order);
    }
  }

  // ── IPlayerAdapter ──────────────────────────────────────────────────────────

  async requestUnitOrder(
    state: GameState,
    aliveUnitIds: UnitId[],
    timeoutMs: number,
  ): Promise<UnitId[]> {
    this.onStateUpdate(state);

    return new Promise((resolve) => {
      this.pendingUnitOrderTimer = setTimeout(() => {
        this.pendingUnitOrderResolve = undefined;
        resolve(aliveUnitIds); // auto-submit in default order
      }, timeoutMs);

      this.pendingUnitOrderResolve = (order) => {
        clearTimeout(this.pendingUnitOrderTimer);
        this.pendingUnitOrderTimer = undefined;
        resolve(order);
      };
    });
  }

  async requestDraftPlacement(
    _state: GameState,
    _timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    // Draft phase bypassed — placement done via /place endpoint before game start
    throw new Error("PassThroughAdapter: draft phase not used");
  }

  async requestAction(state: GameState, timeoutMs: number): Promise<PlayerAction> {
    this.onStateUpdate(state);

    return new Promise((resolve) => {
      this.pendingTimer = setTimeout(() => {
        this.pendingResolve = undefined;
        // Auto-pass
        const firstUnit = Object.values(state.units).find(
          (u) => u.alive && u.playerId === this.playerId,
        );
        resolve({
          type: "pass",
          playerId: this.playerId as PlayerId,
          unitId: (firstUnit?.unitId ?? "") as UnitId,
        });
      }, timeoutMs);

      this.pendingResolve = (action) => {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = undefined;
        resolve(action);
      };
    });
  }

  onStateUpdate(state: GameState): void {
    for (const fn of this.stateListeners) {
      try { fn(state); } catch { /* ignore */ }
    }
  }
}
