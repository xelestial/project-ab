/**
 * ELO rating calculation tests.
 */
import { describe, it, expect } from "vitest";
import { calculateElo, ELO_INITIAL, ELO_FLOOR } from "../session/elo.js";

describe("calculateElo", () => {
  it("빈 플레이어 배열 — 빈 결과 반환", () => {
    expect(calculateElo([], ["p1"])).toHaveLength(0);
  });

  it("동일 레이팅 1v1 — 승자는 +, 패자는 -", () => {
    const players = [
      { playerId: "p1", rating: 1000, gamesPlayed: 50 },
      { playerId: "p2", rating: 1000, gamesPlayed: 50 },
    ];
    const results = calculateElo(players, ["p1"]);

    const p1 = results.find((r) => r.playerId === "p1")!;
    const p2 = results.find((r) => r.playerId === "p2")!;

    expect(p1.delta).toBeGreaterThan(0);
    expect(p2.delta).toBeLessThan(0);
    // 합산은 0 (제로섬)
    expect(p1.delta + p2.delta).toBe(0);
  });

  it("무승부 — 동일 레이팅이면 변화 없음", () => {
    const players = [
      { playerId: "p1", rating: 1000, gamesPlayed: 50 },
      { playerId: "p2", rating: 1000, gamesPlayed: 50 },
    ];
    const results = calculateElo(players, []);
    // 동일 레이팅 무승부 → expected=0.5, actual=0.5, delta=0
    for (const r of results) {
      expect(r.delta).toBe(0);
    }
  });

  it("약자가 강자 이기면 더 큰 점수 획득", () => {
    const weak = { playerId: "weak", rating: 800, gamesPlayed: 50 };
    const strong = { playerId: "strong", rating: 1400, gamesPlayed: 50 };

    const resultsWeakWins = calculateElo([weak, strong], ["weak"]);
    const weakResult = resultsWeakWins.find((r) => r.playerId === "weak")!;

    // 약자가 이기면 expected score가 낮으므로 delta가 크다
    expect(weakResult.delta).toBeGreaterThan(10);
  });

  it("강자가 약자 이기면 적은 점수 획득", () => {
    const weak = { playerId: "weak", rating: 800, gamesPlayed: 50 };
    const strong = { playerId: "strong", rating: 1400, gamesPlayed: 50 };

    const resultsStrongWins = calculateElo([weak, strong], ["strong"]);
    const strongResult = resultsStrongWins.find((r) => r.playerId === "strong")!;

    // 강자가 이기면 기대 점수가 이미 높으므로 delta가 작다
    expect(strongResult.delta).toBeGreaterThan(0);
    expect(strongResult.delta).toBeLessThan(5);
  });

  it("신규 플레이어 (K=40) — K팩터 높음", () => {
    const newPlayer = { playerId: "new", rating: 1000, gamesPlayed: 5 };
    const veteran = { playerId: "vet", rating: 1000, gamesPlayed: 100 };

    const results = calculateElo([newPlayer, veteran], ["new"]);
    const newResult = results.find((r) => r.playerId === "new")!;
    const vetResult = results.find((r) => r.playerId === "vet")!;

    // 신규 플레이어는 K=40으로 더 많이 획득
    expect(newResult.delta).toBeGreaterThan(vetResult.delta * -1); // 비대칭
    expect(newResult.delta).toBeGreaterThan(0);
  });

  it("레이팅 하한선: 100 미만으로 떨어지지 않음", () => {
    const loser = { playerId: "loser", rating: 110, gamesPlayed: 200 };
    const winner = { playerId: "winner", rating: 3000, gamesPlayed: 200 };

    const results = calculateElo([loser, winner], ["winner"]);
    const loserResult = results.find((r) => r.playerId === "loser")!;

    expect(loserResult.newRating).toBeGreaterThanOrEqual(ELO_FLOOR);
  });

  it("3명 대전 — 승자 점수 증가, 패자 점수 감소", () => {
    const players = [
      { playerId: "p1", rating: 1000, gamesPlayed: 50 },
      { playerId: "p2", rating: 1000, gamesPlayed: 50 },
      { playerId: "p3", rating: 1000, gamesPlayed: 50 },
    ];

    const results = calculateElo(players, ["p1"]);
    const p1 = results.find((r) => r.playerId === "p1")!;
    const p2 = results.find((r) => r.playerId === "p2")!;
    const p3 = results.find((r) => r.playerId === "p3")!;

    expect(p1.delta).toBeGreaterThan(0);
    expect(p2.delta).toBeLessThan(0);
    expect(p3.delta).toBeLessThan(0);
  });

  it("MemoryStatsStore — 게임 후 ELO 업데이트", async () => {
    const { MemoryStatsStore } = await import("../session/stats-store.js");
    const store = new MemoryStatsStore();

    await store.recordResult({
      gameId: "g1",
      winnerIds: ["alice"],
      loserIds: ["bob"],
      reason: "all_units_dead",
      rounds: 5,
      playerIds: ["alice", "bob"],
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
    });

    const alice = await store.getPlayerStats("alice");
    const bob = await store.getPlayerStats("bob");

    expect(alice.rating).toBeGreaterThan(ELO_INITIAL);
    expect(bob.rating).toBeLessThan(ELO_INITIAL);
    expect(alice.wins).toBe(1);
    expect(bob.losses).toBe(1);
  });

  it("getPlayerStats — 첫 조회 시 초기 ELO 반환", async () => {
    const { MemoryStatsStore } = await import("../session/stats-store.js");
    const store = new MemoryStatsStore();
    const stats = await store.getPlayerStats("unknown");
    expect(stats.rating).toBe(ELO_INITIAL);
  });
});
