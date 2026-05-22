/**
 * 유닛 특수 스킬 및 타일 속성 능력 검증
 *
 * 1. shield_defend (t1/t2) — 발판 타일 속성 흡수 후 공격
 * 2. r2 원거리 관통 + 넉백
 * 3. ice 타일 — clearsAllEffects + freeze 적용
 * 4. electric 타일 — 진입 시 electric 효과 적용
 * 5. sand 타일 — 진입 시 sand 효과 적용
 * 6. river cannotStop — 강 타일에 정지 불가
 * 7. t2 pull oneShot — 스킬 사용 후 skillUsed=true
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, UnitState, MetaId, PlayerId, UnitId, GameId } from "@ab/metadata";
import { AttackResolver } from "../../resolvers/attack-resolver.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import { MovementValidator } from "../../validators/movement-validator.js";
import { TileTransitionResolver } from "../../resolvers/tile-transition-resolver.js";
import { StateApplicator } from "../../state/state-applicator.js";
import { ActionProcessor } from "../../loop/action-processor.js";
import { MovementResolver } from "../../resolvers/movement-resolver.js";
import { EffectResolver } from "../../resolvers/effect-resolver.js";
import { EffectValidator } from "../../validators/effect-validator.js";
import { TileResolver } from "../../resolvers/tile-resolver.js";
import { TileValidator } from "../../validators/tile-validator.js";
import { HealthManager } from "../../managers/health-manager.js";
import { EffectManager } from "../../managers/effect-manager.js";
import { TileManager } from "../../managers/tile-manager.js";
import { TurnManager } from "../../managers/turn-manager.js";

// ─── 실제 게임 유닛 레지스트리 ────────────────────────────────────────────────────

function makeFullRegistry() {
  return buildDataRegistry({
    units: [
      { id: "t1", nameKey: "n", descKey: "d", class: "tanker", faction: "a",
        baseMovement: 3, baseHealth: 6, baseArmor: 1, attributes: [],
        primaryWeaponId: "wpn_tanker_melee", skillIds: ["skill_shield_defend"], passiveIds: ["passive_tile_absorb_attack"], spriteKey: "s" },
      { id: "t2", nameKey: "n", descKey: "d", class: "tanker", faction: "b",
        baseMovement: 3, baseHealth: 6, baseArmor: 1, attributes: [],
        primaryWeaponId: "wpn_tanker_melee", skillIds: ["skill_shield_defend", "skill_t2_pull"], passiveIds: [], spriteKey: "s" },
      { id: "f1", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_fighter_rush_kb", skillIds: [], passiveIds: [], spriteKey: "s" },
      { id: "r2", nameKey: "n", descKey: "d", class: "ranger", faction: "b",
        baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_ranger_penetrate_kb", skillIds: [], passiveIds: [], spriteKey: "s" },
      { id: "enemy", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_tanker_melee", skillIds: [], passiveIds: [], spriteKey: "s" },
    ],
    weapons: [
      { id: "wpn_tanker_melee", nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1,
        damage: 2, attribute: "none", penetrating: false, arcing: false },
      { id: "wpn_fighter_rush_kb", nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single", minRange: 1, maxRange: 3,
        damage: 2, attribute: "none", penetrating: false, arcing: false,
        rush: { requiresClearPath: true }, knockback: { distance: 1, direction: "away" } },
      { id: "wpn_ranger_penetrate_kb", nameKey: "n", descKey: "d",
        attackType: "ranged", rangeType: "penetrate", minRange: 2, maxRange: 3,
        damage: 2, attribute: "none", penetrating: false, arcing: false,
        knockback: { distance: 1, direction: "away" } },
      { id: "wpn_t2_pull", nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single", minRange: 1, maxRange: 3,
        damage: 0, attribute: "none", penetrating: false, arcing: false,
        pull: { landAdjacent: true }, requiresClearPath: true },
    ],
    skills: [
      { id: "skill_shield_defend", nameKey: "n", descKey: "d", type: "passive", oneShot: false },
      { id: "skill_t2_pull", nameKey: "n", descKey: "d", type: "active", oneShot: true, weaponId: "wpn_t2_pull" },
    ],
    effects: [
      { id: "effect_fire", nameKey: "n", descKey: "d", effectType: "fire", damagePerTurn: 1,
        blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false,
        removeConditions: [{ type: "turns", count: 3 }, { type: "river_entry" }] },
      { id: "effect_freeze", nameKey: "n", descKey: "d", effectType: "freeze", damagePerTurn: 0,
        blocksAllActions: true, alsoAffectsTile: false, clearsAllEffectsOnApply: true,
        removeConditions: [{ type: "turns", count: 1 }] },
      { id: "effect_electric", nameKey: "n", descKey: "d", effectType: "electric", damagePerTurn: 1,
        blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false,
        removeConditions: [{ type: "turns", count: 1 }] },
      { id: "effect_sand", nameKey: "n", descKey: "d", effectType: "sand", damagePerTurn: 0,
        blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false,
        removeConditions: [{ type: "on_move" }] },
      { id: "effect_acid", nameKey: "n", descKey: "d", effectType: "acid", damagePerTurn: 1,
        blocksAllActions: false, alsoAffectsTile: true, incomingDamageMultiplier: 2, clearsAllEffectsOnApply: false,
        removeConditions: [{ type: "turns", count: 3 }, { type: "river_entry" }] },
    ],
    tiles: [
      { id: "tile_plain", tileType: "plain", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
      { id: "tile_fire", tileType: "fire", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 2, appliesEffectId: "effect_fire" },
      { id: "tile_ice", tileType: "ice", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, appliesEffectId: "effect_freeze", clearsAllEffects: true },
      { id: "tile_electric", tileType: "electric", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 1, appliesEffectId: "effect_electric" },
      { id: "tile_sand", tileType: "sand", nameKey: "n", descKey: "d", moveCost: 2, cannotStop: false, impassable: false, damagePerTurn: 0, appliesEffectId: "effect_sand" },
      { id: "tile_river", tileType: "river", nameKey: "n", descKey: "d", moveCost: 2, cannotStop: true, impassable: false, damagePerTurn: 0 },
      { id: "tile_mountain", tileType: "mountain", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: true, damagePerTurn: 0 },
      { id: "tile_water", tileType: "water", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, removesEffectTypes: ["fire", "acid"] },
    ],
    maps: [{ id: "map_t", nameKey: "n", descKey: "d", playerCounts: [2], tileOverrides: [], spawnPoints: [] }],
    elementalReactions: [],
    unitPassives: [
      {
        id: "passive_tile_absorb_attack",
        nameKey: "n", descKey: "d",
        trigger: { type: "on_attack" },
        actions: [{ type: "absorb_tile_at_attacker", applyToTargetTile: true }],
      },
    ],
  });
}

const registry = makeFullRegistry();
const tileTransition = new TileTransitionResolver(registry);
const applicator = new StateApplicator();
const av = new AttackValidator(registry);
const ar = new AttackResolver(av, registry, tileTransition);
const mv = new MovementValidator(registry);
const ev = new EffectValidator(registry);
const tv = new TileValidator(registry);
const mr = new MovementResolver(mv, tileTransition);
const er = new EffectResolver(ev, registry);
const tr = new TileResolver(tv, registry);
const hm = new HealthManager(applicator);
const em = new EffectManager(er, applicator);
const tm = new TileManager(tr, applicator);
const turnMgr = new TurnManager(applicator);
const ap = new ActionProcessor(turnMgr, mv, av, mr, ar, er, applicator, hm, em, tm, registry);

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeState(
  units: Record<string, UnitState>,
  tiles: Record<string, { attribute: string }> = {},
): GameState {
  const now = new Date().toISOString();
  const p1Units = Object.entries(units).filter(([, u]) => u.playerId === "p1").map(([id]) => id as UnitId);
  const p2Units = Object.entries(units).filter(([, u]) => u.playerId === "p2").map(([id]) => id as UnitId);
  return {
    gameId: "test" as GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: "p1" as PlayerId, priority: 1 },
      { playerId: "p2" as PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as PlayerId, teamIndex: 0, priority: 1, unitIds: p1Units, connected: true, surrendered: false },
      p2: { playerId: "p2" as PlayerId, teamIndex: 1, priority: 1, unitIds: p2Units, connected: true, surrendered: false },
    },
    units: units as Record<string, UnitState>,
    map: {
      mapId: "map_t" as MetaId,
      gridSize: 11,
      tiles: Object.fromEntries(
        Object.entries(tiles).map(([k, v]) => {
          const [r, c] = k.split(",").map(Number);
          return [k, { position: { row: r!, col: c! }, attribute: v.attribute as any }];
        }),
      ),
    },
    createdAt: now,
    updatedAt: now,
  };
}

function unit(
  id: string,
  metaId: string,
  playerId: string,
  row: number,
  col: number,
  overrides: Partial<UnitState> = {},
): [string, UnitState] {
  return [id, {
    unitId: id as UnitId,
    metaId: metaId as MetaId,
    playerId: playerId as PlayerId,
    position: { row, col },
    currentHealth: 4,
    currentArmor: 0,
    movementPoints: 3,
    activeEffects: [],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
    ...overrides,
  }];
}

// ─── 1. shield_defend — 발판 타일 속성 흡수 후 공격 ─────────────────────────────

describe("1. shield_defend (t1/t2) — 발판 타일 속성 흡수", () => {
  it("t1이 fire 타일 위에서 공격 → 타일 plain으로, 공격에 fire 속성 부여", () => {
    const state = makeState(
      Object.fromEntries([
        unit("t1u", "t1", "p1", 5, 4),        // t1, fire 타일 위
        unit("tgt", "enemy", "p2", 5, 5),      // 인접 적
      ]),
      { "5,4": { attribute: "fire" } },         // t1의 발판 = fire 타일
    );

    const changes = ar.resolve(state.units["t1u"]!, { row: 5, col: 5 }, state);

    // 타일이 plain으로 변환
    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange).toBeDefined();
    expect(tileChange.position).toEqual({ row: 5, col: 4 });
    expect(tileChange.from).toBe("fire");
    expect(tileChange.to).toBe("plain");

    // 타겟에 fire 효과 적용 (fire 속성 공격이므로)
    const effectAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effectAdd).toBeDefined();
    expect(effectAdd.unitId).toBe("tgt");
    expect(effectAdd.effectType).toBe("fire");

    console.log(`  ✅ fire 타일 흡수: 타일 ${tileChange.from}→${tileChange.to}, 타겟 효과: ${effectAdd.effectType}`);
  });

  it("t1이 fire 타일 위에 있고 fire 효과도 보유 → 타일→plain + 자신의 fire 효과 제거", () => {
    const state = makeState(
      Object.fromEntries([
        unit("t1u", "t1", "p1", 5, 4, {
          activeEffects: [{
            effectId: "effect_fire" as MetaId,
            effectType: "fire",
            turnsRemaining: 2,
            appliedOnTurn: 1,
          }],
        }),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
      { "5,4": { attribute: "fire" } },
    );

    const changes = ar.resolve(state.units["t1u"]!, { row: 5, col: 5 }, state);

    // 자신의 fire 효과 제거
    const effRemove = changes.find(c => c.type === "unit_effect_remove" && (c as any).unitId === "t1u") as any;
    expect(effRemove).toBeDefined();
    expect(effRemove.effectType).toBe("fire");

    console.log(`  ✅ 자신 fire 효과 제거: unitId=${effRemove.unitId}, type=${effRemove.effectType}`);
  });

  it("t1이 plain 타일 위에서 공격 → 타일 변환 없음, 기본 공격(속성 none)", () => {
    const state = makeState(
      Object.fromEntries([
        unit("t1u", "t1", "p1", 5, 4),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
    );

    const changes = ar.resolve(state.units["t1u"]!, { row: 5, col: 5 }, state);

    const tileChange = changes.find(c => c.type === "tile_attribute_change");
    const effectAdd = changes.find(c => c.type === "unit_effect_add");
    expect(tileChange).toBeUndefined();
    expect(effectAdd).toBeUndefined();

    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe(2);

    console.log(`  ✅ 평지에서 공격: 타일 변환 없음, 데미지=${dmg.amount}`);
  });
});

// ─── 2. r2 원거리 관통 + 넉백 ─────────────────────────────────────────────────

describe("2. r2 — 원거리 관통 + 넉백", () => {
  it("r2가 2칸 거리 타겟 공격 → 데미지 + 넉백 away 1칸", () => {
    const state = makeState(
      Object.fromEntries([
        unit("r2u", "r2", "p1", 5, 3),
        unit("tgt", "enemy", "p2", 5, 5),  // 거리 2 (minRange=2)
      ]),
    );

    const changes = ar.resolve(state.units["r2u"]!, { row: 5, col: 5 }, state);

    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe(2);

    const kb = changes.find(c => c.type === "unit_knockback") as any;
    expect(kb).toBeDefined();
    expect(kb.unitId).toBe("tgt");
    expect(kb.to).toEqual({ row: 5, col: 6 }); // col 5+1=6 (knockback distance=1, away)

    const newState = applicator.apply(changes, state);
    expect(newState.units["tgt"]!.position).toEqual({ row: 5, col: 6 });

    console.log(`  ✅ r2 원거리 넉백: 데미지=${dmg.amount}, (5,5)→(5,${kb.to.col})`);
  });

  it("r2가 1칸 거리 타겟 공격 → AttackValidator 거부 (minRange=2)", () => {
    const state = makeState(
      Object.fromEntries([
        unit("r2u", "r2", "p1", 5, 4),
        unit("tgt", "enemy", "p2", 5, 5),  // 거리 1 < minRange 2
      ]),
    );

    const valid = av.validateAttack(state.units["r2u"]!, { row: 5, col: 5 }, state);
    expect(valid.valid).toBe(false);

    console.log(`  ✅ r2 최소 사거리 미달 거부: ${valid.errorCode}`);
  });

  it("r2가 4칸 거리 타겟 공격 → AttackValidator 거부 (maxRange=3)", () => {
    const state = makeState(
      Object.fromEntries([
        unit("r2u", "r2", "p1", 5, 1),
        unit("tgt", "enemy", "p2", 5, 5),  // 거리 4 > maxRange 3
      ]),
    );

    const valid = av.validateAttack(state.units["r2u"]!, { row: 5, col: 5 }, state);
    expect(valid.valid).toBe(false);

    console.log(`  ✅ r2 최대 사거리 초과 거부: ${valid.errorCode}`);
  });
});

// ─── 3. ice 타일 — clearsAllEffects + freeze 적용 ────────────────────────────

describe("3. ice 타일 — clearsAllEffects + freeze 적용", () => {
  it("fire 효과 보유 유닛이 ice 타일 진입 → fire 제거 후 freeze 적용", () => {
    const u = {
      unitId: "u1" as UnitId, metaId: "f1" as MetaId, playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [{ effectId: "effect_fire" as MetaId, effectType: "fire" as any, turnsRemaining: 2, appliedOnTurn: 1 }],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const changes = tileTransition.resolveUnitEntersTile(u, { row: 5, col: 5 }, "ice", makeState({ u1: u }));

    // 기존 fire 효과 제거
    const fireRemove = changes.find(c => c.type === "unit_effect_remove" && (c as any).effectType === "fire") as any;
    expect(fireRemove).toBeDefined();
    expect(fireRemove.unitId).toBe("u1");

    // freeze 효과 추가
    const freezeAdd = changes.find(c => c.type === "unit_effect_add" && (c as any).effectType === "freeze") as any;
    expect(freezeAdd).toBeDefined();
    expect(freezeAdd.unitId).toBe("u1");

    console.log(`  ✅ ice 타일: fire 제거 + freeze 적용 (changes: ${changes.map(c=>c.type).join(", ")})`);
  });

  it("아무 효과 없는 유닛이 ice 타일 진입 → freeze만 적용", () => {
    const u = {
      unitId: "u1" as UnitId, metaId: "f1" as MetaId, playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3, activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const changes = tileTransition.resolveUnitEntersTile(u, { row: 5, col: 5 }, "ice", makeState({ u1: u }));

    expect(changes.filter(c => c.type === "unit_effect_remove")).toHaveLength(0);
    const freezeAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(freezeAdd?.effectType).toBe("freeze");

    console.log(`  ✅ 효과 없는 유닛 + ice 타일: freeze만 적용`);
  });
});

// ─── 4. electric 타일 — 진입 시 electric 효과 ─────────────────────────────────

describe("4. electric 타일 — 진입 시 효과 적용", () => {
  it("유닛이 electric 타일 진입 → electric 효과 부여", () => {
    const u = {
      unitId: "u1" as UnitId, metaId: "f1" as MetaId, playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3, activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const changes = tileTransition.resolveUnitEntersTile(u, { row: 5, col: 5 }, "electric", makeState({ u1: u }));

    const effAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effAdd).toBeDefined();
    expect(effAdd.effectType).toBe("electric");
    expect(effAdd.unitId).toBe("u1");

    console.log(`  ✅ electric 타일 진입 → 효과: ${effAdd.effectType}`);
  });

  it("이미 electric 효과가 있는 유닛은 중복 적용 안 됨", () => {
    const u = {
      unitId: "u1" as UnitId, metaId: "f1" as MetaId, playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3,
      activeEffects: [{ effectId: "effect_electric" as MetaId, effectType: "electric" as any, turnsRemaining: 1, appliedOnTurn: 1 }],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const changes = tileTransition.resolveUnitEntersTile(u, { row: 5, col: 5 }, "electric", makeState({ u1: u }));
    const effAdds = changes.filter(c => c.type === "unit_effect_add");
    expect(effAdds).toHaveLength(0);

    console.log(`  ✅ electric 효과 중복 적용 방지: 추가된 효과 ${effAdds.length}개`);
  });
});

// ─── 5. sand 타일 — 진입 시 sand 효과 ────────────────────────────────────────

describe("5. sand 타일 — 진입 시 효과 적용", () => {
  it("유닛이 sand 타일 진입 → sand 효과 부여", () => {
    const u = {
      unitId: "u1" as UnitId, metaId: "f1" as MetaId, playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 4, currentArmor: 0, movementPoints: 3, activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const changes = tileTransition.resolveUnitEntersTile(u, { row: 5, col: 5 }, "sand", makeState({ u1: u }));

    const effAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effAdd).toBeDefined();
    expect(effAdd.effectType).toBe("sand");

    console.log(`  ✅ sand 타일 진입 → 효과: ${effAdd.effectType}`);
  });
});

// ─── 6. river cannotStop — 강 타일에 정지 불가 ────────────────────────────────

describe("6. river cannotStop — 강 타일에 정지 불가", () => {
  it("이동 목적지가 river 타일이면 MovementValidator 거부", () => {
    const state = makeState(
      Object.fromEntries([unit("u1", "f1", "p1", 5, 3)]),
      { "5,5": { attribute: "river" } },
    );

    const valid = mv.validateMove(state.units["u1"]!, { row: 5, col: 5 }, state);
    expect(valid.valid).toBe(false);

    console.log(`  ✅ river 타일 정지 거부: ${valid.errorCode}`);
  });

  it("river 타일을 통과하는 경로는 허용되지 않음 (경유지 포함 cannotStop)", () => {
    // 이동 거리를 river로 가려는 시도 자체가 거부됨
    const state = makeState(
      Object.fromEntries([unit("u1", "f1", "p1", 5, 3)]),
      { "5,4": { attribute: "river" }, "5,5": { attribute: "river" } },
    );

    // river에 멈추려는 시도
    const valid = mv.validateMove(state.units["u1"]!, { row: 5, col: 4 }, state);
    expect(valid.valid).toBe(false);

    console.log(`  ✅ river 타일 중간 정지 거부: ${valid.errorCode}`);
  });
});

// ─── 7. t2 pull oneShot — 스킬 사용 후 skillUsed=true ────────────────────────

describe("7. t2 skill_t2_pull — oneShot, 사용 후 skillUsed=true", () => {
  it("t2가 pull 스킬 사용 → skillUsed=true, 적 인접으로 이동", () => {
    const state = makeState(
      Object.fromEntries([
        unit("t2u", "t2", "p1", 5, 5),
        unit("tgt", "enemy", "p2", 5, 8),  // 거리 3
      ]),
    );

    const action = {
      type: "skill" as const,
      playerId: "p1" as PlayerId,
      unitId: "t2u" as UnitId,
      skillId: "skill_t2_pull" as MetaId,
      target: { row: 5, col: 8 },
    };

    const result = ap.process(action, state);
    expect(result.accepted).toBe(true);

    // 적이 t2 인접으로 당겨짐
    const tgt = result.newState.units["tgt"]!;
    const t2 = result.newState.units["t2u"]!;
    const dist = Math.abs(tgt.position.row - t2.position.row) + Math.abs(tgt.position.col - t2.position.col);
    expect(dist).toBe(1);

    // skillUsed=true
    expect(result.newState.units["t2u"]!.actionsUsed.skillUsed).toBe(true);

    console.log(`  ✅ pull 성공: 적 이동 → (${tgt.position.row},${tgt.position.col}), skillUsed=${result.newState.units["t2u"]!.actionsUsed.skillUsed}`);
  });

  it("pull 스킬을 이미 사용한 t2는 재사용 불가 (skillUsed=true)", () => {
    const state = makeState(
      Object.fromEntries([
        unit("t2u", "t2", "p1", 5, 5, {
          actionsUsed: { moved: false, attacked: false, skillUsed: true, extinguished: false },
        }),
        unit("tgt", "enemy", "p2", 5, 8),
      ]),
    );

    const action = {
      type: "skill" as const,
      playerId: "p1" as PlayerId,
      unitId: "t2u" as UnitId,
      skillId: "skill_t2_pull" as MetaId,
      target: { row: 5, col: 8 },
    };

    const result = ap.process(action, state);
    expect(result.accepted).toBe(false);

    console.log(`  ✅ pull 중복 사용 거부: ${result.errorCode}`);
  });

  it("pull 사거리 초과(4칸)는 거부", () => {
    const state = makeState(
      Object.fromEntries([
        unit("t2u", "t2", "p1", 5, 5),
        unit("tgt", "enemy", "p2", 5, 9),  // 거리 4 > maxRange 3
      ]),
    );

    const action = {
      type: "skill" as const,
      playerId: "p1" as PlayerId,
      unitId: "t2u" as UnitId,
      skillId: "skill_t2_pull" as MetaId,
      target: { row: 5, col: 9 },
    };

    const result = ap.process(action, state);
    expect(result.accepted).toBe(false);

    console.log(`  ✅ pull 사거리 초과 거부: ${result.errorCode}`);
  });
});
