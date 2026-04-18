/**
 * HumanAdapter — IPlayerAdapter implementation for WebSocket-connected human players.
 * Bridges the WebSocket message stream into the engine's IPlayerAdapter interface.
 *
 * Reconnection support: `replaceSocket()` swaps in a new WebSocket when a player
 * reconnects mid-game, allowing pending action promises to resolve via the new socket.
 */
import type { GameState, GameId, PlayerAction, PlayerId, UnitId } from "@ab/metadata";
import type { IPlayerAdapter } from "@ab/engine";
import type { WebSocket } from "@fastify/websocket";
import { encodeMessage, decodeMessage } from "./ws-protocol.js";

export class HumanAdapter implements IPlayerAdapter {
  readonly type = "human" as const;

  private socket: WebSocket;
  private messageHandler: (raw: Buffer | string) => void;
  private pendingResolve: ((action: PlayerAction) => void) | undefined = undefined;
  private pendingDraftResolve: ((action: Extract<PlayerAction, { type: "draft_place" }>) => void) | undefined = undefined;
  private pendingUnitOrderResolve: ((order: UnitId[]) => void) | undefined = undefined;

  /** true while the underlying socket is open */
  get connected(): boolean {
    return this.socket.readyState === 1 /* OPEN */;
  }

  constructor(
    readonly playerId: string,
    socket: WebSocket,
  ) {
    this.socket = socket;
    this.messageHandler = this.makeMessageHandler();
    this.socket.on("message", this.messageHandler);
  }

  private makeMessageHandler(): (raw: Buffer | string) => void {
    return (raw: Buffer | string) => {
      const text = typeof raw === "string" ? raw : raw.toString();
      const msg = decodeMessage(text);
      if (msg === null) return;

      if (msg.type === "unit_order" && this.pendingUnitOrderResolve !== undefined) {
        this.pendingUnitOrderResolve(msg.unitOrder as UnitId[]);
        this.pendingUnitOrderResolve = undefined;
      } else if (msg.type === "action") {
        if (msg.action.type === "draft_place" && this.pendingDraftResolve !== undefined) {
          this.pendingDraftResolve(msg.action);
          this.pendingDraftResolve = undefined;
        } else if (this.pendingResolve !== undefined) {
          this.pendingResolve(msg.action);
          this.pendingResolve = undefined;
        }
      }
    };
  }

  /**
   * Replace the underlying WebSocket with a new connection.
   * Called when a player reconnects to an in-progress game.
   * Immediately sends the current game state to the new socket.
   */
  replaceSocket(newSocket: WebSocket, currentState?: GameState): void {
    // Remove old handler
    this.socket.removeListener("message", this.messageHandler);

    this.socket = newSocket;
    this.messageHandler = this.makeMessageHandler();
    this.socket.on("message", this.messageHandler);

    // Catch up the reconnected client
    if (currentState !== undefined) {
      this.onStateUpdate(currentState);
    }
  }

  async requestUnitOrder(
    state: GameState,
    aliveUnitIds: UnitId[],
    timeoutMs: number,
  ): Promise<UnitId[]> {
    this.sendMessage({
      type: "request_unit_order",
      gameId: state.gameId as unknown as string,
      aliveUnitIds: aliveUnitIds as unknown as string[],
      timeoutMs,
    });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingUnitOrderResolve = undefined;
        resolve(aliveUnitIds); // auto-submit in default order
      }, timeoutMs);

      this.pendingUnitOrderResolve = (order) => {
        clearTimeout(timer);
        resolve(order);
      };
    });
  }

  /**
   * Submit a unit order externally (e.g. from the REST endpoint).
   */
  submitUnitOrder(order: UnitId[]): void {
    if (this.pendingUnitOrderResolve !== undefined) {
      const resolve = this.pendingUnitOrderResolve;
      this.pendingUnitOrderResolve = undefined;
      resolve(order);
    }
  }

  async requestDraftPlacement(
    state: GameState,
    timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    this.onStateUpdate(state);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDraftResolve = undefined;
        reject(new Error("draft_timeout"));
      }, timeoutMs);

      this.pendingDraftResolve = (action) => {
        clearTimeout(timer);
        resolve(action);
      };
    });
  }

  async requestAction(state: GameState, timeoutMs: number): Promise<PlayerAction> {
    this.onStateUpdate(state);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResolve = undefined;
        // Auto-pass on timeout (keeps game moving if player is disconnected)
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
        clearTimeout(timer);
        resolve(action);
      };
    });
  }

  /**
   * Submit an action externally (e.g. from the REST action endpoint).
   * Equivalent to receiving an "action" WS message.
   */
  submitAction(action: PlayerAction): void {
    if (this.pendingResolve !== undefined) {
      const resolve = this.pendingResolve;
      this.pendingResolve = undefined;
      resolve(action);
    }
  }

  onStateUpdate(state: GameState): void {
    if (this.socket.readyState === 1 /* OPEN */) {
      const msg = encodeMessage({ type: "state_update", gameId: state.gameId, state });
      this.socket.send(msg);
    }
  }

  sendMessage(msg: import("./ws-protocol.js").ServerMessage): void {
    if (this.socket.readyState === 1) {
      this.socket.send(encodeMessage(msg));
    }
  }
}
