/**
 * 전도체 장애물 (spawnObstacle) 메커니즘 테스트
 *
 * 흐름:
 *  1. u3(utility) → wpn_uc_pylon으로 빈 타일에 전기 장애물 배치 (unit_spawn)
 *  2. 배치된 장애물은 체인 전도체 역할 (전기 공격이 장애물 너머 유닛까지 도달)
 *  3. 장애물은 전기 데미지를 받고 파괴될 수 있음
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, UnitState } from "@ab/metadata";
import { AttackResolver } from "../resolvers/attack-resolver.js";
import { AttackValidator } from "../validators/attack-validator.js";
import { StateApplicator } from "../state/state-applicator.js";
import { TileTransitionResolver } from "../resolvers/tile-transition-resolver.js";

// ─── 픽스처 ─────────────────────────────────────────────────────────────────

const WPN_PYLON = {
  id: "wpn_uc_pylon",
  nameKey: "n", descKey: "d",
  attackType: "special", rangeType: "single",
  minRange: 1, maxRange: 4,
  damage: 0, attribute: "none",
  penetrating: false, arcing: false,
  spawnObstacle: "obstacle_electric_pylon",
};

const WPN_SHOCK_MELEE = {
  id: "wpn_shock_melee",
  nameKey: "n", descKey: "d",
  attackType: "melee", rangeType: "single",
  minRange: 1, maxRange: 1,
  damage: 1, attribute: "electric",
  penetrating: false, arcing: false,
  chainShock: true,
};

/** utility 유닛 — 전도체 배치 무기 장착 */
const UNIT_UTILITY = {
  id: "u_utility", nameKey: "n", descKey: "d",
  class: "utility", faction: "c",
  baseMovement: 2, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_uc_pylon",
  passiveIds: [],
  spriteKey: "s", priority: 1,
};

/** 전기 공격자 */
const UNIT_ATTACKER = {
  id: "u_attacker", nameKey: "n", descKey: "d",
  class: "fighter", faction: "a",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_shock_melee",
  passiveIds: [],
  spriteKey: "s", priority: 1,
};

/** 일반 유닛 */
const UNIT_NORMAL = {
  id: "u_normal", nameKey: "n", descKey: "d",
  class: "fighter", faction: "b",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_shock_melee",
  passiveIds: [],
  spriteKey: "s", priority: 1,
};

/** 전도체 장애물 메타 */
const UNIT_PYLON_META = {
  id: "obstacle_electric_pylon", nameKey: "n", descKey: "d",
  class: "obstacle", faction: "neutral",
  baseMovement: 0, baseHealth: 2, baseArmor: 0,
  passiveIds: [],
  spriteKey: "s", priority: 99,
};

const TILE_PLAIN = {
  id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t",
  moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0,
};
const TILE_MOUNTAIN = {
  id: "tile_mountain", tileType: "mountain", nameKey: "t", descKey: "t",
  moveCost: 1, cannotStop: false, impassable: true, damagePerTurn: 0,
};
const TILE_RIVER = {
  id: "tile_river", tileType: "river", nameKey: "t", descKey: "t",
  moveCost: 2, cannotStop: true, impassable: false, damagePerTurn: 0,
};

function buildReg() {
  return buildDataRegistry({
    units: [UNIT_UTILITY, UNIT_ATTACKER, UNIT_NORMAL, UNIT_PYLON_META],
    weapons: [WPN_PYLON, WPN_SHOCK_MELEE],
    skills: [],
    effects: [],
    tiles: [TILE_PLAIN, TILE_MOUNTAIN, TILE_RIVER],
    maps: [{
      id: "map_test", nameKey: "m", descKey: "m",
      playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 0, col: 0 }] },
        { playerId: 1, positions: [{ row: 10, col: 10 }] },
      ],
    }],
    elementalReactions: [],
    unitPassives: [],
  });
}

function makeUnit(
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

function makeState(
  units: Record<string, UnitState>,
  tiles: Record<string, import("@ab/metadata").TileState> = {},
): GameState {
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
    map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles },
    createdAt: now, updatedAt: now,
  };
}

