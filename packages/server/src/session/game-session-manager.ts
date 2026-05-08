/**
 * GameSessionManager — manages active game sessions.
 *
 * In-memory: GameContext (validators, resolvers), WebSocket adapters, spectators.
 * Redis (via ISessionStore): GameState snapshots, placements, room metadata.
 *
 * Session recovery: if a session is not in memory (server restart) but exists in
 * the store (status "waiting"), it can be reconstructed via recoverFromStore().
 */
import type { GameState } from "@ab/metadata";
import type { IPlayerAdapter, GameContext, GameFactory } from "@ab/engine";
import { MemorySessionStore } from "./session-store.js";
import type { ISessionStore, SessionRecord, PlacementEntry } from "./session-store.js";

export type SpectatorSend = (msg: unknown) => void;

// Re-export PlacementEntry so routes/ws-server only import from this module
export type { PlacementEntry };

export interface GameSession {
  gameId: string;
  context: GameContext;
  adapters: Map<string, IPlayerAdapter>;
  /** spectatorId → send function (WebSocket write) */
  spectators: Map<string, SpectatorSend>;
  state: GameState;
  status: "waiting" | "running" | "ended";
  createdAt: number;
  /** Map ID (stored for recovery / listing) */
  mapId: string;
  /** Total number of players expected (used for auto-start logic) */
  expectedPlayerCount: number;
  /** Pre-game placement submissions: playerId → placed unit list (mirrored from store) */
  placements: Map<string, PlacementEntry[]>;
  /**
   * Transient placement-phase selection: playerId → metaIds currently selected/placed.
   * Broadcast to teammates in real-time; not persisted to the store.
   */
  selectionMap: Map<string, string[]>;
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
    expectedPlayerCount: number,
    mapId: string,
  ): GameSession {
    const session: GameSession = {
      gameId,
      context,
      adapters: new Map(),
      spectators: new Map(),
      state: initialState,
      status: "waiting",
      createdAt: Date.now(),
      mapId,
      expectedPlayerCount,
      placements: new Map(),
      selectionMap: new Map(),
    };
    this.sessions.set(gameId, session);

    const record: SessionRecord = {
      gameId,
      state: initialState,
      status: "waiting",
      playerIds: [],
      mapId,
      expectedPlayerCount,
      placements: {},
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
    };
    void this.store.save(record);

    return session;
  }

  /**
   * Rebuild a GameSession from a persisted SessionRecord (e.g. after server restart).
   * Only viable for "waiting" sessions — running sessions cannot be resumed this way.
   */
  async recoverFromStore(gameId: string, factory: GameFactory): Promise<GameSession | undefined> {
    const record = await this.store.get(gameId);
    if (record === undefined || record.status === "ended") return undefined;

    // If already in memory, just return it
    const existing = this.sessions.get(gameId);
    if (existing !== undefined) return existing;

    const context = factory.createContext();
    const placements = new Map<string, PlacementEntry[]>(
      Object.entries(record.placements),
    );

    const session: GameSession = {
      gameId,
      context,
      adapters: new Map(),
      spectators: new Map(),
      state: record.state,
      status: record.status,
      createdAt: record.createdAt,
      mapId: record.mapId,
      expectedPlayerCount: record.expectedPlayerCount,
      placements,
      selectionMap: new Map(),
    };
    this.sessions.set(gameId, session);
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
      const playerIds = Object.keys(state.players);
      void this.store.update(gameId, state, playerIds);
    }
  }

  /** Persist a placement both in-memory and in the store. */
  async savePlacement(gameId: string, playerId: string, entries: PlacementEntry[]): Promise<void> {
    const session = this.sessions.get(gameId);
    if (session !== undefined) {
      session.placements.set(playerId, entries);
    }
    await this.store.savePlacement(gameId, playerId, entries);
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

  /** In-memory active sessions (does not query the store). */
  listActiveSessions(): GameSession[] {
    return [...this.sessions.values()].filter((s) => s.status !== "ended");
  }

  /** Expose underlying store — routes use this for Redis-backed room listing. */
  getStore(): ISessionStore {
    return this.store;
  }
}
