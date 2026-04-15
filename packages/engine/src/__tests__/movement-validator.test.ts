import { describe, it, expect } from "vitest";
import { MovementValidator } from "../validators/movement-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

const registry = makeRegistry();
const validator = new MovementValidator(registry);

describe("MovementValidator", () => {
  describe("validateMove", () => {
    it("allows valid move within range", () => {
      const state = TestStateBuilder.create().withUnit("u1", "t1", "p1", 5, 5).build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 5, col: 7 }, state); // 2 steps
      expect(result.valid).toBe(true);
    });

    it("rejects move when frozen", () => {
      const state = TestStateBuilder.create().withFrozenUnit("u1", "t1", "p1", 5, 5).build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toContain("frozen");
    });

    it("rejects move if already moved", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5, {
          actionsUsed: { moved: true, attacked: false, skillUsed: false, extinguished: false },
        })
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
    });

    it("rejects move to mountain tile", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withTile(5, 6, "mountain")
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toContain("mountain");
    });

    it("rejects move to occupied tile (cannot stop on unit)", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
    });

    it("rejects move to river tile (cannot stop)", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withTile(5, 6, "river")
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
    });

    it("rejects move beyond movement range", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0, { movementPoints: 2 })
        .build();
      const unit = state.units["u1"]!;
      // 3 steps away — beyond range of 2
      const result = validator.validateMove(unit, { row: 0, col: 3 }, state);
      expect(result.valid).toBe(false);
    });

    it("allows passing through occupied tile but not stopping", () => {
      // u1 at 0,0, u2 at 0,1, u1 wants to reach 0,2
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0)
        .withUnit("u2", "f1", "p2", 0, 1)
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 0, col: 2 }, state);
      expect(result.valid).toBe(true);
    });

    it("river tile costs 2 movement per tile", () => {
      // u1 at 0,0 with 3 movement, river at 0,1, destination 0,2
      // Cost: plain(0→river=2) + exit_river(0,2=1) = 3 total → valid
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0, { movementPoints: 3 })
        .withTile(0, 1, "river")
        .build();
      const unit = state.units["u1"]!;
      const result = validator.validateMove(unit, { row: 0, col: 2 }, state);
      expect(result.valid).toBe(true);
    });

    it("insufficient MP to cross river", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 0, 0, { movementPoints: 2 })
        .withTile(0, 1, "river")
        .withTile(0, 2, "river")
        .build();
      const unit = state.units["u1"]!;
      // To reach 0,3: cost 2+2+1=5 — way over budget of 2
      const result = validator.validateMove(unit, { row: 0, col: 3 }, state);
      expect(result.valid).toBe(false);
    });
  });

  describe("getReachableTiles", () => {
    it("returns reachable tiles for a unit with 3 movement", () => {
      const state = TestStateBuilder.create().withUnit("u1", "t1", "p1", 5, 5).build();
      const unit = state.units["u1"]!;
      const tiles = validator.getReachableTiles(unit, state);
      // Manhattan distance ≤ 3, no obstacles
      expect(tiles.length).toBeGreaterThan(0);
      // Should not include start position
      expect(tiles.some((t) => t.row === 5 && t.col === 5)).toBe(false);
    });

    it("returns empty array for frozen unit", () => {
      const state = TestStateBuilder.create().withFrozenUnit("u1", "t1", "p1", 5, 5).build();
      const unit = state.units["u1"]!;
      expect(validator.getReachableTiles(unit, state)).toHaveLength(0);
    });

    it("returns empty array for already-moved unit", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5, {
          actionsUsed: { moved: true, attacked: false, skillUsed: false, extinguished: false },
        })
        .build();
      const unit = state.units["u1"]!;
      expect(validator.getReachableTiles(unit, state)).toHaveLength(0);
    });
  });
});
