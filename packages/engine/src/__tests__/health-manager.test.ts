/**
 * HealthManager unit tests — death detection and cleanup.
 */
import { describe, it, expect } from "vitest";
import { HealthManager } from "../managers/health-manager.js";
import { StateApplicator } from "../state/state-applicator.js";
import { TestStateBuilder } from "./test-helpers.js";

function makeManager() {
  return new HealthManager(new StateApplicator());
}

describe("HealthManager.checkDeaths", () => {
  it("returns death change for unit with HP <= 0", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 0 })
      .build();

    const changes = manager.checkDeaths(state);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("unit_death");
    expect((changes[0] as { unitId: string }).unitId).toBe("u1");
  });

  it("returns death change for unit with negative HP", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: -3 })
      .build();

    const changes = manager.checkDeaths(state);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("unit_death");
  });

  it("returns no changes for unit with HP > 0", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 1 })
      .build();

    const changes = manager.checkDeaths(state);
    expect(changes).toHaveLength(0);
  });

  it("skips units that are already dead (alive: false)", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 0, alive: false })
      .build();

    const changes = manager.checkDeaths(state);
    expect(changes).toHaveLength(0);
  });

  it("detects multiple deaths in the same state", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 0 })
      .withUnit("u2", "t1", "p1", 3, 3, { currentHealth: -1 })
      .withUnit("u3", "r1", "p2", 8, 8, { currentHealth: 4 })
      .build();

    const changes = manager.checkDeaths(state);
    expect(changes).toHaveLength(2);
    const ids = changes.map((c) => (c as { unitId: string }).unitId);
    expect(ids).toContain("u1");
    expect(ids).toContain("u2");
  });

  it("records the position of each dead unit", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 3, 7, { currentHealth: 0 })
      .build();

    const changes = manager.checkDeaths(state);
    expect(changes[0]).toMatchObject({ type: "unit_death", position: { row: 3, col: 7 } });
  });
});

describe("HealthManager.applyDeaths", () => {
  it("marks HP-zero units as dead after applyDeaths", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 0 })
      .withUnit("u2", "f1", "p2", 8, 8, { currentHealth: 4 })
      .build();

    const newState = manager.applyDeaths(state);
    expect(newState.units["u1"]!.alive).toBe(false);
    expect(newState.units["u2"]!.alive).toBe(true);
  });

  it("returns the same state reference when no units are dying", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 4 })
      .build();

    const newState = manager.applyDeaths(state);
    expect(newState).toBe(state);
  });

  it("does not mutate the original state", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 0 })
      .build();
    const originalAlive = state.units["u1"]!.alive;

    manager.applyDeaths(state);
    expect(state.units["u1"]!.alive).toBe(originalAlive);
  });

  it("handles an empty unit map (no crash)", () => {
    const manager = makeManager();
    const state = TestStateBuilder.create().build();
    expect(() => manager.applyDeaths(state)).not.toThrow();
  });
});
