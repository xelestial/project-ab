/**
 * Test helpers — minimal GameState and unit builders.
 */
import type {
  GameState,
  UnitState,
  TileState,
  TileAttributeType,
  UnitEffectType,
  ActiveEffect,
} from "@ab/metadata";
import { buildDataRegistry, type DataRegistry } from "@ab/metadata";
import { TileTransitionResolver } from "../resolvers/tile-transition-resolver.js";

export { TileTransitionResolver };

export const FIXTURE_ELEMENTAL_REACTIONS = [
  { attackAttr: "fire",  targetEffect: "freeze", damageMultiplier: 0, removedEffects: ["freeze"] },
  { attackAttr: "water", targetEffect: "fire",   damageMultiplier: 1, removedEffects: ["fire"]   },
  { attackAttr: "ice",   targetEffect: "fire",   damageMultiplier: 0, removedEffects: ["fire"]   },
];

// ─── JSON fixtures (inline, no file I/O) ─────────────────────────────────────

export const FIXTURE_UNITS = [
  {
    id: "t1",
    nameKey: "unit.t1.name",
    descKey: "unit.t1.desc",
    class: "tanker",
    faction: "a",
    baseMovement: 3,
    baseHealth: 6,
    baseArmor: 1,
    attributes: [],
    primaryWeaponId: "wpn_melee_basic",
    skillIds: ["skill_shield_defend"],
    spriteKey: "unit_tanker_a",
  },
  {
    id: "f1",
    nameKey: "unit.f1.name",
    descKey: "unit.f1.desc",
    class: "fighter",
    faction: "a",
    baseMovement: 3,
    baseHealth: 4,
    baseArmor: 0,
    attributes: [],
    primaryWeaponId: "wpn_melee_basic",
    skillIds: ["skill_fighter_rush"],
    spriteKey: "unit_fighter_a",
  },
  {
    id: "r1",
    nameKey: "unit.r1.name",
    descKey: "unit.r1.desc",
    class: "ranger",
    faction: "a",
    baseMovement: 2,
    baseHealth: 4,
    baseArmor: 0,
    attributes: [],
    primaryWeaponId: "wpn_ranged_basic",
    skillIds: ["skill_ranger_fire_arrow"],
    spriteKey: "unit_ranger_a",
  },
];

export const FIXTURE_WEAPONS = [
  {
    id: "wpn_melee_basic",
    nameKey: "weapon.melee_basic.name",
    descKey: "weapon.melee_basic.desc",
    attackType: "melee",
    rangeType: "single",
    minRange: 1,
    maxRange: 1,
    damage: 2,
    attribute: "none",
    penetrating: false,
    arcing: false,
  },
  {
    id: "wpn_ranged_basic",
    nameKey: "weapon.ranged_basic.name",
    descKey: "weapon.ranged_basic.desc",
    attackType: "ranged",
    rangeType: "single",
    minRange: 2,
    maxRange: 4,
    damage: 2,
    attribute: "none",
    penetrating: false,
    arcing: false,
  },
  {
    id: "wpn_fire_arrow",
    nameKey: "weapon.fire_arrow.name",
    descKey: "weapon.fire_arrow.desc",
    attackType: "ranged",
    rangeType: "single",
    minRange: 2,
    maxRange: 4,
    damage: 2,
    attribute: "fire",
    penetrating: false,
    arcing: false,
  },
  {
    id: "wpn_melee_knockback",
    nameKey: "weapon.melee_knockback.name",
    descKey: "weapon.melee_knockback.desc",
    attackType: "melee",
    rangeType: "single",
    minRange: 1,
    maxRange: 1,
    damage: 2,
    attribute: "none",
    knockback: { distance: 1, direction: "away" },
    penetrating: false,
    arcing: false,
  },
];

export const FIXTURE_SKILLS = [
  {
    id: "skill_shield_defend",
    nameKey: "skill.shield_defend.name",
    descKey: "skill.shield_defend.desc",
    type: "passive",
    oneShot: false,
  },
  {
    id: "skill_fighter_rush",
    nameKey: "skill.fighter_rush.name",
    descKey: "skill.fighter_rush.desc",
    type: "active",
    oneShot: true,
    weaponId: "wpn_melee_basic",
  },
  {
    id: "skill_ranger_fire_arrow",
    nameKey: "skill.ranger_fire_arrow.name",
    descKey: "skill.ranger_fire_arrow.desc",
    type: "active",
    oneShot: true,
    weaponId: "wpn_fire_arrow",
  },
];

