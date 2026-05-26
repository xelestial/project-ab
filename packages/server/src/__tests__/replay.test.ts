/**
 * Replay system tests — ReplayStore + API endpoint + ReplayAdapter.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import FastifyCors from "@fastify/cors";
import FastifyWs from "@fastify/websocket";
import { buildDataRegistry } from "@ab/metadata";
import { GameFactory } from "@ab/engine";
import { ReplayAdapter } from "@ab/ai";
import { GameSessionManager } from "../session/game-session-manager.js";
import { MemoryStatsStore } from "../session/stats-store.js";
import { MemoryTokenStore } from "../auth/token-store.js";
import { MemoryReplayStore } from "../session/replay-store.js";
import { createToken } from "../auth/jwt-auth.js";
import { registerRoutes } from "../api/routes.js";
import { registerWsRoutes } from "../ws/ws-server.js";
import type { GameLogEntry, ActionEntry } from "@ab/engine";

// ─── Minimal test registry ─────────────────────────────────────────────────────

const TEST_REGISTRY = buildDataRegistry({
  units: [
    {
      id: "f1", nameKey: "u", descKey: "u", class: "fighter", faction: "a",
      baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn", skillIds: [], spriteKey: "s",
    },
  ],
  weapons: [
    {
      id: "wpn", nameKey: "w", descKey: "w", attackType: "melee", rangeType: "single",
      minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false,
    },
  ],
  skills: [], effects: [],
  tiles: [
    {
      id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t",
      moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0,
    },
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

async function buildTestServer(replayStore: MemoryReplayStore) {
  const fastify = Fastify({ logger: false });
  await fastify.register(FastifyCors, { origin: true });
  await fastify.register(FastifyWs);

  const factory = new GameFactory(TEST_REGISTRY);
  const sessionManager = new GameSessionManager();
  const statsStore = new MemoryStatsStore();
  const tokenStore = new MemoryTokenStore();

  await registerRoutes(fastify, {
    sessionManager,
    factory,
    registry: TEST_REGISTRY,
    statsStore,
    tokenStore,
    replayStore,
  });
  await registerWsRoutes(fastify, {
    sessionManager,
    factory,
    registry: TEST_REGISTRY,
    statsStore,
    replayStore,
  });

  return fastify;
}

// ─── Helper: build a minimal ActionEntry ─────────────────────────────────────

function makeActionEntry(
  overrides: Partial<ActionEntry> & { playerId: string; actionType: string },
): ActionEntry {
  return {
    seq: 1,
    type: "action",
    timestamp: 1000,
    gameId: "g1",
    round: 1,
    turnIndex: 0,
    unitId: "u1",
    outcomes: [],
    tilesChanged: [],
    accepted: true,
    ...overrides,
  };
}

// ─── MemoryReplayStore ────────────────────────────────────────────────────────

describe("MemoryReplayStore", () => {
  let store: MemoryReplayStore;

  beforeEach(() => {
    store = new MemoryReplayStore();
  });

  it("returns undefined for unknown gameId", async () => {
    expect(await store.getLog("no-such-game")).toBeUndefined();
  });

  it("saves and retrieves a log", async () => {
    const entries: GameLogEntry[] = [
      makeActionEntry({
        seq: 1,
        playerId: "p1",
        actionType: "move",
        movedFrom: { row: 0, col: 0 },
        movedTo: { row: 1, col: 0 },
      }),
    ];
    await store.saveLog("g1", entries);
    const retrieved = await store.getLog("g1");
    expect(retrieved).toHaveLength(1);
    expect((retrieved![0] as ActionEntry).actionType).toBe("move");
    expect((retrieved![0] as ActionEntry).movedTo).toEqual({ row: 1, col: 0 });
  });

  it("overwrites an existing log on re-save", async () => {
    await store.saveLog("g1", [makeActionEntry({ playerId: "p1", actionType: "pass" })]);
    await store.saveLog("g1", []);
    expect(await store.getLog("g1")).toHaveLength(0);
  });
});

// ─── GET /api/v1/replays/:gameId ──────────────────────────────────────────────

describe("GET /api/v1/replays/:gameId", () => {
  it("returns 404 when replay does not exist", async () => {
    const replayStore = new MemoryReplayStore();
    const app = await buildTestServer(replayStore);

    const res = await app.inject({ method: "GET", url: "/api/v1/replays/no-such-game" });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe("Replay not found");
  });

  it("returns 200 with entries when replay exists", async () => {
    const replayStore = new MemoryReplayStore();
    const entries: GameLogEntry[] = [
      makeActionEntry({ seq: 1, gameId: "game42", playerId: "p1", unitId: "u1", actionType: "move" }),
      makeActionEntry({ seq: 2, gameId: "game42", playerId: "p2", unitId: "u2", actionType: "attack" }),
    ];
    await replayStore.saveLog("game42", entries);

    const app = await buildTestServer(replayStore);
    const res = await app.inject({ method: "GET", url: "/api/v1/replays/game42" });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ gameId: string; entries: GameLogEntry[]; entryCount: number }>();
    expect(body.gameId).toBe("game42");
    expect(body.entryCount).toBe(2);
    expect((body.entries[0] as ActionEntry).actionType).toBe("move");
    expect((body.entries[1] as ActionEntry).actionType).toBe("attack");
  });
});

// ─── ReplayAdapter ────────────────────────────────────────────────────────────

describe("ReplayAdapter", () => {
  it("has type replay", () => {
    const adapter = new ReplayAdapter("p1", []);
    expect(adapter.type).toBe("replay");
    expect(adapter.playerId).toBe("p1");
  });

  it("returns pass when no entries remain", async () => {
    const adapter = new ReplayAdapter("p1", []);
    const state = {} as import("@ab/metadata").GameState;
    const action = await adapter.requestAction(state, 5000);
    expect(action.type).toBe("pass");
  });

  it("replays move and attack actions in order", async () => {
    const entries: GameLogEntry[] = [
      makeActionEntry({
        seq: 1, gameId: "g1", playerId: "p1", unitId: "u1",
        actionType: "move",
        movedFrom: { row: 0, col: 0 }, movedTo: { row: 1, col: 0 },
      }),
      makeActionEntry({
        seq: 2, gameId: "g1", playerId: "p1", unitId: "u1",
        actionType: "attack",
        targetPosition: { row: 2, col: 0 },
      }),
    ];

    const adapter = new ReplayAdapter("p1", entries);
    const state = {} as import("@ab/metadata").GameState;

    const first = await adapter.requestAction(state, 5000);
    expect(first.type).toBe("move");
    if (first.type === "move") {
      expect(first.destination).toEqual({ row: 1, col: 0 });
    }

    const second = await adapter.requestAction(state, 5000);
    expect(second.type).toBe("attack");
    if (second.type === "attack") {
      expect(second.target).toEqual({ row: 2, col: 0 });
    }

    const third = await adapter.requestAction(state, 5000);
    expect(third.type).toBe("pass");
  });

  it("skips entries not belonging to this player", async () => {
    const entries: GameLogEntry[] = [
      makeActionEntry({ seq: 1, playerId: "p2", unitId: "u2", actionType: "move", movedTo: { row: 5, col: 5 } }),
      makeActionEntry({ seq: 2, playerId: "p1", unitId: "u1", actionType: "pass" }),
    ];

    const adapter = new ReplayAdapter("p1", entries);
    const action = await adapter.requestAction({} as import("@ab/metadata").GameState, 5000);
    expect(action.type).toBe("pass");
    expect(action.playerId).toBe("p1");
  });

  it("skips rejected entries", async () => {
    const entries: GameLogEntry[] = [
      makeActionEntry({ seq: 1, playerId: "p1", unitId: "u1", actionType: "move", accepted: false }),
      makeActionEntry({ seq: 2, playerId: "p1", unitId: "u1", actionType: "pass" }),
    ];

    const adapter = new ReplayAdapter("p1", entries);
    const action = await adapter.requestAction({} as import("@ab/metadata").GameState, 5000);
    // Should skip rejected entry and use pass
    expect(action.type).toBe("pass");
  });

  it("returns unit order from round_start entry", async () => {
    const roundStart: GameLogEntry = {
      seq: 1,
      type: "round_start",
      timestamp: 1000,
      gameId: "g1",
      round: 1,
      turnOrder: [
        { playerId: "p1", unitId: "u2", priority: 1 },
        { playerId: "p2", unitId: "u3", priority: 2 },
        { playerId: "p1", unitId: "u1", priority: 3 },
      ],
    };

    const adapter = new ReplayAdapter("p1", [roundStart]);
    const state = { round: 1 } as import("@ab/metadata").GameState;
    const ids = ["u1", "u2"] as import("@ab/metadata").UnitId[];
    const order = await adapter.requestUnitOrder(state, ids, 5000);
    expect(order).toEqual(["u2", "u1"]);
  });

  it("returns default unit order when no round_start entry", async () => {
    const adapter = new ReplayAdapter("p1", []);
    const ids = ["u1", "u2"] as import("@ab/metadata").UnitId[];
    const order = await adapter.requestUnitOrder({} as import("@ab/metadata").GameState, ids, 5000);
    expect(order).toEqual(ids);
  });
});
