/**
 * Session persistence layer tests — MemorySessionStore + MemoryStatsStore.
 */
import { describe, it, expect } from "vitest";
import { MemorySessionStore, RedisSessionStore } from "../session/session-store.js";
import { MemoryStatsStore, PostgresStatsStore } from "../session/stats-store.js";
import type { SessionRecord } from "../session/session-store.js";
import type { GameResult } from "../session/stats-store.js";

const mockState = {
  gameId: "g1",
  phase: "battle" as const,
  round: 1,
  turnOrder: [],
  currentTurnIndex: 0,
  players: {},
  units: {},
  map: { mapId: "m1", tiles: {} },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as unknown as import("@ab/metadata").GameState;

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    gameId: "g1",
    state: mockState,
    status: "waiting",
    playerIds: ["p1", "p2"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── MemorySessionStore ────────────────────────────────────────────────────────

describe("MemorySessionStore", () => {
  it("save and get returns stored record", async () => {
    const store = new MemorySessionStore();
    const record = makeRecord();
    await store.save(record);

    const result = await store.get("g1");
    expect(result?.gameId).toBe("g1");
    expect(result?.status).toBe("waiting");
  });

  it("get returns undefined for unknown game", async () => {
    const store = new MemorySessionStore();
    expect(await store.get("nonexistent")).toBeUndefined();
  });

  it("update changes state snapshot", async () => {
    const store = new MemorySessionStore();
    await store.save(makeRecord());

    const newState = { ...mockState, round: 5 };
    await store.update("g1", newState as import("@ab/metadata").GameState);

    const result = await store.get("g1");
    expect((result?.state as typeof mockState).round).toBe(5);
  });

  it("end marks session as ended", async () => {
    const store = new MemorySessionStore();
    await store.save(makeRecord({ status: "running" }));
    await store.end("g1");

    const result = await store.get("g1");
    expect(result?.status).toBe("ended");
  });

  it("listActive excludes ended sessions", async () => {
    const store = new MemorySessionStore();
    await store.save(makeRecord({ gameId: "g1", status: "running" }));
    await store.save(makeRecord({ gameId: "g2", status: "ended" }));

    const active = await store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.gameId).toBe("g1");
  });

  it("delete removes the record", async () => {
    const store = new MemorySessionStore();
    await store.save(makeRecord());
    await store.delete("g1");

    expect(await store.get("g1")).toBeUndefined();
  });
});

// ─── RedisSessionStore stub ───────────────────────────────────────────────────

describe("RedisSessionStore (stub)", () => {
  it("save is no-op (stub)", async () => {
    const store = new RedisSessionStore("redis://localhost:6379");
    await expect(store.save(makeRecord())).resolves.not.toThrow();
  });

  it("get returns undefined (stub)", async () => {
    const store = new RedisSessionStore();
    expect(await store.get("any")).toBeUndefined();
  });

  it("listActive returns empty array (stub)", async () => {
    const store = new RedisSessionStore();
    expect(await store.listActive()).toHaveLength(0);
  });
});

// ─── MemoryStatsStore ─────────────────────────────────────────────────────────

describe("MemoryStatsStore", () => {
  function makeResult(overrides: Partial<GameResult> = {}): GameResult {
    return {
      gameId: "g1",
      winnerIds: ["p1"],
      loserIds: ["p2"],
      reason: "all_units_dead",
      rounds: 5,
      playerIds: ["p1", "p2"],
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      ...overrides,
    };
  }

  it("records result and updates winner stats", async () => {
    const store = new MemoryStatsStore();
    await store.recordResult(makeResult());

    const p1 = await store.getPlayerStats("p1");
    expect(p1.wins).toBe(1);
    expect(p1.losses).toBe(0);

    const p2 = await store.getPlayerStats("p2");
    expect(p2.wins).toBe(0);
    expect(p2.losses).toBe(1);
  });

  it("records draw when winnerIds is empty", async () => {
    const store = new MemoryStatsStore();
    await store.recordResult(makeResult({ winnerIds: [], loserIds: [] }));

    const p1 = await store.getPlayerStats("p1");
    expect(p1.draws).toBe(1);
  });

  it("getPlayerStats returns zeros for unknown player", async () => {
    const store = new MemoryStatsStore();
    const stats = await store.getPlayerStats("nobody");
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.draws).toBe(0);
  });

  it("getGameResult returns stored result", async () => {
    const store = new MemoryStatsStore();
    await store.recordResult(makeResult({ gameId: "result-1" }));

    const result = await store.getGameResult("result-1");
    expect(result?.gameId).toBe("result-1");
    expect(result?.rounds).toBe(5);
  });

  it("getGameResult returns undefined for unknown game", async () => {
    const store = new MemoryStatsStore();
    expect(await store.getGameResult("not-found")).toBeUndefined();
  });

  it("getLeaderboard returns players sorted by wins desc", async () => {
    const store = new MemoryStatsStore();
    // alice wins 3, bob wins 1
    for (let i = 0; i < 3; i++) {
      await store.recordResult(makeResult({
        gameId: `ga${i}`, winnerIds: ["alice"], loserIds: ["bob"],
        playerIds: ["alice", "bob"],
      }));
    }
    await store.recordResult(makeResult({
      gameId: "gb1", winnerIds: ["bob"], loserIds: ["alice"],
      playerIds: ["alice", "bob"],
    }));

    const board = await store.getLeaderboard(10);
    expect(board[0]!.playerId).toBe("alice");
    expect(board[0]!.wins).toBe(3);
    expect(board[1]!.playerId).toBe("bob");
    expect(board[1]!.wins).toBe(1);
  });

  it("getLeaderboard respects limit", async () => {
    const store = new MemoryStatsStore();
    for (let i = 0; i < 5; i++) {
      await store.recordResult(makeResult({
        gameId: `gl${i}`, winnerIds: [`player${i}`], loserIds: [`enemy${i}`],
        playerIds: [`player${i}`, `enemy${i}`],
      }));
    }
    const board = await store.getLeaderboard(3);
    expect(board).toHaveLength(3);
  });

  it("getLeaderboard returns empty for no data", async () => {
    const store = new MemoryStatsStore();
    expect(await store.getLeaderboard(10)).toHaveLength(0);
  });
});

// ─── PostgresStatsStore stub ──────────────────────────────────────────────────

describe("PostgresStatsStore (stub)", () => {
  it("recordResult is no-op when no connection string", async () => {
    const store = new PostgresStatsStore("");
    await expect(store.recordResult({
      gameId: "g", winnerIds: [], loserIds: [], reason: "test",
      rounds: 1, playerIds: [], startedAt: 0, endedAt: 0,
    })).resolves.not.toThrow();
  });

  it("getPlayerStats returns zeros when no connection", async () => {
    const store = new PostgresStatsStore("");
    const stats = await store.getPlayerStats("p1");
    expect(stats.wins).toBe(0);
  });

  it("getGameResult returns undefined when no connection", async () => {
    const store = new PostgresStatsStore("");
    expect(await store.getGameResult("g")).toBeUndefined();
  });

  it("getLeaderboard returns empty when no connection", async () => {
    const store = new PostgresStatsStore("");
    expect(await store.getLeaderboard(10)).toHaveLength(0);
  });
});
