/**
 * 새 메카닉 통합 검증 테스트
 *
 * 1. 돌진 (rush) — f1/f2: 공격 시 어택커가 타겟 인접으로 이동 (isRushMovement)
 * 2. 당기기 (pull) — t2 스킬: 타겟이 t2 인접으로 이동 (unit_pull)
 * 3. 인접 타일 흡수 (adjacentTileAbsorb) — r1: sourceTile 속성 흡수 후 타일→plain
 * 4. b1 패시브: 화염 타일 진입 시 타일→plain + 자가 회복
 * 5. b2 패시브: 타일 효과/데미지 면역 + 타일 속성 주변 전파
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry, type IDataRegistry } from "@ab/metadata";
import type { GameState, UnitState, TileState } from "@ab/metadata";
import { AttackResolver } from "../../resolvers/attack-resolver.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import { TileTransitionResolver } from "../../resolvers/tile-transition-resolver.js";
import { EffectResolver } from "../../resolvers/effect-resolver.js";
import { EffectValidator } from "../../validators/effect-validator.js";
import { StateApplicator } from "../../state/state-applicator.js";

// ─── Shared primitives ────────────────────────────────────────────────────────

const TILE_PLAIN = { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 };
const TILE_FIRE  = { id: "tile_fire",  tileType: "fire",  nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 2, appliesEffectId: "effect_fire" };
const TILE_WATER = { id: "tile_water", tileType: "water", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, removesEffectTypes: [] };
const TILE_ACID  = { id: "tile_acid",  tileType: "acid",  nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 1, appliesEffectId: "effect_acid" };

const EFFECT_FIRE = { id: "effect_fire", nameKey: "e", descKey: "e", effectType: "fire", damagePerTurn: 1, blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false, removeConditions: [{ type: "turns", count: 3 }] };
const EFFECT_ACID = { id: "effect_acid", nameKey: "e", descKey: "e", effectType: "acid", damagePerTurn: 1, blocksAllActions: false, alsoAffectsTile: true,  clearsAllEffectsOnApply: false, removeConditions: [{ type: "turns", count: 3 }] };

function makeUnit(
  unitId: string, metaId: string, playerId: string, row: number, col: number,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId: unitId as import("@ab/metadata").UnitId,
    metaId: metaId as import("@ab/metadata").MetaId,
    playerId: playerId as import("@ab/metadata").PlayerId,
    position: { row, col },
    currentHealth: 4, currentArmor: 0, movementPoints: 3,
    activeEffects: [],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
    ...overrides,
  } as UnitState;
}

function makeState(
  units: Record<string, UnitState>,
  tiles: Record<string, TileState> = {},
): GameState {
  const now = new Date().toISOString();
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
      p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1,
            unitIds: Object.values(units).filter(u => u.playerId === "p1").map(u => u.unitId), connected: true, surrendered: false },
      p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1,
            unitIds: Object.values(units).filter(u => u.playerId === "p2").map(u => u.unitId), connected: true, surrendered: false },
    },
    units,
    map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles },
    createdAt: now, updatedAt: now,
  };
}

// ─── 1. 돌진 (Rush) ───────────────────────────────────────────────────────────

describe("1. 돌진 (rush) — 공격 시 어택커가 타겟 인접으로 이동", () => {
  function makeRushRegistry() {
    return buildDataRegistry({
      units: [
        { id: "f1", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
          baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_rush", skillIds: [], spriteKey: "s" },
        { id: "enemy", nameKey: "n", descKey: "d", class: "tanker", faction: "b",
          baseMovement: 3, baseHealth: 6, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_rush", skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_rush", nameKey: "w", descKey: "d",
          attackType: "melee", rangeType: "single",
          minRange: 1, maxRange: 3,
          damage: 2, attribute: "none", penetrating: false, arcing: false,
          rush: { requiresClearPath: true },
          knockback: { distance: 1, direction: "away" } },
      ],
      skills: [], effects: [],
      tiles: [TILE_PLAIN],
      maps: [],
    });
  }

  it("어택커가 타겟과 2칸 거리 → unit_move(isRushMovement=true) 생성, 어택커가 인접으로 이동", () => {
    const reg = makeRushRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    // f1(5,3) → enemy(5,5), 거리 2, 사이 빈칸
    const atk = makeUnit("atk", "f1", "p1", 5, 3);
    const tgt = makeUnit("tgt", "enemy", "p2", 5, 5);
    const state = makeState({ atk, tgt });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    // unit_move with isRushMovement=true
    const rushMove = changes.find(c =>
      c.type === "unit_move" &&
      (c as Extract<typeof c, { type: "unit_move" }>).isRushMovement === true
    ) as Extract<typeof changes[number], { type: "unit_move" }> | undefined;

    expect(rushMove).toBeDefined();
    expect(rushMove!.unitId).toBe("atk");
    expect(rushMove!.to).toEqual({ row: 5, col: 4 }); // 타겟(5,5) 인접 = (5,4)

    console.log(`  ✅ 돌진 이동: ${JSON.stringify(rushMove!.from)} → ${JSON.stringify(rushMove!.to)} (isRushMovement=true)`);
  });

  it("이미 인접한 경우 (거리 1) rush 이동 없이 바로 공격", () => {
    const reg = makeRushRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    const atk = makeUnit("atk", "f1", "p1", 5, 4);
    const tgt = makeUnit("tgt", "enemy", "p2", 5, 5);
    const state = makeState({ atk, tgt });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    // 이미 인접이므로 rush move 없음
    const rushMove = changes.find(c =>
      c.type === "unit_move" &&
      (c as Extract<typeof c, { type: "unit_move" }>).isRushMovement === true
    );
    expect(rushMove).toBeUndefined();

    // 데미지는 발생해야 함
    const dmg = changes.find(c => c.type === "unit_damage");
    expect(dmg).toBeDefined();

    console.log(`  ✅ 인접 시 rush 이동 없음, 데미지 발생`);
  });

  it("rush 시 경로에 장애물 있으면 AttackValidator가 거부", () => {
    const reg = makeRushRegistry();
    const av = new AttackValidator(reg);

    // f1(5,3) → enemy(5,6), 사이에 blocker(5,4)
    const atk = makeUnit("atk", "f1", "p1", 5, 3);
    const blocker = makeUnit("blk", "enemy", "p2", 5, 4);
    const tgt = makeUnit("tgt", "enemy", "p2", 5, 6);
    const state = makeState({ atk, blocker, tgt });

    const result = av.validateAttack(atk, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);

    console.log(`  ✅ 경로 장애물 시 거부: ${result.errorCode}`);
  });

  it("rush 후 knockback도 정상 발생", () => {
    const reg = makeRushRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    const atk = makeUnit("atk", "f1", "p1", 5, 3);
    const tgt = makeUnit("tgt", "enemy", "p2", 5, 5);
    const state = makeState({ atk, tgt });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    const kb = changes.find(c => c.type === "unit_knockback") as any;
    expect(kb).toBeDefined();
    expect(kb.to).toEqual({ row: 5, col: 6 }); // enemy → (5,6) 밀려남

    console.log(`  ✅ rush + knockback: enemy (5,5) → ${JSON.stringify(kb.to)}`);
  });
});

// ─── 2. 당기기 (Pull) ────────────────────────────────────────────────────────

describe("2. 당기기 (pull) — t2 스킬: 타겟이 t2 인접으로 이동", () => {
  function makePullRegistry() {
    return buildDataRegistry({
      units: [
        { id: "t2", nameKey: "n", descKey: "d", class: "tanker", faction: "a",
          baseMovement: 3, baseHealth: 6, baseArmor: 1, attributes: [],
          primaryWeaponId: "wpn_melee_basic", skillIds: ["skill_t2_pull"], spriteKey: "s" },
        { id: "enemy", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
          baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_melee_basic", skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_melee_basic", nameKey: "w", descKey: "d",
          attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1,
          damage: 2, attribute: "none", penetrating: false, arcing: false },
        { id: "wpn_t2_pull", nameKey: "w", descKey: "d",
          attackType: "melee", rangeType: "single", minRange: 1, maxRange: 3,
          damage: 0, attribute: "none", penetrating: false, arcing: false,
          pull: { landAdjacent: true }, requiresClearPath: true },
      ],
      skills: [
        { id: "skill_t2_pull", nameKey: "s", descKey: "s", type: "active", oneShot: true, weaponId: "wpn_t2_pull" },
      ],
      effects: [],
      tiles: [TILE_PLAIN],
      maps: [],
    });
  }

  it("t2 당기기: 적이 3칸 거리 → unit_pull 생성, 적이 t2 인접으로 이동", () => {
    const reg = makePullRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    // t2(5,5), enemy(5,8) — 거리 3, pull 범위 내
    const t2 = makeUnit("t2u", "t2", "p1", 5, 5);
    const enemy = makeUnit("tgt", "enemy", "p2", 5, 8);
    const state = makeState({ t2u: t2, tgt: enemy });

    const changes = ar.resolve(t2, { row: 5, col: 8 }, state, { overrideWeaponId: "wpn_t2_pull" });

    const pull = changes.find(c => c.type === "unit_pull") as Extract<typeof changes[number], { type: "unit_pull" }> | undefined;
    expect(pull).toBeDefined();
    expect(pull!.unitId).toBe("tgt");
    expect(pull!.from).toEqual({ row: 5, col: 8 });
    expect(pull!.to).toEqual({ row: 5, col: 6 }); // t2(5,5) 인접

    console.log(`  ✅ 당기기: enemy (5,8) → ${JSON.stringify(pull!.to)} (t2 인접)`);
  });

  it("경로 장애물 시 pull 거부 (requiresClearPath)", () => {
    const reg = makePullRegistry();
    const av = new AttackValidator(reg);

    // t2(5,5), blocker(5,7), enemy(5,8)
    const t2 = makeUnit("t2u", "t2", "p1", 5, 5);
    const blocker = makeUnit("blk", "enemy", "p2", 5, 7);
    const enemy = makeUnit("tgt", "enemy", "p2", 5, 8);
    const state = makeState({ t2u: t2, blk: blocker, tgt: enemy });

    const result = av.validateAttack(t2, { row: 5, col: 8 }, state, { overrideWeaponId: "wpn_t2_pull" });
    expect(result.valid).toBe(false);

    console.log(`  ✅ 경로 장애물 시 당기기 거부: ${result.errorCode}`);
  });

  it("pull 사거리 초과 시 거부 (>3칸)", () => {
    const reg = makePullRegistry();
    const av = new AttackValidator(reg);

    const t2 = makeUnit("t2u", "t2", "p1", 5, 5);
    const enemy = makeUnit("tgt", "enemy", "p2", 5, 9); // 거리 4
    const state = makeState({ t2u: t2, tgt: enemy });

    const result = av.validateAttack(t2, { row: 5, col: 9 }, state, { overrideWeaponId: "wpn_t2_pull" });
    expect(result.valid).toBe(false);

    console.log(`  ✅ 사거리 초과 당기기 거부: ${result.errorCode}`);
  });
});

// ─── 3. 인접 타일 흡수 (adjacentTileAbsorb) ─────────────────────────────────

describe("3. 인접 타일 흡수 (adjacentTileAbsorb) — r1: 인접 타일 속성으로 공격", () => {
  function makeAbsorbRegistry() {
    return buildDataRegistry({
      units: [
        { id: "r1", nameKey: "n", descKey: "d", class: "ranger", faction: "a",
          baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_absorb", skillIds: [], spriteKey: "s" },
        { id: "enemy", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
          baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_absorb", skillIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_absorb", nameKey: "w", descKey: "d",
          attackType: "ranged", rangeType: "penetrate", minRange: 2, maxRange: 3,
          damage: 2, attribute: "none", penetrating: false, arcing: false,
          adjacentTileAbsorb: true },
      ],
      skills: [],
      effects: [EFFECT_FIRE],
      tiles: [TILE_PLAIN, TILE_FIRE],
      maps: [],
    });
  }

  it("r1이 fire 타일 흡수 후 공격 → fire 속성으로 타겟에 effect_fire 적용", () => {
    const reg = makeAbsorbRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    // r1(5,5), fire tile(5,6), enemy(5,8)
    const r1 = makeUnit("r1u", "r1", "p1", 5, 5);
    const enemy = makeUnit("tgt", "enemy", "p2", 5, 8);
    const fireTile: TileState = { position: { row: 5, col: 6 }, attribute: "fire" };
    const state = makeState({ r1u: r1, tgt: enemy }, { "5,6": fireTile });

    const changes = ar.resolve(r1, { row: 5, col: 8 }, state, { sourceTile: { row: 5, col: 6 } });

    // fire tile → plain
    const tileChange = changes.find(c =>
      c.type === "tile_attribute_change" &&
      (c as Extract<typeof c, { type: "tile_attribute_change" }>).from === "fire"
    ) as any;
    expect(tileChange).toBeDefined();
    expect(tileChange.to).toBe("plain");
    expect(tileChange.position).toEqual({ row: 5, col: 6 });

    // fire effect on enemy
    const effectAdd = changes.find(c =>
      c.type === "unit_effect_add" &&
      (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire"
    );
    expect(effectAdd).toBeDefined();

    console.log(`  ✅ 타일 흡수: fire tile(5,6) → plain, enemy에 fire 효과 적용`);
  });

  it("sourceTile 없으면 attribute none으로 공격 (효과 없음)", () => {
    const reg = makeAbsorbRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    const r1 = makeUnit("r1u", "r1", "p1", 5, 5);
    const enemy = makeUnit("tgt", "enemy", "p2", 5, 8);
    const fireTile: TileState = { position: { row: 5, col: 6 }, attribute: "fire" };
    const state = makeState({ r1u: r1, tgt: enemy }, { "5,6": fireTile });

    // sourceTile 미제공
    const changes = ar.resolve(r1, { row: 5, col: 8 }, state);

    // fire tile 변경 없음
    const tileChange = changes.find(c =>
      c.type === "tile_attribute_change" &&
      (c as Extract<typeof c, { type: "tile_attribute_change" }>).from === "fire"
    );
    expect(tileChange).toBeUndefined();

    // effect_fire 미적용
    const effectAdd = changes.find(c =>
      c.type === "unit_effect_add" &&
      (c as Extract<typeof c, { type: "unit_effect_add" }>).effectType === "fire"
    );
    expect(effectAdd).toBeUndefined();

    console.log(`  ✅ sourceTile 없으면 속성 없이 공격 (타일/효과 변화 없음)`);
  });
});

// ─── 4. b1 패시브: 화염 타일 진입 → 타일 plain + 자가 회복 ───────────────────

describe("4. b1 패시브 — 화염 타일 진입 시 타일 plain 변환 + 자가 회복", () => {
  function makeB1Registry() {
    return buildDataRegistry({
      units: [
        { id: "b1", nameKey: "n", descKey: "d", class: "brute", faction: "a",
          baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_dummy", skillIds: [], passiveIds: ["passive_b1_fire_heal"], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_dummy", nameKey: "w", descKey: "d", attackType: "melee", rangeType: "single",
          minRange: 1, maxRange: 1, damage: 1, attribute: "none", penetrating: false, arcing: false },
      ],
      skills: [],
      effects: [EFFECT_FIRE],
      tiles: [TILE_PLAIN, TILE_FIRE],
      maps: [],
      unitPassives: [
        { id: "passive_b1_fire_heal",
          nameKey: "p", descKey: "p",
          trigger: { type: "on_tile_entry_of", tileAttribute: "fire" },
          actions: [
            { type: "convert_entered_tile", to: "plain" },
            { type: "heal_self", amount: 1 },
          ] },
      ],
    });
  }

  it("b1이 화염 타일 진입 → tile_attribute_change(fire→plain) + unit_heal(+1)", () => {
    const reg = makeB1Registry();
    const ttr = new TileTransitionResolver(reg);

    const b1 = makeUnit("b1u", "b1", "p1", 5, 5, { currentHealth: 3 }); // HP 3/5
    const fireTile: TileState = { position: { row: 5, col: 6 }, attribute: "fire" };
    const state = makeState({ b1u: b1 }, { "5,6": fireTile });

    const changes = ttr.resolveUnitEntersTile(b1, { row: 5, col: 6 }, "fire", state);

    // 타일 변환
    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange).toBeDefined();
    expect(tileChange.from).toBe("fire");
    expect(tileChange.to).toBe("plain");

    // 자가 회복
    const heal = changes.find(c => c.type === "unit_heal") as any;
    expect(heal).toBeDefined();
    expect(heal.amount).toBe(1);
    expect(heal.hpAfter).toBe(4); // 3 + 1

    // 이미 plain으로 변환됐으므로 fire 효과 미적용
    const effectAdd = changes.find(c => c.type === "unit_effect_add");
    expect(effectAdd).toBeUndefined();

    console.log(`  ✅ b1 화염 진입: tile fire→plain, HP 3→${heal.hpAfter}`);
  });

  it("b1이 이미 최대 HP면 heal 없음", () => {
    const reg = makeB1Registry();
    const ttr = new TileTransitionResolver(reg);

    const b1 = makeUnit("b1u", "b1", "p1", 5, 5, { currentHealth: 5 }); // 최대 HP
    const fireTile: TileState = { position: { row: 5, col: 6 }, attribute: "fire" };
    const state = makeState({ b1u: b1 }, { "5,6": fireTile });

    const changes = ttr.resolveUnitEntersTile(b1, { row: 5, col: 6 }, "fire", state);

    const heal = changes.find(c => c.type === "unit_heal");
    expect(heal).toBeUndefined();

    const tileChange = changes.find(c => c.type === "tile_attribute_change");
    expect(tileChange).toBeDefined(); // 타일 변환은 여전히 발생

    console.log(`  ✅ b1 최대 HP 시 heal 없음 (타일 변환은 발생)`);
  });

  it("b1이 non-fire 타일 진입 시 패시브 미발동", () => {
    const reg = makeB1Registry();
    const ttr = new TileTransitionResolver(reg);

    const b1 = makeUnit("b1u", "b1", "p1", 5, 5, { currentHealth: 3 });
    const waterTile: TileState = { position: { row: 5, col: 6 }, attribute: "water" };
    const state = makeState({ b1u: b1 }, { "5,6": waterTile });

    const changes = ttr.resolveUnitEntersTile(b1, { row: 5, col: 6 }, "water", state);

    // fire 패시브 미발동 → 타일 변환, heal 없음
    expect(changes.find(c => c.type === "tile_attribute_change")).toBeUndefined();
    expect(changes.find(c => c.type === "unit_heal")).toBeUndefined();

    console.log(`  ✅ b1 비화염 타일 진입 시 패시브 미발동`);
  });
});

// ─── 5. b2 패시브: 면역 + 타일 속성 전파 ────────────────────────────────────

describe("5. b2 패시브 — 타일 면역 + 타일 속성 전파", () => {
  function makeB2Registry() {
    return buildDataRegistry({
      units: [
        { id: "b2", nameKey: "n", descKey: "d", class: "brute", faction: "b",
          baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_dummy", skillIds: [],
          passiveIds: ["passive_b2_tile_immunity", "passive_b2_tile_spread"], spriteKey: "s" },
        { id: "normal", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
          baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_dummy", skillIds: [], passiveIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_dummy", nameKey: "w", descKey: "d", attackType: "melee", rangeType: "single",
          minRange: 1, maxRange: 1, damage: 1, attribute: "none", penetrating: false, arcing: false },
      ],
      skills: [],
      effects: [EFFECT_FIRE, EFFECT_ACID],
      tiles: [TILE_PLAIN, TILE_FIRE, TILE_WATER, TILE_ACID],
      maps: [],
      unitPassives: [
        { id: "passive_b2_tile_immunity",
          nameKey: "p", descKey: "p",
          trigger: { type: "always_on" },
          actions: [
            { type: "immune_tile_effects" },
            { type: "immune_tile_damage" },
            { type: "immune_elemental_effects" },
          ] },
        { id: "passive_b2_tile_spread",
          nameKey: "p", descKey: "p",
          trigger: { type: "on_tile_entry_any_attribute" },
          actions: [{ type: "spread_entered_tile_attr" }] },
      ],
    });
  }

  it("b2가 fire 타일 진입 → fire 효과 미적용 (면역)", () => {
    const reg = makeB2Registry();
    const ttr = new TileTransitionResolver(reg);

    const b2 = makeUnit("b2u", "b2", "p2", 5, 5);
    const fireTile: TileState = { position: { row: 5, col: 6 }, attribute: "fire" };
    const state = makeState({ b2u: b2 }, { "5,6": fireTile });

    const changes = ttr.resolveUnitEntersTile(b2, { row: 5, col: 6 }, "fire", state);

    // fire 효과 미적용
    const effectAdd = changes.find(c => c.type === "unit_effect_add");
    expect(effectAdd).toBeUndefined();

    console.log(`  ✅ b2 fire 타일 진입 시 효과 없음 (면역)`);
  });

  it("b2 fire 타일 진입 → 4방향 인접 타일에 fire 전파 (spread)", () => {
    const reg = makeB2Registry();
    const ttr = new TileTransitionResolver(reg);

    // b2(5,5), fire tile(5,6) 진입 → (4,6), (6,6), (5,5), (5,7)에 fire 전파
    const b2 = makeUnit("b2u", "b2", "p2", 5, 5);
    const fireTile: TileState = { position: { row: 5, col: 6 }, attribute: "fire" };
    const state = makeState({ b2u: b2 }, { "5,6": fireTile });

    const changes = ttr.resolveUnitEntersTile(b2, { row: 5, col: 6 }, "fire", state);

    // 4방향 타일 변환
    const tileChanges = changes.filter(c => c.type === "tile_attribute_change") as any[];
    // 4개 인접 중 fire가 아닌 타일들만 변환됨 (이미 fire면 skip)
    expect(tileChanges.length).toBeGreaterThan(0);
    tileChanges.forEach(tc => expect(tc.to).toBe("fire"));

    const positions = tileChanges.map((tc: any) => tc.position);
    // (4,6), (6,6), (5,5), (5,7) 중 일부 포함
    const expectedNeighbors = [
      { row: 4, col: 6 }, { row: 6, col: 6 },
      { row: 5, col: 5 }, { row: 5, col: 7 },
    ];
    for (const n of expectedNeighbors) {
      expect(positions).toContainEqual(n);
    }

    console.log(`  ✅ b2 fire 타일 진입 → ${tileChanges.length}개 인접 타일에 fire 전파`);
  });

  it("b2 turn-start tile damage 없음 (immune_tile_damage)", () => {
    const reg = makeB2Registry();
    const ev = new EffectValidator(reg);
    const er = new EffectResolver(ev, reg);

    const b2 = makeUnit("b2u", "b2", "p2", 5, 5);
    const fireTile: TileState = { position: { row: 5, col: 5 }, attribute: "fire" };
    const state = makeState({ b2u: b2 }, { "5,5": fireTile });

    // b2가 fire 타일 위 — resolveTurnTick 호출
    const changes = er.resolveTurnTick(b2, state);

    const tileDmg = changes.find(c =>
      c.type === "unit_damage" &&
      (c as Extract<typeof c, { type: "unit_damage" }>).source.type === "tile"
    );
    expect(tileDmg).toBeUndefined();

    console.log(`  ✅ b2 fire 타일 위 턴 시작: tile damage 없음 (면역)`);
  });

  it("일반 유닛은 fire 타일 위에서 tile damage 받음 (비교)", () => {
    const reg = makeB2Registry();
    const ev = new EffectValidator(reg);
    const er = new EffectResolver(ev, reg);

    const normalUnit = makeUnit("n1", "normal", "p1", 5, 5);
    const fireTile: TileState = { position: { row: 5, col: 5 }, attribute: "fire" };
    const state = makeState({ n1: normalUnit }, { "5,5": fireTile });

    const changes = er.resolveTurnTick(normalUnit, state);

    const tileDmg = changes.find(c =>
      c.type === "unit_damage" &&
      (c as Extract<typeof c, { type: "unit_damage" }>).source.type === "tile"
    );
    expect(tileDmg).toBeDefined();

    console.log(`  ✅ 일반 유닛은 fire 타일 tile damage 받음`);
  });

  it("b2 plain 타일 진입 시 spread 패시브 미발동", () => {
    const reg = makeB2Registry();
    const ttr = new TileTransitionResolver(reg);

    const b2 = makeUnit("b2u", "b2", "p2", 5, 5);
    const state = makeState({ b2u: b2 }); // 모든 타일 plain

    const changes = ttr.resolveUnitEntersTile(b2, { row: 5, col: 6 }, "plain", state);

    const tileChanges = changes.filter(c => c.type === "tile_attribute_change");
    expect(tileChanges).toHaveLength(0);

    console.log(`  ✅ b2 plain 타일 진입 시 spread 없음`);
  });
});

// ─── 6. StateApplicator: unit_pull 처리 검증 ────────────────────────────────

describe("6. StateApplicator — unit_pull 처리", () => {
  it("unit_pull change → 유닛 위치 갱신", () => {
    const applicator = new StateApplicator();

    const unit = makeUnit("u1", "t1", "p2", 5, 8);
    const state = makeState({ u1: unit });

    const pullChange: import("@ab/metadata").GameChange = {
      type: "unit_pull",
      unitId: "u1" as import("@ab/metadata").UnitId,
      from: { row: 5, col: 8 },
      to: { row: 5, col: 6 },
    };

    const newState = applicator.apply([pullChange], state);
    expect(newState.units["u1"]!.position).toEqual({ row: 5, col: 6 });

    console.log(`  ✅ unit_pull: (5,8) → (5,6) 위치 갱신`);
  });
});

// ─── 7. b2 immune_elemental_effects ──────────────────────────────────────────

describe("7. b2 패시브 — immune_elemental_effects: 원소 반응 면역", () => {
  function makeB2ReactionRegistry() {
    const EFFECT_FREEZE = {
      id: "effect_freeze", nameKey: "e", descKey: "e", effectType: "freeze",
      damagePerTurn: 0, blocksAllActions: true, alsoAffectsTile: false,
      clearsAllEffectsOnApply: true,
      removeConditions: [{ type: "turns" as const, count: 2 }],
    };
    const EFFECT_FIRE2 = { ...EFFECT_FIRE };
    return buildDataRegistry({
      units: [
        { id: "b2", nameKey: "n", descKey: "d", class: "brute", faction: "b",
          baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_fire_atk", skillIds: [],
          passiveIds: ["passive_b2_tile_immunity"], spriteKey: "s" },
        { id: "normal", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
          baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_fire_atk", skillIds: [], passiveIds: [], spriteKey: "s" },
        { id: "attacker", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
          baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
          primaryWeaponId: "wpn_fire_atk", skillIds: [], passiveIds: [], spriteKey: "s" },
      ],
      weapons: [
        { id: "wpn_fire_atk", nameKey: "w", descKey: "d", attackType: "melee", rangeType: "single",
          minRange: 1, maxRange: 1, damage: 2, attribute: "fire", penetrating: false, arcing: false },
      ],
      skills: [],
      effects: [EFFECT_FIRE2, EFFECT_FREEZE],
      tiles: [TILE_PLAIN, TILE_FIRE],
      maps: [],
      unitPassives: [
        { id: "passive_b2_tile_immunity",
          nameKey: "p", descKey: "p",
          trigger: { type: "always_on" },
          actions: [
            { type: "immune_tile_effects" },
            { type: "immune_tile_damage" },
            { type: "immune_elemental_effects" },
          ] },
      ],
      elementalReactions: [
        { attackAttr: "fire", targetEffect: "freeze",
          damageMultiplier: 2,
          removedEffects: ["freeze"] },
      ],
    });
  }

  it("일반 유닛이 freeze 상태에서 fire 공격 받으면 2× 데미지 + freeze 제거", () => {
    const reg = makeB2ReactionRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    const atk = makeUnit("atk", "attacker", "p1", 5, 4);
    const tgt = makeUnit("tgt", "normal", "p2", 5, 5, {
      activeEffects: [
        { effectId: "effect_freeze" as import("@ab/metadata").MetaId,
          effectType: "freeze", turnsRemaining: 2 },
      ],
    });
    const state = makeState({ atk, tgt });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    // freeze 제거 change 존재
    const removeFreeze = changes.find(c =>
      c.type === "unit_effect_remove" &&
      (c as Extract<typeof c, { type: "unit_effect_remove" }>).effectType === "freeze"
    );
    expect(removeFreeze).toBeDefined();

    // 데미지: baseDmg=2, armor=0, multiplier=2 → 4
    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe(4);

    console.log(`  ✅ 일반 유닛 freeze+fire 반응: 데미지 ${dmg.amount}, freeze 제거`);
  });

  it("b2는 freeze 상태에서 fire 공격 받아도 반응 없음 — 1× 데미지, freeze 유지", () => {
    const reg = makeB2ReactionRegistry();
    const av = new AttackValidator(reg);
    const ar = new AttackResolver(av, reg, new TileTransitionResolver(reg));

    const atk = makeUnit("atk", "attacker", "p1", 5, 4);
    const b2 = makeUnit("b2u", "b2", "p2", 5, 5, {
      activeEffects: [
        { effectId: "effect_freeze" as import("@ab/metadata").MetaId,
          effectType: "freeze", turnsRemaining: 2 },
      ],
    });
    const state = makeState({ atk, b2u: b2 });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    // freeze 제거 change 없어야 함
    const removeFreeze = changes.find(c =>
      c.type === "unit_effect_remove" &&
      (c as Extract<typeof c, { type: "unit_effect_remove" }>).effectType === "freeze"
    );
    expect(removeFreeze).toBeUndefined();

    // 데미지: baseDmg=2, armor=0, multiplier=1 (반응 없음) → 2
    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe(2);

    console.log(`  ✅ b2 immune_elemental_effects: 반응 없음, 데미지 ${dmg.amount}, freeze 유지`);
  });
});
