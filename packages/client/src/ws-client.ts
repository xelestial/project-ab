/**
 * WebSocket client — connects to the game server for a human player.
 */

export interface GameStateSnapshot {
  gameId: string;
  phase: string;
  round: number;
  currentTurnIndex: number;
  turnOrder: Array<{ playerId: string; unitId?: string; priority: number }>;
  players: Record<string, {
    playerId: string;
    teamIndex: number;
    unitIds: string[];
    connected: boolean;
    surrendered: boolean;
  }>;
  units: Record<string, {
    unitId: string;
    metaId: string;
    playerId: string;
    position: { row: number; col: number };
    currentHealth: number;
    currentArmor: number;
    alive: boolean;
    actionsUsed: { moved: boolean; attacked: boolean; skillUsed: boolean; extinguished: boolean };
  }>;
  map: {
    mapId: string;
    gridSize: number;
    baseTile?: string;
    tiles: Record<string, { attribute: string; position: { row: number; col: number } }>;
  };
  endResult?: {
    result: string;
    winnerIds: string[];
  };
}

type WsMessage =
  | { type: "joined"; gameId: string; playerId: string }
  | { type: "state_update"; gameId: string; state: GameStateSnapshot }
  | { type: "game_end"; gameId: string; winnerIds: string[]; reason: string }
  | { type: "request_unit_order"; gameId: string; aliveUnitIds: string[]; timeoutMs: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export type StateUpdateHandler = (state: GameStateSnapshot) => void;
export type GameEndHandler = (winnerIds: string[], reason: string) => void;
export type UnitOrderRequestHandler = (aliveUnitIds: string[], timeoutMs: number) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private gameId: string | null = null;
  private onStateUpdate: StateUpdateHandler | null = null;
  private onGameEnd: GameEndHandler | null = null;
  private onJoined: (() => void) | null = null;
  private onUnitOrderRequest: UnitOrderRequestHandler | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  connect(
    wsBaseUrl: string,
    gameId: string,
    playerId: string,
    handlers: {
      onJoined?: () => void;
      onStateUpdate?: StateUpdateHandler;
      onGameEnd?: GameEndHandler;
      onUnitOrderRequest?: UnitOrderRequestHandler;
      token?: string;
    },
  ): void {
    this.gameId = gameId;
    this.onJoined = handlers.onJoined ?? null;
    this.onStateUpdate = handlers.onStateUpdate ?? null;
    this.onGameEnd = handlers.onGameEnd ?? null;
    this.onUnitOrderRequest = handlers.onUnitOrderRequest ?? null;

    this.ws = new WebSocket(`${wsBaseUrl}/ws/game/${gameId}`);

    this.ws.onopen = () => {
      this.send({ type: "join", gameId, playerId, token: handlers.token ?? "" });
      // Keepalive
      this.pingInterval = setInterval(() => {
        this.send({ type: "ping" });
      }, 15_000);
    };

    this.ws.onerror = (ev) => {
      console.error("[WsClient] error", ev);
    };

    this.ws.onmessage = (evt: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(evt.data as string) as WsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "joined":
          this.onJoined?.();
          break;
        case "state_update":
          this.onStateUpdate?.(msg.state);
          break;
        case "game_end":
          this.onGameEnd?.(msg.winnerIds, msg.reason);
          break;
        case "request_unit_order":
          this.onUnitOrderRequest?.(msg.aliveUnitIds, msg.timeoutMs);
          break;
      }
    };

    this.ws.onclose = () => {
      if (this.pingInterval !== null) clearInterval(this.pingInterval);
    };
  }

  sendAction(gameId: string, action: unknown): void {
    this.send({ type: "action", gameId, action });
  }

  sendUnitOrder(gameId: string, unitOrder: string[]): void {
    this.send({ type: "unit_order", gameId, unitOrder });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    if (this.pingInterval !== null) clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
    this.gameId = null;
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
