import { describe, it, expect } from "vitest";
import { AttackValidator } from "../validators/attack-validator.js";
import { TestStateBuilder, makeRegistry, FIXTURE_UNITS, FIXTURE_WEAPONS } from "./test-helpers.js";
import { buildDataRegistry } from "@ab/metadata";

const registry = makeRegistry();
const validator = new AttackValidator(registry);

describe("AttackValidator", () => {
  describe("melee attack", () => {
    it("allows melee attack on adjacent unit", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(true);
    });

    it("rejects melee attack out of range", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 7)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 7 }, state);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toContain("range");
    });

    it("rejects attack when frozen", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toContain("frozen");
    });

    it("rejects attack if already attacked", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5, {
          actionsUsed: { moved: false, attacked: true, skillUsed: false, extinguished: false },
        })
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
    });
  });

  describe("ranged attack", () => {
    // Need a unit with ranged weapon (r1 uses wpn_ranged_basic: range 2-4)
    it("allows ranged attack within range", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "r1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 7) // distance 2
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 7 }, state);
      expect(result.valid).toBe(true);
    });

    it("rejects ranged attack at minimum range (too close)", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "r1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6) // distance 1 — below minRange 2
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
    });

    it("ranged attack has free targeting — no LOS requirement", () => {
      // Mountains between attacker and target — still valid for ranged
      const state = TestStateBuilder.create()
        .withUnit("u1", "r1", "p1", 5, 5)
        .withTile(5, 6, "mountain")
        .withUnit("u2", "f1", "p2", 5, 7)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 7 }, state);
      expect(result.valid).toBe(true);
    });
  });

  describe("affected positions", () => {
    it("single-target attack returns one affected position", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateAttack(unit, { row: 5, col: 6 }, state);
      expect(result.affectedPositions).toHaveLength(1);
      expect(result.affectedPositions?.[0]?.isPrimary).toBe(true);
    });
  });

  describe("getAttackableTargets", () => {
    it("returns all positions in melee range", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      const targets = validator.getAttackableTargets(unit, state);
      // All positions at manhattan distance 1 (4 orthogonal)
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.every((t) => Math.abs(t.row - 5) + Math.abs(t.col - 5) === 1)).toBe(true);
    });

    it("returns empty for frozen unit", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      expect(validator.getAttackableTargets(unit, state)).toHaveLength(0);
    });
  });
});
