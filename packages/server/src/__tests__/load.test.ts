/**
 * Lightweight load / concurrency tests.
 *
 * These tests spin up a real Fastify instance and fire concurrent HTTP
 * requests to measure that the server handles parallel room creation and
 * stats queries without errors or data races.
 *
 * They are NOT benchmark assertions (timing is CI-unreliable) — they verify
 * correctness under concurrency: no crashes, no corrupt state.
 */
import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import FastifyCors from "@fastify/cors";
import FastifyWs from "@fastify/websocket";
import { buildDataRegistry } from "@ab/metadata";
import { GameFactory } from "@ab/engine";
import { GameSessionManager } from "../session/game-session-manager.js";
import { MemoryStatsStore } from "../session/stats-store.js";
import { MemoryTokenStore } from "../auth/token-store.js";
import { createToken } from "../auth/jwt-auth.js";
import { registerRoutes } from "../api/routes.js";
import { registerWsRoutes } from "../ws/ws-server.js";

// ─── Minimal registry ─────────────────────────────────────────────────────────

const REGISTRY = buildDataRegistry({
  units: [
    { id: "u1", nameKey: "u", descKey: "u", class: "fighter", faction: "a",
      baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "w1", skillIds: [], spriteKey: "s" },
  ],
  weapons: [
    { id: "w1", nameKey: "w", descKey: "w", attackType: "melee", rangeType: "single",
      minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
  ],
  skills: [], effects: [], tiles: [],
  maps: [
    {
      id: "map_2p", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 0, col: 0 }] },
        { playerId: 1, positions: [{ row: 5, col: 5 }] },
      ],
    },
  ],
});

async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  await fastify.register(FastifyCors, { origin: true });
  await fastify.register(FastifyWs);

  const factory = new GameFactory(REGISTRY);
  const sessionManager = new GameSessionManager();
  const statsStore = new MemoryStatsStore();
  const tokenStore = new MemoryTokenStore();

  await registerRoutes(fastify, { sessionManager, factory, registry: REGISTRY, statsStore, tokenStore });
  await registerWsRoutes(fastify, { sessionManager, factory, registry: REGISTRY, statsStore });
  return fastify;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Concurrent load — no data races", () => {
  let fastify: FastifyInstance;

  afterEach(async () => {
    await fastify?.close();
  });

  it("동시 방 생성 20개 — 모두 201 반환, 중복 gameId 없음", async () => {
    fastify = await buildServer();
    const CONCURRENCY = 20;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        fastify.inject({
          method: "POST",
          url: "/api/v1/rooms",
          headers: { authorization: `Bearer ${createToken(`player-${i}`)}` },
          payload: { mapId: "map_2p", playerCount: 2 },
        }),
      ),
    );

    const codes = results.map((r) => r.statusCode);
    expect(codes.every((c) => c === 201)).toBe(true);

    const gameIds = results.map((r) => r.json<{ gameId: string }>().gameId);
    const unique = new Set(gameIds);
    expect(unique.size).toBe(CONCURRENCY); // 모든 gameId 고유
  });

  it("동시 통계 조회 50개 — 모두 200 반환", async () => {
    fastify = await buildServer();
    const CONCURRENCY = 50;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        fastify.inject({
          method: "GET",
          url: `/api/v1/stats/player-${i % 10}`,
        }),
      ),
    );

    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });

  it("방 생성 후 동시 조회 — 일관된 상태 반환", async () => {
    fastify = await buildServer();

    // Create a room
    const createRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: { authorization: `Bearer ${createToken("host")}` },
      payload: { mapId: "map_2p", playerCount: 2 },
    });
    const { gameId } = createRes.json<{ gameId: string }>();

    // Fetch same room concurrently
    const CONCURRENCY = 30;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        fastify.inject({
          method: "GET",
          url: `/api/v1/rooms/${gameId}`,
          headers: { authorization: `Bearer ${createToken("viewer")}` },
        }),
      ),
    );

    expect(results.every((r) => r.statusCode === 200)).toBe(true);

    // All responses must return the same gameId
    const ids = results.map((r) => r.json<{ gameId: string }>().gameId);
    expect(ids.every((id) => id === gameId)).toBe(true);
  });

  it("MemoryStatsStore 동시 recordResult — 집계 정확", async () => {
    const store = new MemoryStatsStore();
    const GAMES = 100;

    await Promise.all(
      Array.from({ length: GAMES }, (_, i) =>
        store.recordResult({
          gameId: `g${i}`,
          winnerIds: ["alice"],
          loserIds: ["bob"],
          reason: "all_units_dead",
          rounds: 5,
          playerIds: ["alice", "bob"],
          startedAt: Date.now() - 1000,
          endedAt: Date.now(),
        }),
      ),
    );

    const alice = await store.getPlayerStats("alice");
    const bob = await store.getPlayerStats("bob");

    expect(alice.wins).toBe(GAMES);
    expect(alice.losses).toBe(0);
    expect(bob.losses).toBe(GAMES);
    expect(bob.wins).toBe(0);
  });

  it("동시 로그인 10명 — 각자 고유 refresh token 발급", async () => {
    fastify = await buildServer();
    const CONCURRENCY = 10;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { playerId: `player-${i}` },
        }),
      ),
    );

    expect(results.every((r) => r.statusCode === 200)).toBe(true);

    const refreshTokens = results.map((r) => r.json<{ refreshToken: string }>().refreshToken);
    const unique = new Set(refreshTokens);
    expect(unique.size).toBe(CONCURRENCY);
  });
});
