/**
 * TileResolver — tile attribute conversion + unit standing effect changes.
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, TileState } from "@ab/metadata";
import { TileResolver } from "../resolvers/tile-resolver.js";
import { TileValidator } from "../validators/tile-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

function makeResolver() {
  const registry = makeRegistry();
  const validator = new TileValidator(registry);
  return new TileResolver(validator, registry);
}

function makeState(
  units: Record<string, import("@ab/metadata").UnitState> = {},
  tiles: Record<string, TileState> = {},
): GameState {
  const now = new Date().toISOString();
  const p1Units = Object.values(units).filter(u => u.playerId === "p1").map(u => u.unitId);
  const p2Units = Object.values(units).filter(u => u.playerId === "p2").map(u => u.unitId);
  return {
    gameId: "test" as import("@ab/metadata").GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: "p1" as import("@ab/metadata").PlayerId, priority: 1 },
      { playerId: "p2" as import("@ab/metadata").PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: p1Units, connected: true, surrendered: false },
      p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: p2Units, connected: true, surrendered: false },
    },
    units,
    map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles },
    createdAt: now,
    updatedAt: now,
  };
}

describe("TileResolver", () => {
  it("returns empty changes for 'none' attribute", () => {
    const resolver = makeResolver();
    const state = makeState();
    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "none", "u1", "wpn1", state);
    expect(changes).toHaveLength(0);
  });

  it("converts plain tile to fire tile", () => {
    const resolver = makeResolver();
    const state = makeState();

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "fire", "u1", "wpn1", state);
    expect(changes.length).toBeGreaterThan(0);
    const tileChange = changes.find(c => c.type === "tile_attribute_change") as Extract<(typeof changes)[number], { type: "tile_attribute_change" }> | undefined;
    expect(tileChange).toBeDefined();
    expect(tileChange!.to).toBe("fire");
    expect(tileChange!.from).toBe("plain");
  });

  it("returns empty if tile is already the same attribute", () => {
    const resolver = makeResolver();
    // Fire tile already at position
    const fireTile: TileState = { position: { row: 5, col: 5 }, attribute: "fire" };
    const state = makeState({}, { "5,5": fireTile });

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "fire", "u1", "wpn1", state);
    expect(changes.filter(c => c.type === "tile_attribute_change")).toHaveLength(0);
  });

  it("applies fire effect to unit standing on converted fire tile", () => {
    const resolver = makeResolver();
    const unit: import("@ab/metadata").UnitState = {
      unitId: "u1" as import("@ab/metadata").UnitId,
      metaId: "f1" as import("@ab/metadata").MetaId,
      playerId: "p1" as import("@ab/metadata").PlayerId,
      position: { row: 5, col: 5 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };
    const state = makeState({ u1: unit });

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "fire", "u2", "wpn1", state);

    const effectAdd = changes.find(c => c.type === "unit_effect_add" &&
      (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire");
    expect(effectAdd).toBeDefined();
  });

  it("removes fire effect from unit standing on tile converted to water", () => {
    const resolver = makeResolver();
    const fireEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as import("@ab/metadata").MetaId,
      effectType: "fire",
      turnsRemaining: 2,
      appliedOnTurn: 1,
    };
    const unit: import("@ab/metadata").UnitState = {
      unitId: "u1" as import("@ab/metadata").UnitId,
      metaId: "f1" as import("@ab/metadata").MetaId,
      playerId: "p1" as import("@ab/metadata").PlayerId,
      position: { row: 5, col: 5 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [fireEffect],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };
    const state = makeState({ u1: unit });

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "water", "u2", "wpn1", state);

    const fireRemove = changes.find(c => c.type === "unit_effect_remove" &&
      (c as Extract<typeof c, { type: "unit_effect_remove" }>).effectType === "fire");
    expect(fireRemove).toBeDefined();
  });

  it("applies electric effect to unit standing on converted electric tile", () => {
    const resolver = makeResolver();
    const unit: import("@ab/metadata").UnitState = {
      unitId: "u1" as import("@ab/metadata").UnitId,
      metaId: "f1" as import("@ab/metadata").MetaId,
      playerId: "p1" as import("@ab/metadata").PlayerId,
      position: { row: 5, col: 5 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };
    const state = makeState({ u1: unit });

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "electric", "u2", "wpn1", state);

    const effectAdd = changes.find(c => c.type === "unit_effect_add" &&
      (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "electric");
    expect(effectAdd).toBeDefined();
  });

  it("applies freeze to unit standing on converted ice tile", () => {
    const resolver = makeResolver();
    const unit: import("@ab/metadata").UnitState = {
      unitId: "u1" as import("@ab/metadata").UnitId,
      metaId: "f1" as import("@ab/metadata").MetaId,
      playerId: "p1" as import("@ab/metadata").PlayerId,
      position: { row: 5, col: 5 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };
    const state = makeState({ u1: unit });

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "ice", "u2", "wpn1", state);

    const freezeAdd = changes.find(c => c.type === "unit_effect_add" &&
      (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "freeze");
    expect(freezeAdd).toBeDefined();
  });

  it("does not add fire effect if unit already has fire", () => {
    const resolver = makeResolver();
    const fireEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as import("@ab/metadata").MetaId,
      effectType: "fire",
      turnsRemaining: 2,
      appliedOnTurn: 1,
    };
    const unit: import("@ab/metadata").UnitState = {
      unitId: "u1" as import("@ab/metadata").UnitId,
      metaId: "f1" as import("@ab/metadata").MetaId,
      playerId: "p1" as import("@ab/metadata").PlayerId,
      position: { row: 5, col: 5 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [fireEffect],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };
    const state = makeState({ u1: unit });

    const changes = resolver.resolveAttributeConversion({ row: 5, col: 5 }, "fire", "u2", "wpn1", state);

    // Tile conversion should still happen, but no duplicate fire effect
    const fireAdds = changes.filter(c => c.type === "unit_effect_add" &&
      (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire");
    expect(fireAdds).toHaveLength(0);
  });
});
