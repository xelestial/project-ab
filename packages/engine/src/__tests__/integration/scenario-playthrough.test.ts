/**
 * 시나리오 플레이스루 — 실제 전투 흐름을 engine 레이어에서 헤드리스로 검증합니다.
 *
 * 각 시나리오는 구체적인 게임 상황을 세팅하고 ActionProcessor / GameLoop 를 통해
 * 결과를 단정합니다.  서버나 브라우저 없이 순수 엔진만으로 돌아갑니다.
 *
 * Scenario 1  : 관통 무기 + 방패 패시브 — 방패 유닛에서 관통이 멈추는지
 * Scenario 2  : fire 타일 진입 → 화염 효과 적용 → water 타일로 이동 → 화염 해제
 * Scenario 3  : ice 타일 진입 → freeze → 행동 불가 → 피격 시 빙결 해제
 * Scenario 4  : 전기 무기 → electric 효과 적용 확인
 * Scenario 5  : knockback → 격자 경계로 밀릴 때 경계에서 멈춤
 * Scenario 6  : AI vs AI — 최대 30 라운드 내에 게임 종료 (result 단계)
 * Scenario 7  : 모든 적 유닛 사망 → 즉시 승리 판정
 */
import { describe, it, expect } from "vitest";
import type {
  GameState,
  UnitState,
  TileState,
  PlayerAction,
  PlayerId,
  UnitId,
  MetaId,
  GameId,
} from "@ab/metadata";
import { buildDataRegistry } from "@ab/metadata";
import {
  makeRegistry,
  FIXTURE_UNITS,
  FIXTURE_WEAPONS,
  FIXTURE_SKILLS,
  FIXTURE_EFFECTS,
  FIXTURE_TILES,
  FIXTURE_MAPS,
  FIXTURE_ELEMENTAL_REACTIONS,
} from "../test-helpers.js";
import { AttackResolver } from "../../resolvers/attack-resolver.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import { MovementValidator } from "../../validators/movement-validator.js";
import { MovementResolver } from "../../resolvers/movement-resolver.js";
import { TileTransitionResolver } from "../../resolvers/tile-transition-resolver.js";
import { StateApplicator } from "../../state/state-applicator.js";
import { EffectResolver } from "../../resolvers/effect-resolver.js";
import { EffectValidator } from "../../validators/effect-validator.js";
import { EndDetector } from "../../loop/end-detector.js";
import { GameFactory } from "../../context/game-factory.js";
import type { IPlayerAdapter } from "../../loop/game-loop.js";
import { posKey } from "../../state/game-state-utils.js";

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────

function makeUnit(
  id: string,
  metaId: string,
  pid: string,
  row: number,
  col: number,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId: id as UnitId,
    metaId: metaId as MetaId,
    playerId: pid as PlayerId,
    position: { row, col },
    currentHealth: 4,
    currentArmor: 0,
    movementPoints: 3,
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
    gameId: "scenario-test" as GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: "p1" as PlayerId, priority: 1 },
      { playerId: "p2" as PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: {
        playerId: "p1" as PlayerId, teamIndex: 0, priority: 1,
        unitIds: Object.values(units).filter(u => u.playerId === "p1").map(u => u.unitId),
        connected: true, surrendered: false,
      },
      p2: {
        playerId: "p2" as PlayerId, teamIndex: 1, priority: 1,
        unitIds: Object.values(units).filter(u => u.playerId === "p2").map(u => u.unitId),
        connected: true, surrendered: false,
      },
    },
    units,
    map: { mapId: "map_test" as MetaId, gridSize: 11, tiles },
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Scenario 1: 방패 패시브 — 관통 차단 ─────────────────────────────────────

