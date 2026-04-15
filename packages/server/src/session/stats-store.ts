/**
 * IStatsStore — abstraction layer for game statistics persistence.
 * Implementations:
 *   - MemoryStatsStore  : in-memory (test / single-server)
 *   - PostgresStatsStore: PostgreSQL (production)
 *
 * PostgreSQL schema (run once before starting):
 *
 *   CREATE TABLE IF NOT EXISTS game_results (
 *     game_id     TEXT PRIMARY KEY,
 *     winner_ids  TEXT[]      NOT NULL DEFAULT '{}',
 *     loser_ids   TEXT[]      NOT NULL DEFAULT '{}',
 *     reason      TEXT        NOT NULL,
 *     rounds      INT         NOT NULL,
 *     started_at  TIMESTAMPTZ NOT NULL,
 *     ended_at    TIMESTAMPTZ NOT NULL,
 *     player_ids  TEXT[]      NOT NULL DEFAULT '{}'
 *   );
 *
 *   CREATE TABLE IF NOT EXISTS player_stats (
 *     player_id   TEXT PRIMARY KEY,
 *     wins        INT NOT NULL DEFAULT 0,
 *     losses      INT NOT NULL DEFAULT 0,
 *     draws       INT NOT NULL DEFAULT 0,
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * Environment:
 *   DATABASE_URL  — PostgreSQL connection string
 *   PG_POOL_SIZE  — max pool connections (default: 10)
 */

import type { Pool as PgPool, PoolConfig } from "pg";
import { calculateElo, ELO_INITIAL } from "./elo.js";

// ─── Data shapes ──────────────────────────────────────────────────────────────

export interface GameResult {
  gameId: string;
  winnerIds: string[];
  loserIds: string[];
  reason: string;
  rounds: number;
  playerIds: string[];
  startedAt: number;
  endedAt: number;
}

