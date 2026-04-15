/**
 * Database migration script.
 * Creates PostgreSQL tables for AB server if they don't already exist.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host/db npx tsx scripts/migrate.ts
 *
 * Safe to run multiple times (all statements use IF NOT EXISTS / DO NOTHING).
 */
import { Pool } from "pg";

const DATABASE_URL = process.env["DATABASE_URL"];

if (DATABASE_URL === undefined || DATABASE_URL === "") {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10_000,
});

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "create_migrations_table",
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  },
  {
    name: "create_game_results",
    sql: `
      CREATE TABLE IF NOT EXISTS game_results (
        game_id     TEXT        PRIMARY KEY,
        winner_ids  TEXT[]      NOT NULL DEFAULT '{}',
        loser_ids   TEXT[]      NOT NULL DEFAULT '{}',
        reason      TEXT        NOT NULL,
        rounds      INT         NOT NULL,
        started_at  TIMESTAMPTZ NOT NULL,
        ended_at    TIMESTAMPTZ NOT NULL,
        player_ids  TEXT[]      NOT NULL DEFAULT '{}'
      )
    `,
  },
  {
    name: "create_player_stats",
    sql: `
      CREATE TABLE IF NOT EXISTS player_stats (
        player_id   TEXT        PRIMARY KEY,
        wins        INT         NOT NULL DEFAULT 0,
        losses      INT         NOT NULL DEFAULT 0,
        draws       INT         NOT NULL DEFAULT 0,
        rating      INT         NOT NULL DEFAULT 1000,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  },
  {
    name: "idx_game_results_player_ids",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_game_results_player_ids
        ON game_results USING GIN (player_ids)
    `,
  },
  {
    name: "idx_player_stats_wins",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_player_stats_wins
        ON player_stats (wins DESC)
    `,
  },
];

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("Connected to database.");

    // Ensure migrations table exists first (before checking applied)
    await client.query(MIGRATIONS[0]!.sql);
    console.log("  ✓ migrations table ready");

    for (const migration of MIGRATIONS.slice(1)) {
      // Check if already applied
      const { rows } = await client.query(
        "SELECT 1 FROM migrations WHERE name = $1",
        [migration.name],
      );

      if (rows.length > 0) {
        console.log(`  ─ skipped (already applied): ${migration.name}`);
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [migration.name],
      );
      console.log(`  ✓ applied: ${migration.name}`);
    }

    console.log("\nMigration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err: unknown) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
