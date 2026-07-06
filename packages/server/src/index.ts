/**
 * Server entry point — Fastify + WebSocket + REST API.
 *
 * Usage:
 *   node packages/server/dist/index.js [--port 3000] [--host 0.0.0.0]
 *
 * CLI arguments (take precedence over environment variables):
 *   --port <n>       — HTTP port (default: PORT env var or 3000)
 *   --host <addr>    — bind host (default: HOST env var or 0.0.0.0)
 *
 * Environment variables:
 *   PORT             — HTTP port (default 3000)
 *   HOST             — bind host (default 0.0.0.0)
 *   REDIS_URL        — Redis connection URL (enables RedisSessionStore + RedisTokenStore)
 *   DATABASE_URL     — PostgreSQL connection string (enables PostgresStatsStore)
 *   REDIS_SESSION_TTL_S  — Redis session TTL in seconds (default 86400)
 *   REFRESH_TOKEN_TTL_S  — Refresh token TTL in seconds (default 604800 = 7 days)
 *   PG_POOL_SIZE     — PostgreSQL pool size (default 10)
 */
import Fastify from "fastify";
import FastifyWs from "@fastify/websocket";
import FastifyCors from "@fastify/cors";

import { buildDataRegistry, DataRegistry } from "@ab/metadata";
import { GameFactory } from "@ab/engine";
import { GameSessionManager } from "./session/game-session-manager.js";
import { MemorySessionStore, RedisSessionStore } from "./session/session-store.js";
import { MemoryStatsStore, PostgresStatsStore } from "./session/stats-store.js";
import { MemoryReplayStore, PostgresReplayStore } from "./session/replay-store.js";
import { MemoryTokenStore } from "./auth/token-store.js";
import { RedisTokenStore } from "./auth/redis-token-store.js";
import { registerRoutes } from "./api/routes.js";
import { registerWsRoutes } from "./ws/ws-server.js";

// ─── Load metadata ─────────────────────────────────────────────────────────────

import { createRequire } from "module";
const require = createRequire(import.meta.url);

function loadRegistry(): DataRegistry {
  const reg = new DataRegistry();

  try {
    const units                 = require("../../metadata/data/units.json")                         as unknown[];
    const weapons               = require("../../metadata/data/weapons.json")                      as unknown[];
    const skills                = require("../../metadata/data/skills.json")                       as unknown[];
    const effects               = require("../../metadata/data/effects.json")                      as unknown[];
    const tiles                 = require("../../metadata/data/tiles.json")                        as unknown[];
    const elementalReactions    = require("../../metadata/data/elemental-reactions.json")          as unknown[];
    const unitPassives          = require("../../metadata/data/unit-passives.json")                as unknown[];
    const dialogueCharacters    = require("../../metadata/data/dialogue/characters.json")          as unknown[];
    const unitDialogueBindings  = require("../../metadata/data/dialogue/unit-bindings.json")       as unknown[];
    const map01                 = require("../../metadata/data/maps/test-map-01.json")             as unknown;
    const map1v1_6v6            = require("../../metadata/data/maps/map-1v1-6v6.json")             as unknown;
    const map2v2_6v6            = require("../../metadata/data/maps/map-2v2-6v6.json")             as unknown;

    reg.loadUnits(units);
    reg.loadWeapons(weapons);
    reg.loadSkills(skills);
    reg.loadEffects(effects);
    reg.loadTiles(tiles);
    reg.loadElementalReactions(elementalReactions);
    reg.loadUnitPassives(unitPassives);
    reg.loadDialogueCharacters(dialogueCharacters);
    reg.loadUnitDialogueBindings(unitDialogueBindings);
    reg.loadMaps([map01, map1v1_6v6, map2v2_6v6]);
  } catch (e) {
    console.warn("Metadata JSON load failed (expected during unit tests):", e);
  }

  return reg;
}

// ─── Store factory helpers ────────────────────────────────────────────────────

async function createSessionStore() {
  // Use REDIS_URL env var if set; otherwise default to local Redis
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: Ioredis } = require("ioredis") as typeof import("ioredis");
    const probe = new Ioredis(redisUrl, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 1 });
    await probe.ping();
    await probe.quit();
    console.info(`[server] Redis 연결 성공 → RedisSessionStore (${redisUrl})`);
    return new RedisSessionStore(redisUrl);
  } catch {
    console.warn("[server] Redis 연결 실패 → MemorySessionStore로 폴백 (단일 인스턴스 모드)");
    return new MemorySessionStore();
  }
}

function createStatsStore() {
  const dbUrl = process.env["DATABASE_URL"];
  if (dbUrl !== undefined && dbUrl !== "") {
    console.info("[server] Using PostgresStatsStore");
    return new PostgresStatsStore(dbUrl);
  }
  console.info("[server] Using MemoryStatsStore");
  return new MemoryStatsStore();
}

function createTokenStore() {
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl !== undefined && redisUrl !== "") {
    console.info("[server] Using RedisTokenStore");
    return new RedisTokenStore(redisUrl);
  }
  console.info("[server] Using MemoryTokenStore");
  return new MemoryTokenStore();
}

function createReplayStore() {
  const dbUrl = process.env["DATABASE_URL"];
  if (dbUrl !== undefined && dbUrl !== "") {
    console.info("[server] Using PostgresReplayStore");
    return new PostgresReplayStore(dbUrl);
  }
  console.info("[server] Using MemoryReplayStore");
  return new MemoryReplayStore();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function buildServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(FastifyCors, { origin: true });
  await fastify.register(FastifyWs);

  const registry     = loadRegistry();
  const factory      = new GameFactory(registry);
  const sessionStore = await createSessionStore();
  const statsStore   = createStatsStore();
  const tokenStore   = createTokenStore();

  const replayStore   = createReplayStore();
  const sessionManager = new GameSessionManager(sessionStore);

  // Graceful shutdown: close connections before exit
  const cleanup = async () => {
    if (sessionStore instanceof RedisSessionStore) {
      await sessionStore.quit().catch(() => {/* ignore */});
    }
    if (statsStore instanceof PostgresStatsStore) {
      await statsStore.end().catch(() => {/* ignore */});
    }
    if (tokenStore instanceof RedisTokenStore) {
      await tokenStore.quit().catch(() => {/* ignore */});
    }
    if (replayStore instanceof PostgresReplayStore) {
      await replayStore.end().catch(() => {/* ignore */});
    }
  };

  fastify.addHook("onClose", async () => {
    await cleanup();
  });

  const deps = { sessionManager, factory, registry, statsStore, tokenStore, replayStore };

  await registerRoutes(fastify, deps);
  await registerWsRoutes(fastify, { sessionManager, factory, registry, statsStore, replayStore });

  return fastify;
}

// ─── CLI argument parser ──────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== undefined && arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (process.env["NODE_ENV"] !== "test") {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  const port = Number(cliArgs["port"] ?? process.env["PORT"] ?? 3000);
  const host = cliArgs["host"] ?? process.env["HOST"] ?? "0.0.0.0";

  const server = await buildServer();
  await server.listen({ port, host });
  server.log.info(`Server running at http://${host}:${port}`);
}
