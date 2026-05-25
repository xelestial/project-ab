/**
 * tactical-adapter.test.ts — TacticalAdapter 결정론적 행동 검증.
 *
 * test 프로파일 (wKillBonus=100) 사용:
 *   - 킬 가능 적이 있으면 반드시 공격
 *   - 적이 사거리 밖이면 접근 이동
 *   - 화재 상태에서 소화 우선
 */

import { describe, it, expect } from "vitest";
import {
  buildDataRegistry,
  type PlayerId,
  type UnitId,
  type MetaId,
  type GameId,
  type GameState,
} from "@ab/metadata";
import { MovementValidator, AttackValidator } from "@ab/engine";
import { TacticalAdapter } from "../tactical/tactical-adapter.js";

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

const UNITS = [
  {
    id: "t1", nameKey: "t1", descKey: "t1", class: "tanker", faction: "a",
    baseMovement: 3, baseHealth: 6, baseArmor: 1, attributes: [],
    primaryWeaponId: "wpn_melee", skillIds: [], passiveIds: [], spriteKey: "s", priority: 1,
  },
  {
    id: "f1", nameKey: "f1", descKey: "f1", class: "fighter", faction: "b",
    baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
    primaryWeaponId: "wpn_melee", skillIds: [], passiveIds: [], spriteKey: "s", priority: 1,
  },
  {
    id: "r1", nameKey: "r1", descKey: "r1", class: "ranger", faction: "a",
    baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [],
    primaryWeaponId: "wpn_ranged", skillIds: [], passiveIds: [], spriteKey: "s", priority: 1,
  },
] as const;

const WEAPONS = [
  {
    id: "wpn_melee", nameKey: "w", descKey: "w", attackType: "melee", rangeType: "single",
    minRange: 1, maxRange: 1, damage: 3, attribute: "none", penetrating: false, arcing: false,
  },
  {
    id: "wpn_ranged", nameKey: "wr", descKey: "wr", attackType: "ranged", rangeType: "single",
    minRange: 2, maxRange: 4, damage: 2, attribute: "none", penetrating: false, arcing: false,
  },
] as const;

const EFFECTS = [
  {
    id: "effect_fire", nameKey: "fire", descKey: "fire", effectType: "fire",
    damagePerTurn: 1, damageMultiplier: 1, statusFlags: [],
    removeConditions: [{ type: "manual_extinguish" }],
  },
] as const;

const MAPS = [
  {
    id: "map_test", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
    spawnPoints: [
      { playerId: 0, positions: [{ row: 0, col: 0 }] },
      { playerId: 1, positions: [{ row: 10, col: 10 }] },
    ],
  },
] as const;

function makeRegistry() {
  return buildDataRegistry({
    units: UNITS as any,
    weapons: WEAPONS as any,
    skills: [],
    effects: EFFECTS as any,
    tiles: [],
    maps: MAPS as any,
  });
}

function makeUnit(
  unitId: string,
  metaId: string,
  playerId: string,
  row: number,
  col: number,
  overrides: Partial<GameState["units"][string]> = {},
): GameState["units"][string] {
  return {
    unitId: unitId as UnitId,
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
  };
}

