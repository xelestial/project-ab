import { describe, it, expect } from "vitest";
import { PositionSchema, ValidationResultSchema, VALID, invalid } from "../schemas/base.js";
import { GameChangeSchema } from "../schemas/game-change.js";
import { PlayerActionSchema } from "../schemas/player-action.js";

describe("PositionSchema", () => {
  it("accepts valid position", () => {
    expect(PositionSchema.parse({ row: 0, col: 10 })).toEqual({ row: 0, col: 10 });
  });

  it("rejects negative row", () => {
    expect(() => PositionSchema.parse({ row: -1, col: 5 })).toThrow();
  });

  it("accepts row > 10 (grid size is now map-specific, no fixed max)", () => {
    // PositionSchema no longer enforces an upper bound — each map defines gridSize.
    expect(PositionSchema.parse({ row: 15, col: 14 })).toEqual({ row: 15, col: 14 });
  });

  it("rejects fractional values", () => {
    expect(() => PositionSchema.parse({ row: 1.5, col: 0 })).toThrow();
  });
});

describe("ValidationResult helpers", () => {
  it("VALID is valid:true", () => {
    expect(VALID.valid).toBe(true);
  });

  it("invalid() produces valid:false with errorCode", () => {
    const r = invalid("error.move.frozen");
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errorCode).toBe("error.move.frozen");
    }
  });
});

describe("GameChangeSchema", () => {
  it("parses unit_move change", () => {
    const raw = {
      type: "unit_move",
      unitId: "u1",
      from: { row: 0, col: 0 },
      to: { row: 1, col: 1 },
    };
    const c = GameChangeSchema.parse(raw);
    expect(c.type).toBe("unit_move");
  });

  it("parses unit_death change", () => {
    const raw = {
      type: "unit_death",
      unitId: "u2",
      position: { row: 3, col: 3 },
      killedBy: { type: "effect", effectId: "effect_fire" },
    };
    const c = GameChangeSchema.parse(raw);
    expect(c.type).toBe("unit_death");
  });

  it("parses tile_attribute_change", () => {
    const raw = {
      type: "tile_attribute_change",
      position: { row: 5, col: 5 },
      from: "plain",
      to: "fire",
      causedBy: { attackerId: "u1", attribute: "fire" },
    };
    const c = GameChangeSchema.parse(raw);
    expect(c.type).toBe("tile_attribute_change");
  });

  it("rejects unknown change type", () => {
    expect(() => GameChangeSchema.parse({ type: "teleport" })).toThrow();
  });
});

describe("PlayerActionSchema", () => {
  it("parses move action", () => {
    const raw = {
      type: "move",
      playerId: "p1",
      unitId: "u1",
      destination: { row: 3, col: 4 },
    };
    const a = PlayerActionSchema.parse(raw);
    expect(a.type).toBe("move");
  });

  it("parses attack action", () => {
    const raw = {
      type: "attack",
      playerId: "p1",
      unitId: "u1",
      target: { row: 5, col: 5 },
    };
    const a = PlayerActionSchema.parse(raw);
    expect(a.type).toBe("attack");
  });

  it("parses pass action", () => {
    const raw = { type: "pass", playerId: "p1", unitId: "u1" };
    const a = PlayerActionSchema.parse(raw);
    expect(a.type).toBe("pass");
  });

  it("rejects action without playerId", () => {
    expect(() =>
      PlayerActionSchema.parse({ type: "move", unitId: "u1", destination: { row: 0, col: 0 } }),
    ).toThrow();
  });
});
