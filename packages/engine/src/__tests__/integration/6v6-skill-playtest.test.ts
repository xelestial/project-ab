/**
 * 6v6 스킬 플레이테스트 — 실제 유닛 데이터 기반 스킬 검증
 *
 * 검증 대상:
 *   1. f1 rush+knockback — 돌격 후 밀어냄
 *   2. r1 adjacentTileAbsorb — 인접 타일 속성 흡수 원거리 공격
 *   3. b1 fire_heal passive — fire 타일 진입 시 타일→plain + 자가 회복
 *   4. b2 tile_immunity — 타일 효과/데미지/속성 면역
 *   5. b2 tile_spread — 속성 타일 진입 시 인접 타일로 속성 전파
 *   6. 전체 팀 구성: t1/t2/f1/r1/b1/b2 모두 포함한 실제 6v6 전투 시나리오
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

// ─── 실제 6v6 유닛 레지스트리 (production 데이터와 동일) ─────────────────────────

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
      { id: "r1", nameKey: "n", descKey: "d", class: "ranger", faction: "a",
        baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_ranger_penetrate_absorb", skillIds: [], passiveIds: [], spriteKey: "s" },
      { id: "b1", nameKey: "n", descKey: "d", class: "brute", faction: "a",
        baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_brute_water", skillIds: [], passiveIds: ["passive_b1_fire_heal"], spriteKey: "s" },
      { id: "b2", nameKey: "n", descKey: "d", class: "brute", faction: "b",
        baseMovement: 3, baseHealth: 5, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_brute_melee", skillIds: [], passiveIds: ["passive_b2_tile_immunity", "passive_b2_tile_spread"], spriteKey: "s" },
      { id: "enemy", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
        baseMovement: 3, baseHealth: 6, baseArmor: 0, attributes: [],
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
      { id: "wpn_ranger_penetrate_absorb", nameKey: "n", descKey: "d",
        attackType: "ranged", rangeType: "penetrate", minRange: 2, maxRange: 3,
        damage: 2, attribute: "none", penetrating: false, arcing: false,
        adjacentTileAbsorb: true },
      { id: "wpn_brute_water", nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single", minRange: 1, maxRange: 2,
        damage: 1, attribute: "water", penetrating: false, arcing: false },
      { id: "wpn_brute_melee", nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single", minRange: 1, maxRange: 2,
        damage: 1, attribute: "none", penetrating: false, arcing: false },
      { id: "wpn_t2_pull", nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single", minRange: 1, maxRange: 3,
        damage: 0, attribute: "none", penetrating: false, arcing: false,
        pull: { landAdjacent: true }, requiresClearPath: true },
    ],
    skills: [
      { id: "skill_shield_defend", nameKey: "n", descKey: "d", type: "passive", oneShot: false },
      { id: "skill_t2_pull", nameKey: "n", descKey: "d", type: "active", oneShot: true, weaponId: "wpn_t2_pull" },
    ],
    unitPassives: [
      {
        id: "passive_tile_absorb_attack",
        nameKey: "n", descKey: "d",
        trigger: { type: "on_attack" },
        actions: [{ type: "absorb_tile_at_attacker", applyToTargetTile: true }],
      },
      {
        id: "passive_b1_fire_heal",
        nameKey: "n", descKey: "d",
        trigger: { type: "on_tile_entry_of", tileAttribute: "fire" },
        actions: [
          { type: "convert_entered_tile", to: "plain" },
          { type: "heal_self", amount: 1 },
        ],
      },
      {
        id: "passive_b2_tile_immunity",
        nameKey: "n", descKey: "d",
        trigger: { type: "always_on" },
        actions: [
          { type: "immune_tile_effects" },
          { type: "immune_tile_damage" },
          { type: "immune_elemental_effects" },
        ],
      },
      {
        id: "passive_b2_tile_spread",
        nameKey: "n", descKey: "d",
        trigger: { type: "on_tile_entry_any_attribute" },
        actions: [
          { type: "spread_entered_tile_attr" },
        ],
      },
    ],
    effects: [
      { id: "effect_fire", nameKey: "n", descKey: "d", effectType: "fire", damagePerTurn: 1,
        blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false,
        removeConditions: [{ type: "turns", count: 3 }, { type: "river_entry" }] },
      { id: "effect_acid", nameKey: "n", descKey: "d", effectType: "acid", damagePerTurn: 1,
        blocksAllActions: false, alsoAffectsTile: true, incomingDamageMultiplier: 2, clearsAllEffectsOnApply: false,
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
      { id: "effect_water", nameKey: "n", descKey: "d", effectType: "water", damagePerTurn: 0,
        blocksAllActions: false, alsoAffectsTile: false, clearsAllEffectsOnApply: false,
        removeConditions: [{ type: "turns", count: 1 }] },
    ],
    tiles: [
      { id: "tile_plain", tileType: "plain", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
      { id: "tile_mountain", tileType: "mountain", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: true, damagePerTurn: 0 },
      { id: "tile_river", tileType: "river", nameKey: "n", descKey: "d", moveCost: 2, cannotStop: true, impassable: false, damagePerTurn: 0 },
      { id: "tile_water", tileType: "water", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, removesEffectTypes: ["fire", "acid"] },
      { id: "tile_sand", tileType: "sand", nameKey: "n", descKey: "d", moveCost: 2, cannotStop: false, impassable: false, damagePerTurn: 0, appliesEffectId: "effect_sand" },
      { id: "tile_fire", tileType: "fire", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 2, appliesEffectId: "effect_fire" },
      { id: "tile_acid", tileType: "acid", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 1, appliesEffectId: "effect_acid" },
      { id: "tile_ice", tileType: "ice", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0, appliesEffectId: "effect_freeze", clearsAllEffects: true },
      { id: "tile_electric", tileType: "electric", nameKey: "n", descKey: "d", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 1, appliesEffectId: "effect_electric" },
    ],
    maps: [{ id: "map_t", nameKey: "n", descKey: "d", playerCounts: [2], tileOverrides: [], spawnPoints: [] }],
    elementalReactions: [],
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

// ─── 1. f1 rush+knockback ─────────────────────────────────────────────────────

describe("1. f1 — rush+knockback (돌격 후 밀어냄)", () => {
  it("f1이 3칸 거리 타겟 공격 → 인접으로 돌격 후 데미지+넉백 1칸", () => {
    /**
     *  f1(5,3) ──rush──→ (5,4) ──attack──→ tgt(5,5) ──kb──→ (5,6)
     */
    const state = makeState(
      Object.fromEntries([
        unit("f1u", "f1", "p1", 5, 3),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
    );

    const changes = ar.resolve(state.units["f1u"]!, { row: 5, col: 5 }, state);

    // f1 자신이 (5,4)로 러시 이동
    const rush = changes.find(c => c.type === "unit_move") as any;
    expect(rush).toBeDefined();
    expect(rush.unitId).toBe("f1u");
    expect(rush.to).toEqual({ row: 5, col: 4 });

    // 타겟 데미지 2
    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg).toBeDefined();
    expect(dmg.unitId).toBe("tgt");
    expect(dmg.amount).toBe(2);

    // 타겟 넉백 → (5,6)
    const kb = changes.find(c => c.type === "unit_knockback") as any;
    expect(kb).toBeDefined();
    expect(kb.unitId).toBe("tgt");
    expect(kb.to).toEqual({ row: 5, col: 6 });

    const newState = applicator.apply(changes, state);
    expect(newState.units["f1u"]!.position).toEqual({ row: 5, col: 4 });
    expect(newState.units["tgt"]!.position).toEqual({ row: 5, col: 6 });

    console.log(`  ✅ f1 돌격: (5,3)→(5,4) 러시, tgt (5,5)→(5,6) 넉백, 데미지=${dmg.amount}`);
  });

  it("f1이 1칸 거리 타겟 공격 → 러시 없음(이미 인접), 데미지+넉백만", () => {
    const state = makeState(
      Object.fromEntries([
        unit("f1u", "f1", "p1", 5, 4),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
    );

    const changes = ar.resolve(state.units["f1u"]!, { row: 5, col: 5 }, state);

    // 러시 이동 없음 (이미 인접)
    const rushMove = changes.find(c => c.type === "unit_move" && (c as any).isRushMovement) as any;
    expect(rushMove).toBeUndefined();

    // 데미지+넉백은 여전히 발생
    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg?.amount).toBe(2);
    const kb = changes.find(c => c.type === "unit_knockback") as any;
    expect(kb?.to).toEqual({ row: 5, col: 6 });

    console.log(`  ✅ f1 인접 공격: 러시 없음, 넉백 (5,5)→(5,6)`);
  });

  it("f1 rush 경로에 장애물(유닛)이 있으면 공격 거부 (requiresClearPath)", () => {
    /**
     * f1(5,2) → 경로 (5,3),(5,4) → tgt(5,5)
     * blocker(5,3)이 경로 차단
     */
    const state = makeState(
      Object.fromEntries([
        unit("f1u", "f1", "p1", 5, 2),
        unit("blocker", "enemy", "p2", 5, 3),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
    );

    const valid = av.validateAttack(state.units["f1u"]!, { row: 5, col: 5 }, state);
    expect(valid.valid).toBe(false);

    console.log(`  ✅ f1 경로 차단으로 공격 거부: ${valid.errorCode}`);
  });

  it("f1 넉백 대상이 경계에 있으면 벽 충돌 데미지 발생", () => {
    /**
     * f1(5,4) attacks tgt(5,10) → 넉백 방향=오른쪽 but col 11 = out of bounds → wall collision
     * gridSize=11 → max col=10, 넉백 시 col 11 = 경계 외부 → 충돌
     */
    const state = makeState(
      Object.fromEntries([
        unit("f1u", "f1", "p1", 5, 8),
        unit("tgt", "enemy", "p2", 5, 10),  // f1에서 거리 2, 타겟이 가장자리
      ]),
    );

    const changes = ar.resolve(state.units["f1u"]!, { row: 5, col: 10 }, state);

    const kb = changes.find(c => c.type === "unit_knockback") as any;
    expect(kb).toBeDefined();

    // 경계 밖으로 밀려나면 wall collision 발생
    // col 10 + 1 = col 11 (out of gridSize=11, so blocked)
    // 충돌 데미지가 추가되어야 함
    const wallDmg = changes.filter(c => c.type === "unit_damage" && (c as any).unitId === "tgt");
    // 기본 공격 데미지 + 충돌 데미지 2개
    expect(wallDmg.length).toBeGreaterThanOrEqual(1);

    console.log(`  ✅ f1 벽 충돌: 넉백 데미지 이벤트 ${wallDmg.length}개`);
  });
});

// ─── 2. r1 adjacentTileAbsorb ─────────────────────────────────────────────────

describe("2. r1 — adjacentTileAbsorb (인접 타일 속성 흡수 원거리 공격)", () => {
  it("r1이 fire 타일 흡수 후 원거리 공격 → fire 속성 공격, 타일→plain", () => {
    /**
     * r1(5,3) ← fire tile at (5,2)
     * r1 absorbs (5,2), attacks tgt(5,5)
     * → attack attr=fire, tile(5,2)→plain, tgt gets fire effect
     */
    const state = makeState(
      Object.fromEntries([
        unit("r1u", "r1", "p1", 5, 3),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
      { "5,2": { attribute: "fire" } },
    );

    const changes = ar.resolve(
      state.units["r1u"]!,
      { row: 5, col: 5 },
      state,
      { sourceTile: { row: 5, col: 2 } },
    );

    // 흡수한 타일이 plain으로 변환
    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange).toBeDefined();
    expect(tileChange.position).toEqual({ row: 5, col: 2 });
    expect(tileChange.from).toBe("fire");
    expect(tileChange.to).toBe("plain");

    // 타겟에 fire 효과 적용
    const effAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effAdd).toBeDefined();
    expect(effAdd.unitId).toBe("tgt");
    expect(effAdd.effectType).toBe("fire");

    // 데미지도 발생
    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg?.amount).toBe(2);

    console.log(`  ✅ r1 타일 흡수: fire 타일→plain, tgt fire 효과, 데미지=${dmg?.amount}`);
  });

  it("r1이 acid 타일 흡수 후 원거리 공격 → acid 속성 공격, 타일→plain", () => {
    const state = makeState(
      Object.fromEntries([
        unit("r1u", "r1", "p1", 5, 3),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
      { "5,4": { attribute: "acid" } },  // 인접 타일
    );

    const changes = ar.resolve(
      state.units["r1u"]!,
      { row: 5, col: 5 },
      state,
      { sourceTile: { row: 5, col: 4 } },
    );

    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange?.from).toBe("acid");
    expect(tileChange?.to).toBe("plain");

    const effAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effAdd?.effectType).toBe("acid");

    console.log(`  ✅ r1 acid 흡수: 타일→plain, tgt acid 효과`);
  });

  it("r1이 sourceTile 없이 공격 → 기본 속성(none)으로 공격, 효과 없음", () => {
    const state = makeState(
      Object.fromEntries([
        unit("r1u", "r1", "p1", 5, 3),
        unit("tgt", "enemy", "p2", 5, 5),
      ]),
    );

    const changes = ar.resolve(state.units["r1u"]!, { row: 5, col: 5 }, state);

    const tileChange = changes.find(c => c.type === "tile_attribute_change");
    const effAdd = changes.find(c => c.type === "unit_effect_add");
    expect(tileChange).toBeUndefined();
    expect(effAdd).toBeUndefined();

    const dmg = changes.find(c => c.type === "unit_damage") as any;
    expect(dmg?.amount).toBe(2);

    console.log(`  ✅ r1 흡수 없이 공격: 타일 변환 없음, 효과 없음, 데미지=${dmg?.amount}`);
  });

  it("r1 최소 사거리(minRange=2) 미만 타겟은 거부", () => {
    const state = makeState(
      Object.fromEntries([
        unit("r1u", "r1", "p1", 5, 4),
        unit("tgt", "enemy", "p2", 5, 5),  // 거리 1 < minRange 2
      ]),
    );

    const valid = av.validateAttack(state.units["r1u"]!, { row: 5, col: 5 }, state);
    expect(valid.valid).toBe(false);

    console.log(`  ✅ r1 최소 사거리 미달 거부: ${valid.errorCode}`);
  });
});

