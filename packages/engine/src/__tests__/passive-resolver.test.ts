/**
 * PassiveResolver unit tests.
 *
 * Covers:
 *  - resolveTurnStart: heal_adjacent_allies, heal_self_per, apply_tile_effect_to_adjacent_enemies,
 *    remove_adjacent_tile_effect, remove_adjacent_unit_effect, condition checks
 *  - resolveOnAttack: bonus_move
 */
import { describe, it, expect } from "vitest";
import { PassiveResolver } from "../resolvers/passive-resolver.js";
import { TestStateBuilder, makeRegistry, FIXTURE_UNITS, FIXTURE_WEAPONS, FIXTURE_SKILLS, FIXTURE_EFFECTS, FIXTURE_TILES, FIXTURE_MAPS, FIXTURE_ELEMENTAL_REACTIONS } from "./test-helpers.js";
import { buildDataRegistry } from "@ab/metadata";
import type { ActiveEffect } from "@ab/metadata";

// ─── Registry helpers ─────────────────────────────────────────────────────────

/** Unit with heal_adjacent_allies passive on turn_start */
const HEALER_UNIT = {
  id: "medic",
  nameKey: "unit.medic.name",
  descKey: "unit.medic.desc",
  class: "support",
  faction: "a",
  baseMovement: 2,
  baseHealth: 5,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_heal_allies"],
  spriteKey: "unit_support_a",
};

const CRYO_UNIT = {
  id: "cryo",
  nameKey: "unit.cryo.name",
  descKey: "unit.cryo.desc",
  class: "tanker",
  faction: "a",
  baseMovement: 2,
  baseHealth: 6,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_heal_self_per_frozen"],
  spriteKey: "unit_tanker_a",
};

const ARSONIST_UNIT = {
  id: "arsonist",
  nameKey: "unit.arsonist.name",
  descKey: "unit.arsonist.desc",
  class: "fighter",
  faction: "a",
  baseMovement: 3,
  baseHealth: 4,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_apply_fire_to_adjacent_enemies"],
  spriteKey: "unit_fighter_a",
};

const SPRINKLER_UNIT = {
  id: "sprinkler",
  nameKey: "unit.sprinkler.name",
  descKey: "unit.sprinkler.desc",
  class: "support",
  faction: "a",
  baseMovement: 2,
  baseHealth: 4,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_remove_fire_tiles"],
  spriteKey: "unit_support_a",
};

const CLEANSER_UNIT = {
  id: "cleanser",
  nameKey: "unit.cleanser.name",
  descKey: "unit.cleanser.desc",
  class: "support",
  faction: "a",
  baseMovement: 2,
  baseHealth: 4,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_remove_fire_effects"],
  spriteKey: "unit_support_a",
};

const RUSH_UNIT = {
  id: "rusher",
  nameKey: "unit.rusher.name",
  descKey: "unit.rusher.desc",
  class: "fighter",
  faction: "a",
  baseMovement: 3,
  baseHealth: 4,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_bonus_move_on_attack"],
  spriteKey: "unit_fighter_a",
};

const COND_HEALER_UNIT = {
  id: "cond_healer",
  nameKey: "unit.cond_healer.name",
  descKey: "unit.cond_healer.desc",
  class: "support",
  faction: "a",
  baseMovement: 2,
  baseHealth: 5,
  baseArmor: 0,
  attributes: [],
  primaryWeaponId: "wpn_melee_basic",
  skillIds: [],
  passiveIds: ["passive_heal_when_adjacent_enemy"],
  spriteKey: "unit_support_a",
};

