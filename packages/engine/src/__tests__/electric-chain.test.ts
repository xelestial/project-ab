/**
 * Electric chain-shock mechanic tests.
 *
 * Rules:
 *  - 전기 공격(chainShock=true)은 1차 피격 대상에서 BFS로 전파.
 *  - 1차 대상과 인접(4방향)한 유닛, 그 유닛과 인접한 유닛 순으로 전기 데미지를 받는다.
 *  - 공격자 본인은 체인에서 제외.
 *  - 적/아군 구분 없이 모두 데미지.
 *  - block_chain_conductor 패시브(Insulator)를 가진 유닛: 자신은 면역(immune_damage_type: electric),
 *    체인 전파도 차단.
 *  - 빈 타일이 있으면 체인이 끊김. 전도체 장애물을 배치하면 체인이 이어진다.
 *  - 타일을 electric으로 변환하지 않음 — 데미지만 발생.
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, UnitState } from "@ab/metadata";
import { AttackResolver } from "../resolvers/attack-resolver.js";
import { AttackValidator } from "../validators/attack-validator.js";
import { TileTransitionResolver } from "../resolvers/tile-transition-resolver.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const WPN_SHOCK_MELEE = {
  id: "wpn_shock_melee",
  nameKey: "n", descKey: "d",
  attackType: "melee", rangeType: "single",
  minRange: 1, maxRange: 1,
  damage: 1, attribute: "electric",
  penetrating: false, arcing: false,
  chainShock: true,
};

const PASSIVE_INSULATOR = {
  id: "passive_insulator",
  nameKey: "n", descKey: "d",
  trigger: { type: "always_on" },
  actions: [
    { type: "immune_damage_type", damageType: "electric" },
    { type: "block_chain_conductor" },
  ],
};

/** 공격자 — shock_melee 장착 */
const UNIT_ATTACKER = {
  id: "u_attacker", nameKey: "n", descKey: "d",
  class: "fighter", faction: "a",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_shock_melee",
  passiveIds: [],
  spriteKey: "s",
  priority: 1,
};

/** 일반 유닛 — 아무 패시브 없음, armor=0 */
const UNIT_NORMAL = {
  id: "u_normal", nameKey: "n", descKey: "d",
  class: "fighter", faction: "a",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_shock_melee",
  passiveIds: [],
  spriteKey: "s",
  priority: 1,
};

/** 인슐레이터 유닛 — electric 면역 + 체인 차단 */
const UNIT_INSULATOR = {
  id: "u_insulator", nameKey: "n", descKey: "d",
  class: "fighter", faction: "a",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_shock_melee",
  passiveIds: ["passive_insulator"],
  spriteKey: "s",
  priority: 1,
};

/** 전도체 장애물 (electric pylon) — 패시브 없음, 아머 없음 */
const UNIT_PYLON = {
  id: "u_pylon", nameKey: "n", descKey: "d",
  class: "obstacle", faction: "neutral",
  baseMovement: 0, baseHealth: 2, baseArmor: 0,
  passiveIds: [],
  spriteKey: "s",
  priority: 99,
};

/** armor=1 유닛 — 체인 데미지(1)가 아머로 상쇄되어 0 */
const UNIT_ARMORED = {
  id: "u_armored", nameKey: "n", descKey: "d",
  class: "tanker", faction: "a",
  baseMovement: 3, baseHealth: 5, baseArmor: 1,
  primaryWeaponId: "wpn_shock_melee",
  passiveIds: [],
  spriteKey: "s",
  priority: 1,
};

function buildReg(extraUnits: unknown[] = []) {
  return buildDataRegistry({
    units: [UNIT_ATTACKER, UNIT_NORMAL, UNIT_INSULATOR, UNIT_PYLON, UNIT_ARMORED, ...extraUnits],
    weapons: [WPN_SHOCK_MELEE],
    skills: [],
    effects: [],
    tiles: [{ id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 }],
    maps: [{
      id: "map_test", nameKey: "m", descKey: "m",
      playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 0, col: 0 }] },
        { playerId: 1, positions: [{ row: 10, col: 10 }] },
      ],
    }],
    elementalReactions: [],
    unitPassives: [PASSIVE_INSULATOR],
  });
}