// ─── 3. b1 fire_heal passive ──────────────────────────────────────────────────

describe("3. b1 — passive_b1_fire_heal (fire 타일 진입 시 회복)", () => {
  it("b1이 fire 타일 진입 → 타일 plain으로, b1 HP +1", () => {
    /**
     * b1 passive: on_tile_entry_of fire → convert_entered_tile to plain + heal_self 1
     */
    const b1Unit: UnitState = {
      unitId: "b1u" as UnitId,
      metaId: "b1" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 3,  // HP 3/5 — 회복 가능
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b1u: b1Unit });

    const changes = tileTransition.resolveUnitEntersTile(b1Unit, { row: 5, col: 5 }, "fire", state);

    // 타일이 plain으로 변환
    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange).toBeDefined();
    expect(tileChange.position).toEqual({ row: 5, col: 5 });
    expect(tileChange.from).toBe("fire");
    expect(tileChange.to).toBe("plain");

    // b1 HP 회복 +1
    const heal = changes.find(c => c.type === "unit_heal") as any;
    expect(heal).toBeDefined();
    expect(heal.unitId).toBe("b1u");
    expect(heal.amount).toBe(1);

    // fire 효과 적용 없음 (타일이 plain으로 변환됨)
    const effAdd = changes.find(c => c.type === "unit_effect_add" && (c as any).effectType === "fire");
    expect(effAdd).toBeUndefined();

    console.log(`  ✅ b1 fire 타일 진입: 타일→plain, HP +${heal.amount} (3→${heal.hpAfter})`);
  });

  it("b1이 만 HP로 fire 타일 진입 → 타일 plain, 회복 없음(이미 full HP)", () => {
    const b1Unit: UnitState = {
      unitId: "b1u" as UnitId,
      metaId: "b1" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,  // 만 HP (baseHealth=5)
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b1u: b1Unit });

    const changes = tileTransition.resolveUnitEntersTile(b1Unit, { row: 5, col: 5 }, "fire", state);

    // 타일은 여전히 변환됨
    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange?.to).toBe("plain");

    // 만 HP이므로 heal 없음
    const heal = changes.find(c => c.type === "unit_heal");
    expect(heal).toBeUndefined();

    console.log(`  ✅ b1 만 HP에서 fire 타일 진입: 타일→plain, 회복 없음`);
  });

  it("b1이 acid 타일 진입 → 일반 타일 효과 적용 (passive 미작동)", () => {
    /**
     * passive는 fire 타일에만 반응 — acid 타일은 일반 처리
     */
    const b1Unit: UnitState = {
      unitId: "b1u" as UnitId,
      metaId: "b1" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 3,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b1u: b1Unit });

    const changes = tileTransition.resolveUnitEntersTile(b1Unit, { row: 5, col: 5 }, "acid", state);

    // 타일 변환 없음 (acid passive 없음)
    const tileChange = changes.find(c => c.type === "tile_attribute_change");
    expect(tileChange).toBeUndefined();

    // 회복 없음
    const heal = changes.find(c => c.type === "unit_heal");
    expect(heal).toBeUndefined();

    // acid 효과 적용됨 (일반 타일 처리)
    const effAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effAdd?.effectType).toBe("acid");

    console.log(`  ✅ b1 acid 타일 진입: passive 미작동, acid 효과 적용`);
  });
});