const PASSIVE_FIXTURES = [
  {
    id: "passive_heal_allies",
    nameKey: "passive.heal_allies.name",
    descKey: "passive.heal_allies.desc",
    trigger: { type: "on_turn_start" },
    actions: [{ type: "heal_adjacent_allies", amount: 2, radius: 1, excludeSelf: false }],
  },
  {
    id: "passive_heal_self_per_frozen",
    nameKey: "passive.heal_self_per.name",
    descKey: "passive.heal_self_per.desc",
    trigger: { type: "on_turn_start" },
    actions: [{ type: "heal_self_per", amount: 1, perCondition: "adjacent_frozen_enemy" }],
  },
  {
    id: "passive_apply_fire_to_adjacent_enemies",
    nameKey: "passive.apply_fire.name",
    descKey: "passive.apply_fire.desc",
    trigger: { type: "on_turn_start", condition: "adjacent_enemy_exists" },
    actions: [{ type: "apply_tile_effect_to_adjacent_enemies", effect: "fire" }],
  },
  {
    id: "passive_remove_fire_tiles",
    nameKey: "passive.remove_fire_tiles.name",
    descKey: "passive.remove_fire_tiles.desc",
    trigger: { type: "on_turn_start" },
    actions: [{ type: "remove_adjacent_tile_effect", effect: "fire", radius: 1 }],
  },
  {
    id: "passive_remove_fire_effects",
    nameKey: "passive.remove_fire_effects.name",
    descKey: "passive.remove_fire_effects.desc",
    trigger: { type: "on_turn_start" },
    actions: [{ type: "remove_adjacent_unit_effect", effectType: "fire", radius: 2 }],
  },
  {
    id: "passive_bonus_move_on_attack",
    nameKey: "passive.bonus_move.name",
    descKey: "passive.bonus_move.desc",
    trigger: { type: "on_attack" },
    actions: [{ type: "bonus_move", distance: 2 }],
  },
  {
    id: "passive_heal_when_adjacent_enemy",
    nameKey: "passive.cond_heal.name",
    descKey: "passive.cond_heal.desc",
    trigger: { type: "on_turn_start", condition: "adjacent_enemy_exists" },
    actions: [{ type: "heal_adjacent_allies", amount: 1, radius: 1, excludeSelf: false }],
  },
];

function makePassiveRegistry() {
  return buildDataRegistry({
    units: [
      ...FIXTURE_UNITS,
      HEALER_UNIT,
      CRYO_UNIT,
      ARSONIST_UNIT,
      SPRINKLER_UNIT,
      CLEANSER_UNIT,
      RUSH_UNIT,
      COND_HEALER_UNIT,
    ],
    weapons: FIXTURE_WEAPONS,
    skills: FIXTURE_SKILLS,
    effects: FIXTURE_EFFECTS,
    tiles: FIXTURE_TILES,
    maps: FIXTURE_MAPS,
    elementalReactions: FIXTURE_ELEMENTAL_REACTIONS,
    unitPassives: PASSIVE_FIXTURES,
  });
}

const fireEffect: ActiveEffect = {
  effectId: "effect_fire" as import("@ab/metadata").MetaId,
  effectType: "fire",
  turnsRemaining: 2,
  appliedOnTurn: 1,
};

// ─── resolveTurnStart ─────────────────────────────────────────────────────────

