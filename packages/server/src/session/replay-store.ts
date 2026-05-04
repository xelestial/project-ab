/**
 * IReplayStore — persists per-game action logs for replay playback.
 * Implementations:
 *   - MemoryReplayStore   : in-memory (test / single-server)
 *   - PostgresReplayStore : PostgreSQL JSONB column (production)
 *
 * PostgreSQL schema (add to migrate.ts):
 *
 *   CREATE TABLE IF NOT EXISTS game_replays (
 *     game_id    TEXT PRIMARY KEY,
 *     entries    JSONB        NOT NULL DEFAULT '[]',
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * Environment:
 *   DATABASE_URL  — PostgreSQL connection string
 *   PG_POOL_SIZE  — max pool connections (default: 10)
 */

import type { LogEntry } from "@ab/engine";
import type { Pool as PgPool, PoolConfig } from "pg";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IReplayStore {
  saveLog(gameId: string, entries: LogEntry[]): Promise<void>;
  getLog(gameId: string): Promise<LogEntry[] | undefined>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────

export class MemoryReplayStore implements IReplayStore {
  private readonly store = new Map<string, LogEntry[]>();

  async saveLog(gameId: string, entries: LogEntry[]): Promise<void> {
    this.store.set(gameId, entries);
  }

  async getLog(gameId: string): Promise<LogEntry[] | undefined> {
    return this.store.get(gameId);
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────────────────

const PG_POOL_SIZE = Number(process.env["PG_POOL_SIZE"] ?? 10);

export class PostgresReplayStore implements IReplayStore {
  private readonly pool: PgPool | null;

  constructor(connectionString: string = process.env["DATABASE_URL"] ?? "") {
    if (connectionString === "") {
      console.warn("[PostgresReplayStore] DATABASE_URL not set — replay persistence disabled.");
      this.pool = null;
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    const config: PoolConfig = {
      connectionString,
      max: PG_POOL_SIZE,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
    this.pool = new Pool(config);

    this.pool.on("error", (err: Error) => {
      console.error("[PostgresReplayStore] pool error:", err.message);
    });
  }

  async saveLog(gameId: string, entries: LogEntry[]): Promise<void> {
    if (this.pool === null) return;
    await this.pool.query(
      `INSERT INTO game_replays (game_id, entries)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (game_id) DO UPDATE SET entries = $2::jsonb`,
      [gameId, JSON.stringify(entries)],
    );
  }

  async getLog(gameId: string): Promise<LogEntry[] | undefined> {
    if (this.pool === null) return undefined;
    const { rows } = await this.pool.query<{ entries: LogEntry[] }>(
      "SELECT entries FROM game_replays WHERE game_id = $1",
      [gameId],
    );
    if (rows.length === 0) return undefined;
    return rows[0]!.entries;
  }

  async end(): Promise<void> {
    await this.pool?.end();
  }
}
