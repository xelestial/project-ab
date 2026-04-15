import { describe, it, expect } from "vitest";
import { EndDetector } from "../loop/end-detector.js";
import { TestStateBuilder } from "./test-helpers.js";

const detector = new EndDetector();

describe("EndDetector", () => {
  it("returns not ended when both players have units", () => {
    const state = TestStateBuilder.create()
      .withUnit("u1", "t1", "p1", 0, 0)
      .withUnit("u2", "f1", "p2", 10, 10)
      .build();
    const result = detector.check(state);
    expect(result.ended).toBe(false);
  });

  it("detects all_units_dead when p1 has no alive units", () => {
    const state = TestStateBuilder.create()
      .withUnit("u1", "t1", "p1", 0, 0, { alive: false, currentHealth: 0 })
      .withUnit("u2", "f1", "p2", 10, 10)
      .build();
    const result = detector.check(state);
    expect(result.ended).toBe(true);
    expect(result.reason).toBe("all_units_dead");
    expect(result.winnerIds).toContain("p2");
  });

  it("detects surrender", () => {
    const state = {
      ...TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0)
        .withUnit("u2", "f1", "p2", 10, 10)
        .build(),
      players: {
        p1: {
          playerId: "p1" as import("@ab/metadata").PlayerId,
          teamIndex: 0,
          priority: 1,
          unitIds: ["u1"] as import("@ab/metadata").UnitId[],
          connected: true,
          surrendered: true,
        },
        p2: {
          playerId: "p2" as import("@ab/metadata").PlayerId,
          teamIndex: 1,
          priority: 1,
          unitIds: ["u2"] as import("@ab/metadata").UnitId[],
          connected: true,
          surrendered: false,
        },
      },
    };
    const result = detector.check(state);
    expect(result.ended).toBe(true);
    expect(result.reason).toBe("surrender");
    expect(result.winnerIds).toContain("p2");
  });

  it("returns draw when round limit exceeded and equal unit counts", () => {
    const state = {
      ...TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0)
        .withUnit("u2", "f1", "p2", 10, 10)
        .build(),
      round: 31,
      currentTurnIndex: 999, // past end
      turnOrder: [] as import("@ab/metadata").TurnSlot[],
    };
    const result = detector.check(state);
    expect(result.ended).toBe(true);
    expect(result.reason).toBe("round_limit");
    expect(result.winnerIds).toHaveLength(0); // draw
  });

  it("returns winner when round limit exceeded and one player has more units", () => {
    const state = {
      ...TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0)
        .withUnit("u1b", "t1", "p1", 1, 0)
        .withUnit("u2", "f1", "p2", 10, 10)
        .build(),
      round: 31,
      currentTurnIndex: 999,
      turnOrder: [] as import("@ab/metadata").TurnSlot[],
    };
    const result = detector.check(state);
    expect(result.ended).toBe(true);
    expect(result.winnerIds).toContain("p1");
  });
});