export const FIXTURE_EFFECTS = [
  {
    id: "effect_freeze",
    nameKey: "effect.freeze.name",
    descKey: "effect.freeze.desc",
    effectType: "freeze",
    damagePerTurn: 0,
    blocksAllActions: true,
    alsoAffectsTile: false,
    clearsAllEffectsOnApply: true,
    removeConditions: [
      { type: "turns", count: 1 },
      { type: "collision_with_frozen" },
    ],
  },
  {
    id: "effect_fire",
    nameKey: "effect.fire.name",
    descKey: "effect.fire.desc",
    effectType: "fire",
    damagePerTurn: 1,
    blocksAllActions: false,
    alsoAffectsTile: false,
    removeConditions: [
      { type: "turns", count: 3 },
      { type: "manual_extinguish" },
      { type: "river_entry" },
    ],
  },
  {
    id: "effect_acid",
    nameKey: "effect.acid.name",
    descKey: "effect.acid.desc",
    effectType: "acid",
    damagePerTurn: 1,
    blocksAllActions: false,
    alsoAffectsTile: true,
    removeConditions: [
      { type: "turns", count: 3 },
      { type: "river_entry" },
    ],
  },
  {
    id: "effect_electric",
    nameKey: "effect.electric.name",
    descKey: "effect.electric.desc",
    effectType: "electric",
    damagePerTurn: 1,
    blocksAllActions: false,
    alsoAffectsTile: false,
    removeConditions: [{ type: "turns", count: 1 }],
  },
  {
    id: "effect_sand",
    nameKey: "effect.sand.name",
    descKey: "effect.sand.desc",
    effectType: "sand",
    damagePerTurn: 0,
    blocksAllActions: false,
    alsoAffectsTile: false,
    removeConditions: [{ type: "on_move" }],
  },
  {
    id: "effect_water",
    nameKey: "effect.water.name",
    descKey: "effect.water.desc",
    effectType: "water",
    damagePerTurn: 0,
    blocksAllActions: false,
    alsoAffectsTile: false,
    removeConditions: [{ type: "on_move" }],
  },
];

export const FIXTURE_TILES = [
  {
    id: "tile_plain",
    tileType: "plain",
    nameKey: "tile.plain.name",
    descKey: "tile.plain.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 0,
  },
  {
    id: "tile_mountain",
    tileType: "mountain",
    nameKey: "tile.mountain.name",
    descKey: "tile.mountain.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: true,
    damagePerTurn: 0,
  },
  {
    id: "tile_river",
    tileType: "river",
    nameKey: "tile.river.name",
    descKey: "tile.river.desc",
    moveCost: 2,
    cannotStop: true,
    impassable: false,
    damagePerTurn: 0,
  },
  {
    id: "tile_fire",
    tileType: "fire",
    nameKey: "tile.fire.name",
    descKey: "tile.fire.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 2,
    appliesEffectId: "effect_fire",
  },
  {
    id: "tile_water",
    tileType: "water",
    nameKey: "tile.water.name",
    descKey: "tile.water.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 0,
    removesEffectTypes: ["fire", "acid"],
  },
  {
    id: "tile_sand",
    tileType: "sand",
    nameKey: "tile.sand.name",
    descKey: "tile.sand.desc",
    moveCost: 2,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 0,
    appliesEffectId: "effect_sand",
  },
  {
    id: "tile_electric",
    tileType: "electric",
    nameKey: "tile.electric.name",
    descKey: "tile.electric.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 1,
    appliesEffectId: "effect_electric",
  },
  {
    id: "tile_acid",
    tileType: "acid",
    nameKey: "tile.acid.name",
    descKey: "tile.acid.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 1,
    appliesEffectId: "effect_acid",
  },
  {
    id: "tile_ice",
    tileType: "ice",
    nameKey: "tile.ice.name",
    descKey: "tile.ice.desc",
    moveCost: 1,
    cannotStop: false,
    impassable: false,
    damagePerTurn: 0,
    appliesEffectId: "effect_freeze",
    clearsAllEffects: true,
  },
];

