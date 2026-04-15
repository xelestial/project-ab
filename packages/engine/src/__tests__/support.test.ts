/**
 * Support utilities — EventBus and GameLogger.
 */
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../support/event-bus.js";
import { GameLogger } from "../support/game-logger.js";
import { TestStateBuilder } from "./test-helpers.js";

// ─── EventBus ──────────────────────────────────────────────────────────────────

describe("EventBus", () => {
  it("emit: fires specific listener", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("game.start", handler);
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();
    bus.emit({ type: "game.start", state });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ type: "game.start" });
  });

  it("emit: fires onAny listener for every event", () => {
    const bus = new EventBus();
    const any = vi.fn();
    bus.onAny(any);

    const state = TestStateBuilder.create().build();
    bus.emit({ type: "round.start", round: 1, state });
    bus.emit({ type: "round.end", round: 1, state });

    expect(any).toHaveBeenCalledTimes(2);
  });

  it("on: returns unsubscribe function that stops further calls", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on("turn.start", handler);
    const state = TestStateBuilder.create().build();

    bus.emit({ type: "turn.start", playerId: "p1", turnIndex: 0, state });
    unsub();
    bus.emit({ type: "turn.start", playerId: "p1", turnIndex: 0, state });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("onAny: returns unsubscribe that stops any-listener", () => {
    const bus = new EventBus();
    const any = vi.fn();
    const unsub = bus.onAny(any);
    const state = TestStateBuilder.create().build();

    bus.emit({ type: "state.update", state });
    unsub();
    bus.emit({ type: "state.update", state });

    expect(any).toHaveBeenCalledOnce();
  });

  it("clear: removes all listeners", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const any = vi.fn();

    bus.on("game.end", handler);
    bus.onAny(any);
    bus.clear();

    const state = TestStateBuilder.create().build();
    bus.emit({ type: "game.end", state, winnerIds: [], reason: "test" });

    expect(handler).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
  });

  it("emit: does nothing for type with no handlers", () => {
    const bus = new EventBus();
    // No crash if no handlers registered for this type
    const state = TestStateBuilder.create().build();
    expect(() => bus.emit({ type: "unit.died", unitId: "u1", state })).not.toThrow();
  });
});

// ─── GameLogger ───────────────────────────────────────────────────────────────

describe("GameLogger", () => {
  it("logAction: records a move action", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const changes: import("@ab/metadata").GameChange[] = [
      { type: "unit_move", unitId: "u1" as import("@ab/metadata").UnitId, from: { row: 5, col: 5 }, to: { row: 5, col: 7 } },
    ];

    logger.logAction(
      { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, destination: { row: 5, col: 7 } },
      changes,
      state,
    );

    const log = logger.getLog("test-game");
    expect(log).toHaveLength(1);
    expect(log[0]!.actionType).toBe("move");
    expect(log[0]!.positionBefore).toEqual({ row: 5, col: 5 });
    expect(log[0]!.positionAfter).toEqual({ row: 5, col: 7 });
  });

  it("logAction: records damage amount", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const changes: import("@ab/metadata").GameChange[] = [
      { type: "unit_damage", unitId: "u2" as import("@ab/metadata").UnitId, amount: 3, source: { type: "attack", attackerId: "u1" as import("@ab/metadata").UnitId, weaponId: "wpn_melee_basic" as import("@ab/metadata").MetaId }, hpAfter: 1 },
    ];

    logger.logAction(
      { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 6 } },
      changes,
      state,
    );

    const log = logger.getLog("test-game");
    expect(log[0]!.damage).toBe(3);
  });

  it("logAction: records effects applied and removed", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const changes: import("@ab/metadata").GameChange[] = [
      { type: "unit_effect_add", unitId: "u1" as import("@ab/metadata").UnitId, effectId: "effect_fire" as import("@ab/metadata").MetaId, effectType: "fire", turnsRemaining: 3 },
      { type: "unit_effect_remove", unitId: "u1" as import("@ab/metadata").UnitId, effectId: "effect_acid" as import("@ab/metadata").MetaId, effectType: "acid" },
    ];

    logger.logAction(
      { type: "pass", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId },
      changes,
      state,
    );

    const log = logger.getLog("test-game");
    expect(log[0]!.effectsApplied).toContain("fire");
    expect(log[0]!.effectsRemoved).toContain("acid");
  });

  it("logAction: records tile attribute change", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();

    const changes: import("@ab/metadata").GameChange[] = [
      { type: "tile_attribute_change", position: { row: 5, col: 5 }, from: "plain", to: "fire",
        causedBy: { attackerId: "u1" as import("@ab/metadata").UnitId, attribute: "fire" } },
    ];

    logger.logAction(
      { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 5 } },
      changes,
      state,
    );

    const log = logger.getLog("test-game");
    expect(log[0]!.tilesChanged).toHaveLength(1);
    expect(log[0]!.tilesChanged![0]!.to).toBe("fire");
  });

  it("logAction: skips draft_place actions", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().build();

    logger.logAction(
      { type: "draft_place", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, metaId: "f1" as import("@ab/metadata").MetaId, position: { row: 0, col: 0 } },
      [],
      state,
    );

    expect(logger.getLog("test-game")).toHaveLength(0);
  });

  it("getLog: returns empty array for unknown game", () => {
    const logger = new GameLogger();
    expect(logger.getLog("nonexistent")).toHaveLength(0);
  });

  it("clear: removes logs for given gameId", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();

    logger.logAction(
      { type: "pass", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId },
      [],
      state,
    );

    logger.clear("test-game");
    expect(logger.getLog("test-game")).toHaveLength(0);
  });

  it("logEvent: does not throw (no-op debug utility)", () => {
    const logger = new GameLogger();
    expect(() => logger.logEvent("test.event", { foo: "bar" })).not.toThrow();
  });
});
