/**
 * TileValidator unit tests — canConvertTile / resolveConversion / countWaterNeighbors.
 */
import { describe, it, expect } from "vitest";
import { TileValidator } from "../validators/tile-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

function makeValidator() {
  return new TileValidator(makeRegistry());
}

// ─── canConvertTile ────────────────────────────────────────────────────────────

describe("TileValidator.canConvertTile", () => {
  it("returns valid for fire attribute (last attack wins)", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create().build();

    const result = v.canConvertTile({ row: 3, col: 3 }, "fire", state);
    expect(result.valid).toBe(true);
  });

  it("returns valid for none attribute (no-op conversion)", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create().build();

    const result = v.canConvertTile({ row: 5, col: 5 }, "none", state);
    expect(result.valid).toBe(true);
  });

  it("returns valid for water attribute", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create().build();

    const result = v.canConvertTile({ row: 0, col: 0 }, "water", state);
    expect(result.valid).toBe(true);
  });

  it("returns valid even for mountain tiles (impassable but attackable)", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create()
      .withTile(2, 2, "mountain")
      .build();

    const result = v.canConvertTile({ row: 2, col: 2 }, "fire", state);
    expect(result.valid).toBe(true);
  });

  it("returns valid for ice attribute", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create().build();

    const result = v.canConvertTile({ row: 1, col: 1 }, "ice", state);
    expect(result.valid).toBe(true);
  });
});

// ─── resolveConversion ────────────────────────────────────────────────────────

describe("TileValidator.resolveConversion", () => {
  it("returns current attribute unchanged when attackAttr is none", () => {
    const v = makeValidator();
    expect(v.resolveConversion("fire", "none")).toBe("fire");
    expect(v.resolveConversion("plain", "none")).toBe("plain");
    expect(v.resolveConversion("water", "none")).toBe("water");
  });

  it("overwrites plain with fire", () => {
    const v = makeValidator();
    expect(v.resolveConversion("plain", "fire")).toBe("fire");
  });

  it("overwrites fire with water", () => {
    const v = makeValidator();
    expect(v.resolveConversion("fire", "water")).toBe("water");
  });

  it("overwrites water with ice", () => {
    const v = makeValidator();
    expect(v.resolveConversion("water", "ice")).toBe("ice");
  });

  it("overwrites acid with sand", () => {
    const v = makeValidator();
    expect(v.resolveConversion("acid", "sand")).toBe("sand");
  });

  it("last attack always wins — fire over ice", () => {
    const v = makeValidator();
    expect(v.resolveConversion("ice", "fire")).toBe("fire");
  });
});

// ─── countWaterNeighbors ──────────────────────────────────────────────────────

describe("TileValidator.countWaterNeighbors", () => {
  it("returns 0 when all neighbors are plain", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create().build();

    // position (5,5) on an 11×11 grid — no tile overrides means all plain
    expect(v.countWaterNeighbors({ row: 5, col: 5 }, state)).toBe(0);
  });

  it("counts one water neighbor", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create()
      .withTile(4, 5, "water")
      .build();

    expect(v.countWaterNeighbors({ row: 5, col: 5 }, state)).toBe(1);
  });

  it("counts two water/river neighbors", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create()
      .withTile(4, 5, "water")
      .withTile(5, 4, "river")
      .build();

    expect(v.countWaterNeighbors({ row: 5, col: 5 }, state)).toBe(2);
  });

  it("counts all four orthogonal water neighbors", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create()
      .withTile(4, 5, "water")
      .withTile(6, 5, "water")
      .withTile(5, 4, "water")
      .withTile(5, 6, "river")
      .build();

    expect(v.countWaterNeighbors({ row: 5, col: 5 }, state)).toBe(4);
  });

  it("does not count diagonal water tiles", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create()
      .withTile(4, 4, "water") // diagonal, not orthogonal
      .build();

    expect(v.countWaterNeighbors({ row: 5, col: 5 }, state)).toBe(0);
  });

  it("handles edge position (top-left corner, 2 neighbors)", () => {
    const v = makeValidator();
    const state = TestStateBuilder.create()
      .withTile(0, 1, "water")
      .withTile(1, 0, "water")
      .build();

    // position (0,0) has only 2 orthogonal neighbors
    expect(v.countWaterNeighbors({ row: 0, col: 0 }, state)).toBe(2);
  });
});
