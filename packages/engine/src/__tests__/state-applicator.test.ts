import { describe, it, expect } from "vitest";
import { StateApplicator } from "../state/state-applicator.js";
import { TestStateBuilder } from "./test-helpers.js";

const applicator = new StateApplicator();

describe("StateApplicator", () => {
  describe("unit_move", () => {
    it("moves unit to new position", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0)
        .build();

      const newState = applicator.apply(
        [{ type: "unit_move", unitId: "u1", from: { row: 0, col: 0 }, to: { row: 1, col: 1 } }],
        state,
      );

      expect(newState.units["u1"]?.position).toEqual({ row: 1, col: 1 });
      expect(newState.units["u1"]?.actionsUsed.moved).toBe(true);
    });

    it("does not mutate original state", () => {
      const state = TestStateBuilder.create().withUnit("u1", "t1", "p1", 0, 0).build();
      applicator.apply(
        [{ type: "unit_move", unitId: "u1", from: { row: 0, col: 0 }, to: { row: 2, col: 2 } }],
        state,
      );
      expect(state.units["u1"]?.position).toEqual({ row: 0, col: 0 });
    });
  });

  describe("unit_damage", () => {
    it("reduces unit health", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0, { currentHealth: 6 })
        .build();

      const newState = applicator.apply(
        [
          {
            type: "unit_damage",
            unitId: "u1",
            amount: 2,
            source: { type: "attack", attackerId: "u2", weaponId: "wpn_melee_basic" },
            hpAfter: 4,
          },
        ],
        state,
      );

      expect(newState.units["u1"]?.currentHealth).toBe(4);
    });
  });

  describe("unit_effect_add", () => {
    it("adds freeze effect to unit", () => {
      const state = TestStateBuilder.create().withUnit("u1", "t1", "p1", 0, 0).build();

      const newState = applicator.apply(
        [
          {
            type: "unit_effect_add",
            unitId: "u1",
            effectId: "effect_freeze",
            effectType: "freeze",
            turnsRemaining: 1,
          },
        ],
        state,
      );

      const effects = newState.units["u1"]?.activeEffects ?? [];
      expect(effects).toHaveLength(1);
      expect(effects[0]?.effectType).toBe("freeze");
    });

    it("replaces existing effect of same type", () => {
      const state = TestStateBuilder.create().withFrozenUnit("u1", "t1", "p1", 0, 0).build();

      const newState = applicator.apply(
        [
          {
            type: "unit_effect_add",
            unitId: "u1",
            effectId: "effect_freeze",
            effectType: "freeze",
            turnsRemaining: 2,
          },
        ],
        state,
      );

      const effects = newState.units["u1"]?.activeEffects ?? [];
      expect(effects).toHaveLength(1);
      expect(effects[0]?.turnsRemaining).toBe(2);
    });
  });

  describe("unit_effect_remove", () => {
    it("removes effect from unit", () => {
      const state = TestStateBuilder.create().withFrozenUnit("u1", "t1", "p1", 0, 0).build();

      const newState = applicator.apply(
        [{ type: "unit_effect_remove", unitId: "u1", effectId: "effect_freeze", effectType: "freeze" }],
        state,
      );

      expect(newState.units["u1"]?.activeEffects).toHaveLength(0);
    });
  });

  describe("unit_death", () => {
    it("marks unit as dead", () => {
      const state = TestStateBuilder.create().withUnit("u1", "t1", "p1", 0, 0).build();

      const newState = applicator.apply(
        [
          {
            type: "unit_death",
            unitId: "u1",
            position: { row: 0, col: 0 },
            killedBy: { type: "attack", attackerId: "u2", weaponId: "wpn" },
          },
        ],
        state,
      );

      expect(newState.units["u1"]?.alive).toBe(false);
    });
  });

  describe("tile_attribute_change", () => {
    it("converts tile attribute", () => {
      const state = TestStateBuilder.create().withTile(3, 3, "plain").build();

      const newState = applicator.apply(
        [
          {
            type: "tile_attribute_change",
            position: { row: 3, col: 3 },
            from: "plain",
            to: "fire",
          },
        ],
        state,
      );

      expect(newState.map.tiles["3,3"]?.attribute).toBe("fire");
    });
  });

  describe("unit_knockback", () => {
    it("moves unit when not blocked", () => {
      const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 2, 2).build();

      const newState = applicator.apply(
        [
          {
            type: "unit_knockback",
            unitId: "u1",
            from: { row: 2, col: 2 },
            to: { row: 3, col: 2 },
            blockedBy: undefined,
          },
        ],
        state,
      );

      expect(newState.units["u1"]?.position).toEqual({ row: 3, col: 2 });
    });

    it("does not move unit when blocked", () => {
      const state = TestStateBuilder.create().withUnit("u1", "f1", "p1", 2, 2).build();

      const newState = applicator.apply(
        [
          {
            type: "unit_knockback",
            unitId: "u1",
            from: { row: 2, col: 2 },
            to: { row: 3, col: 2 },
            blockedBy: "u2",
          },
        ],
        state,
      );

      expect(newState.units["u1"]?.position).toEqual({ row: 2, col: 2 });
    });
  });

  describe("unit_river_enter", () => {
    it("clears all effects and moves unit to river", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 2, 2)
        .build();

      const newState = applicator.apply(
        [
          {
            type: "unit_river_enter",
            unitId: "u1",
            position: { row: 2, col: 5 },
            clearedEffectIds: ["effect_freeze"],
            clearedAttributes: [],
          },
        ],
        state,
      );

      expect(newState.units["u1"]?.activeEffects).toHaveLength(0);
      expect(newState.units["u1"]?.position).toEqual({ row: 2, col: 5 });
    });
  });

  describe("round_advance", () => {
    it("increments round number", () => {
      const state = TestStateBuilder.create().build();
      const newState = applicator.apply([{ type: "round_advance", from: 1, to: 2 }], state);
      expect(newState.round).toBe(2);
    });
  });

  describe("phase_change", () => {
    it("changes game phase", () => {
      const state = TestStateBuilder.create().build();
      const newState = applicator.apply(
        [{ type: "phase_change", from: "battle", to: "result" }],
        state,
      );
      expect(newState.phase).toBe("result");
    });
  });

  describe("chained changes", () => {
    it("applies multiple changes in sequence", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0, { currentHealth: 6 })
        .build();

      const newState = applicator.apply(
        [
          { type: "unit_move", unitId: "u1", from: { row: 0, col: 0 }, to: { row: 1, col: 0 } },
          {
            type: "unit_damage",
            unitId: "u1",
            amount: 2,
            source: { type: "effect", effectId: "effect_fire" },
            hpAfter: 4,
          },
          {
            type: "unit_effect_add",
            unitId: "u1",
            effectId: "effect_fire",
            effectType: "fire",
            turnsRemaining: 3,
          },
        ],
        state,
      );

      expect(newState.units["u1"]?.position).toEqual({ row: 1, col: 0 });
      expect(newState.units["u1"]?.currentHealth).toBe(4);
      expect(newState.units["u1"]?.activeEffects).toHaveLength(1);
      expect(newState.units["u1"]?.activeEffects[0]?.effectType).toBe("fire");
    });
  });
});