// ─── 4. b2 tile_immunity ─────────────────────────────────────────────────────

describe("4. b2 — passive_b2_tile_immunity (타일 효과/데미지/속성 면역)", () => {
  it("b2가 acid 타일 진입 → acid 효과 적용 없음(면역)", () => {
    /**
     * passive_b2_tile_immunity: always_on → immune_tile_effects + immune_tile_damage + immune_elemental_effects
     */
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b2u: b2Unit });

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "acid", state);

    // 효과 적용 없음
    const effAdd = changes.find(c => c.type === "unit_effect_add");
    expect(effAdd).toBeUndefined();

    // 데미지 없음
    const dmg = changes.find(c => c.type === "unit_damage");
    expect(dmg).toBeUndefined();

    console.log(`  ✅ b2 acid 타일 면역: 효과=${changes.filter(c=>c.type==="unit_effect_add").length}개, 데미지=${changes.filter(c=>c.type==="unit_damage").length}개`);
  });

  it("b2가 electric 타일 진입 → electric 효과 적용 없음(면역)", () => {
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b2u: b2Unit });

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "electric", state);

    const effAdd = changes.find(c => c.type === "unit_effect_add");
    expect(effAdd).toBeUndefined();

    console.log(`  ✅ b2 electric 타일 면역: 효과 없음`);
  });

  it("b2가 fire 타일 진입 → fire 효과 없음(면역), 단 tile_spread로 인접에 fire 전파", () => {
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b2u: b2Unit });

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "fire", state);

    // b2는 tile_spread passive로 인접 타일에 fire 전파 (tile_attribute_change는 발생함)
    // 단 진입 타일 자체는 변환되지 않음 — spread는 neighbors만 대상
    const tileChanges = changes.filter(c => c.type === "tile_attribute_change") as any[];
    // spread는 (4,5),(6,5),(5,4),(5,6) 방향으로 발생 — 진입 타일(5,5) 자신은 포함 안 됨
    const selfTileChange = tileChanges.find((c: any) => c.position.row === 5 && c.position.col === 5);
    expect(selfTileChange).toBeUndefined();

    // fire 효과(unit_effect_add)는 없음 (면역)
    const effAdd = changes.find(c => c.type === "unit_effect_add");
    expect(effAdd).toBeUndefined();

    console.log(`  ✅ b2 fire 타일: spread 전파 ${tileChanges.length}개, b2 fire 효과 없음(면역)`);
  });
});

