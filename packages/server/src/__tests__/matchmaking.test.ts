/**
 * MatchmakingQueue 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { MatchmakingQueue } from "../session/matchmaking.js";
import type { MatchResult } from "../session/matchmaking.js";

function makeRequest(playerId: string, overrides: Partial<{ mapId: string; playerCount: number; rating: number }> = {}) {
  return {
    playerId,
    mapId: overrides.mapId ?? "map_2p",
    playerCount: overrides.playerCount ?? 2,
    rating: overrides.rating ?? 1000,
    enqueuedAt: Date.now(),
  };
}

describe("MatchmakingQueue", () => {
  it("1명만 큐에 넣으면 매칭 없음", () => {
    const queue = new MatchmakingQueue();
    const matched = queue.enqueue(makeRequest("p1"));
    expect(matched).toBe(false);
  });

  it("2명 입장 시 즉시 매칭", () => {
    const queue = new MatchmakingQueue();
    const results: MatchResult[] = [];
    queue.onMatch((r) => results.push(r));

    queue.enqueue(makeRequest("p1"));
    const matched = queue.enqueue(makeRequest("p2"));

    expect(matched).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]!.playerIds).toContain("p1");
    expect(results[0]!.playerIds).toContain("p2");
    expect(results[0]!.gameId).toMatch(/^game_mm_/);
  });

  it("매칭 후 큐 비워짐", () => {
    const queue = new MatchmakingQueue();
    queue.enqueue(makeRequest("p1"));
    queue.enqueue(makeRequest("p2"));

    const sizes = queue.getQueueSizes();
    expect(Object.values(sizes).every((n) => n === 0)).toBe(true);
  });

  it("dequeue로 큐에서 제거", () => {
    const queue = new MatchmakingQueue();
    queue.enqueue(makeRequest("p1"));
    queue.dequeue("p1");

    const pos = queue.getPosition("p1");
    expect(pos).toBe(0);
  });

  it("getPosition: 큐 순서 반환", () => {
    const queue = new MatchmakingQueue();
    queue.enqueue(makeRequest("p1"));
    queue.enqueue(makeRequest("p2", { playerCount: 4 }));

    expect(queue.getPosition("p1")).toBe(1);
  });

  it("4인 매칭: 4명 입장 후 매칭", () => {
    const queue = new MatchmakingQueue();
    const results: MatchResult[] = [];
    queue.onMatch((r) => results.push(r));

    for (let i = 1; i <= 4; i++) {
      queue.enqueue(makeRequest(`p${i}`, { playerCount: 4 }));
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.playerIds).toHaveLength(4);
  });

  it("맵이 다르면 매칭되지 않음", () => {
    const queue = new MatchmakingQueue();
    queue.enqueue(makeRequest("p1", { mapId: "map_a" }));
    const matched = queue.enqueue(makeRequest("p2", { mapId: "map_b" }));
    expect(matched).toBe(false);
  });

  it("ELO 범위 내 플레이어 우선 매칭", () => {
    const queue = new MatchmakingQueue();
    const results: MatchResult[] = [];
    queue.onMatch((r) => results.push(r));

    // p1: ELO 1000, p2: ELO 2000 (범위 초과), p3: ELO 1100 (범위 내)
    queue.enqueue(makeRequest("p1", { rating: 1000 }));
    queue.enqueue(makeRequest("p2", { rating: 2000 }));
    queue.enqueue(makeRequest("p3", { rating: 1100 }));

    expect(results).toHaveLength(1);
    expect(results[0]!.playerIds).toContain("p1");
    expect(results[0]!.playerIds).toContain("p3");
    expect(results[0]!.playerIds).not.toContain("p2");
  });

  it("동일 플레이어 재큐잉 시 기존 항목 교체", () => {
    const queue = new MatchmakingQueue();
    queue.enqueue(makeRequest("p1", { mapId: "map_a" }));
    queue.enqueue(makeRequest("p1", { mapId: "map_b" })); // 재큐잉

    // p1은 map_b 큐에만 있어야 함
    expect(queue.getQueueSizes()["map_a:2"]).toBeUndefined();
    expect(queue.getQueueSizes()["map_b:2"]).toBe(1);
  });

  it("onMatch 구독 취소 후 이벤트 미수신", () => {
    const queue = new MatchmakingQueue();
    let count = 0;
    const unsub = queue.onMatch(() => { count++; });
    unsub();

    queue.enqueue(makeRequest("p1"));
    queue.enqueue(makeRequest("p2"));

    expect(count).toBe(0);
  });
});

describe("매치메이킹 API routes", () => {
  it("matchmaking HTTP 라우트 — 2명 즉시 매칭", async () => {
    const Fastify = (await import("fastify")).default;
    const FastifyCors = (await import("@fastify/cors")).default;
    const FastifyWs = (await import("@fastify/websocket")).default;
    const { buildDataRegistry } = await import("@ab/metadata");
    const { GameFactory } = await import("@ab/engine");
    const { GameSessionManager } = await import("../session/game-session-manager.js");
    const { MemoryStatsStore } = await import("../session/stats-store.js");
    const { MemoryTokenStore } = await import("../auth/token-store.js");
    const { createToken } = await import("../auth/jwt-auth.js");
    const { registerRoutes } = await import("../api/routes.js");
    const { registerWsRoutes } = await import("../ws/ws-server.js");
    const { MatchmakingQueue: MMQ } = await import("../session/matchmaking.js");

    const registry = buildDataRegistry({
      units: [], weapons: [], skills: [], effects: [], tiles: [],
      maps: [{ id: "map_2p", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
        spawnPoints: [{ playerId: 0, positions: [{ row: 0, col: 0 }] }, { playerId: 1, positions: [{ row: 5, col: 5 }] }] }],
    });

    const fastify = Fastify({ logger: false });
    await fastify.register(FastifyCors, { origin: true });
    await fastify.register(FastifyWs);

    const factory = new GameFactory(registry);
    const sessionManager = new GameSessionManager();
    const statsStore = new MemoryStatsStore();
    const tokenStore = new MemoryTokenStore();
    const matchmakingQueue = new MMQ();

    await registerRoutes(fastify, { sessionManager, factory, registry, statsStore, tokenStore, matchmakingQueue });
    await registerWsRoutes(fastify, { sessionManager, factory, registry, statsStore });

    // p1 enters queue → queued
    const res1 = await fastify.inject({
      method: "POST", url: "/api/v1/matchmaking/join",
      headers: { authorization: `Bearer ${createToken("p1")}` },
      payload: { mapId: "map_2p", playerCount: 2 },
    });
    expect(res1.statusCode).toBe(202);
    expect(res1.json().status).toBe("queued");

    // p2 enters queue → immediate match
    const res2 = await fastify.inject({
      method: "POST", url: "/api/v1/matchmaking/join",
      headers: { authorization: `Bearer ${createToken("p2")}` },
      payload: { mapId: "map_2p", playerCount: 2 },
    });
    expect(res2.statusCode).toBe(201);
    const body = res2.json();
    expect(body.status).toBe("matched");
    expect(body.gameId).toMatch(/^game_mm_/);
    expect(body.playerIds).toContain("p1");
    expect(body.playerIds).toContain("p2");

    await fastify.close();
  });
});
