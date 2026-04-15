import { describe, it, expect } from "vitest";
import { RandomAdapter } from "../heuristic/random-adapter.js";
import { MovementValidator, AttackValidator } from "@ab/engine";
import { makeRegistry, TestStateBuilder } from "../../src/__tests__/test-helpers.js";

// Re-use test helpers from engine (path alias resolves correctly)
import { buildDataRegistry } from "@ab/metadata";

// ── inline fixture (same as engine test-helpers) ──────────────────────────────
const UNITS = [
  {
    id: "t1",
    nameKey: "unit.t1.name", descKey: "unit.t1.desc",
    class: "tanker", faction: "a", baseMovement: 3, baseHealth: 6, baseArmor: 1,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
  },
  {
    id: "f1",
    nameKey: "unit.f1.name", descKey: "unit.f1.desc",
    class: "fighter", faction: "b", baseMovement: 3, baseHealth: 4, baseArmor: 0,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
  },
];
const WEAPONS = [
  {
    id: "wpn_melee", nameKey: "w", descKey: "w",
    attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1,
    damage: 2, attribute: "none", penetrating: false, arcing: false,
  },
];
const reg = buildDataRegistry({
  units: UNITS, weapons: WEAPONS, skills: [], effects: [],
  tiles: [
    { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
    { id: "tile_mountain", tileType: "mountain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: true, damagePerTurn: 0 },
  ],
  maps: [
    {
      id: "map_test", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 0, col: 0 }] },
        { playerId: 1, positions: [{ row: 10, col: 10 }] },
      ],
    },
  ],
});

describe("RandomAdapter", () => {
  it("returns a valid action type", async () => {
    const mv = new MovementValidator(reg);
    const av = new AttackValidator(reg);
    const adapter = new RandomAdapter("p1", mv, av);

    const state: import("@ab/metadata").GameState = {
      gameId: "g1" as import("@ab/metadata").GameId,
      phase: "battle",
      round: 1,
      turnOrder: [{ playerId: "p1" as import("@ab/metadata").PlayerId, priority: 1 }],
      currentTurnIndex: 0,
      players: {
        p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: ["u1"] as import("@ab/metadata").UnitId[], connected: true, surrendered: false },
        p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: ["u2"] as import("@ab/metadata").UnitId[], connected: true, surrendered: false },
      },
      units: {
        u1: {
          unitId: "u1" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          playerId: "p1" as import("@ab/metadata").PlayerId,
          position: { row: 5, col: 5 },
          currentHealth: 6, currentArmor: 1, movementPoints: 3,
          activeEffects: [],
          actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
          alive: true,
        },
        u2: {
          unitId: "u2" as import("@ab/metadata").UnitId,
          metaId: "f1" as import("@ab/metadata").MetaId,
          playerId: "p2" as import("@ab/metadata").PlayerId,
          position: { row: 5, col: 6 },
          currentHealth: 4, currentArmor: 0, movementPoints: 3,
          activeEffects: [],
          actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
          alive: true,
        },
      },
      map: { mapId: "map_test" as import("@ab/metadata").MetaId, tiles: {} },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const action = await adapter.requestAction(state, 5000);
    expect(["move", "attack", "pass"]).toContain(action.type);
    expect(action.playerId).toBe("p1");
  });

  it("calls onStateUpdate without throwing", () => {
    const mv = new MovementValidator(reg);
    const av = new AttackValidator(reg);
    const adapter = new RandomAdapter("p1", mv, av);
    expect(() => adapter.onStateUpdate({} as import("@ab/metadata").GameState)).not.toThrow();
  });
});