describe("Scenario 1: shield passive blocks penetration", () => {
  /**
   * 배치: 공격자(5,1) → 방패유닛(5,5) → 뒤편유닛(5,6)
   * 무기: rangeType=penetrate
   * 기대: 방패유닛 피격 O, 뒤편유닛 피격 X (방패가 관통 차단)
   */
  const registry = buildDataRegistry({
    units: [
      {
        id: "atk", nameKey: "n", descKey: "d", class: "ranger", faction: "a",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_penetrate", skillIds: [], spriteKey: "s",
      },
      {
        id: "shielder", nameKey: "n", descKey: "d", class: "tanker", faction: "b",
        baseMovement: 2, baseHealth: 5, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_melee", skillIds: [], passiveIds: ["passive_shield"], spriteKey: "s",
      },
      {
        id: "behind_unit", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
      },
    ],
    weapons: [
      { id: "wpn_penetrate", nameKey: "n", descKey: "d", attackType: "ranged", rangeType: "penetrate", minRange: 1, maxRange: 8, damage: 2, attribute: "none", penetrating: false, arcing: false },
      { id: "wpn_melee", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
    ],
    skills: [],
    effects: FIXTURE_EFFECTS,
    tiles: FIXTURE_TILES,
    maps: FIXTURE_MAPS,
    unitPassives: [
      { id: "passive_shield", nameKey: "n", descKey: "d", trigger: { type: "always_on" }, actions: [{ type: "block_penetration" }] },
    ],
  });

  const ttr = new TileTransitionResolver(registry);
  const av = new AttackValidator(registry);
  const ar = new AttackResolver(av, registry, ttr);

  it("방패 유닛이 관통을 막는다 — 뒤편 유닛 무피격", () => {
    const atk      = makeUnit("atk",     "atk",        "p1", 5, 1, { currentHealth: 4 });
    const shielder = makeUnit("shielder","shielder",   "p2", 5, 5, { currentHealth: 5 });
    const behind   = makeUnit("behind",  "behind_unit","p2", 5, 6, { currentHealth: 4 });
    const state    = makeState({ atk, shielder, behind });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "shielder")).toBe(true);
    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "behind")).toBe(false);
  });

  it("방패 없는 유닛은 관통을 막지 못한다 — 뒤편 유닛도 피격", () => {
    // 앞에 방패 없는 유닛, 뒤에 일반 유닛
    const atk    = makeUnit("atk",    "atk",        "p1", 5, 1, { currentHealth: 4 });
    const front  = makeUnit("front",  "behind_unit","p2", 5, 5, { currentHealth: 4 });
    const behind = makeUnit("behind", "behind_unit","p2", 5, 6, { currentHealth: 4 });
    const state  = makeState({ atk, front, behind });

    const changes = ar.resolve(atk, { row: 5, col: 5 }, state);

    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "front")).toBe(true);
    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "behind")).toBe(true);
  });
});

// ─── Scenario 2: fire 타일 진입 → water 타일 이동 → 화염 해제 ────────────────