function setup() {
  const registry = buildReg();
  const validator = new AttackValidator(registry);
  const tileTransition = new TileTransitionResolver(registry);
  const resolver = new AttackResolver(validator, registry, tileTransition);
  const applicator = new StateApplicator();
  return { registry, validator, resolver, applicator };
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe("전도체 장애물 배치 (spawnObstacle)", () => {

  it("빈 타일에 pylon 무기 사용 → unit_spawn 체인지 생성", () => {
    const { resolver } = setup();

    // utility 유닛이 (5,3)에서 (5,6) 빈 타일을 공격
    const util = makeUnit("util", "u_utility", "p1", 5, 3);
    const state = makeState({ util });

    const changes = resolver.resolve(util, { row: 5, col: 6 }, state);

    const spawn = changes.find(c => c.type === "unit_spawn") as
      Extract<(typeof changes)[number], { type: "unit_spawn" }> | undefined;

    expect(spawn).toBeDefined();
    expect(spawn!.metaId).toBe("obstacle_electric_pylon");
    expect(spawn!.position).toEqual({ row: 5, col: 6 });
    expect(spawn!.playerId).toBe("p1"); // 배치자의 소유
    expect(spawn!.currentHealth).toBe(2); // obstacle_electric_pylon baseHealth
    expect(spawn!.currentArmor).toBe(0);
    expect(spawn!.movementPoints).toBe(0);
  });

  it("unit_spawn 적용 후 상태에 장애물 유닛이 등록된다", () => {
    const { resolver, applicator } = setup();

    const util = makeUnit("util", "u_utility", "p1", 5, 3);
    const state = makeState({ util });

    const changes = resolver.resolve(util, { row: 5, col: 6 }, state);
    const newState = applicator.apply(changes, state);

    // 새 장애물 유닛이 state.units에 존재
    const pylonUnits = Object.values(newState.units).filter(u => u.metaId === "obstacle_electric_pylon");
    expect(pylonUnits).toHaveLength(1);
    expect(pylonUnits[0]!.position).toEqual({ row: 5, col: 6 });
    expect(pylonUnits[0]!.alive).toBe(true);

    // 배치자의 unitIds에 등록
    const owner = newState.players["p1"]!;
    expect(owner.unitIds.some(id => id === pylonUnits[0]!.unitId)).toBe(true);
  });

  it("생성된 장애물은 모든 액션이 소진된 상태 (당 턴 행동 불가)", () => {
    const { resolver, applicator } = setup();

    const util = makeUnit("util", "u_utility", "p1", 5, 3);
    const state = makeState({ util });

    const changes = resolver.resolve(util, { row: 5, col: 6 }, state);
    const newState = applicator.apply(changes, state);

    const pylon = Object.values(newState.units).find(u => u.metaId === "obstacle_electric_pylon")!;
    expect(pylon.actionsUsed.moved).toBe(true);
    expect(pylon.actionsUsed.attacked).toBe(true);
    expect(pylon.actionsUsed.skillUsed).toBe(true);
  });

  it("이미 유닛이 있는 타일에는 배치 불가", () => {
    const { validator } = setup();

    const util   = makeUnit("util",  "u_utility", "p1", 5, 3);
    const enemy  = makeUnit("enemy", "u_normal",  "p2", 5, 6);
    const state  = makeState({ util, enemy });

    const result = validator.validateAttack(util, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
  });

  it("산 타일에는 배치 불가", () => {
    const { validator } = setup();

    const util  = makeUnit("util", "u_utility", "p1", 5, 3);
    const tiles: Record<string, import("@ab/metadata").TileState> = {
      "5,6": { position: { row: 5, col: 6 }, attribute: "mountain" },
    };
    const state = makeState({ util }, tiles);

    const result = validator.validateAttack(util, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
  });

  it("강 타일에는 배치 불가", () => {
    const { validator } = setup();

    const util  = makeUnit("util", "u_utility", "p1", 5, 3);
    const tiles: Record<string, import("@ab/metadata").TileState> = {
      "5,6": { position: { row: 5, col: 6 }, attribute: "river" },
    };
    const state = makeState({ util }, tiles);

    const result = validator.validateAttack(util, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
  });

  it("사거리(1~4) 밖 타일에는 배치 불가", () => {
    const { validator } = setup();

    const util  = makeUnit("util", "u_utility", "p1", 5, 5);
    const state = makeState({ util });

    // 거리 5 — maxRange(4) 초과
    const tooFar = validator.validateAttack(util, { row: 5, col: 0 }, state);
    expect(tooFar.valid).toBe(false);

    // 같은 위치(거리 0) — minRange(1) 미만
    const selfPos = validator.validateAttack(util, { row: 5, col: 5 }, state);
    expect(selfPos.valid).toBe(false);
  });

  it("배치 가능한 대상 목록(getAttackableTargets): 같은 행/열의 빈 타일만 반환", () => {
    const { validator } = setup();

    const util  = makeUnit("util",  "u_utility", "p1", 5, 5);
    const blocker = makeUnit("blk", "u_normal",  "p2", 5, 7); // (5,7)은 유닛 있음 → 불가

    const state = makeState({ util, blocker });
    const targets = validator.getAttackableTargets(util, state);

    // 반환된 좌표는 모두 row=5 또는 col=5 (orthogonal)
    for (const pos of targets) {
      expect(pos.row === 5 || pos.col === 5).toBe(true);
    }

    // (5,7)은 유닛이 있으므로 포함되지 않아야 함
    const hasBlocker = targets.some(p => p.row === 5 && p.col === 7);
    expect(hasBlocker).toBe(false);

    // (5,6)은 빈 타일이므로 포함되어야 함 (거리 1 — minRange 1 충족)
    const hasEmpty = targets.some(p => p.row === 5 && p.col === 6);
    expect(hasEmpty).toBe(true);
  });
});

describe("전도체 통합 시나리오", () => {

  it("전도체 배치 후 전기 공격 — 장애물 너머 유닛까지 체인 연결", () => {
    /**
     * 배치 전: atk(5,1) → tgt(5,2) ... [gap(5,3)] ... u2(5,4)
     *          전기 체인이 끊겨 u2에게 데미지 없음
     *
     * 배치 후: util이 (5,3)에 전도체 배치
     *          atk 전기 공격 → tgt(5,2) → conductor(5,3) → u2(5,4)
     *          u2도 데미지를 받음
     */
    const { resolver, applicator } = setup();

    const util = makeUnit("util", "u_utility", "p1", 5, 0);
    const atk  = makeUnit("atk",  "u_attacker","p1", 5, 1);
    const tgt  = makeUnit("tgt",  "u_normal",  "p2", 5, 2);
    const u2   = makeUnit("u2",   "u_normal",  "p2", 5, 4); // gap at (5,3)

    let state = makeState({ util, atk, tgt, u2 });

    // Step 1: (5,3)에 전도체 배치
    const placeChanges = resolver.resolve(util, { row: 5, col: 3 }, state);
    state = applicator.apply(placeChanges, state);

    // 장애물 유닛이 생성되었는지 확인
    const conductor = Object.values(state.units).find(u => u.metaId === "obstacle_electric_pylon");
    expect(conductor).toBeDefined();
    expect(conductor!.position).toEqual({ row: 5, col: 3 });

    // Step 2: 공격자가 tgt(5,2) 전기 공격
    const atkUnit = state.units["atk"]!;
    const attackChanges = resolver.resolve(atkUnit, { row: 5, col: 2 }, state);

    // tgt은 직접 데미지
    const tgtDmg = attackChanges.filter(c => c.type === "unit_damage" && c.unitId === "tgt");
    expect(tgtDmg.length).toBeGreaterThan(0);

    // 전도체도 체인 데미지
    const condDmg = attackChanges.filter(c => c.type === "unit_damage" && c.unitId === conductor!.unitId);
    expect(condDmg.length, "전도체도 체인 데미지를 받아야 함").toBeGreaterThan(0);

    // u2도 전도체를 통해 체인 데미지
    const u2Dmg = attackChanges.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg.length, "전도체 너머 u2도 체인 데미지를 받아야 함").toBeGreaterThan(0);
  });

  it("전도체 없으면 같은 상황에서 u2에게 데미지 없음 (대조군)", () => {
    const { resolver } = setup();

    const atk = makeUnit("atk", "u_attacker", "p1", 5, 1);
    const tgt = makeUnit("tgt", "u_normal",   "p2", 5, 2);
    const u2  = makeUnit("u2",  "u_normal",   "p2", 5, 4); // gap at (5,3), no conductor

    const state = makeState({ atk, tgt, u2 });
    const changes = resolver.resolve(atk, { row: 5, col: 2 }, state);

    const u2Dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg).toHaveLength(0);
  });

  it("전도체 파괴: 전도체 HP=0이 되면 전기 공격이 더 이상 전파되지 않음", () => {
    /**
     * 전도체(HP=2)에 2 데미지를 주어 파괴한 뒤,
     * 전기 공격 시 체인이 끊겨야 함
     */
    const { resolver, applicator } = setup();

    const util = makeUnit("util", "u_utility", "p1", 5, 0);
    const atk  = makeUnit("atk",  "u_attacker","p1", 5, 1);
    const tgt  = makeUnit("tgt",  "u_normal",  "p2", 5, 2);
    const u2   = makeUnit("u2",   "u_normal",  "p2", 5, 4);

    let state = makeState({ util, atk, tgt, u2 });

    // Step 1: 전도체 배치
    const placeChanges = resolver.resolve(util, { row: 5, col: 3 }, state);
    state = applicator.apply(placeChanges, state);

    const condId = Object.values(state.units)
      .find(u => u.metaId === "obstacle_electric_pylon")!.unitId;

    // Step 2: 전도체를 직접 공격해서 HP 0으로 만들기 (atk는 (5,1)에 있고 전도체는 (5,3) — 범위 밖)
    // 대신 state를 수동으로 조작하여 전도체를 alive=false로 변경
    state = {
      ...state,
      units: {
        ...state.units,
        [condId]: { ...state.units[condId]!, alive: false, currentHealth: 0 },
      },
    };

    // Step 3: 전기 공격
    const atkUnit = state.units["atk"]!;
    const changes = resolver.resolve(atkUnit, { row: 5, col: 2 }, state);

    // 죽은 전도체는 체인에 포함되지 않으므로 u2에게 데미지 없음
    const u2Dmg = changes.filter(c => c.type === "unit_damage" && c.unitId === "u2");
    expect(u2Dmg).toHaveLength(0);
  });
});
