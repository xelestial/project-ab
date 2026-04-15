import { describe, it, expect, beforeEach } from "vitest";
import { DataRegistry, buildDataRegistry, RegistryError } from "../data-registry.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UNIT_T1 = {
  id: "t1",
  nameKey: "unit.t1.name",
  descKey: "unit.t1.desc",
  class: "tanker",
  faction: "a",
  baseMovement: 3,
  baseHealth: 6,
  baseArmor: 1,
  attributes: [],
  primaryWeaponId: "wpn_tanker_basic",
  skillIds: ["skill_shield_defend"],
  spriteKey: "unit_tanker_a",
};

const WEAPON_BASIC = {
  id: "wpn_tanker_basic",
  nameKey: "weapon.tanker_basic.name",
  descKey: "weapon.tanker_basic.desc",
  attackType: "melee",
  rangeType: "single",
  minRange: 1,
  maxRange: 1,
  damage: 2,
  attribute: "none",
  penetrating: false,
  arcing: false,
};

const SKILL_SHIELD = {
  id: "skill_shield_defend",
  nameKey: "skill.shield_defend.name",
  descKey: "skill.shield_defend.desc",
  type: "passive",
  oneShot: false,
};

const EFFECT_FREEZE = {
  id: "effect_freeze",
  nameKey: "effect.freeze.name",
  descKey: "effect.freeze.desc",
  effectType: "freeze",
  damagePerTurn: 0,
  blocksAllActions: true,
  alsoAffectsTile: false,
  removeConditions: [
    { type: "turns", count: 1 },
    { type: "collision_with_frozen" },
  ],
};

const EFFECT_ACID = {
  id: "effect_acid",
  nameKey: "effect.acid.name",
  descKey: "effect.acid.desc",
  effectType: "acid",
  damagePerTurn: 1,
  blocksAllActions: false,
  alsoAffectsTile: true,
  removeConditions: [{ type: "turns", count: 3 }, { type: "river_entry" }],
};

const TILE_MOUNTAIN = {
  id: "tile_mountain",
  tileType: "mountain",
  nameKey: "tile.mountain.name",
  descKey: "tile.mountain.desc",
  moveCost: 1,
  cannotStop: false,
  impassable: true,
  damagePerTurn: 0,
};

const MAP_TEST = {
  id: "map_test_01",
  nameKey: "map.test_01.name",
  descKey: "map.test_01.desc",
  playerCounts: [2],
  tileOverrides: [],
  spawnPoints: [
    { playerId: 0, positions: [{ row: 1, col: 1 }] },
    { playerId: 1, positions: [{ row: 9, col: 9 }] },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DataRegistry", () => {
  let reg: DataRegistry;

  beforeEach(() => {
    reg = buildDataRegistry({
      units: [UNIT_T1],
      weapons: [WEAPON_BASIC],
      skills: [SKILL_SHIELD],
      effects: [EFFECT_FREEZE, EFFECT_ACID],
      tiles: [TILE_MOUNTAIN],
      maps: [MAP_TEST],
    });
  });

  describe("getUnit", () => {
    it("returns unit by ID", () => {
      const unit = reg.getUnit("t1");
      expect(unit.id).toBe("t1");
      expect(unit.class).toBe("tanker");
      expect(unit.baseHealth).toBe(6);
      expect(unit.baseArmor).toBe(1);
    });

    it("throws RegistryError for unknown unit", () => {
      expect(() => reg.getUnit("unknown")).toThrow(RegistryError);
    });
  });

  describe("getWeapon", () => {
    it("returns weapon by ID", () => {
      const w = reg.getWeapon("wpn_tanker_basic");
      expect(w.attackType).toBe("melee");
      expect(w.damage).toBe(2);
      expect(w.penetrating).toBe(false);
    });

    it("throws RegistryError for unknown weapon", () => {
      expect(() => reg.getWeapon("nope")).toThrow(RegistryError);
    });
  });

  describe("getSkill", () => {
    it("returns skill by ID", () => {
      const s = reg.getSkill("skill_shield_defend");
      expect(s.type).toBe("passive");
      expect(s.oneShot).toBe(false);
    });
  });

  describe("getEffect", () => {
    it("returns effect by ID", () => {
      const e = reg.getEffect("effect_freeze");
      expect(e.blocksAllActions).toBe(true);
      expect(e.damagePerTurn).toBe(0);
    });

    it("returns acid effect with alsoAffectsTile=true", () => {
      const e = reg.getEffect("effect_acid");
      expect(e.alsoAffectsTile).toBe(true);
      expect(e.damagePerTurn).toBe(1);
    });
  });

  describe("getTile", () => {
    it("returns tile by ID", () => {
      const t = reg.getTile("tile_mountain");
      expect(t.impassable).toBe(true);
    });
  });

  describe("getTileByType", () => {
    it("finds tile by tileType string", () => {
      const t = reg.getTileByType("mountain");
      expect(t).toBeDefined();
      expect(t?.id).toBe("tile_mountain");
    });

    it("returns undefined for unknown type", () => {
      expect(reg.getTileByType("lava")).toBeUndefined();
    });
  });

  describe("getEffectByType", () => {
    it("finds effect by effectType string", () => {
      const e = reg.getEffectByType("freeze");
      expect(e?.id).toBe("effect_freeze");
    });
  });

  describe("getMap", () => {
    it("returns map by ID", () => {
      const m = reg.getMap("map_test_01");
      expect(m.playerCounts).toContain(2);
      expect(m.spawnPoints).toHaveLength(2);
    });

    it("throws RegistryError for unknown map", () => {
      expect(() => reg.getMap("no_map")).toThrow(RegistryError);
    });
  });

  describe("getAll* helpers", () => {
    it("getAllUnits returns all loaded units", () => {
      expect(reg.getAllUnits()).toHaveLength(1);
    });

    it("getAllEffects returns all loaded effects", () => {
      expect(reg.getAllEffects()).toHaveLength(2);
    });
  });

  describe("Zod validation", () => {
    it("rejects unit with invalid class", () => {
      expect(() =>
        buildDataRegistry({
          units: [{ ...UNIT_T1, class: "invalid_class" }],
          weapons: [],
          skills: [],
          effects: [],
          tiles: [],
          maps: [],
        }),
      ).toThrow();
    });

    it("rejects weapon with negative damage", () => {
      expect(() =>
        buildDataRegistry({
          units: [],
          weapons: [{ ...WEAPON_BASIC, damage: -5 }],
          skills: [],
          effects: [],
          tiles: [],
          maps: [],
        }),
      ).toThrow();
    });

    it("accepts large-grid positions (grid size is map-specific, PositionSchema has no fixed max)", () => {
      // Since grid size is now defined per-map (gridSize field), PositionSchema
      // no longer rejects large coordinates. Runtime bounds checks use state.map.gridSize.
      expect(() =>
        buildDataRegistry({
          units: [],
          weapons: [],
          skills: [],
          effects: [],
          tiles: [],
          maps: [
            {
              ...MAP_TEST,
              gridSize: 1000,
              spawnPoints: [{ playerId: 0, positions: [{ row: 999, col: 0 }] }],
            },
          ],
        }),
      ).not.toThrow();
    });
  });
});