export interface PlayerStats {
  playerId: string;
  wins: number;
  losses: number;
  draws: number;
  /** ELO rating (default: 1000) */
  rating: number;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IStatsStore {
  recordResult(result: GameResult): Promise<void>;
  getPlayerStats(playerId: string): Promise<PlayerStats>;
  getGameResult(gameId: string): Promise<GameResult | undefined>;
  /** Top players sorted by wins DESC, then losses ASC. */
  getLeaderboard(limit: number): Promise<PlayerStats[]>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────

export class MemoryStatsStore implements IStatsStore {
  private readonly results = new Map<string, GameResult>();
  private readonly playerStats = new Map<string, PlayerStats>();

  async recordResult(result: GameResult): Promise<void> {
    this.results.set(result.gameId, result);

    // Calculate ELO changes
    const eloInputs = result.playerIds.map((pid) => {
      const s = this.playerStats.get(pid);
      return {
        playerId: pid,
        rating: s?.rating ?? ELO_INITIAL,
        gamesPlayed: (s?.wins ?? 0) + (s?.losses ?? 0) + (s?.draws ?? 0),
      };
    });
    const eloResults = calculateElo(eloInputs, result.winnerIds);
    const eloMap = new Map(eloResults.map((r) => [r.playerId, r.newRating]));

    for (const playerId of result.playerIds) {
      const existing = this.playerStats.get(playerId) ?? {
        playerId, wins: 0, losses: 0, draws: 0, rating: ELO_INITIAL,
      };

      if (result.winnerIds.length === 0) {
        existing.draws += 1;
      } else if (result.winnerIds.includes(playerId)) {
        existing.wins += 1;
      } else {
        existing.losses += 1;
      }

      existing.rating = eloMap.get(playerId) ?? existing.rating;
      this.playerStats.set(playerId, existing);
    }
  }

  async getPlayerStats(playerId: string): Promise<PlayerStats> {
    return this.playerStats.get(playerId) ?? { playerId, wins: 0, losses: 0, draws: 0, rating: ELO_INITIAL };
  }

  async getGameResult(gameId: string): Promise<GameResult | undefined> {
    return this.results.get(gameId);
  }

  async getLeaderboard(limit: number): Promise<PlayerStats[]> {
    return [...this.playerStats.values()]
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
      .slice(0, limit);
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────────────────

const PG_POOL_SIZE = Number(process.env["PG_POOL_SIZE"] ?? 10);

export class PostgresStatsStore implements IStatsStore {
  private readonly pool: PgPool | null;

  constructor(
    connectionString: string = process.env["DATABASE_URL"] ?? "",
  ) {
    if (connectionString === "") {
      console.warn(
        "[PostgresStatsStore] DATABASE_URL not set — stats persistence disabled.",
      );
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
      console.error("[PostgresStatsStore] pool error:", err.message);
    });
  }

  async recordResult(result: GameResult): Promise<void> {
    if (this.pool === null) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert game result row
      await client.query(
        `INSERT INTO game_results
           (game_id, winner_ids, loser_ids, reason, rounds, started_at, ended_at, player_ids)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), $8)
         ON CONFLICT (game_id) DO NOTHING`,
        [
          result.gameId,
          result.winnerIds,
          result.loserIds,
          result.reason,
          result.rounds,
          result.startedAt,
          result.endedAt,
          result.playerIds,
        ],
      );

      // Fetch current ratings for ELO calculation
      const { rows: statRows } = await client.query<{
        player_id: string; wins: number; losses: number; draws: number; rating: number;
      }>(
        "SELECT player_id, wins, losses, draws, rating FROM player_stats WHERE player_id = ANY($1)",
        [result.playerIds],
      );
      const statMap = new Map(statRows.map((r) => [r.player_id, r]));

      const eloInputs = result.playerIds.map((pid) => {
        const s = statMap.get(pid);
        return {
          playerId: pid,
          rating: s?.rating ?? ELO_INITIAL,
          gamesPlayed: (s?.wins ?? 0) + (s?.losses ?? 0) + (s?.draws ?? 0),
        };
      });
      const eloResults = calculateElo(eloInputs, result.winnerIds);
      const newRatings = new Map(eloResults.map((r) => [r.playerId, r.newRating]));

      // Upsert per-player stats
      for (const playerId of result.playerIds) {
        const col =
          result.winnerIds.length === 0
            ? "draws"
            : result.winnerIds.includes(playerId)
              ? "wins"
              : "losses";
        const newRating = newRatings.get(playerId) ?? ELO_INITIAL;

        await client.query(
          `INSERT INTO player_stats (player_id, ${col}, rating, updated_at)
           VALUES ($1, 1, $2, NOW())
           ON CONFLICT (player_id)
           DO UPDATE SET ${col} = player_stats.${col} + 1, rating = $2, updated_at = NOW()`,
          [playerId, newRating],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getPlayerStats(playerId: string): Promise<PlayerStats> {
    if (this.pool === null) return { playerId, wins: 0, losses: 0, draws: 0, rating: ELO_INITIAL };
    const { rows } = await this.pool.query<{ wins: number; losses: number; draws: number; rating: number }>(
      "SELECT wins, losses, draws, rating FROM player_stats WHERE player_id = $1",
      [playerId],
    );
    if (rows.length === 0) return { playerId, wins: 0, losses: 0, draws: 0, rating: ELO_INITIAL };
    const row = rows[0]!;
    return { playerId, wins: row.wins, losses: row.losses, draws: row.draws, rating: row.rating };
  }

  async getGameResult(gameId: string): Promise<GameResult | undefined> {
    if (this.pool === null) return undefined;
    const { rows } = await this.pool.query<{
      game_id: string;
      winner_ids: string[];
      loser_ids: string[];
      reason: string;
      rounds: number;
      player_ids: string[];
      started_at: Date;
      ended_at: Date;
    }>(
      `SELECT game_id, winner_ids, loser_ids, reason, rounds, player_ids,
              EXTRACT(EPOCH FROM started_at) * 1000 AS started_at,
              EXTRACT(EPOCH FROM ended_at)   * 1000 AS ended_at
       FROM game_results WHERE game_id = $1`,
      [gameId],
    );
    if (rows.length === 0) return undefined;
    const r = rows[0]!;
    return {
      gameId: r.game_id,
      winnerIds: r.winner_ids,
      loserIds: r.loser_ids,
      reason: r.reason,
      rounds: r.rounds,
      playerIds: r.player_ids,
      startedAt: Number(r.started_at),
      endedAt: Number(r.ended_at),
    };
  }

  async getLeaderboard(limit: number): Promise<PlayerStats[]> {
    if (this.pool === null) return [];
    const { rows } = await this.pool.query<{
      player_id: string;
      wins: number;
      losses: number;
      draws: number;
      rating: number;
    }>(
      `SELECT player_id, wins, losses, draws, rating
       FROM player_stats
       ORDER BY rating DESC, wins DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      playerId: r.player_id,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      rating: r.rating,
    }));
  }

  async end(): Promise<void> {
    await this.pool?.end();
  }
}