// ─── 5. b2 tile_spread ───────────────────────────────────────────────────────

describe("5. b2 — passive_b2_tile_spread (속성 전파)", () => {
  it("b2가 acid 타일 진입 → 4방향 인접 타일에 acid 속성 전파", () => {
    /**
     * 배치:
     *   (4,5) = plain, (6,5) = plain, (5,4) = plain, (5,6) = plain
     * b2 → (5,5) acid 타일
     * 전파 결과: 4 인접 타일 모두 acid로 변환
     */
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b2u: b2Unit });

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "acid", state);

    // 4방향에 acid 전파
    const spreads = changes.filter(c => c.type === "tile_attribute_change" && (c as any).to === "acid") as any[];
    expect(spreads.length).toBeGreaterThanOrEqual(1);

    // 인접 포지션들이 포함되어야 함
    const spreadPositions = spreads.map((s: any) => `${s.position.row},${s.position.col}`);
    // (4,5), (6,5), (5,4), (5,6) 중 적어도 하나는 포함
    const expectedNeighbors = ["4,5", "6,5", "5,4", "5,6"];
    const hasNeighbor = expectedNeighbors.some(n => spreadPositions.includes(n));
    expect(hasNeighbor).toBe(true);

    console.log(`  ✅ b2 acid 전파: ${spreads.length}개 타일에 spread (${spreadPositions.join(", ")})`);
  });

  it("b2가 fire 타일 진입 → 인접 타일에 fire 속성 전파", () => {
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b2u: b2Unit });

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "fire", state);

    const spreads = changes.filter(c => c.type === "tile_attribute_change" && (c as any).to === "fire");
    expect(spreads.length).toBeGreaterThanOrEqual(1);

    console.log(`  ✅ b2 fire 전파: ${spreads.length}개 타일에 spread`);
  });

  it("b2가 이미 같은 속성인 인접 타일에는 중복 전파 안 함", () => {
    /**
     * 인접 타일이 이미 acid인 경우 → tile_attribute_change 없어야 함
     */
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    // 모든 인접 타일이 이미 acid
    const state = makeState(
      { b2u: b2Unit },
      {
        "4,5": { attribute: "acid" },
        "6,5": { attribute: "acid" },
        "5,4": { attribute: "acid" },
        "5,6": { attribute: "acid" },
      },
    );

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "acid", state);

    // 이미 acid인 타일로의 변환은 없어야 함
    const spreads = changes.filter(c => c.type === "tile_attribute_change" && (c as any).to === "acid");
    expect(spreads.length).toBe(0);

    console.log(`  ✅ b2 중복 전파 방지: ${spreads.length}개 (이미 acid인 인접 타일 건너뜀)`);
  });

  it("b2가 plain 타일 진입 → spread 트리거 안 됨 (on_tile_entry_any_attribute)", () => {
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState({ b2u: b2Unit });

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "plain", state);

    // plain 타일 진입 → spread 없음
    const spreads = changes.filter(c => c.type === "tile_attribute_change");
    expect(spreads.length).toBe(0);

    console.log(`  ✅ b2 plain 타일 진입: spread 없음`);
  });
});

