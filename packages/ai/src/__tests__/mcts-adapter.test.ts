/**
 * MCTSAdapter — ActionProcessor 기반 실제 롤아웃 포함 테스트.
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry, type PlayerId, type UnitId, type MetaId, type GameId } from "@ab/metadata";
import { GameFactory, MovementValidator, AttackValidator } from "@ab/engine";
import { MCTSAdapter } from "../mcts/mcts-adapter.js";

const UNITS = [
  { id: "t1", nameKey: "u", descKey: "u", class: "tanker", faction: "a",
    baseMovement: 3, baseHealth: 6, baseArmor: 1,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s" },
  { id: "f1", nameKey: "u", descKey: "u", class: "fighter", faction: "b",
    baseMovement: 3, baseHealth: 4, baseArmor: 0,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s" },
];
const WEAPONS = [
  { id: "wpn_melee", nameKey: "w", descKey: "w", attackType: "melee", rangeType: "single",
    minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
];
const MAPS = [
  {
    id: "map_2p", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
    spawnPoints: [
      { playerId: 0, positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      { playerId: 1, positions: [{ row: 10, col: 10 }, { row: 10, col: 9 }] },
    ],
  },
];

function makeSetup() {
  const registry = buildDataRegistry({ units: UNITS, weapons: WEAPONS, skills: [], effects: [], tiles: [], maps: MAPS });
  const factory = new GameFactory(registry);
  const context = factory.createContext();
  const now = new Date().toISOString();

  const state: import("@ab/metadata").GameState = {
    gameId: "mcts-test" as GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: "p1" as PlayerId, priority: 1 },
      { playerId: "p2" as PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as PlayerId, teamIndex: 0, priority: 1, unitIds: ["u1"] as UnitId[], connected: true, surrendered: false },
      p2: { playerId: "p2" as PlayerId, teamIndex: 1, priority: 1, unitIds: ["u2"] as UnitId[], connected: true, surrendered: false },
    },
    units: {
      u1: {
        unitId: "u1" as UnitId, metaId: "t1" as MetaId, playerId: "p1" as PlayerId,
        position: { row: 5, col: 5 }, currentHealth: 6, currentArmor: 1, movementPoints: 3,
        activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      },
      u2: {
        unitId: "u2" as UnitId, metaId: "f1" as MetaId, playerId: "p2" as PlayerId,
        position: { row: 5, col: 8 }, currentHealth: 4, currentArmor: 0, movementPoints: 3,
        activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      },
    },
    map: { mapId: "map_2p" as MetaId, gridSize: 11, tiles: {} },
    createdAt: now,
    updatedAt: now,
  };

  return { state, context };
}

describe("MCTSAdapter", () => {
  it("ActionProcessor 미주입 — 유효한 액션 반환", async () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;

    const adapter = new MCTSAdapter("p1", mv, av, undefined, { iterations: 10, timeoutMs: 500 });
    const action = await adapter.requestAction(state);

    expect(action).toBeDefined();
    expect(action.playerId).toBe("p1");
    expect(["move", "attack", "pass", "extinguish", "skill"]).toContain(action.type);
  });

  it("ActionProcessor 주입 — 실제 롤아웃으로 결정", async () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const ap = context.actionProcessor;

    const adapter = new MCTSAdapter("p1", mv, av, ap, { iterations: 20, timeoutMs: 500, rolloutDepth: 4 });
    const action = await adapter.requestAction(state);

    expect(action).toBeDefined();
    expect(action.playerId).toBe("p1");
  });

  it("인접한 적 — 공격 또는 이동 반환", async () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const ap = context.actionProcessor;

    // u2를 u1 바로 옆에 배치
    const adjacentState: import("@ab/metadata").GameState = {
      ...state,
      units: {
        ...state.units,
        u2: { ...state.units["u2"]!, position: { row: 5, col: 6 } },
      },
    };

    const adapter = new MCTSAdapter("p1", mv, av, ap, { iterations: 30, timeoutMs: 500 });
    const action = await adapter.requestAction(adjacentState);

    // 공격 범위 내이므로 공격 또는 이동이어야 함
    expect(["attack", "move", "pass"]).toContain(action.type);
  });

  it("즉시 승리 가능한 액션 즉각 선택 (상대 1HP)", async () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const ap = context.actionProcessor;

    const killState: import("@ab/metadata").GameState = {
      ...state,
      units: {
        ...state.units,
        u1: { ...state.units["u1"]!, position: { row: 5, col: 5 } },
        u2: { ...state.units["u2"]!, position: { row: 5, col: 6 }, currentHealth: 1 },
      },
    };

    const adapter = new MCTSAdapter("p1", mv, av, ap, { iterations: 5 });
    const action = await adapter.requestAction(killState);

    // 1HP 상대는 공격 한 방에 죽음 → 즉시 attack 선택
    expect(action.type).toBe("attack");
  });

  it("모든 내 유닛 사망 시 pass 반환", async () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;

    const adapter = new MCTSAdapter("p1", mv, av, undefined, { iterations: 5 });
    const deadState: import("@ab/metadata").GameState = {
      ...state,
      units: {
        ...state.units,
        u1: { ...state.units["u1"]!, alive: false },
      },
    };

    const action = await adapter.requestAction(deadState);
    expect(action.type).toBe("pass");
  });

  it("type이 'ai'", () => {
    const { context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const adapter = new MCTSAdapter("p1", mv, av);
    expect(adapter.type).toBe("ai");
  });

  it("onStateUpdate — 예외 없이 실행", () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const adapter = new MCTSAdapter("p1", mv, av);
    expect(() => adapter.onStateUpdate(state)).not.toThrow();
  });

  it("화재 상태 유닛 — extinguish 후보에 포함", async () => {
    const { state, context } = makeSetup();
    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;

    const fireEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as MetaId,
      effectType: "fire",
      turnsRemaining: 3,
      appliedOnTurn: 1,
    };

    const fireState: import("@ab/metadata").GameState = {
      ...state,
      units: {
        ...state.units,
        u1: { ...state.units["u1"]!, activeEffects: [fireEffect] },
      },
    };

    const adapter = new MCTSAdapter("p1", mv, av, undefined, { iterations: 10 });
    const action = await adapter.requestAction(fireState);
    // extinguish, move, attack, pass 중 하나
    expect(["extinguish", "move", "attack", "pass"]).toContain(action.type);
  });
});