describe("Scenario 2: fire tile entry → water tile extinguishes fire", () => {
  const registry = makeRegistry();
  const ttr = new TileTransitionResolver(registry);
  const mv = new MovementValidator(registry);
  const mr = new MovementResolver(mv, ttr);
  const applicator = new StateApplicator();

  it("fire 타일 진입 시 fire 효과 부여", () => {
    const unit  = makeUnit("u1", "f1", "p1", 5, 5);
    // fire 타일이 (5,6)에 있음
    const tiles: Record<string, TileState> = {
      [posKey({ row: 5, col: 6 })]: { position: { row: 5, col: 6 }, attribute: "fire" },
    };
    const state = makeState({ u1: unit }, tiles);

    // (5,6)으로 이동
    const changes = mr.resolve(unit, { row: 5, col: 6 }, state);
    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "fire")).toBe(true);
  });

  it("fire 효과가 있는 유닛이 water 타일에 진입하면 fire 효과 제거", () => {
    const fireEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as MetaId,
      effectType: "fire",
      turnsRemaining: 3,
      appliedOnTurn: 1,
    };
    const unit = makeUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] });
    const tiles: Record<string, TileState> = {
      [posKey({ row: 5, col: 6 })]: { position: { row: 5, col: 6 }, attribute: "water" },
    };
    const state = makeState({ u1: unit }, tiles);

    const changes = mr.resolve(unit, { row: 5, col: 6 }, state);
    expect(changes.some(c => c.type === "unit_effect_remove" && (c as { effectType: string }).effectType === "fire")).toBe(true);
  });

  it("fire → water 순서 이동 시 최종 상태에 fire 없음", () => {
    const unit = makeUnit("u1", "f1", "p1", 5, 5);
    const fireTiles: Record<string, TileState> = {
      [posKey({ row: 5, col: 6 })]: { position: { row: 5, col: 6 }, attribute: "fire" },
      [posKey({ row: 5, col: 7 })]: { position: { row: 5, col: 7 }, attribute: "water" },
    };
    let state = makeState({ u1: unit }, fireTiles);

    // Step 1: fire 타일로 이동
    const changes1 = mr.resolve(unit, { row: 5, col: 6 }, state);
    state = applicator.apply(changes1, state);

    // fire 효과 부여 확인
    expect(state.units["u1"]!.activeEffects.some(e => e.effectType === "fire")).toBe(true);

    // Step 2: water 타일로 이동 (새 턴 — moved 플래그 초기화)
    state = {
      ...state,
      units: {
        ...state.units,
        u1: { ...state.units["u1"]!, actionsUsed: { ...state.units["u1"]!.actionsUsed, moved: false } },
      },
    };
    const burningUnit = state.units["u1"]!;
    const changes2 = mr.resolve(burningUnit, { row: 5, col: 7 }, state);
    state = applicator.apply(changes2, state);

    // fire 효과 제거 확인
    expect(state.units["u1"]!.activeEffects.some(e => e.effectType === "fire")).toBe(false);
  });
});

// ─── Scenario 3: ice 타일 진입 → freeze → 행동 불가 → 피격 시 해제 ───────────

describe("Scenario 3: ice tile → freeze → blocked → on_hit thaw", () => {
  const registry = makeRegistry();
  const ttr = new TileTransitionResolver(registry);
  const av = new AttackValidator(registry);
  const ar = new AttackResolver(av, registry, ttr);
  const mv = new MovementValidator(registry);
  const mr = new MovementResolver(mv, ttr);
  const applicator = new StateApplicator();

  it("ice 타일 진입 시 freeze 효과 부여", () => {
    const unit = makeUnit("u1", "f1", "p1", 5, 5);
    const tiles: Record<string, TileState> = {
      [posKey({ row: 5, col: 6 })]: { position: { row: 5, col: 6 }, attribute: "ice" },
    };
    const state = makeState({ u1: unit }, tiles);

    const changes = mr.resolve(unit, { row: 5, col: 6 }, state);
    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "freeze")).toBe(true);
  });

  it("freeze 된 유닛은 이동 불가", () => {
    const freezeEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_freeze" as MetaId,
      effectType: "freeze",
      turnsRemaining: 1,
      appliedOnTurn: 1,
    };
    const frozen = makeUnit("frozen", "f1", "p1", 5, 5, { activeEffects: [freezeEffect] });
    const state = makeState({ frozen });

    const result = mv.validateMove(frozen, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
  });

  it("freeze 된 유닛은 공격 불가", () => {
    const freezeEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_freeze" as MetaId,
      effectType: "freeze",
      turnsRemaining: 1,
      appliedOnTurn: 1,
    };
    const frozen = makeUnit("frozen", "t1", "p1", 5, 5, { activeEffects: [freezeEffect] });
    const enemy  = makeUnit("enemy",  "f1", "p2", 5, 6);
    const state  = makeState({ frozen, enemy });

    const result = av.validateAttack(frozen, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
  });

  it("freeze 유닛 피격 → 빙결 해제 (on_hit removeCondition)", () => {
    const freezeEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_freeze" as MetaId,
      effectType: "freeze",
      turnsRemaining: 1,
      appliedOnTurn: 1,
    };
    const attacker = makeUnit("atk",    "f1", "p1", 5, 4);
    const frozen   = makeUnit("frozen", "f1", "p2", 5, 5, {
      currentHealth: 4,
      activeEffects: [freezeEffect],
    });
    const state = makeState({ atk: attacker, frozen });

    const changes = ar.resolve(attacker, { row: 5, col: 5 }, state);
    // freeze는 blocksDamage=true → 피격 시 빙결 해제
    expect(changes.some(c => c.type === "unit_effect_remove" && (c as { effectType: string }).effectType === "freeze")).toBe(true);
  });
});

