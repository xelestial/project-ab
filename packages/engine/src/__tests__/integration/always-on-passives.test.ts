/**
 * always_on 패시브 검증 — 전용 단위 테스트가 없던 6개 패시브를 커버합니다.
 *
 *  1. passive_shield        (block_penetration)          — t1/t2/t3/t4 보유
 *  2. passive_melee_mastery (damage_reduction: melee -1) — f1 보유
 *  3. passive_fire_weakness (vulnerability: fire +1)     — f4/r4/a4 보유
 *  4. passive_freeze_immunity (immune_effect: freeze)    — b4 보유 (타일 진입 + 공격 적용 모두)
 *  5. passive_amphibious    (immune_tile_type: water/river) — b4 보유
 *  6. passive_generator     (amplify_damage_type: electric ×2, radius 2) — u3 보유
 *
 *  보너스:
 *  7. freeze on_hit 해제   — 피격 시 빙결 해제 (AttackResolver 직접 처리)
 *  8. freeze blocksDamage  — 빙결 중 데미지 차단
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry, type IDataRegistry } from "@ab/metadata";
import type { GameState, UnitState, TileState } from "@ab/metadata";
import { AttackResolver } from "../../resolvers/attack-resolver.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import { TileTransitionResolver } from "../../resolvers/tile-transition-resolver.js";
import { StateApplicator } from "../../state/state-applicator.js";

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

const EFFECTS = [
  { id: "effect_freeze",   nameKey: "e", descKey: "e", effectType: "freeze",   damagePerTurn: 0, blocksAllActions: true,  blocksDamage: true,  alsoAffectsTile: false, clearsAllEffectsOnApply: true,  removeConditions: [{ type: "turns", count: 1 }, { type: "collision_with_frozen" }, { type: "on_hit" }] },
  { id: "effect_fire",     nameKey: "e", descKey: "e", effectType: "fire",     damagePerTurn: 1, blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false, removeConditions: [{ type: "turns", count: 3 }, { type: "manual_extinguish" }, { type: "river_entry" }] },
  { id: "effect_electric", nameKey: "e", descKey: "e", effectType: "electric", damagePerTurn: 1, ignoresArmor: true, blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false, removeConditions: [{ type: "turns", count: 1 }] },
];

const TILES = [
  { id: "tile_plain",    tileType: "plain",    nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
  { id: "tile_ice",      tileType: "ice",      nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, appliesEffectId: "effect_freeze", clearsAllEffects: true },
  { id: "tile_water",    tileType: "water",    nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, removesEffectTypes: ["fire"] },
  { id: "tile_river",    tileType: "river",    nameKey: "t", descKey: "t", moveCost: 2, cannotStop: true,  impassable: false, damagePerTurn: 0 },
  { id: "tile_fire",     tileType: "fire",     nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 2, appliesEffectId: "effect_fire" },
  { id: "tile_electric", tileType: "electric", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 1, appliesEffectId: "effect_electric" },
];

const MAPS = [{
  id: "map_test", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
  spawnPoints: [
    { playerId: 0, positions: [{ row: 0, col: 0 }] },
    { playerId: 1, positions: [{ row: 10, col: 10 }] },
  ],
}];

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────

function makeUnit(id: string, metaId: string, pid: string, row: number, col: number,
  overrides: Partial<UnitState> = {}): UnitState {
  return {
    unitId: id as import("@ab/metadata").UnitId,
    metaId: metaId as import("@ab/metadata").MetaId,
    playerId: pid as import("@ab/metadata").PlayerId,
    position: { row, col }, currentHealth: 4, currentArmor: 0, movementPoints: 3,
    activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true, ...overrides,
  } as UnitState;
}

function makeState(units: Record<string, UnitState>, tiles: Record<string, TileState> = {}): GameState {
  const now = new Date().toISOString();
  return {
    gameId: "test" as import("@ab/metadata").GameId, phase: "battle", round: 1,
    turnOrder: [
      { playerId: "p1" as import("@ab/metadata").PlayerId, priority: 1 },
      { playerId: "p2" as import("@ab/metadata").PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: Object.values(units).filter(u => u.playerId === "p1").map(u => u.unitId), connected: true, surrendered: false },
      p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: Object.values(units).filter(u => u.playerId === "p2").map(u => u.unitId), connected: true, surrendered: false },
    },
    units, map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles },
    createdAt: now, updatedAt: now,
  };
}

function makeAttackPipeline(registry: IDataRegistry) {
  const validator = new AttackValidator(registry);
  const ttr = new TileTransitionResolver(registry);
  const resolver = new AttackResolver(validator, registry, ttr);
  return { validator, ttr, resolver };
}

// ─── 1. passive_shield — block_penetration ───────────────────────────────────

describe("passive_shield — block_penetration", () => {
  function makeRegistry() {
    return buildDataRegistry({
      units: [
        { id: "atk",     nameKey: "n", descKey: "d", class: "ranger",  faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_penetrate", skillIds: [], spriteKey: "s" },
        { id: "shield",  nameKey: "n", descKey: "d", class: "tanker",  faction: "b", baseMovement: 2, baseHealth: 5, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee",     skillIds: [], passiveIds: ["passive_shield"], spriteKey: "s" },
        { id: "noshield",nameKey: "n", descKey: "d", class: "fighter", faction: "b", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee",     skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_penetrate", nameKey: "n", descKey: "d", attackType: "ranged", rangeType: "penetrate", minRange: 1, maxRange: 5, damage: 2, attribute: "none", penetrating: false, arcing: false },
        { id: "wpn_melee",     nameKey: "n", descKey: "d", attackType: "melee",  rangeType: "single",    minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS,
      unitPassives: [{ id: "passive_shield", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "block_penetration" }] }],
    });
  }

  it("관통 무기가 방패 유닛에서 멈춘다 — 방패 뒤 유닛은 피격 안 됨", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    // 배치: atk(col 2) → shield(col 5) → behind(col 6), 같은 행
    const atk    = makeUnit("atk",    "atk",     "p1", 5, 2);
    const shield = makeUnit("shield", "shield",  "p2", 5, 5);
    const behind = makeUnit("behind", "noshield","p2", 5, 6);
    const state  = makeState({ atk, shield, behind });

    const changes = resolver.resolve(atk, { row: 5, col: 5 }, state);

    const shieldHit = changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "shield");
    expect(shieldHit).toBe(true);

    const behindHit = changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "behind");
    expect(behindHit).toBe(false);
  });

  it("방패 없는 유닛 뒤로 관통 피해가 전파된다", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",     "atk",     "p1", 5, 2);
    const front  = makeUnit("front",   "noshield","p2", 5, 5);
    const behind = makeUnit("behind",  "noshield","p2", 5, 6);
    const state  = makeState({ atk, front, behind });

    const changes = resolver.resolve(atk, { row: 5, col: 5 }, state);

    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "front")).toBe(true);
    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "behind")).toBe(true);
  });
});

// ─── 2. passive_melee_mastery — damage_reduction: melee -1 ───────────────────

describe("passive_melee_mastery — 근접 피해 -1 감소", () => {
  function makeRegistry(weaponId: string, damage: number, attackType: "melee" | "ranged", rangeMin: number, rangeMax: number) {
    return buildDataRegistry({
      units: [
        { id: "atk",    nameKey: "n", descKey: "d", class: "fighter", faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: weaponId,     skillIds: [], spriteKey: "s" },
        { id: "master", nameKey: "n", descKey: "d", class: "fighter", faction: "b", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee2", skillIds: [], passiveIds: ["passive_melee_mastery"], spriteKey: "s" },
      ],
      weapons: [
        { id: weaponId,    nameKey: "n", descKey: "d", attackType, rangeType: "single", minRange: rangeMin, maxRange: rangeMax, damage, attribute: "none", penetrating: false, arcing: false },
        { id: "wpn_melee2",nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS,
      unitPassives: [{ id: "passive_melee_mastery", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "damage_reduction", attackType: "melee", amount: 1 }] }],
    });
  }

  it("melee_mastery 유닛이 근접 공격 받으면 데미지 -1 (2→1)", () => {
    const registry = makeRegistry("wpn_melee1", 2, "melee", 1, 1);
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 4);
    const master = makeUnit("master", "master", "p2", 5, 5);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, master }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "master") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(1); // 2 - 1 = 1
  });

  it("melee_mastery 유닛이 원거리 공격 받으면 감소 없음 (2→2)", () => {
    const registry = makeRegistry("wpn_ranged1", 2, "ranged", 2, 4);
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 2);
    const master = makeUnit("master", "master", "p2", 5, 5);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, master }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "master") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(2);
  });

  it("damage_reduction이 데미지를 0 미만으로 내리지 않는다 (1-1=0 → 피해 없음)", () => {
    const registry = makeRegistry("wpn_weak", 1, "melee", 1, 1);
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 4);
    const master = makeUnit("master", "master", "p2", 5, 5);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, master }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "master");
    expect(dmg).toBeUndefined(); // 0 데미지 → change 없음
  });
});

// ─── 3. passive_fire_weakness — vulnerability: fire +1 ───────────────────────

describe("passive_fire_weakness — 화염 피해 +1 취약", () => {
  function makeRegistry() {
    return buildDataRegistry({
      units: [
        { id: "fire_atk",  nameKey: "n", descKey: "d", class: "ranger",  faction: "a", baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_fire",  skillIds: [], spriteKey: "s" },
        { id: "none_atk",  nameKey: "n", descKey: "d", class: "fighter", faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_none",  skillIds: [], spriteKey: "s" },
        { id: "weak",      nameKey: "n", descKey: "d", class: "fighter", faction: "b", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_none",  skillIds: [], passiveIds: ["passive_fire_weakness"], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_fire", nameKey: "n", descKey: "d", attackType: "ranged", rangeType: "single", minRange: 2, maxRange: 4, damage: 2, attribute: "fire", penetrating: false, arcing: false },
        { id: "wpn_none", nameKey: "n", descKey: "d", attackType: "melee",  rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS,
      elementalReactions: [
        { attackAttr: "fire", targetEffect: "none", damageMultiplier: 1, removedEffects: [] },
      ],
      unitPassives: [{ id: "passive_fire_weakness", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "vulnerability", damageType: "fire", extraDamage: 1 }] }],
    });
  }

  it("화염 취약 유닛이 fire 공격 받으면 데미지 +1 (2→3)", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk  = makeUnit("fire_atk", "fire_atk", "p1", 5, 2);
    const weak = makeUnit("weak",     "weak",      "p2", 5, 5);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, weak }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "weak") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(3); // 2 + 1
  });

  it("화염 취약 유닛이 none 공격 받으면 추가 피해 없음 (2→2)", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk  = makeUnit("none_atk", "none_atk", "p1", 5, 4);
    const weak = makeUnit("weak",     "weak",      "p2", 5, 5);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, weak }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "weak") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(2);
  });
});

// ─── 4. passive_freeze_immunity — immune_effect: freeze ──────────────────────

describe("passive_freeze_immunity — 빙결 면역", () => {
  function makeRegistry() {
    return buildDataRegistry({
      units: [
        { id: "immune", nameKey: "n", descKey: "d", class: "brute",  faction: "b", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], passiveIds: ["passive_freeze_immunity"], spriteKey: "s" },
        { id: "normal", nameKey: "n", descKey: "d", class: "fighter", faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s" },
        { id: "atk",    nameKey: "n", descKey: "d", class: "ranger",  faction: "a", baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_ice",   skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_melee", nameKey: "n", descKey: "d", attackType: "melee",  rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
        { id: "wpn_ice",   nameKey: "n", descKey: "d", attackType: "ranged", rangeType: "single", minRange: 2, maxRange: 4, damage: 1, attribute: "ice",  penetrating: false, arcing: false },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS,
      elementalReactions: [
        { attackAttr: "ice", targetEffect: "none", damageMultiplier: 1, removedEffects: [], appliesEffectId: "effect_freeze" },
      ],
      unitPassives: [{ id: "passive_freeze_immunity", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "immune_effect", effectType: "freeze" }] }],
    });
  }

  it("빙결 면역 유닛이 ice 타일 진입해도 freeze 미적용", () => {
    const registry = makeRegistry();
    const ttr = new TileTransitionResolver(registry);

    const unit  = makeUnit("immune", "immune", "p2", 5, 5);
    const state = makeState({ immune: unit }, { "5,5": { position: { row: 5, col: 5 }, attribute: "ice" } });

    const changes = ttr.resolveUnitEntersTile(unit, { row: 5, col: 5 }, state);
    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "freeze")).toBe(false);
  });

  it("일반 유닛은 ice 타일 진입 시 freeze 적용됨 (비교)", () => {
    const registry = makeRegistry();
    const ttr = new TileTransitionResolver(registry);

    const unit  = makeUnit("normal", "normal", "p1", 5, 5);
    const state = makeState({ normal: unit }, { "5,5": { position: { row: 5, col: 5 }, attribute: "ice" } });

    const changes = ttr.resolveUnitEntersTile(unit, { row: 5, col: 5 }, state);
    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "freeze")).toBe(true);
  });

  it("빙결 면역 유닛은 ice 속성 공격으로도 freeze 미적용", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 2);
    const immune = makeUnit("immune", "immune", "p2", 5, 5);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, immune }));

    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "freeze")).toBe(false);
  });
});

// ─── 5. passive_amphibious — immune_tile_type: [water, river] ────────────────

describe("passive_amphibious — 수상 타일 면역", () => {
  function makeRegistry() {
    return buildDataRegistry({
      units: [
        { id: "amphi",  nameKey: "n", descKey: "d", class: "brute",  faction: "b", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], passiveIds: ["passive_amphibious"], spriteKey: "s" },
        { id: "normal", nameKey: "n", descKey: "d", class: "fighter", faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_melee", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS,
      unitPassives: [{ id: "passive_amphibious", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "immune_tile_type", tileTypes: ["water", "river"] }] }],
    });
  }

  it("수상 면역 유닛이 water 타일 진입 시 변경 없음 (완전 면역)", () => {
    const registry = makeRegistry();
    const ttr = new TileTransitionResolver(registry);

    const unit  = makeUnit("amphi", "amphi", "p2", 5, 5);
    const state = makeState({ amphi: unit }, { "5,5": { position: { row: 5, col: 5 }, attribute: "water" } });

    const changes = ttr.resolveUnitEntersTile(unit, { row: 5, col: 5 }, state);
    expect(changes).toHaveLength(0);
  });

  it("수상 면역 유닛이 river 타일 진입 시 변경 없음", () => {
    const registry = makeRegistry();
    const ttr = new TileTransitionResolver(registry);

    const unit  = makeUnit("amphi", "amphi", "p2", 5, 5);
    const state = makeState({ amphi: unit }, { "5,5": { position: { row: 5, col: 5 }, attribute: "river" } });

    const changes = ttr.resolveUnitEntersTile(unit, { row: 5, col: 5 }, state);
    expect(changes).toHaveLength(0);
  });

  it("수상 면역 유닛에 fire 효과가 있어도 water 진입 시 fire 제거 없음 (타일 자체 면역)", () => {
    const registry = makeRegistry();
    const ttr = new TileTransitionResolver(registry);

    const fireEff: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as import("@ab/metadata").MetaId, effectType: "fire", turnsRemaining: 2, appliedOnTurn: 1,
    };
    const unit  = makeUnit("amphi", "amphi", "p2", 5, 5, { activeEffects: [fireEff] });
    const state = makeState({ amphi: unit }, { "5,5": { position: { row: 5, col: 5 }, attribute: "water" } });

    const changes = ttr.resolveUnitEntersTile(unit, { row: 5, col: 5 }, state);
    expect(changes.some(c => c.type === "unit_effect_remove" && (c as { effectType: string }).effectType === "fire")).toBe(false);
  });

  it("일반 유닛은 electric 타일 진입 시 electric 효과 받음 (수상 면역과 무관, 비교)", () => {
    const registry = makeRegistry();
    const ttr = new TileTransitionResolver(registry);

    const unit  = makeUnit("normal", "normal", "p1", 5, 5);
    const state = makeState({ normal: unit }, { "5,5": { position: { row: 5, col: 5 }, attribute: "electric" } });

    const changes = ttr.resolveUnitEntersTile(unit, { row: 5, col: 5 }, state);
    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "electric")).toBe(true);
  });
});

// ─── 6. passive_generator — amplify_damage_type: electric ×2 ─────────────────

describe("passive_generator — 전기 피해 ×2 증폭 (반경 2)", () => {
  function makeRegistry() {
    return buildDataRegistry({
      units: [
        { id: "atk", nameKey: "n", descKey: "d", class: "tanker",  faction: "a", baseMovement: 2, baseHealth: 5, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_shock", skillIds: [], spriteKey: "s" },
        { id: "tgt", nameKey: "n", descKey: "d", class: "fighter", faction: "b", baseMovement: 3, baseHealth: 8, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s" },
        { id: "gen", nameKey: "n", descKey: "d", class: "utility", faction: "a", baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], passiveIds: ["passive_generator"], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_shock", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "electric", penetrating: false, arcing: false },
        { id: "wpn_melee", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none",     penetrating: false, arcing: false },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS,
      elementalReactions: [
        { attackAttr: "electric", targetEffect: "none", damageMultiplier: 1, removedEffects: [] },
      ],
      unitPassives: [{ id: "passive_generator", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "amplify_damage_type", damageType: "electric", multiplier: 2, radius: 2, radiusDiagonalCost: 2 }] }],
    });
  }

  it("generator가 반경 2 내에 있으면 전기 피해 ×2 (2→4)", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    // gen(col 3)는 tgt(col 5)와 거리 2 → 반경 이내
    const atk = makeUnit("atk", "atk", "p1", 5, 4);
    const tgt = makeUnit("tgt", "tgt", "p2", 5, 5);
    const gen = makeUnit("gen", "gen", "p1", 5, 3);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, tgt, gen }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "tgt") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(4); // 2 × 2
  });

  it("generator가 반경 밖이면 증폭 없음 (2→2)", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    // gen(col 1)은 tgt(col 5)와 거리 4 → 반경(2) 초과
    const atk = makeUnit("atk", "atk", "p1", 5, 4);
    const tgt = makeUnit("tgt", "tgt", "p2", 5, 5);
    const gen = makeUnit("gen", "gen", "p1", 5, 1);
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, tgt, gen }));

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "tgt") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(2); // 증폭 없음
  });

  it("generator가 있어도 비전기 공격은 증폭 안 됨", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk = makeUnit("atk", "atk", "p1", 5, 4);
    const tgt = makeUnit("tgt", "tgt", "p2", 5, 5);
    const gen = makeUnit("gen", "gen", "p1", 5, 3); // 반경 내지만 비전기 공격

    // overrideWeaponId로 전기 아닌 무기 사용
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, tgt, gen }), { overrideWeaponId: "wpn_melee" });

    const dmg = changes.find(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "tgt") as { amount: number } | undefined;
    expect(dmg).toBeDefined();
    expect(dmg!.amount).toBe(2);
  });
});

// ─── 7. freeze on_hit 해제 + blocksDamage ────────────────────────────────────

describe("freeze on_hit 동작 — 피격 시 빙결 해제 + blocksDamage", () => {
  function makeRegistry(piercesFreeze = false) {
    return buildDataRegistry({
      units: [
        { id: "atk",    nameKey: "n", descKey: "d", class: "fighter", faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_atk", skillIds: [], spriteKey: "s" },
        { id: "frozen", nameKey: "n", descKey: "d", class: "tanker",  faction: "b", baseMovement: 2, baseHealth: 5, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_atk", skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_atk", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false, ...(piercesFreeze ? { piercesFreeze: true } : {}) },
      ],
      skills: [], effects: EFFECTS, tiles: TILES, maps: MAPS, unitPassives: [],
    });
  }

  const freezeEff = (): import("@ab/metadata").ActiveEffect => ({
    effectId: "effect_freeze" as import("@ab/metadata").MetaId, effectType: "freeze", turnsRemaining: 1, appliedOnTurn: 1,
  });

  it("빙결 유닛 피격 시 freeze 효과 제거 (on_hit 해제)", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 4);
    const frozen = makeUnit("frozen", "frozen", "p2", 5, 5, { activeEffects: [freezeEff()] });
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, frozen }));

    expect(changes.some(c => c.type === "unit_effect_remove" && (c as { effectType: string }).effectType === "freeze")).toBe(true);
  });

  it("빙결 유닛 피격 시 데미지 차단 (blocksDamage=true)", () => {
    const registry = makeRegistry();
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 4);
    const frozen = makeUnit("frozen", "frozen", "p2", 5, 5, { activeEffects: [freezeEff()] });
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, frozen }));

    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "frozen")).toBe(false);
  });

  it("piercesFreeze 무기는 빙결 상태에서도 데미지 입힘", () => {
    const registry = makeRegistry(true); // piercesFreeze: true
    const { resolver } = makeAttackPipeline(registry);

    const atk    = makeUnit("atk",    "atk",    "p1", 5, 4);
    const frozen = makeUnit("frozen", "frozen", "p2", 5, 5, { activeEffects: [freezeEff()] });
    const changes = resolver.resolve(atk, { row: 5, col: 5 }, makeState({ atk, frozen }));

    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "frozen")).toBe(true);
  });
});
