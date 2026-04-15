import { describe, it, expect } from "vitest";
import { EffectResolver } from "../resolvers/effect-resolver.js";
import { EffectValidator } from "../validators/effect-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

const registry = makeRegistry();
const validator = new EffectValidator(registry);
const resolver = new EffectResolver(validator, registry);

describe("EffectResolver", () => {
  describe("resolveTurnTick", () => {
    it("deals fire damage per turn", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          currentHealth: 4,
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveTurnTick(unit, state);

      const dmgChange = changes.find((c) => c.type === "unit_damage");
      expect(dmgChange).toBeDefined();
      if (dmgChange?.type === "unit_damage") {
        expect(dmgChange.amount).toBe(1);
      }
    });

    it("decrements fire turns and removes on expiry", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          currentHealth: 4,
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 1, // last turn
              appliedOnTurn: 1,
            },
          ],
        })
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveTurnTick(unit, state);

      const removeChange = changes.find((c) => c.type === "unit_effect_remove");
      expect(removeChange).toBeDefined();
    });

    it("deals tile fire damage when standing on fire tile", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, { currentHealth: 4 })
        .withTile(5, 5, "fire")
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveTurnTick(unit, state);

      const dmgChange = changes.find((c) => c.type === "unit_damage");
      expect(dmgChange).toBeDefined();
      if (dmgChange?.type === "unit_damage") {
        expect(dmgChange.source.type).toBe("tile");
        expect(dmgChange.amount).toBe(2); // fire tile deals 2/turn
      }
    });

    it("freeze effect does not deal damage", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveTurnTick(unit, state);

      const dmgChange = changes.find((c) => c.type === "unit_damage");
      expect(dmgChange).toBeUndefined();
    });
  });

  describe("resolveApply", () => {
    it("applies fire effect to unit", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveApply("effect_fire", unit, state);

      const addChange = changes.find((c) => c.type === "unit_effect_add");
      expect(addChange).toBeDefined();
      if (addChange?.type === "unit_effect_add") {
        expect(addChange.effectType).toBe("fire");
      }
    });

    it("applying freeze clears all existing effects", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveApply("effect_freeze", unit, state);

      const removeChange = changes.find((c) => c.type === "unit_effect_remove");
      expect(removeChange).toBeDefined();
    });

    it("applying acid also converts tile", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveApply("effect_acid", unit, state);

      const tileChange = changes.find((c) => c.type === "tile_attribute_change");
      expect(tileChange).toBeDefined();
      if (tileChange?.type === "tile_attribute_change") {
        expect(tileChange.to).toBe("acid");
      }
    });
  });

  describe("resolveRemove", () => {
    it("removes fire effect by manual extinguish", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveRemove("effect_fire", unit, "manual_extinguish");

      const removeChange = changes.find((c) => c.type === "unit_effect_remove");
      expect(removeChange).toBeDefined();
    });

    it("cannot remove freeze by manual_extinguish", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      const changes = resolver.resolveRemove("effect_freeze", unit, "manual_extinguish");
      // Freeze cannot be extinguished
      expect(changes).toHaveLength(0);
    });
  });
});