function makeState(
  units: Record<string, GameState["units"][string]>,
  activePlayerId = "p1",
  activeUnitId?: string,
): GameState {
  const unitIds = Object.keys(units);
  const p1UnitIds = unitIds.filter((id) => units[id]!.playerId === "p1") as UnitId[];
  const p2UnitIds = unitIds.filter((id) => units[id]!.playerId === "p2") as UnitId[];

  return {
    gameId: "test" as GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: activePlayerId as PlayerId, unitId: activeUnitId as UnitId | undefined, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: {
        playerId: "p1" as PlayerId, teamIndex: 0, priority: 1,
        unitIds: p1UnitIds, connected: true, surrendered: false,
      },
      p2: {
        playerId: "p2" as PlayerId, teamIndex: 1, priority: 1,
        unitIds: p2UnitIds, connected: true, surrendered: false,
      },
    },
    units,
    map: { mapId: "map_test" as MetaId, gridSize: 11, tiles: {}, baseTile: "plain" },
  };
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("TacticalAdapter — test profile", () => {
  it("공격 가능 적이 있을 때 attack 액션을 반환한다", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    const units = {
      u1: makeUnit("u1", "t1", "p1", 5, 5),  // 내 유닛 (melee range 1)
      u2: makeUnit("u2", "f1", "p2", 5, 6),  // 적 유닛 (거리 1 — 공격 가능)
    };

    const state = makeState(units, "p1", "u1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "test" });

    const action = await adapter.requestAction(state);
    expect(action.type).toBe("attack");
    if (action.type === "attack") {
      expect(action.target).toEqual({ row: 5, col: 6 });
    }
  });

  it("적이 사거리 밖에 있을 때 이동한다", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    const units = {
      u1: makeUnit("u1", "t1", "p1", 0, 0),  // 내 유닛 (melee)
      u2: makeUnit("u2", "f1", "p2", 5, 5),  // 적 유닛 (거리 10 — 사거리 밖)
    };

    const state = makeState(units, "p1", "u1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "test" });

    const action = await adapter.requestAction(state);
    expect(action.type).toBe("move");
  });

  it("화재 상태에서 소화를 선택한다 (test 프로파일 wExtinguishBase=50)", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    const units = {
      u1: makeUnit("u1", "t1", "p1", 5, 5, {
        activeEffects: [{
          effectId: "effect_fire" as MetaId,
          effectType: "fire",
          turnsRemaining: 2,
        }],
        currentHealth: 4,
      }),
      u2: makeUnit("u2", "f1", "p2", 8, 5), // 적이 멀리 있어 공격 불가
    };

    const state = makeState(units, "p1", "u1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "test" });

    const action = await adapter.requestAction(state);
    expect(action.type).toBe("extinguish");
  });

  it("적 유닛 체력이 낮을 때 우선 공격한다 (wKillBonus=100)", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    const units = {
      u1: makeUnit("u1", "t1", "p1", 5, 5), // damage=3
      u2: makeUnit("u2", "f1", "p2", 5, 6, { currentHealth: 2 }), // HP 2 — 데미지 3으로 즉사
      u3: makeUnit("u3", "f1", "p2", 5, 7, { currentHealth: 4 }), // HP 4
    };

    const state = makeState(units, "p1", "u1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "test" });

    const action = await adapter.requestAction(state);
    // 즉사 가능한 u2(col=6)를 공격해야 함
    expect(action.type).toBe("attack");
    if (action.type === "attack") {
      expect(action.target).toEqual({ row: 5, col: 6 });
    }
  });

  it("requestUnitOrder — 공격 가능 유닛이 먼저 행동한다", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    const units = {
      u1: makeUnit("u1", "t1", "p1", 0, 0),  // 적에서 멀리 (melee, 공격 불가)
      u2: makeUnit("u2", "t1", "p1", 5, 6),  // 적에 인접 (melee, 공격 가능)
      enemy: makeUnit("enemy", "f1", "p2", 5, 7),
    };

    const state = makeState(units, "p1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "test" });

    const order = await adapter.requestUnitOrder(state, ["u1", "u2"] as UnitId[], 5000);
    // u2가 먼저 (공격 가능)
    expect(order[0]).toBe("u2");
  });

  it("pass 액션은 항상 폴백으로 반환된다 (후보 없음)", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    // 이미 이동+공격 모두 완료된 유닛
    const units = {
      u1: makeUnit("u1", "t1", "p1", 5, 5, {
        actionsUsed: { moved: true, attacked: true, skillUsed: false, extinguished: false },
      }),
      u2: makeUnit("u2", "f1", "p2", 5, 8),
    };

    const state = makeState(units, "p1", "u1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "test" });

    const action = await adapter.requestAction(state);
    expect(action.type).toBe("pass");
  });
});

describe("TacticalAdapter — balanced profile", () => {
  it("balanced 프로파일로도 공격 후보를 반환한다", async () => {
    const registry = makeRegistry();
    const movVal = new MovementValidator(registry);
    const atkVal = new AttackValidator(registry);

    const units = {
      u1: makeUnit("u1", "t1", "p1", 5, 5),
      u2: makeUnit("u2", "f1", "p2", 5, 6),
    };

    const state = makeState(units, "p1", "u1");
    const adapter = new TacticalAdapter("p1", movVal, atkVal, registry, { profile: "balanced" });

    const action = await adapter.requestAction(state);
    expect(["attack", "move", "pass"]).toContain(action.type);
  });
});
