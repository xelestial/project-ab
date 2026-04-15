/**
 * GameSessionManager — manages active game sessions.
 *
 * Phase 1: in-memory (no external dependencies).
 * Phase 2: ISessionStore implementation swapped to RedisSessionStore.
 *
 * Architecture: The manager holds non-serializable state (GameContext, adapters)
 * in memory. The ISessionStore handles persistent/distributed state (GameState snapshot).
 * This allows Redis to store state while keeping heavy objects (validators, resolvers)
 * local to the process.
 */
import type { GameState } from "@ab/metadata";
import type { IPlayerAdapter, GameContext } from "@ab/engine";
import { MemorySessionStore } from "./session-store.js";
import type { ISessionStore, SessionRecord } from "./session-store.js";

export type SpectatorSend = (msg: unknown) => void;

export interface PlacementEntry {
  metaId: string;
  position: { row: number; col: number };
}

export interface GameSession {
  gameId: string;
  context: GameContext;
  adapters: Map<string, IPlayerAdapter>;
  /** spectatorId → send function (WebSocket write) */
  spectators: Map<string, SpectatorSend>;
  state: GameState;
  status: "waiting" | "running" | "ended";
  createdAt: number;
  /** Total number of players expected (used for auto-start logic) */
  expectedPlayerCount: number;
  /** Pre-game placement submissions: playerId → placed unit list */
  placements: Map<string, PlacementEntry[]>;
}

export class GameSessionManager {
  private readonly sessions = new Map<string, GameSession>();
  private readonly store: ISessionStore;

  constructor(store?: ISessionStore) {
    this.store = store ?? new MemorySessionStore();
  }

  createSession(
    gameId: string,
    context: GameContext,
    initialState: GameState,
    expectedPlayerCount?: number,
  ): GameSession {
    const session: GameSession = {
      gameId,
      context,
      adapters: new Map(),
      spectators: new Map(),
      state: initialState,
      status: "waiting",
      createdAt: Date.now(),
      expectedPlayerCount: expectedPlayerCount ?? Object.keys(initialState.players).length,
      placements: new Map(),
    };
    this.sessions.set(gameId, session);

    // Persist to store (async, fire-and-forget for now)
    const record: SessionRecord = {
      gameId,
      state: initialState,
      status: "waiting",
      playerIds: [],
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
    };
    void this.store.save(record);

    return session;
  }

  getSession(gameId: string): GameSession | undefined {
    return this.sessions.get(gameId);
  }

  addAdapter(gameId: string, adapter: IPlayerAdapter): boolean {
    const session = this.sessions.get(gameId);
    if (session === undefined) return false;
    session.adapters.set(adapter.playerId, adapter);
    return true;
  }

  updateState(gameId: string, state: GameState): void {
    const session = this.sessions.get(gameId);
    if (session !== undefined) {
      session.state = state;
      // Sync to persistent store
      void this.store.update(gameId, state);
    }
  }

  endSession(gameId: string): void {
    const session = this.sessions.get(gameId);
    if (session !== undefined) {
      session.status = "ended";
      void this.store.end(gameId);
    }
  }

  removeSession(gameId: string): void {
    this.sessions.delete(gameId);
    void this.store.delete(gameId);
  }

  addSpectator(gameId: string, spectatorId: string, send: SpectatorSend): boolean {
    const session = this.sessions.get(gameId);
    if (session === undefined) return false;
    session.spectators.set(spectatorId, send);
    return true;
  }

  removeSpectator(gameId: string, spectatorId: string): void {
    this.sessions.get(gameId)?.spectators.delete(spectatorId);
  }

  broadcastToSpectators(gameId: string, msg: unknown): void {
    const session = this.sessions.get(gameId);
    if (session === undefined) return;
    for (const send of session.spectators.values()) {
      try { send(msg); } catch { /* socket may be closed */ }
    }
  }

  listActiveSessions(): GameSession[] {
    return [...this.sessions.values()].filter((s) => s.status !== "ended");
  }

  /** Expose underlying store for server stats routes */
  getStore(): ISessionStore {
    return this.store;
  }
}
