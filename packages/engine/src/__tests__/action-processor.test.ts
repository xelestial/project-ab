/**
 * ActionProcessor — validates + resolves + applies all action types.
 */
import { describe, it, expect } from "vitest";
import type { GameState } from "@ab/metadata";
import { ActionProcessor } from "../loop/action-processor.js";
import { MovementValidator } from "../validators/movement-validator.js";
import { AttackValidator } from "../validators/attack-validator.js";
import { MovementResolver } from "../resolvers/movement-resolver.js";
import { AttackResolver } from "../resolvers/attack-resolver.js";
import { EffectResolver } from "../resolvers/effect-resolver.js";
import { StateApplicator } from "../state/state-applicator.js";
import { TurnManager } from "../managers/turn-manager.js";
import { HealthManager } from "../managers/health-manager.js";
import { EffectManager } from "../managers/effect-manager.js";
import { TileManager } from "../managers/tile-manager.js";
import { TileResolver } from "../resolvers/tile-resolver.js";
import { TileValidator } from "../validators/tile-validator.js";
import { EffectValidator } from "../validators/effect-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

function makeProcessor() {
  const registry = makeRegistry();
  const applicator = new StateApplicator();
  const mvValidator = new MovementValidator(registry);
  const atkValidator = new AttackValidator(registry);
  const mvResolver = new MovementResolver(mvValidator, registry);
  const atkResolver = new AttackResolver(atkValidator, registry);
  const effValidator = new EffectValidator(registry);
  const effResolver = new EffectResolver(effValidator, registry);
  const tileValidator = new TileValidator(registry);
  const tileResolver = new TileResolver(tileValidator, registry);
  const turnManager = new TurnManager(applicator);
  const healthManager = new HealthManager(applicator);
  const effectManager = new EffectManager(effResolver, applicator);
  const tileManager = new TileManager(tileResolver, applicator);

  const processor = new ActionProcessor(
    turnManager,
    mvValidator,
    atkValidator,
    mvResolver,
    atkResolver,
    effResolver,
    applicator,
    healthManager,
    effectManager,
    tileManager,
    registry,
  );

  return processor;
}