// ─── Scenario 4: 전기 무기 → electric 효과 ───────────────────────────────────

describe("Scenario 4: electric weapon applies electric effect", () => {
  const registry = buildDataRegistry({
    units: [
      {
        id: "shocker", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_electric", skillIds: [], spriteKey: "s",
      },
      {
        id: "target", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
      },
    ],
    weapons: [
      { id: "wpn_electric", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 1, attribute: "electric", penetrating: false, arcing: false },
      { id: "wpn_melee", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
    ],
    skills: [],
    effects: FIXTURE_EFFECTS,
    tiles: FIXTURE_TILES,
    maps: FIXTURE_MAPS,
    elementalReactions: [
      ...FIXTURE_ELEMENTAL_REACTIONS,
      // 전기 공격 → electric effect 직접 적용
      { attackAttr: "electric", targetEffect: "none", damageMultiplier: 1, removedEffects: [], appliesEffectId: "effect_electric" },
    ],
  });

  const ttr = new TileTransitionResolver(registry);
  const av = new AttackValidator(registry);
  const ar = new AttackResolver(av, registry, ttr);

  it("전기 공격 → electric effect 적용", () => {
    const shocker = makeUnit("shocker", "shocker", "p1", 5, 4);
    const target  = makeUnit("target",  "target",  "p2", 5, 5);
    const state   = makeState({ shocker, target });

    const changes = ar.resolve(shocker, { row: 5, col: 5 }, state);
    expect(changes.some(c => c.type === "unit_damage" && (c as { unitId: string }).unitId === "target")).toBe(true);
    expect(changes.some(c => c.type === "unit_effect_add" && (c as { effectType: string }).effectType === "electric")).toBe(true);
  });
});

// ─── Scenario 5: knockback → 그리드 경계에서 멈춤 ────────────────────────────

describe("Scenario 5: knockback stops at grid boundary", () => {
  const registry = buildDataRegistry({
    units: [
      {
        id: "pusher", nameKey: "n", descKey: "d", class: "fighter", faction: "a",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_knockback", skillIds: [], spriteKey: "s",
      },
      {
        id: "edge_unit", nameKey: "n", descKey: "d", class: "fighter", faction: "b",
        baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
        primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
      },
    ],
    weapons: [
      { id: "wpn_knockback", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false, knockback: { distance: 3, direction: "away" } },
      { id: "wpn_melee", nameKey: "n", descKey: "d", attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
    ],
    skills: [],
    effects: FIXTURE_EFFECTS,
    tiles: FIXTURE_TILES,
    maps: FIXTURE_MAPS,
  });

  const ttr = new TileTransitionResolver(registry);
  const av = new AttackValidator(registry);
  const ar = new AttackResolver(av, registry, ttr);

  it("grid 경계(col 10)에 있는 유닛을 밀어도 경계 안에 멈춘다", () => {
    // 공격자(5,9) → 대상(5,10): knockback 3칸 → col 13은 그리드 밖 → col 10에서 멈춰야
    const pusher    = makeUnit("pusher",    "pusher",    "p1", 5, 9);
    const edge_unit = makeUnit("edge_unit", "edge_unit", "p2", 5, 10);
    const state     = makeState({ pusher, edge_unit });

    const changes = ar.resolve(pusher, { row: 5, col: 10 }, state);
    const knockbackChange = changes.find(c => c.type === "unit_knockback");

    if (knockbackChange !== undefined) {
      const dest = (knockbackChange as { to: { row: number; col: number } }).to;
      // gridSize=11 이므로 col은 0~10 범위
      expect(dest.col).toBeLessThanOrEqual(10);
      expect(dest.col).toBeGreaterThanOrEqual(0);
    }
    // knockback이 없어도 최소 데미지는 있어야 함
    expect(changes.some(c => c.type === "unit_damage")).toBe(true);
  });
});

// ─── Scenario 6: AI vs AI 완주 — 30라운드 내에 result 단계 진입 ───────────────

describe("Scenario 6: AI vs AI full game completes within 30 rounds", () => {
  class GreedyAI implements IPlayerAdapter {
    readonly type = "ai" as const;
    constructor(
      readonly playerId: string,
      private mv: MovementValidator,
      private av: AttackValidator,
    ) {}

    async requestDraftPlacement(
      _state: GameState,
      _timeout: number,
    ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
      throw new Error("not in draft");
    }

    async requestUnitOrder(_state: GameState, aliveIds: UnitId[]): Promise<UnitId[]> {
      return aliveIds;
    }

    async requestAction(state: GameState): Promise<PlayerAction> {
      const slot = state.turnOrder[state.currentTurnIndex];
      const slotUnitId = slot?.unitId;

      const myUnits = Object.values(state.units).filter(
        u => u.alive && u.playerId === this.playerId && (slotUnitId === undefined || u.unitId === slotUnitId),
      );
      const enemies = Object.values(state.units).filter(u => u.alive && u.playerId !== this.playerId);

      for (const unit of myUnits) {
        if (!unit.actionsUsed.attacked) {
          const targets = this.av.getAttackableTargets(unit, state);
          const enemyTargets = targets.filter(t => enemies.some(e => e.position.row === t.row && e.position.col === t.col));
          const pick = enemyTargets[0] ?? targets[0];
          if (pick !== undefined) {
            return { type: "attack", playerId: this.playerId as PlayerId, unitId: unit.unitId, target: pick };
          }
        }
        if (!unit.actionsUsed.moved && enemies.length > 0) {
          const reachable = this.mv.getReachableTiles(unit, state);
          const nearest = enemies.reduce((a, b) =>
            Math.abs(a.position.row - unit.position.row) + Math.abs(a.position.col - unit.position.col) <
            Math.abs(b.position.row - unit.position.row) + Math.abs(b.position.col - unit.position.col) ? a : b,
          );
          const sorted = [...reachable].sort((a, b) =>
            (Math.abs(a.row - nearest.position.row) + Math.abs(a.col - nearest.position.col)) -
            (Math.abs(b.row - nearest.position.row) + Math.abs(b.col - nearest.position.col)),
          );
          if (sorted[0] !== undefined) {
            return { type: "move", playerId: this.playerId as PlayerId, unitId: unit.unitId, destination: sorted[0] };
          }
        }
      }

      const first = myUnits[0];
      return { type: "pass", playerId: this.playerId as PlayerId, unitId: (first?.unitId ?? "") as UnitId };
    }

    onStateUpdate() {}
  }

  it("2v2 GreedyAI 대전이 result 단계로 종료된다", async () => {
    const registry = makeRegistry();
    const factory  = new GameFactory(registry);
    const context  = factory.createContext();

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;

    const now = new Date().toISOString();
    const p1 = "p1" as PlayerId;
    const p2 = "p2" as PlayerId;

    const initialState: GameState = {
      gameId: "scenario-ai-vs-ai" as GameId,
      phase: "battle",
      round: 1,
      turnOrder: [
        { playerId: p1, priority: 1 },
        { playerId: p2, priority: 1 },
      ],
      currentTurnIndex: 0,
      players: {
        p1: { playerId: p1, teamIndex: 0, priority: 1, unitIds: ["u1a", "u1b"] as UnitId[], connected: true, surrendered: false },
        p2: { playerId: p2, teamIndex: 1, priority: 1, unitIds: ["u2a", "u2b"] as UnitId[], connected: true, surrendered: false },
      },
      units: {
        u1a: { unitId: "u1a" as UnitId, metaId: "t1" as MetaId, playerId: p1, position: { row: 1, col: 1 }, currentHealth: 6, currentArmor: 0, movementPoints: 3, activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false }, alive: true },
        u1b: { unitId: "u1b" as UnitId, metaId: "f1" as MetaId, playerId: p1, position: { row: 1, col: 2 }, currentHealth: 4, currentArmor: 0, movementPoints: 3, activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false }, alive: true },
        u2a: { unitId: "u2a" as UnitId, metaId: "t1" as MetaId, playerId: p2, position: { row: 9, col: 9 }, currentHealth: 6, currentArmor: 0, movementPoints: 3, activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false }, alive: true },
        u2b: { unitId: "u2b" as UnitId, metaId: "f1" as MetaId, playerId: p2, position: { row: 9, col: 8 }, currentHealth: 4, currentArmor: 0, movementPoints: 3, activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false }, alive: true },
      },
      map: { mapId: "map_test" as MetaId, gridSize: 11, tiles: {} },
      createdAt: now,
      updatedAt: now,
    };

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new GreedyAI("p1", mv, av)],
      ["p2", new GreedyAI("p2", mv, av)],
    ]);

    const result = await context.gameLoop.start(initialState, adapters);

    expect(result.gameId).toBe("scenario-ai-vs-ai");
    expect(["win", "draw"]).toContain(result.reason);
    expect(result.finalState.phase).toBe("result");
  }, 30_000);
});

