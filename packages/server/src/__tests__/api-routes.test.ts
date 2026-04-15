/**
 * API Routes integration tests — actual Fastify HTTP requests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
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

// ─── Minimal test registry ─────────────────────────────────────────────────────

const TEST_REGISTRY = buildDataRegistry({
  units: [
    { id: "f1", nameKey: "u", descKey: "u", class: "fighter", faction: "a",
      baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn", skillIds: [], spriteKey: "s" },
  ],
  weapons: [
    { id: "wpn", nameKey: "w", descKey: "w", attackType: "melee", rangeType: "single",
      minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
  ],
  skills: [], effects: [],
  tiles: [
    { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
  ],
  maps: [
    {
      id: "map_2p", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 0, col: 0 }] },
        { playerId: 1, positions: [{ row: 10, col: 10 }] },
      ],
    },
  ],
});

async function buildTestServer() {
  const fastify = Fastify({ logger: false });
  await fastify.register(FastifyCors, { origin: true });
  await fastify.register(FastifyWs);

  const factory = new GameFactory(TEST_REGISTRY);
  const sessionManager = new GameSessionManager();
  const statsStore = new MemoryStatsStore();
  const tokenStore = new MemoryTokenStore();

  await registerRoutes(fastify, { sessionManager, factory, registry: TEST_REGISTRY, statsStore, tokenStore });
  await registerWsRoutes(fastify, { sessionManager, factory, registry: TEST_REGISTRY, statsStore });

  return { fastify, sessionManager, statsStore, tokenStore };
}

function authHeader(playerId: string) {
  return `Bearer ${createToken(playerId)}`;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("API Routes", () => {
  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBe("2.0.0");
      await fastify.close();
    });
  });

  describe("GET /api/v1/meta/units", () => {
    it("returns unit list without auth", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/api/v1/meta/units" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.units)).toBe(true);
      await fastify.close();
    });
  });

  describe("GET /api/v1/meta/units/:id", () => {
    it("returns 200 for known unit", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/api/v1/meta/units/f1" });
      expect(res.statusCode).toBe(200);
      await fastify.close();
    });

    it("returns 404 for unknown unit", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/api/v1/meta/units/nonexistent" });
      expect(res.statusCode).toBe(404);
      await fastify.close();
    });
  });

  describe("GET /api/v1/meta/maps", () => {
    it("returns map list without auth", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/api/v1/meta/maps" });
      expect(res.statusCode).toBe(200);
      await fastify.close();
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("returns access + refresh tokens for valid playerId", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { playerId: "player-1" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      expect(body.tokenType).toBe("Bearer");
      expect(body.expiresIn).toBe(900); // 15 min
      await fastify.close();
    });

    it("returns 400 for missing playerId", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    it("rotates refresh token and issues new access token", async () => {
      const { fastify, tokenStore } = await buildTestServer();

      const record = tokenStore.issue("p1");
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: record.token },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).not.toBe(record.token); // new token issued
      await fastify.close();
    });

    it("returns 401 for invalid refresh token", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: "invalid-token" },
      });
      expect(res.statusCode).toBe(401);
      await fastify.close();
    });
  });

  describe("POST /api/v1/rooms (protected)", () => {
    it("returns 401 without auth header", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms",
        payload: { mapId: "map_2p", playerCount: 2 },
      });
      expect(res.statusCode).toBe(401);
      await fastify.close();
    });

    it("creates room with valid auth and returns gameId", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms",
        headers: { authorization: authHeader("p1") },
        payload: { mapId: "map_2p", playerCount: 2 },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.gameId).toBeTruthy();
      expect(body.createdBy).toBe("p1");
      await fastify.close();
    });

    it("returns 400 for missing required fields", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms",
        headers: { authorization: authHeader("p1") },
        payload: { mapId: "map_2p" }, // missing playerCount
      });
      expect(res.statusCode).toBe(400);
      await fastify.close();
    });
  });

  describe("GET /api/v1/rooms (protected)", () => {
    it("returns 401 without auth", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/api/v1/rooms" });
      expect(res.statusCode).toBe(401);
      await fastify.close();
    });

    it("returns active rooms with auth", async () => {
      const { fastify } = await buildTestServer();
      // Create a room first
      await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms",
        headers: { authorization: authHeader("p1") },
        payload: { mapId: "map_2p", playerCount: 2 },
      });

      const res = await fastify.inject({
        method: "GET",
        url: "/api/v1/rooms",
        headers: { authorization: authHeader("p1") },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.rooms)).toBe(true);
      expect(body.rooms.length).toBeGreaterThanOrEqual(1);
      await fastify.close();
    });
  });

  describe("GET /api/v1/rooms/:gameId (protected)", () => {
    it("returns 404 for unknown room", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "GET",
        url: "/api/v1/rooms/nonexistent",
        headers: { authorization: authHeader("p1") },
      });
      expect(res.statusCode).toBe(404);
      await fastify.close();
    });

    it("returns room state for existing room", async () => {
      const { fastify } = await buildTestServer();

      const createRes = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms",
        headers: { authorization: authHeader("p1") },
        payload: { mapId: "map_2p", playerCount: 2 },
      });
      const { gameId } = createRes.json<{ gameId: string }>();

      const res = await fastify.inject({
        method: "GET",
        url: `/api/v1/rooms/${gameId}`,
        headers: { authorization: authHeader("p1") },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.gameId).toBe(gameId);
      await fastify.close();
    });
  });

  describe("GET /api/v1/stats/:playerId", () => {
    it("returns zero stats for unknown player (public)", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "GET",
        url: "/api/v1/stats/player-xyz",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.wins).toBe(0);
      expect(body.gamesPlayed).toBe(0);
      await fastify.close();
    });

    it("returns real stats after game is recorded", async () => {
      const { fastify, statsStore } = await buildTestServer();
      await statsStore.recordResult({
        gameId: "g1", winnerIds: ["player-w"], loserIds: ["player-l"],
        reason: "all_units_dead", rounds: 5,
        playerIds: ["player-w", "player-l"],
        startedAt: Date.now() - 10000, endedAt: Date.now(),
      });

      const res = await fastify.inject({
        method: "GET",
        url: "/api/v1/stats/player-w",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.wins).toBe(1);
      expect(body.gamesPlayed).toBe(1);
      await fastify.close();
    });
  });

  describe("GET /api/v1/stats/game/:gameId", () => {
    it("returns 404 for unknown game", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "GET",
        url: "/api/v1/stats/game/nonexistent",
      });
      expect(res.statusCode).toBe(404);
      await fastify.close();
    });

    it("returns game result when recorded", async () => {
      const { fastify, statsStore } = await buildTestServer();
      await statsStore.recordResult({
        gameId: "g-recorded", winnerIds: ["p1"], loserIds: ["p2"],
        reason: "surrender", rounds: 3,
        playerIds: ["p1", "p2"],
        startedAt: Date.now() - 5000, endedAt: Date.now(),
      });

      const res = await fastify.inject({
        method: "GET",
        url: "/api/v1/stats/game/g-recorded",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.gameId).toBe("g-recorded");
      expect(body.reason).toBe("surrender");
      await fastify.close();
    });
  });

  describe("GET /api/v1/leaderboard", () => {
    it("returns empty leaderboard when no games played", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({ method: "GET", url: "/api/v1/leaderboard" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.leaderboard)).toBe(true);
      expect(body.leaderboard).toHaveLength(0);
      await fastify.close();
    });

    it("returns ranked players sorted by wins", async () => {
      const { fastify, statsStore } = await buildTestServer();
      await statsStore.recordResult({
        gameId: "g1", winnerIds: ["alice"], loserIds: ["bob"],
        reason: "all_units_dead", rounds: 3, playerIds: ["alice", "bob"],
        startedAt: Date.now() - 5000, endedAt: Date.now(),
      });
      await statsStore.recordResult({
        gameId: "g2", winnerIds: ["alice"], loserIds: ["charlie"],
        reason: "all_units_dead", rounds: 4, playerIds: ["alice", "charlie"],
        startedAt: Date.now() - 3000, endedAt: Date.now(),
      });

      const res = await fastify.inject({ method: "GET", url: "/api/v1/leaderboard?limit=3" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ leaderboard: { playerId: string; rank: number; wins: number; winRate: number }[] }>();
      expect(body.leaderboard[0]!.playerId).toBe("alice");
      expect(body.leaderboard[0]!.wins).toBe(2);
      expect(body.leaderboard[0]!.rank).toBe(1);
      expect(body.leaderboard[0]!.winRate).toBe(100);
      await fastify.close();
    });
  });

  describe("POST /api/v1/rooms/:gameId/ai (protected)", () => {
    it("returns 404 for unknown game", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms/nonexistent/ai",
        headers: { authorization: authHeader("p1") },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      await fastify.close();
    });

    it("returns 401 without auth", async () => {
      const { fastify } = await buildTestServer();
      const res = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms/any-game/ai",
        payload: {},
      });
      expect(res.statusCode).toBe(401);
      await fastify.close();
    });

    it("adds AI player to waiting room", async () => {
      const { fastify } = await buildTestServer();

      // Create a room
      const createRes = await fastify.inject({
        method: "POST",
        url: "/api/v1/rooms",
        headers: { authorization: authHeader("p1") },
        payload: { mapId: "map_2p", playerCount: 2 },
      });
      const { gameId } = createRes.json<{ gameId: string }>();

      // Add AI
      const res = await fastify.inject({
        method: "POST",
        url: `/api/v1/rooms/${gameId}/ai`,
        headers: { authorization: authHeader("p1") },
        payload: { iterations: 10 },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.aiPlayerId).toMatch(/^ai_/);
      expect(body.gameId).toBe(gameId);
      await fastify.close();
    });
  });
});