export const FIXTURE_MAPS = [
  {
    id: "map_test",
    nameKey: "map.test.name",
    descKey: "map.test.desc",
    playerCounts: [2],
    tileOverrides: [],
    spawnPoints: [
      { playerId: 0, positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }] },
      { playerId: 1, positions: [{ row: 10, col: 10 }, { row: 10, col: 9 }, { row: 10, col: 8 }] },
    ],
  },
];

export function makeRegistry(): DataRegistry {
  return buildDataRegistry({
    units: FIXTURE_UNITS,
    weapons: FIXTURE_WEAPONS,
    skills: FIXTURE_SKILLS,
    effects: FIXTURE_EFFECTS,
    tiles: FIXTURE_TILES,
    maps: FIXTURE_MAPS,
    elementalReactions: FIXTURE_ELEMENTAL_REACTIONS,
  });
}

/** Convenience: create a TileTransitionResolver backed by the test registry. */
export function makeTileTransitionResolver(registry: DataRegistry): TileTransitionResolver {
  return new TileTransitionResolver(registry);
}

// ─── State builder ────────────────────────────────────────────────────────────

function makeUnit(
  unitId: string,
  metaId: string,
  playerId: string,
  row: number,
  col: number,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId: unitId as import("@ab/metadata").UnitId,
    metaId: metaId as import("@ab/metadata").MetaId,
    playerId: playerId as import("@ab/metadata").PlayerId,
    position: { row, col },
    currentHealth: 4,
    currentArmor: 0,
    movementPoints: 3,
    activeEffects: [],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
    ...overrides,
  };
}

function makeEffect(
  effectId: string,
  effectType: UnitEffectType,
  turnsRemaining?: number,
): ActiveEffect {
  return {
    effectId: effectId as import("@ab/metadata").MetaId,
    effectType,
    turnsRemaining,
    appliedOnTurn: 1,
  };
}

export class TestStateBuilder {
  private units: Record<string, UnitState> = {};
  private tiles: Record<string, TileState> = {};

  static create(): TestStateBuilder {
    return new TestStateBuilder();
  }

  withUnit(
    unitId: string,
    metaId: string,
    playerId: string,
    row: number,
    col: number,
    overrides: Partial<UnitState> = {},
  ): TestStateBuilder {
    this.units[unitId] = makeUnit(unitId, metaId, playerId, row, col, overrides);
    return this;
  }

  withFrozenUnit(unitId: string, metaId: string, playerId: string, row: number, col: number): TestStateBuilder {
    this.units[unitId] = makeUnit(unitId, metaId, playerId, row, col, {
      activeEffects: [makeEffect("effect_freeze", "freeze", 1)],
    });
    return this;
  }

  withTile(row: number, col: number, attr: TileAttributeType): TestStateBuilder {
    const key = `${row},${col}`;
    this.tiles[key] = { position: { row, col }, attribute: attr };
    return this;
  }

  build(): GameState {
    const now = new Date().toISOString();
    return {
      gameId: "test-game" as import("@ab/metadata").GameId,
      phase: "battle",
      round: 1,
      turnOrder: [
        { playerId: "p1" as import("@ab/metadata").PlayerId, priority: 1 },
        { playerId: "p2" as import("@ab/metadata").PlayerId, priority: 1 },
      ],
      currentTurnIndex: 0,
      players: {
        p1: {
          playerId: "p1" as import("@ab/metadata").PlayerId,
          teamIndex: 0,
          priority: 1,
          unitIds: Object.entries(this.units)
            .filter(([, u]) => u.playerId === "p1")
            .map(([id]) => id as import("@ab/metadata").UnitId),
          connected: true,
          surrendered: false,
        },
        p2: {
          playerId: "p2" as import("@ab/metadata").PlayerId,
          teamIndex: 1,
          priority: 1,
          unitIds: Object.entries(this.units)
            .filter(([, u]) => u.playerId === "p2")
            .map(([id]) => id as import("@ab/metadata").UnitId),
          connected: true,
          surrendered: false,
        },
      },
      units: this.units,
      map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles: this.tiles },
      createdAt: now,
      updatedAt: now,
    };
  }
}