function makeUnitState(
  id: string, meta: string, player: string, row: number, col: number,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId: id as import("@ab/metadata").UnitId,
    metaId: meta as import("@ab/metadata").MetaId,
    playerId: player as import("@ab/metadata").PlayerId,
    position: { row, col },
    currentHealth: 4, currentArmor: 0, movementPoints: 3,
    activeEffects: [],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
    ...overrides,
  };
}

function makeState(units: Record<string, UnitState>): GameState {
  const now = new Date().toISOString();
  return {
    gameId: "test" as import("@ab/metadata").GameId,
    phase: "battle", round: 1,
    turnOrder: [
      { playerId: "p1" as import("@ab/metadata").PlayerId, priority: 1 },
      { playerId: "p2" as import("@ab/metadata").PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: [], connected: true, surrendered: false },
      p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: [], connected: true, surrendered: false },
    },
    units,
    map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles: {} },
    createdAt: now, updatedAt: now,
  };
}

function makeResolver() {
  const registry = buildReg();
  const validator = new AttackValidator(registry);
  const tileTransition = new TileTransitionResolver(registry);
  const resolver = new AttackResolver(validator, registry, tileTransition);
  return { resolver, registry };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("전기 체인 공격 (chainShock)", () => {

  it("기본 직선 체인: 공격자(0,1) → 대상(0,2) → 유닛1(0,3) → 유닛2(0,4) → 유닛3(0,5) 모두 데미지", () => {
    const { resolver } = makeResolver();
    const attacker = makeUnitState("atk", "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt", "u_normal",   "p2", 0, 2);
    const u1       = makeUnitState("u1",  "u_normal",   "p2", 0, 3);
    const u2       = makeUnitState("u2",  "u_normal",   "p2", 0, 4);
    const u3       = makeUnitState("u3",  "u_normal",   "p2", 0, 5);

    const state = makeState({ atk: attacker, tgt: target, u1, u2, u3 });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    // Primary target takes direct attack damage (1 dmg, armor 0 → 1)
    const primaryDmg = changes.find(c => c.type === "unit_damage" && c.unitId === "tgt");
    expect(primaryDmg).toBeDefined();

    // Chain units u1, u2, u3 all receive damage
    const chainIds = ["u1", "u2", "u3"];
    for (const id of chainIds) {
      const dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === id);
      expect(dmg.length, `${id}이(가) 체인 데미지를 받아야 함`).toBeGreaterThan(0);
      expect((dmg[0] as Extract<typeof dmg[0], { type: "unit_damage" }>).amount).toBe(1);
    }

    // No tile_attribute_change to electric (chain does not convert tiles)
    const tileChanges = changes.filter(c =>
      c.type === "tile_attribute_change" &&
      (c as Extract<typeof c, { type: "tile_attribute_change" }>).to === "electric"
    );
    expect(tileChanges).toHaveLength(0);
  });

  it("공격자 본인은 체인 데미지를 받지 않는다", () => {
    const { resolver } = makeResolver();
    // attacker at (0,1), target at (0,2), attacker also adjacent to target from left
    const attacker = makeUnitState("atk", "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt", "u_normal",   "p2", 0, 2);

    const state = makeState({ atk: attacker, tgt: target });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    const atkDmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "atk");
    expect(atkDmg).toHaveLength(0);
  });

  it("아군도 체인 데미지를 받는다 (팩션 무관)", () => {
    const { resolver } = makeResolver();
    const attacker = makeUnitState("atk",   "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt",   "u_normal",   "p2", 0, 2);
    const ally     = makeUnitState("ally",  "u_normal",   "p1", 0, 3); // 같은 팀

    const state = makeState({ atk: attacker, tgt: target, ally });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    const allyDmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "ally");
    expect(allyDmg.length, "아군도 체인 데미지를 받아야 함").toBeGreaterThan(0);
  });

  it("빈 칸이 있으면 체인이 끊긴다 — 갭 너머 유닛은 데미지 없음", () => {
    const { resolver } = makeResolver();
    // (0,2)=target, (0,3)=empty gap, (0,4)=u2 → u2 should NOT be hit
    const attacker = makeUnitState("atk", "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt", "u_normal",   "p2", 0, 2);
    const u2       = makeUnitState("u2",  "u_normal",   "p2", 0, 4); // gap at (0,3)

    const state = makeState({ atk: attacker, tgt: target, u2 });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    const u2Dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg).toHaveLength(0);
  });

  it("전도체 장애물이 갭을 메우면 체인이 이어진다", () => {
    const { resolver } = makeResolver();
    // (0,2)=target, (0,3)=pylon conductor, (0,4)=u2 → u2 SHOULD be hit
    const attacker = makeUnitState("atk",   "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt",   "u_normal",   "p2", 0, 2);
    const pylon    = makeUnitState("pylon", "u_pylon",    "p1", 0, 3); // neutral/ally conductor
    const u2       = makeUnitState("u2",    "u_normal",   "p2", 0, 4);

    const state = makeState({ atk: attacker, tgt: target, pylon, u2 });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    // Pylon itself takes chain damage (it's a unit, no armor)
    const pylonDmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "pylon");
    expect(pylonDmg.length, "전도체 장애물도 체인 데미지를 받아야 함").toBeGreaterThan(0);

    // u2 behind the pylon also takes chain damage
    const u2Dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg.length, "전도체를 통해 갭 너머 유닛도 데미지를 받아야 함").toBeGreaterThan(0);
  });

  it("인슐레이터(block_chain_conductor)는 체인을 차단하고 데미지도 0 (immune_damage_type: electric)", () => {
    const { resolver } = makeResolver();
    // (0,2)=target, (0,3)=insulator, (0,4)=u2
    // u2 should NOT be hit because insulator blocks chain
    const attacker  = makeUnitState("atk",   "u_attacker",  "p1", 0, 1);
    const target    = makeUnitState("tgt",   "u_normal",    "p2", 0, 2);
    const insulator = makeUnitState("ins",   "u_insulator", "p2", 0, 3);
    const u2        = makeUnitState("u2",    "u_normal",    "p2", 0, 4);

    const state = makeState({ atk: attacker, tgt: target, ins: insulator, u2 });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    // Insulator: immune to electric damage → 0 damage
    const insDmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "ins");
    expect(insDmg).toHaveLength(0);

    // u2: blocked by insulator → no damage
    const u2Dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg).toHaveLength(0);
  });

  it("체인 데미지는 아머를 적용한다 — armor=1이면 체인 데미지(1) 상쇄되어 0", () => {
    const { resolver } = makeResolver();
    const attacker = makeUnitState("atk",     "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt",     "u_normal",   "p2", 0, 2);
    const armored  = makeUnitState("armored", "u_armored",  "p2", 0, 3,
      { currentArmor: 1 });

    const state = makeState({ atk: attacker, tgt: target, armored });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    const armoredDmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "armored");
    // damage = 1 (weapon) - 1 (armor) = 0 → no unit_damage change
    expect(armoredDmg).toHaveLength(0);
  });

  it("죽은 유닛은 체인에 포함되지 않는다", () => {
    const { resolver } = makeResolver();
    const attacker = makeUnitState("atk",   "u_attacker", "p1", 0, 1);
    const target   = makeUnitState("tgt",   "u_normal",   "p2", 0, 2);
    const dead     = makeUnitState("dead",  "u_normal",   "p2", 0, 3, { alive: false, currentHealth: 0 });
    const u2       = makeUnitState("u2",    "u_normal",   "p2", 0, 4);

    const state = makeState({ atk: attacker, tgt: target, dead, u2 });
    const changes = resolver.resolve(attacker, { row: 0, col: 2 }, state);

    const deadDmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "dead");
    expect(deadDmg).toHaveLength(0);

    // u2 is also cut off because dead unit is not a conductor
    const u2Dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg).toHaveLength(0);
  });

  it("체인이 사방으로 퍼진다 — 십자 배치에서 4방향 모두 데미지", () => {
    const { resolver } = makeResolver();
    // target at center (5,5), units at N/S/E/W
    const attacker = makeUnitState("atk",  "u_attacker", "p1", 5, 4);
    const target   = makeUnitState("tgt",  "u_normal",   "p2", 5, 5);
    const north    = makeUnitState("n",    "u_normal",   "p2", 4, 5);
    const south    = makeUnitState("s",    "u_normal",   "p2", 6, 5);
    const east     = makeUnitState("e",    "u_normal",   "p2", 5, 6);
    // west (5,4) = attacker — excluded

    const state = makeState({ atk: attacker, tgt: target, n: north, s: south, e: east });
    const changes = resolver.resolve(attacker, { row: 5, col: 5 }, state);

    for (const id of ["n", "s", "e"]) {
      const dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === id);
      expect(dmg.length, `${id} 방향 유닛도 체인 데미지를 받아야 함`).toBeGreaterThan(0);
    }
  });
});
