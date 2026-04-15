/**
 * Server entry point — Fastify + WebSocket + REST API.
 *
 * Usage:
 *   pnpm -F @ab/server build && node packages/server/dist/index.js
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
    const units        = require("../../metadata/data/units.json")                  as unknown[];
    const weapons      = require("../../metadata/data/weapons.json")               as unknown[];
    const skills       = require("../../metadata/data/skills.json")                as unknown[];
    const effects      = require("../../metadata/data/effects.json")               as unknown[];
    const tiles        = require("../../metadata/data/tiles.json")                 as unknown[];
    const map01        = require("../../metadata/data/maps/test-map-01.json")      as unknown;
    const map1v1_6v6   = require("../../metadata/data/maps/map-1v1-6v6.json")      as unknown;
    const map2v2_6v6   = require("../../metadata/data/maps/map-2v2-6v6.json")      as unknown;

    reg.loadUnits(units);
    reg.loadWeapons(weapons);
    reg.loadSkills(skills);
    reg.loadEffects(effects);
    reg.loadTiles(tiles);
    reg.loadMaps([map01, map1v1_6v6, map2v2_6v6]);
  } catch (e) {
    console.warn("Metadata JSON load failed (expected during unit tests):", e);
  }

  return reg;
}

// ─── Store factory helpers ────────────────────────────────────────────────────

function createSessionStore() {
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl !== undefined && redisUrl !== "") {
    console.info(`[server] Using RedisSessionStore (${redisUrl})`);
    return new RedisSessionStore(redisUrl);
  }
  console.info("[server] Using MemorySessionStore");
  return new MemorySessionStore();
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

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function buildServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(FastifyCors, { origin: true });
  await fastify.register(FastifyWs);

  const registry     = loadRegistry();
  const factory      = new GameFactory(registry);
  const sessionStore = createSessionStore();
  const statsStore   = createStatsStore();
  const tokenStore   = createTokenStore();

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
  };

  fastify.addHook("onClose", async () => {
    await cleanup();
  });

  const deps = { sessionManager, factory, registry, statsStore, tokenStore };

  await registerRoutes(fastify, deps);
  await registerWsRoutes(fastify, { sessionManager, factory, registry, statsStore });

  return fastify;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (process.env["NODE_ENV"] !== "test") {
  const port = Number(process.env["PORT"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";

  const server = await buildServer();
  await server.listen({ port, host });
  server.log.info(`Server running at http://${host}:${port}`);
}
