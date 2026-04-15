/**
 * MovementResolver — tile entry effects: fire, water, acid, electric, ice, sand.
 */
import { describe, it, expect } from "vitest";
import type { GameState, TileState } from "@ab/metadata";
import { MovementResolver } from "../resolvers/movement-resolver.js";
import { MovementValidator } from "../validators/movement-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

function makeResolver() {
  const registry = makeRegistry();
  const validator = new MovementValidator(registry);
  return { resolver: new MovementResolver(validator, registry), registry };
}

describe("MovementResolver", () => {
  describe("basic movement", () => {
    it("emits unit_move change for valid move", () => {
      const { resolver } = makeResolver();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const moveChange = changes.find(c => c.type === "unit_move") as Extract<(typeof changes)[number], { type: "unit_move" }> | undefined;
      expect(moveChange).toBeDefined();
      expect(moveChange!.from).toEqual({ row: 5, col: 5 });
      expect(moveChange!.to).toEqual({ row: 5, col: 7 });
    });

    it("returns empty if move validation fails", () => {
      const { resolver } = makeResolver();
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      // Destination way out of range
      const changes = resolver.resolve(state.units["u1"]!, { row: 0, col: 0 }, state);
      expect(changes).toHaveLength(0);
    });
  });

  describe("tile entry effects", () => {
    it("stepping on fire tile applies fire effect", () => {
      const { resolver } = makeResolver();
      const fireTile: TileState = { position: { row: 5, col: 7 }, attribute: "fire" };
      const state: GameState = {
        ...TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": fireTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const effectAdd = changes.find(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire");
      expect(effectAdd).toBeDefined();
    });

    it("does not add fire effect if unit already has fire", () => {
      const { resolver } = makeResolver();
      const fireEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_fire" as import("@ab/metadata").MetaId,
        effectType: "fire",
        turnsRemaining: 2,
        appliedOnTurn: 1,
      };
      const fireTile: TileState = { position: { row: 5, col: 7 }, attribute: "fire" };
      const state: GameState = {
        ...TestStateBuilder.create()
          .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
          .build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": fireTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const fireAdds = changes.filter(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire");
      expect(fireAdds).toHaveLength(0);
    });

    it("stepping on water tile removes fire and acid effects", () => {
      const { resolver } = makeResolver();
      const fireEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_fire" as import("@ab/metadata").MetaId,
        effectType: "fire",
        turnsRemaining: 2,
        appliedOnTurn: 1,
      };
      const acidEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_acid" as import("@ab/metadata").MetaId,
        effectType: "acid",
        turnsRemaining: 1,
        appliedOnTurn: 1,
      };
      const waterTile: TileState = { position: { row: 5, col: 7 }, attribute: "water" };
      const state: GameState = {
        ...TestStateBuilder.create()
          .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect, acidEffect] })
          .build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": waterTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const removes = changes.filter(c => c.type === "unit_effect_remove");
      expect(removes.length).toBe(2);
    });

    it("stepping on acid tile applies acid effect", () => {
      const { resolver } = makeResolver();
      const acidTile: TileState = { position: { row: 5, col: 7 }, attribute: "acid" };
      const state: GameState = {
        ...TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": acidTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const acidAdd = changes.find(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "acid");
      expect(acidAdd).toBeDefined();
    });

    it("stepping on electric tile applies electric effect", () => {
      const { resolver } = makeResolver();
      const electricTile: TileState = { position: { row: 5, col: 7 }, attribute: "electric" };
      const state: GameState = {
        ...TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": electricTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const electricAdd = changes.find(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "electric");
      expect(electricAdd).toBeDefined();
    });

    it("stepping on ice tile applies freeze and clears other effects", () => {
      const { resolver } = makeResolver();
      const fireEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_fire" as import("@ab/metadata").MetaId,
        effectType: "fire",
        turnsRemaining: 2,
        appliedOnTurn: 1,
      };
      const iceTile: TileState = { position: { row: 5, col: 7 }, attribute: "ice" };
      const state: GameState = {
        ...TestStateBuilder.create()
          .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
          .build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": iceTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      // Fire should be removed first
      const fireRemove = changes.find(c => c.type === "unit_effect_remove" &&
        (c as Extract<typeof c, { type: "unit_effect_remove" }>).effectType === "fire");
      expect(fireRemove).toBeDefined();
      // Then freeze added
      const freezeAdd = changes.find(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "freeze");
      expect(freezeAdd).toBeDefined();
    });

    it("stepping on sand tile applies sand effect", () => {
      const { resolver } = makeResolver();
      const sandTile: TileState = { position: { row: 5, col: 7 }, attribute: "sand" };
      const state: GameState = {
        ...TestStateBuilder.create().withUnit("u1", "f1", "p1", 5, 5).build(),
        map: {
          mapId: "map_test" as import("@ab/metadata").MetaId,
          gridSize: 11,
          tiles: { "5,7": sandTile },
        },
      };

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 7 }, state);
      const sandAdd = changes.find(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "sand");
      expect(sandAdd).toBeDefined();
    });
  });
});
