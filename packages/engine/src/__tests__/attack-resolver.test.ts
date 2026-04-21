/**
 * AttackResolver — damage, knockback, tile conversion, attribute effects.
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState } from "@ab/metadata";
import { AttackResolver } from "../resolvers/attack-resolver.js";
import { AttackValidator } from "../validators/attack-validator.js";
import { TestStateBuilder, makeRegistry, makeTileTransitionResolver, FIXTURE_WEAPONS, FIXTURE_EFFECTS, FIXTURE_TILES, FIXTURE_ELEMENTAL_REACTIONS } from "./test-helpers.js";

// ─── Helper registry builders ─────────────────────────────────────────────────

const EFFECT_FREEZE = {
  id: "effect_freeze", nameKey: "e", descKey: "e", effectType: "freeze",
  damagePerTurn: 0, blocksAllActions: true, alsoAffectsTile: false,
  removeConditions: [{ type: "turns", count: 1 }, { type: "collision_with_frozen" }],
};
const EFFECT_FIRE = {
  id: "effect_fire", nameKey: "e", descKey: "e", effectType: "fire",
  damagePerTurn: 1, blocksAllActions: false, alsoAffectsTile: false,
  removeConditions: [{ type: "turns", count: 3 }],
};
const EFFECT_ACID = {
  id: "effect_acid", nameKey: "e", descKey: "e", effectType: "acid",
  damagePerTurn: 1, blocksAllActions: false, alsoAffectsTile: true,
  removeConditions: [{ type: "turns", count: 3 }],
};
const TILE_PLAIN = { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 };
const TILE_FIRE = { id: "tile_fire", tileType: "fire", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 2, appliesEffectId: "effect_fire" };
const TILE_WATER = { id: "tile_water", tileType: "water", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, removesEffectTypes: ["fire", "acid"] };

function makeUnitState(
  id: string, meta: string, player: string, row: number, col: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    unitId: id as import("@ab/metadata").UnitId,
    metaId: meta as import("@ab/metadata").MetaId,
    playerId: player as import("@ab/metadata").PlayerId,
    position: { row, col },
    currentHealth: 4, currentArmor: 0, movementPoints: 3,
    activeEffects: [] as import("@ab/metadata").ActiveEffect[],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
    ...overrides,
  } as import("@ab/metadata").UnitState;
}

function makeState(units: Record<string, import("@ab/metadata").UnitState>, tiles: Record<string, import("@ab/metadata").TileState> = {}): GameState {
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AttackResolver", () => {
  describe("basic damage", () => {
    it("deals base damage minus armor to target", () => {
      const registry = makeRegistry();
      const validator = new AttackValidator(registry);
      const resolver = new AttackResolver(validator, registry, makeTileTransitionResolver(registry));

      // t1 = tanker, uses wpn_melee_basic (damage 2), target has armor 1
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6, { currentArmor: 1 })
        .build();

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 6 }, state);
      const dmg = changes.find(c => c.type === "unit_damage") as Extract<(typeof changes)[number], { type: "unit_damage" }> | undefined;
      expect(dmg).toBeDefined();
      expect(dmg!.amount).toBe(1); // 2 base - 1 armor
      expect(dmg!.hpAfter).toBe(3); // target had 4 HP
    });

    it("deals 0 damage when armor exceeds base damage", () => {
      const registry = makeRegistry();
      const validator = new AttackValidator(registry);
      const resolver = new AttackResolver(validator, registry, makeTileTransitionResolver(registry));

      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6, { currentArmor: 5 })
        .build();

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 6 }, state);
      expect(changes.filter(c => c.type === "unit_damage")).toHaveLength(0);
    });

    it("doubles damage on acid-affected target", () => {
      const registry = makeRegistry();
      const validator = new AttackValidator(registry);
      const resolver = new AttackResolver(validator, registry, makeTileTransitionResolver(registry));

      const acidEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_acid" as import("@ab/metadata").MetaId,
        effectType: "acid",
        turnsRemaining: 2,
        appliedOnTurn: 1,
      };
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 5, 6, { activeEffects: [acidEffect] })
        .build();

      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 6 }, state);
      const dmg = changes.find(c => c.type === "unit_damage") as Extract<(typeof changes)[number], { type: "unit_damage" }> | undefined;
      expect(dmg).toBeDefined();
      expect(dmg!.amount).toBe(4); // (2 - 0) * 2 = 4
    });

    it("returns empty if attack validation fails", () => {
      const registry = makeRegistry();
      const validator = new AttackValidator(registry);
      const resolver = new AttackResolver(validator, registry, makeTileTransitionResolver(registry));

      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 9, 9)
        .build();

      const changes = resolver.resolve(state.units["u1"]!, { row: 9, col: 9 }, state);
      expect(changes).toHaveLength(0);
    });

    it("no damage change if target tile is empty", () => {
      const registry = makeRegistry();
      const validator = new AttackValidator(registry);
      const resolver = new AttackResolver(validator, registry, makeTileTransitionResolver(registry));

      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      // valid range but no enemy present
      const changes = resolver.resolve(state.units["u1"]!, { row: 5, col: 6 }, state);
      expect(changes.filter(c => c.type === "unit_damage")).toHaveLength(0);
    });
  });

  describe("knockback", () => {
    const KB_UNIT_A = { id: "kbu", nameKey: "u", descKey: "u", class: "fighter", faction: "a",
      baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn_kb", skillIds: [], spriteKey: "s" };
    const KB_UNIT_B = { ...KB_UNIT_A, id: "kbu2", faction: "b" };
    const KB_UNIT_C = { ...KB_UNIT_A, id: "kbu3", faction: "b" };
    const KB_WEAPON = { id: "wpn_kb", nameKey: "w", descKey: "w",
      attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1,
      damage: 2, attribute: "none", penetrating: false, arcing: false,
      knockback: { distance: 1, direction: "away" } };

    it("pushes target away into free tile", () => {
      const reg = buildDataRegistry({ units: [KB_UNIT_A, KB_UNIT_B], weapons: [KB_WEAPON], skills: [], effects: [], tiles: [TILE_PLAIN], maps: [] });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const u1 = makeUnitState("u1", "kbu", "p1", 5, 4);
      const u2 = makeUnitState("u2", "kbu2", "p2", 5, 5);
      const state = makeState({ u1, u2 });

      const changes = resolver.resolve(u1, { row: 5, col: 5 }, state);
      const kb = changes.find(c => c.type === "unit_knockback") as Extract<(typeof changes)[number], { type: "unit_knockback" }> | undefined;
      expect(kb).toBeDefined();
      expect(kb!.to).toEqual({ row: 5, col: 6 }); // pushed right
    });

    it("knockback into wall stops unit without damage", () => {
      const reg = buildDataRegistry({ units: [KB_UNIT_A, KB_UNIT_B], weapons: [KB_WEAPON], skills: [], effects: [], tiles: [TILE_PLAIN], maps: [] });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      // Place target at col 10 (edge), pushed right would go col 11 (OOB)
      const u1 = makeUnitState("u1", "kbu", "p1", 5, 9);
      const u2 = makeUnitState("u2", "kbu2", "p2", 5, 10);
      const state = makeState({ u1, u2 });

      const changes = resolver.resolve(u1, { row: 5, col: 10 }, state);
      const kb = changes.find(c => c.type === "unit_knockback") as Extract<(typeof changes)[number], { type: "unit_knockback" }> | undefined;
      expect(kb).toBeDefined();
      expect(kb!.blockedBy).toBe("wall");
    });

    it("knockback into occupied tile deals collision damage", () => {
      const reg = buildDataRegistry({ units: [KB_UNIT_A, KB_UNIT_B, KB_UNIT_C], weapons: [KB_WEAPON], skills: [], effects: [], tiles: [TILE_PLAIN], maps: [] });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const u1 = makeUnitState("u1", "kbu", "p1", 5, 4);
      const u2 = makeUnitState("u2", "kbu2", "p2", 5, 5);
      const u3 = makeUnitState("u3", "kbu3", "p2", 5, 6); // blocker
      const state = makeState({ u1, u2, u3 });

      const changes = resolver.resolve(u1, { row: 5, col: 5 }, state);
      const dmgChanges = changes.filter(c => c.type === "unit_damage");
      // Pushed unit (u2) takes collision damage + regular attack damage
      expect(dmgChanges.length).toBeGreaterThanOrEqual(1);
      const collisionDmg = dmgChanges.find(c =>
        (c as Extract<typeof c, { type: "unit_damage" }>).source.type === "collision"
      );
      expect(collisionDmg).toBeDefined();
    });

    it("knockback into frozen unit breaks freeze, no damage to frozen", () => {
      const reg = buildDataRegistry({
        units: [KB_UNIT_A, KB_UNIT_B, KB_UNIT_C],
        weapons: [KB_WEAPON],
        skills: [],
        effects: [EFFECT_FREEZE],
        tiles: [TILE_PLAIN],
        maps: [],
      });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const frozenEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_freeze" as import("@ab/metadata").MetaId,
        effectType: "freeze",
        turnsRemaining: 1,
        appliedOnTurn: 1,
      };

      const u1 = makeUnitState("u1", "kbu", "p1", 5, 4);
      const u2 = makeUnitState("u2", "kbu2", "p2", 5, 5);
      const u3 = makeUnitState("u3", "kbu3", "p2", 5, 6, { activeEffects: [frozenEffect] });
      const state = makeState({ u1, u2, u3 });

      const changes = resolver.resolve(u1, { row: 5, col: 5 }, state);

      // Freeze removed from blocker
      const freezeRemove = changes.find(c => c.type === "unit_effect_remove" &&
        (c as Extract<typeof c, { type: "unit_effect_remove" }>).effectType === "freeze");
      expect(freezeRemove).toBeDefined();

      // Pushed unit (u2) takes 1 collision damage
      const collisionDmg = changes.find(c => c.type === "unit_damage" &&
        (c as Extract<typeof c, { type: "unit_damage" }>).source.type === "collision");
      expect(collisionDmg).toBeDefined();
    });

    it("knockback into river tile causes river entry", () => {
      const reg = buildDataRegistry({
        units: [KB_UNIT_A, KB_UNIT_B],
        weapons: [KB_WEAPON],
        skills: [],
        effects: [EFFECT_FIRE],
        tiles: [
          TILE_PLAIN,
          { id: "tile_river", tileType: "river", nameKey: "t", descKey: "t", moveCost: 2, cannotStop: true, impassable: false, damagePerTurn: 0 },
        ],
        maps: [],
      });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const fireEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_fire" as import("@ab/metadata").MetaId,
        effectType: "fire",
        turnsRemaining: 3,
        appliedOnTurn: 1,
      };

      const u1 = makeUnitState("u1", "kbu", "p1", 5, 4);
      const u2 = makeUnitState("u2", "kbu2", "p2", 5, 5, { activeEffects: [fireEffect] });
      // River at (5, 6)
      const riverTile: import("@ab/metadata").TileState = { position: { row: 5, col: 6 }, attribute: "river" };
      const state = makeState({ u1, u2 }, { "5,6": riverTile });

      const changes = resolver.resolve(u1, { row: 5, col: 5 }, state);
      const riverEntry = changes.find(c => c.type === "unit_river_enter");
      expect(riverEntry).toBeDefined();
    });
  });

  describe("fire attribute effects", () => {
    const FIRE_UNIT_A = { id: "fua", nameKey: "u", descKey: "u", class: "ranger", faction: "a",
      baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn_fire_ranged", skillIds: [], spriteKey: "s" };
    const FIRE_UNIT_B = { id: "fub", nameKey: "u", descKey: "u", class: "fighter", faction: "b",
      baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn_fire_ranged", skillIds: [], spriteKey: "s" };
    const FIRE_WEAPON = { id: "wpn_fire_ranged", nameKey: "w", descKey: "w",
      attackType: "ranged", rangeType: "single", minRange: 2, maxRange: 4,
      damage: 2, attribute: "fire", penetrating: false, arcing: false };

    it("applies fire effect to hit unit", () => {
      const reg = buildDataRegistry({ units: [FIRE_UNIT_A, FIRE_UNIT_B], weapons: [FIRE_WEAPON], skills: [], effects: [EFFECT_FIRE], tiles: [TILE_PLAIN, TILE_FIRE], maps: [] });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const u1 = makeUnitState("u1", "fua", "p1", 5, 5);
      const u2 = makeUnitState("u2", "fub", "p2", 5, 8);
      const state = makeState({ u1, u2 });

      const changes = resolver.resolve(u1, { row: 5, col: 8 }, state);
      const effectAdd = changes.find(c => c.type === "unit_effect_add" &&
        (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire");
      expect(effectAdd).toBeDefined();
    });

    it("converts target tile to fire attribute", () => {
      const reg = buildDataRegistry({ units: [FIRE_UNIT_A, FIRE_UNIT_B], weapons: [FIRE_WEAPON], skills: [], effects: [EFFECT_FIRE], tiles: [TILE_PLAIN, TILE_FIRE], maps: [] });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const u1 = makeUnitState("u1", "fua", "p1", 5, 5);
      const u2 = makeUnitState("u2", "fub", "p2", 5, 8);
      const state = makeState({ u1, u2 });

      const changes = resolver.resolve(u1, { row: 5, col: 8 }, state);
      const tileChange = changes.find(c => c.type === "tile_attribute_change") as Extract<(typeof changes)[number], { type: "tile_attribute_change" }> | undefined;
      expect(tileChange).toBeDefined();
      expect(tileChange!.to).toBe("fire");
    });

    it("removes fire/acid from target when water attack hits", () => {
      const WATER_WEAPON = { id: "wpn_water", nameKey: "w", descKey: "w",
        attackType: "ranged", rangeType: "single", minRange: 2, maxRange: 4,
        damage: 1, attribute: "water", penetrating: false, arcing: false };
      const WATER_UNIT_A = { ...FIRE_UNIT_A, id: "wua", primaryWeaponId: "wpn_water" };
      const WATER_UNIT_B = { ...FIRE_UNIT_B, id: "wub", primaryWeaponId: "wpn_water" };
      const EFFECT_WATER = { id: "effect_water", nameKey: "e", descKey: "e", effectType: "water",
        damagePerTurn: 0, blocksAllActions: false, alsoAffectsTile: false,
        removeConditions: [{ type: "on_move" }] };

      const reg = buildDataRegistry({
        units: [WATER_UNIT_A, WATER_UNIT_B],
        weapons: [WATER_WEAPON],
        skills: [],
        effects: [EFFECT_FIRE, EFFECT_WATER],
        tiles: [TILE_PLAIN, TILE_WATER],
        maps: [],
        elementalReactions: [{ attackAttr: "water", targetEffect: "fire", damageMultiplier: 1, removedEffects: ["fire"] }],
      });
      const resolver = new AttackResolver(new AttackValidator(reg), reg, makeTileTransitionResolver(reg));

      const fireEffect: import("@ab/metadata").ActiveEffect = {
        effectId: "effect_fire" as import("@ab/metadata").MetaId,
        effectType: "fire",
        turnsRemaining: 3,
        appliedOnTurn: 1,
      };

      const u1 = makeUnitState("u1", "wua", "p1", 5, 5);
      const u2 = makeUnitState("u2", "wub", "p2", 5, 8, { activeEffects: [fireEffect] });
      const state = makeState({ u1, u2 });

      const changes = resolver.resolve(u1, { row: 5, col: 8 }, state);
      const fireRemove = changes.find(c => c.type === "unit_effect_remove" &&
        (c as Extract<typeof c, { type: "unit_effect_remove" }>).effectType === "fire");
      expect(fireRemove).toBeDefined();
    });
  });
});