describe("PassiveResolver.resolveTurnStart", () => {
  describe("heal_adjacent_allies", () => {
    it("heals an ally within radius when both have room to heal", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("healer", "medic", "p1", 5, 5, { currentHealth: 5 }) // full HP (excluded by maxHp check)
        .withUnit("ally", "f1", "p1", 5, 6, { currentHealth: 2 }) // injured ally in radius 1
        .build();

      const changes = resolver.resolveTurnStart(state.units["healer"]!, state);
      const healChange = changes.find((c) => c.type === "unit_heal" && (c as { unitId: string }).unitId === "ally");
      expect(healChange).toBeDefined();
      expect((healChange as { amount: number }).amount).toBe(2);
    });

    it("does not heal an ally who is already at max HP", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("healer", "medic", "p1", 5, 5, { currentHealth: 5 })
        .withUnit("ally", "f1", "p1", 5, 6, { currentHealth: 4 }) // full HP (f1 baseHealth=4)
        .build();

      const changes = resolver.resolveTurnStart(state.units["healer"]!, state);
      const healForAlly = changes.find(
        (c) => c.type === "unit_heal" && (c as { unitId: string }).unitId === "ally",
      );
      expect(healForAlly).toBeUndefined();
    });

    it("does not heal enemies", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("healer", "medic", "p1", 5, 5)
        .withUnit("enemy", "f1", "p2", 5, 6, { currentHealth: 1 }) // injured but enemy
        .build();

      const changes = resolver.resolveTurnStart(state.units["healer"]!, state);
      const healForEnemy = changes.find(
        (c) => c.type === "unit_heal" && (c as { unitId: string }).unitId === "enemy",
      );
      expect(healForEnemy).toBeUndefined();
    });

    it("does not heal a unit outside the radius", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      // Healer is at full HP (medic baseHealth=5) so self-heal doesn't fire.
      // farAlly is at dist=4, outside radius=1 → should not be healed.
      const state = TestStateBuilder.create()
        .withUnit("healer", "medic", "p1", 5, 5, { currentHealth: 5 }) // full HP — no self-heal
        .withUnit("farAlly", "f1", "p1", 5, 9, { currentHealth: 1 }) // dist=4, radius=1
        .build();

      const changes = resolver.resolveTurnStart(state.units["healer"]!, state);
      expect(changes.filter((c) => c.type === "unit_heal")).toHaveLength(0);
    });

    it("caps heal to maxHP", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      // f1 baseHealth=4, ally has 3 HP → heal 2 would overshoot by 1 → capped at 4
      // Healer is at full HP so only ally gets healed.
      const state = TestStateBuilder.create()
        .withUnit("healer", "medic", "p1", 5, 5, { currentHealth: 5 }) // full HP — no self-heal
        .withUnit("ally", "f1", "p1", 5, 6, { currentHealth: 3 })
        .build();

      const changes = resolver.resolveTurnStart(state.units["healer"]!, state);
      const healChange = changes.find(
        (c) => c.type === "unit_heal" && (c as { unitId: string }).unitId === "ally",
      ) as { amount: number; hpAfter: number } | undefined;
      expect(healChange).toBeDefined();
      expect(healChange!.hpAfter).toBe(4); // capped at 4 (f1 maxHP)
      expect(healChange!.amount).toBe(1); // only heals 1 (not 2)
    });
  });

  describe("heal_self_per adjacent_frozen_enemy", () => {
    it("heals self for each frozen adjacent enemy", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cryo", "cryo", "p1", 5, 5, { currentHealth: 3 })
        .withFrozenUnit("enemy1", "f1", "p2", 5, 6) // frozen orthogonal enemy
        .withFrozenUnit("enemy2", "f1", "p2", 4, 5) // another frozen enemy
        .build();

      const changes = resolver.resolveTurnStart(state.units["cryo"]!, state);
      const heal = changes.find((c) => c.type === "unit_heal") as { amount: number } | undefined;
      expect(heal).toBeDefined();
      expect(heal!.amount).toBe(2); // 1 HP × 2 frozen enemies
    });

    it("does not heal when no frozen adjacent enemies", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cryo", "cryo", "p1", 5, 5, { currentHealth: 3 })
        .withUnit("enemy", "f1", "p2", 5, 6) // not frozen
        .build();

      const changes = resolver.resolveTurnStart(state.units["cryo"]!, state);
      expect(changes.filter((c) => c.type === "unit_heal")).toHaveLength(0);
    });

    it("does not heal when self is already at max HP", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cryo", "cryo", "p1", 5, 5, { currentHealth: 6 }) // full HP (cryo baseHealth=6)
        .withFrozenUnit("enemy", "f1", "p2", 5, 6)
        .build();

      const changes = resolver.resolveTurnStart(state.units["cryo"]!, state);
      expect(changes.filter((c) => c.type === "unit_heal")).toHaveLength(0);
    });
  });

  describe("apply_tile_effect_to_adjacent_enemies", () => {
    it("converts enemy tile to fire when adjacent enemy exists", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("arsonist", "arsonist", "p1", 5, 5)
        .withUnit("enemy", "f1", "p2", 5, 6) // adjacent enemy
        .build();

      const changes = resolver.resolveTurnStart(state.units["arsonist"]!, state);
      const tileChange = changes.find((c) => c.type === "tile_attribute_change");
      expect(tileChange).toBeDefined();
      expect((tileChange as { to: string }).to).toBe("fire");
      expect((tileChange as { position: { row: number; col: number } }).position).toEqual({ row: 5, col: 6 });
    });

    it("does not fire when no adjacent enemies (condition: adjacent_enemy_exists)", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("arsonist", "arsonist", "p1", 5, 5)
        .withUnit("ally", "f1", "p1", 5, 6) // ally, not enemy
        .build();

      const changes = resolver.resolveTurnStart(state.units["arsonist"]!, state);
      expect(changes.filter((c) => c.type === "tile_attribute_change")).toHaveLength(0);
    });

    it("does not convert enemy tile that already has the target attribute", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("arsonist", "arsonist", "p1", 5, 5)
        .withUnit("enemy", "f1", "p2", 5, 6)
        .withTile(5, 6, "fire") // already fire
        .build();

      const changes = resolver.resolveTurnStart(state.units["arsonist"]!, state);
      // No tile_attribute_change since tile is already fire
      expect(changes.filter((c) => c.type === "tile_attribute_change")).toHaveLength(0);
    });
  });

  describe("remove_adjacent_tile_effect", () => {
    it("removes fire tiles within radius", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("sprinkler", "sprinkler", "p1", 5, 5)
        .withTile(5, 6, "fire")
        .withTile(4, 5, "fire")
        .build();

      const changes = resolver.resolveTurnStart(state.units["sprinkler"]!, state);
      const tileChanges = changes.filter((c) => c.type === "tile_attribute_change");
      expect(tileChanges.length).toBe(2);
      expect(tileChanges.every((c) => (c as { to: string }).to === "plain")).toBe(true);
    });

    it("does not affect non-fire tiles", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("sprinkler", "sprinkler", "p1", 5, 5)
        .withTile(5, 6, "water") // water, not fire
        .build();

      const changes = resolver.resolveTurnStart(state.units["sprinkler"]!, state);
      expect(changes.filter((c) => c.type === "tile_attribute_change")).toHaveLength(0);
    });
  });

  describe("remove_adjacent_unit_effect", () => {
    it("removes fire effect from allies and enemies within radius", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cleanser", "cleanser", "p1", 5, 5)
        .withUnit("ally", "f1", "p1", 5, 6, { activeEffects: [fireEffect] })
        .withUnit("enemy", "f1", "p2", 5, 4, { activeEffects: [fireEffect] })
        .build();

      const changes = resolver.resolveTurnStart(state.units["cleanser"]!, state);
      const removeChanges = changes.filter((c) => c.type === "unit_effect_remove");
      expect(removeChanges.length).toBe(2);
    });

    it("does not affect units without the target effect", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cleanser", "cleanser", "p1", 5, 5)
        .withUnit("ally", "f1", "p1", 5, 6) // no effects
        .build();

      const changes = resolver.resolveTurnStart(state.units["cleanser"]!, state);
      expect(changes.filter((c) => c.type === "unit_effect_remove")).toHaveLength(0);
    });

    it("does not remove effects from units outside the radius", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cleanser", "cleanser", "p1", 5, 5) // radius=2
        .withUnit("far", "f1", "p1", 5, 9, { activeEffects: [fireEffect] }) // dist=4
        .build();

      const changes = resolver.resolveTurnStart(state.units["cleanser"]!, state);
      expect(changes.filter((c) => c.type === "unit_effect_remove")).toHaveLength(0);
    });
  });

  describe("condition: adjacent_enemy_exists", () => {
    it("does NOT trigger when there are no adjacent enemies", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cond_healer", "cond_healer", "p1", 5, 5)
        .withUnit("ally", "f1", "p1", 5, 6, { currentHealth: 2 }) // ally only
        .build();

      const changes = resolver.resolveTurnStart(state.units["cond_healer"]!, state);
      expect(changes.filter((c) => c.type === "unit_heal")).toHaveLength(0);
    });

    it("DOES trigger when an adjacent enemy exists", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("cond_healer", "cond_healer", "p1", 5, 5)
        .withUnit("ally", "f1", "p1", 5, 6, { currentHealth: 2 }) // injured ally
        .withUnit("enemy", "f1", "p2", 5, 4) // enemy triggers condition
        .build();

      const changes = resolver.resolveTurnStart(state.units["cond_healer"]!, state);
      expect(changes.filter((c) => c.type === "unit_heal").length).toBeGreaterThan(0);
    });
  });

  describe("unit with no passives", () => {
    it("returns empty changes for a plain unit", () => {
      const registry = makePassiveRegistry();
      const resolver = new PassiveResolver(registry);

      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5)
        .build();

      const changes = resolver.resolveTurnStart(state.units["u1"]!, state);
      expect(changes).toHaveLength(0);
    });
  });
});