describe("ActionProcessor", () => {
  describe("move action", () => {
    it("accepts valid move and marks unit as moved", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const result = processor.process(
        { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, destination: { row: 5, col: 7 } },
        state,
      );

      expect(result.accepted).toBe(true);
      expect(result.newState.units["u1"]!.actionsUsed.moved).toBe(true);
      expect(result.newState.units["u1"]!.position).toEqual({ row: 5, col: 7 });
    });

    it("rejects move for unknown unit", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create().build();

      const result = processor.process(
        { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "nonexistent" as import("@ab/metadata").UnitId, destination: { row: 5, col: 5 } },
        state,
      );

      expect(result.accepted).toBe(false);
      expect(result.errorCode).toBeDefined();
    });

    it("rejects move if unit already moved", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, { actionsUsed: { moved: true, attacked: false, skillUsed: false, extinguished: false } })
        .build();

      const result = processor.process(
        { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, destination: { row: 5, col: 7 } },
        state,
      );

      expect(result.accepted).toBe(false);
    });

    it("rejects move if destination out of movement range", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const result = processor.process(
        { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, destination: { row: 0, col: 0 } },
        state,
      );

      expect(result.accepted).toBe(false);
    });

    it("rejects move for frozen unit", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "f1", "p1", 5, 5)
        .build();

      const result = processor.process(
        { type: "move", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, destination: { row: 5, col: 7 } },
        state,
      );

      expect(result.accepted).toBe(false);
    });
  });

  describe("attack action", () => {
    it("accepts valid attack and marks unit as attacked", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();

      const result = processor.process(
        { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 6 } },
        state,
      );

      expect(result.accepted).toBe(true);
      expect(result.newState.units["u1"]!.actionsUsed.attacked).toBe(true);
    });

    it("rejects attack for unknown unit", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create().build();

      const result = processor.process(
        { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "ghost" as import("@ab/metadata").UnitId, target: { row: 5, col: 5 } },
        state,
      );

      expect(result.accepted).toBe(false);
    });

    it("rejects attack if already attacked", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, { actionsUsed: { moved: false, attacked: true, skillUsed: false, extinguished: false } })
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();

      const result = processor.process(
        { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 6 } },
        state,
      );

      expect(result.accepted).toBe(false);
    });

    it("rejects attack on out-of-range target", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 9, 9)
        .build();

      const result = processor.process(
        { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 9, col: 9 } },
        state,
      );

      expect(result.accepted).toBe(false);
    });

    it("enemy unit death is detected after lethal attack", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6, { currentHealth: 1 }) // will die from 2 damage
        .build();

      const result = processor.process(
        { type: "attack", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, target: { row: 5, col: 6 } },
        state,
      );

      expect(result.accepted).toBe(true);
      expect(result.newState.units["u2"]!.alive).toBe(false);
    });
  });

  describe("skill action", () => {
    it("accepts passive skill (shield_defend) — no-op", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5) // t1 has skill_shield_defend (passive)
        .build();

      const result = processor.process(
        { type: "skill", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId, skillId: "skill_shield_defend" as import("@ab/metadata").MetaId },
        state,
      );

      expect(result.accepted).toBe(true);
    });

    it("accepts active skill (fighter_rush) with target", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5) // f1 has skill_fighter_rush (active, uses wpn_melee_basic)
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();

      const result = processor.process(
        {
          type: "skill",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "u1" as import("@ab/metadata").UnitId,
          skillId: "skill_fighter_rush" as import("@ab/metadata").MetaId,
          target: { row: 5, col: 6 },
        },
        state,
      );

      expect(result.accepted).toBe(true);
      expect(result.newState.units["u1"]!.actionsUsed.skillUsed).toBe(true);
    });

    it("rejects skill for unknown unit", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create().build();

      const result = processor.process(
        { type: "skill", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "ghost" as import("@ab/metadata").UnitId, skillId: "skill_shield_defend" as import("@ab/metadata").MetaId },
        state,
      );

      expect(result.accepted).toBe(false);
    });
  });

  describe("extinguish action", () => {
    it("removes fire effect and consumes full turn", () => {
      const processor = makeProcessor();
      const fireEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_fire" as import("@ab/metadata").MetaId,
        effectType: "fire",
        turnsRemaining: 2,
        appliedOnTurn: 1,
      };
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
        .build();

      const result = processor.process(
        { type: "extinguish", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId },
        state,
      );

      expect(result.accepted).toBe(true);
      expect(result.newState.units["u1"]!.actionsUsed.moved).toBe(true);
      expect(result.newState.units["u1"]!.actionsUsed.attacked).toBe(true);
      expect(result.newState.units["u1"]!.actionsUsed.extinguished).toBe(true);
      expect(result.newState.units["u1"]!.activeEffects).toHaveLength(0);
    });

    it("rejects extinguish if unit not on fire", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const result = processor.process(
        { type: "extinguish", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId },
        state,
      );

      expect(result.accepted).toBe(false);
      expect(result.errorCode).toBeDefined();
    });

    it("rejects extinguish for unknown unit", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create().build();

      const result = processor.process(
        { type: "extinguish", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "ghost" as import("@ab/metadata").UnitId },
        state,
      );

      expect(result.accepted).toBe(false);
    });
  });

  describe("pass action", () => {
    it("accepts pass — state unchanged", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const result = processor.process(
        { type: "pass", playerId: "p1" as import("@ab/metadata").PlayerId, unitId: "u1" as import("@ab/metadata").UnitId },
        state,
      );

      expect(result.accepted).toBe(true);
      expect(result.newState).toBe(state);
    });
  });

  describe("draft_place action", () => {
    it("rejects draft_place during battle phase", () => {
      const processor = makeProcessor();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const result = processor.process(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "u1" as import("@ab/metadata").UnitId,
          metaId: "f1" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 },
        },
        state,
      );

      expect(result.accepted).toBe(false);
    });
  });
});
