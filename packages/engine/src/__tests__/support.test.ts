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
  it("logAction: records a move action with positions", () => {
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
      state,
    );

    const log = logger.getLog("test-game");
    expect(log).toHaveLength(1);
    expect(log[0]!.type).toBe("action");
    const entry = log[0] as import("../support/game-logger.js").ActionEntry;
    expect(entry.actionType).toBe("move");
    expect(entry.movedFrom).toEqual({ row: 5, col: 5 });
    expect(entry.movedTo).toEqual({ row: 5, col: 7 });
    // Acting unit outcome should also record the move
    expect(entry.outcomes[0]!.movedFrom).toEqual({ row: 5, col: 5 });
    expect(entry.outcomes[0]!.movedTo).toEqual({ row: 5, col: 7 });
  });

  it("logAction: records hpAfter per unit from damage change", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .withUnit("u2", "f1", "p2", 5, 6)
      .build();

    const changes: import("@ab/metadata").GameChange[] = [
      {
        type: "unit_damage",
        unitId: "u2" as import("@ab/metadata").UnitId,
        amount: 3,
        source: { type: "attack", attackerId: "u1" as import("@ab/metadata").UnitId, weaponId: "wpn_melee_basic" as import("@ab/metadata").MetaId },
        hpAfter: 1,
      },
    ];

    logger.logAction(
      { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 6 } },
      changes,
      state,
      state,
    );

    const log = logger.getLog("test-game");
    const entry = log[0] as import("../support/game-logger.js").ActionEntry;
    expect(entry.targetUnitId).toBe("u2");
    const affected = entry.outcomes.find((o) => o.unitId === "u2")!;
    expect(affected.hpAfter).toBe(1);
  });

  it("logAction: records effects added and removed per unit", () => {
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
      state,
    );

    const log = logger.getLog("test-game");
    const entry = log[0] as import("../support/game-logger.js").ActionEntry;
    const outcome = entry.outcomes.find((o) => o.unitId === "u1")!;
    expect(outcome.effectsAdded).toContain("fire");
    expect(outcome.effectsRemoved).toContain("acid");
  });

  it("logAction: records tile attribute changes", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();

    const changes: import("@ab/metadata").GameChange[] = [
      {
        type: "tile_attribute_change",
        position: { row: 5, col: 5 },
        from: "plain",
        to: "fire",
        causedBy: { attackerId: "u1" as import("@ab/metadata").UnitId, attribute: "fire" },
      },
    ];

    logger.logAction(
      { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 5 } },
      changes,
      state,
      state,
    );

    const log = logger.getLog("test-game");
    const entry = log[0] as import("../support/game-logger.js").ActionEntry;
    expect(entry.tilesChanged).toHaveLength(1);
    expect(entry.tilesChanged[0]!.to).toBe("fire");
  });

  it("logAction: skips draft_place actions", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().build();

    logger.logAction(
      { type: "draft_place", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, metaId: "f1" as import("@ab/metadata").MetaId, position: { row: 0, col: 0 } },
      [],
      state,
      state,
    );

    expect(logger.getLog("test-game")).toHaveLength(0);
  });

  it("logAction: records rejected actions with accepted=false", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();

    logger.logAction(
      { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, destination: { row: 0, col: 0 } },
      [],
      state,
      state,
      false,
      "out_of_range",
    );

    const log = logger.getLog("test-game");
    const entry = log[0] as import("../support/game-logger.js").ActionEntry;
    expect(entry.accepted).toBe(false);
    expect(entry.errorCode).toBe("out_of_range");
  });

  it("logGameStart: records initial unit positions and HP", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 3, 3)
      .build();

    logger.logGameStart(state);

    const log = logger.getLog("test-game");
    expect(log).toHaveLength(1);
    expect(log[0]!.type).toBe("game_start");
    const entry = log[0] as import("../support/game-logger.js").GameStartEntry;
    expect(entry.units).toHaveLength(1);
    expect(entry.units[0]!.unitId).toBe("u1");
    expect(entry.units[0]!.position).toEqual({ row: 3, col: 3 });
  });

  it("logRoundStart: records turn order", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 3, 3)
      .build();

    logger.logRoundStart(state);

    const log = logger.getLog("test-game");
    expect(log[0]!.type).toBe("round_start");
    const entry = log[0] as import("../support/game-logger.js").RoundStartEntry;
    expect(entry.round).toBe(state.round);
  });

  it("logEffectTick: emits entry only when HP actually changed", () => {
    const logger = new GameLogger();
    const stateBefore = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 3, 3)
      .build();
    const stateAfter = stateBefore; // nothing changed

    logger.logEffectTick(1, 0, "p1", stateBefore, stateAfter);
    expect(logger.getLog("test-game")).toHaveLength(0); // no HP change → no entry
  });

  it("logEffectTick: records units that took damage", () => {
    const logger = new GameLogger();
    const stateBefore = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 3, 3)
      .build();
    // Simulate HP dropping from default (assume 10) to 7
    const unitAfter = { ...stateBefore.units["u1"]!, currentHealth: 7 };
    const stateAfter = { ...stateBefore, units: { ...stateBefore.units, "u1": unitAfter } };

    logger.logEffectTick(1, 0, "p1", stateBefore, stateAfter);

    const log = logger.getLog("test-game");
    expect(log[0]!.type).toBe("effect_tick");
    const entry = log[0] as import("../support/game-logger.js").EffectTickEntry;
    expect(entry.affected).toHaveLength(1);
    expect(entry.affected[0]!.unitId).toBe("u1");
    expect(entry.affected[0]!.hpAfter).toBe(7);
  });

  it("logGameEnd: records winners and final unit snapshot", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 3, 3)
      .build();

    logger.logGameEnd(["p1"], "elimination", state);

    const log = logger.getLog("test-game");
    expect(log[0]!.type).toBe("game_end");
    const entry = log[0] as import("../support/game-logger.js").GameEndEntry;
    expect(entry.winnerIds).toEqual(["p1"]);
    expect(entry.reason).toBe("elimination");
    expect(entry.finalUnits).toHaveLength(1);
  });

  it("sequence numbers are monotonically increasing", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();

    logger.logGameStart(state);
    logger.logRoundStart(state);
    logger.logTurnStart(1, 0, "p1", "u1", "test-game");

    const log = logger.getLog("test-game");
    expect(log[0]!.seq).toBe(1);
    expect(log[1]!.seq).toBe(2);
    expect(log[2]!.seq).toBe(3);
  });

  it("getLog: returns empty array for unknown game", () => {
    const logger = new GameLogger();
    expect(logger.getLog("nonexistent")).toHaveLength(0);
  });

  it("clear: removes logs and resets sequence counter", () => {
    const logger = new GameLogger();
    const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build();

    logger.logGameStart(state);
    logger.clear("test-game");

    expect(logger.getLog("test-game")).toHaveLength(0);
    // After clear, sequence restarts from 1
    logger.logGameStart(state);
    expect(logger.getLog("test-game")[0]!.seq).toBe(1);
  });

  it("logEvent: does not throw (no-op debug utility)", () => {
    const logger = new GameLogger();
    expect(() => logger.logEvent("test.event", { foo: "bar" })).not.toThrow();
  });
});