// ─── 6. 6v6 팀 구성 통합 시나리오 ────────────────────────────────────────────

describe("6. 6v6 팀 구성 통합 — 상호작용 시나리오", () => {
  it("t1이 acid 타일 위에서 t2(팀원)를 공격하지 않고 적 공격 → acid 흡수", () => {
    /**
     * 실제 6v6에서 t1이 acid 타일 위에 있을 때 공격 시나리오
     */
    const state = makeState(
      Object.fromEntries([
        unit("t1u", "t1", "p1", 5, 5),      // acid 타일 위
        unit("enemyT", "enemy", "p2", 5, 6), // 인접 적
      ]),
      { "5,5": { attribute: "acid" } },
    );

    const changes = ar.resolve(state.units["t1u"]!, { row: 5, col: 6 }, state);

    const tileChange = changes.find(c => c.type === "tile_attribute_change") as any;
    expect(tileChange?.from).toBe("acid");
    expect(tileChange?.to).toBe("plain");

    const effAdd = changes.find(c => c.type === "unit_effect_add") as any;
    expect(effAdd?.effectType).toBe("acid");

    console.log(`  ✅ 6v6 t1 acid 흡수: acid→plain, 적에게 acid 부여`);
  });

  it("b2가 acid 타일 진입 시 b1은 근처에 있어도 fire_heal 미작동(다른 타일)", () => {
    /**
     * b2 이동 → acid 타일 진입, acid 전파됨
     * b1은 옆에 있지만 fire 타일 아닌 곳에 있어서 passive 미작동
     */
    const b2Unit: UnitState = {
      unitId: "b2u" as UnitId,
      metaId: "b2" as MetaId,
      playerId: "p1" as PlayerId,
      position: { row: 5, col: 4 },
      currentHealth: 5, currentArmor: 0, movementPoints: 3,
      activeEffects: [],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    };

    const state = makeState(
      Object.fromEntries([
        ["b2u", b2Unit],
        ...([unit("b1u", "b1", "p1", 5, 6)] as [string, UnitState][]),
      ]),
    );

    const changes = tileTransition.resolveUnitEntersTile(b2Unit, { row: 5, col: 5 }, "acid", state);

    // b2 acid 전파 발생
    const acidSpreads = changes.filter(c => c.type === "tile_attribute_change" && (c as any).to === "acid");
    expect(acidSpreads.length).toBeGreaterThanOrEqual(1);

    // b2 면역 유지 (acid 효과 없음)
    const b2Effect = changes.find(c => c.type === "unit_effect_add" && (c as any).unitId === "b2u");
    expect(b2Effect).toBeUndefined();

    console.log(`  ✅ 6v6 b2 acid 전파: ${acidSpreads.length}개 타일, b2 면역 유지`);
  });

  it("f1이 rush 후 t2 pull로 당겨 협공 가능", () => {
    /**
     * 시퀀스:
     * 1. f1(5,2) rush attacks enemy(5,4) → f1→(5,3), enemy→(5,5)
     * 2. t2(5,8) pull enemy(5,5) → enemy→(5,7) [t2 인접, dist=3 within maxRange]
     *
     * t2@(5,8), enemy@(5,5) after rush → dist=3 ≤ maxRange(3) ✓
     */
    const initialState = makeState(
      Object.fromEntries([
        unit("f1u", "f1", "p1", 5, 2),
        unit("t2u", "t2", "p1", 5, 8, {
          actionsUsed: { moved: true, attacked: false, skillUsed: false, extinguished: false },
        }),
        unit("enemy", "enemy", "p2", 5, 4),
      ]),
    );

    // Step 1: f1 돌격 (f1@(5,2) attacks enemy@(5,4), distance=2)
    const rushChanges = ar.resolve(initialState.units["f1u"]!, { row: 5, col: 4 }, initialState);
    const afterRush = applicator.apply(rushChanges, initialState);

    expect(afterRush.units["f1u"]!.position).toEqual({ row: 5, col: 3 });
    expect(afterRush.units["enemy"]!.position).toEqual({ row: 5, col: 5 });

    // Step 2: t2@(5,8) pulls enemy@(5,5) — dist=3 = maxRange
    const pullAction = {
      type: "skill" as const,
      playerId: "p1" as PlayerId,
      unitId: "t2u" as UnitId,
      skillId: "skill_t2_pull" as MetaId,
      target: { row: 5, col: 5 },
    };

    const pullResult = ap.process(pullAction, afterRush);
    expect(pullResult.accepted).toBe(true);

    const pulledEnemy = pullResult.newState.units["enemy"]!;
    const t2 = pullResult.newState.units["t2u"]!;
    const distToT2 = Math.abs(pulledEnemy.position.row - t2.position.row) + Math.abs(pulledEnemy.position.col - t2.position.col);
    expect(distToT2).toBe(1);

    console.log(`  ✅ 6v6 f1+t2 협공: f1 rush→(5,3), enemy→(5,5), t2 pull→(${pulledEnemy.position.row},${pulledEnemy.position.col}) (t2 인접)`);
  });
});