// ─── resolveOnAttack ──────────────────────────────────────────────────────────

describe("PassiveResolver.resolveOnAttack", () => {
  it("emits bonus_move change after attack", () => {
    const registry = makePassiveRegistry();
    const resolver = new PassiveResolver(registry);

    const state = TestStateBuilder.create()
      .withUnit("rusher", "rusher", "p1", 5, 5)
      .build();

    const changes = resolver.resolveOnAttack(state.units["rusher"]!, state);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("unit_movement_restore");
    expect((changes[0] as { movementPoints: number }).movementPoints).toBe(2);
  });

  it("returns empty changes for unit without on_attack passive", () => {
    const registry = makePassiveRegistry();
    const resolver = new PassiveResolver(registry);

    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const changes = resolver.resolveOnAttack(state.units["u1"]!, state);
    expect(changes).toHaveLength(0);
  });

  it("returns empty changes for healer unit (has on_turn_start, not on_attack)", () => {
    const registry = makePassiveRegistry();
    const resolver = new PassiveResolver(registry);

    const state = TestStateBuilder.create()
      .withUnit("healer", "medic", "p1", 5, 5)
      .build();

    const changes = resolver.resolveOnAttack(state.units["healer"]!, state);
    expect(changes).toHaveLength(0);
  });
});