// ─── Scenario 7: 즉시 승리 판정 — EndDetector ─────────────────────────────────

describe("Scenario 7: EndDetector — immediate win when all enemies dead", () => {
  const endDetector = new EndDetector();

  it("p2 유닛 전멸 시 p1 승리 판정", () => {
    const state = makeState({
      p1_alive: makeUnit("p1_alive", "f1", "p1", 0, 0, { alive: true, currentHealth: 4 }),
      p2_dead:  makeUnit("p2_dead",  "f1", "p2", 9, 9, { alive: false, currentHealth: 0 }),
    });

    const result = endDetector.check(state);
    expect(result.ended).toBe(true);
    expect(result.winnerIds).toContain("p1");
    expect(result.reason).toBe("all_units_dead");
  });

  it("양측 생존 유닛 있으면 게임 계속", () => {
    const state = makeState({
      p1: makeUnit("p1", "f1", "p1", 0, 0, { alive: true }),
      p2: makeUnit("p2", "f1", "p2", 9, 9, { alive: true }),
    });

    const result = endDetector.check(state);
    expect(result.ended).toBe(false);
  });

  it("30라운드 초과 시 생존 유닛 수 비교로 승자 결정", () => {
    const base = makeState({
      p1a: makeUnit("p1a", "f1", "p1", 0, 0, { alive: true }),
      p1b: makeUnit("p1b", "f1", "p1", 0, 1, { alive: true }),
      p2a: makeUnit("p2a", "f1", "p2", 9, 9, { alive: true }),
    });
    const state: GameState = {
      ...base,
      round: 31,
      // 라운드 내 모든 턴이 끝난 상태: currentTurnIndex >= turnOrder.length
      currentTurnIndex: base.turnOrder.length,
    };

    const result = endDetector.check(state);
    expect(result.ended).toBe(true);
    expect(result.winnerIds).toContain("p1"); // p1이 유닛 2개 > p2 유닛 1개
    expect(result.reason).toBe("round_limit");
  });

  it("30라운드 초과 + 동등한 유닛 수 → 무승부", () => {
    const base = makeState({
      p1: makeUnit("p1", "f1", "p1", 0, 0, { alive: true }),
      p2: makeUnit("p2", "f1", "p2", 9, 9, { alive: true }),
    });
    const state: GameState = {
      ...base,
      round: 31,
      // 라운드 내 모든 턴이 끝난 상태: currentTurnIndex >= turnOrder.length
      currentTurnIndex: base.turnOrder.length,
    };

    const result = endDetector.check(state);
    expect(result.ended).toBe(true);
    expect(result.winnerIds).toHaveLength(0); // 무승부 — 승자 없음
    expect(result.reason).toBe("round_limit");
  });
});
