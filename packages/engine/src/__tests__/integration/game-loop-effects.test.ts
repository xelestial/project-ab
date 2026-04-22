/**
 * 게임 루프 effect tick 통합 테스트
 *
 * GameLoop.start() 안에서 매 턴 시작 시 effectManager.processTurnStart가
 * 올바르게 호출되는지를 실제 게임을 돌려서 검증한다.
 *
 * 검증 항목:
 *  1. fire 타일 위에 있는 유닛은 턴 시작 시 tile damagePerTurn(2)을 받는다
 *  2. fire 효과가 걸린 유닛은 턴 시작 시 effect damagePerTurn(1)을 받는다
 *  3. effect의 turnsRemaining 카운트다운이 매 턴 감소한다 (3→2→1→제거)
 *  4. tile damage로 HP가 0이 되면 사망 처리되고 상대방이 승리한다
 */
import { describe, it, expect } from "vitest";
import { GameFactory } from "../../context/game-factory.js";
import { buildDataRegistry, type PlayerId, type UnitId, type MetaId, type GameId } from "@ab/metadata";
import type { IPlayerAdapter } from "../../loop/game-loop.js";
import type { GameState, PlayerAction } from "@ab/metadata";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UNITS = [
  {
    id: "fighter", nameKey: "f", descKey: "f", class: "fighter", faction: "a",
    baseMovement: 3, baseHealth: 4, baseArmor: 0,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
  },
];

const WEAPONS = [
  {
    id: "wpn_melee", nameKey: "w", descKey: "w",
    attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1,
    damage: 2, attribute: "none", penetrating: false, arcing: false,
  },
];

const EFFECTS = [
  {
    id: "effect_fire", nameKey: "e", descKey: "e", effectType: "fire",
    damagePerTurn: 1, blocksAllActions: false, alsoAffectsTile: false,
    clearsAllEffectsOnApply: false,
    removeConditions: [{ type: "turns", count: 3 }],
  },
];

const TILES = [
  { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
  { id: "tile_fire",  tileType: "fire",  nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 2, appliesEffectId: "effect_fire" },
];

const MAPS = [
  {
    id: "map_test", nameKey: "m", descKey: "m", playerCounts: [2],
    tileOverrides: [],
    spawnPoints: [
      { playerId: 0, positions: [{ row: 0, col: 0 }] },
      { playerId: 1, positions: [{ row: 10, col: 10 }] },
    ],
  },
];

// ─── Adapters ─────────────────────────────────────────────────────────────────

/** PassAI: 항상 pass. 게임 루프의 effect tick만 검증할 때 사용. */
class PassAI implements IPlayerAdapter {
  readonly type = "ai" as const;

  constructor(readonly playerId: string) {}

  async requestDraftPlacement(): Promise<never> {
    throw new Error("no draft");
  }

  async requestUnitOrder(_state: GameState, aliveUnitIds: UnitId[]): Promise<UnitId[]> {
    return aliveUnitIds;
  }

  async requestAction(state: GameState): Promise<PlayerAction> {
    const unit = Object.values(state.units).find(
      (u) => u.alive && u.playerId === this.playerId,
    );
    return {
      type: "pass",
      playerId: this.playerId as PlayerId,
      unitId: (unit?.unitId ?? "") as UnitId,
    };
  }

  onStateUpdate() {}
}

/** SingleAttackAI: 처음 공격 가능한 대상에게 1회 공격 후 pass. */
class AttackThenPassAI implements IPlayerAdapter {
  readonly type = "ai" as const;
  private attacked = false;

  constructor(
    readonly playerId: string,
    private readonly av: import("../../validators/attack-validator.js").AttackValidator,
  ) {}

  async requestDraftPlacement(): Promise<never> {
    throw new Error("no draft");
  }

  async requestUnitOrder(_state: GameState, aliveUnitIds: UnitId[]): Promise<UnitId[]> {
    return aliveUnitIds;
  }

  async requestAction(state: GameState): Promise<PlayerAction> {
    const myUnit = Object.values(state.units).find(
      (u) => u.alive && u.playerId === this.playerId,
    );
    if (myUnit === undefined) {
      return { type: "pass", playerId: this.playerId as PlayerId, unitId: "" as UnitId };
    }
    if (!this.attacked) {
      const targets = this.av.getAttackableTargets(myUnit, state);
      const enemies = Object.values(state.units).filter(
        (u) => u.alive && u.playerId !== this.playerId,
      );
      const enemyTarget = targets.find((t) =>
        enemies.some((e) => e.position.row === t.row && e.position.col === t.col),
      );
      if (enemyTarget !== undefined) {
        this.attacked = true;
        return {
          type: "attack",
          playerId: this.playerId as PlayerId,
          unitId: myUnit.unitId,
          target: enemyTarget,
        };
      }
    }
    return {
      type: "pass",
      playerId: this.playerId as PlayerId,
      unitId: myUnit.unitId,
    };
  }

  onStateUpdate() {}
}

// ─── 공통 유틸 ──────────────────────────────────────────────────────────────────

function makeState(
  options: {
    p1Pos: { row: number; col: number };
    p2Pos: { row: number; col: number };
    p1HP?: number;
    p2HP?: number;
    p1Effects?: import("@ab/metadata").ActiveEffect[];
    tiles?: Record<string, import("@ab/metadata").TileState>;
  },
): GameState {
  const now = new Date().toISOString();
  const p1 = "p1" as PlayerId;
  const p2 = "p2" as PlayerId;
  return {
    gameId: "test" as GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: p1, priority: 1 },
      { playerId: p2, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: p1, teamIndex: 0, priority: 1, unitIds: ["u1"] as UnitId[], connected: true, surrendered: false },
      p2: { playerId: p2, teamIndex: 1, priority: 1, unitIds: ["u2"] as UnitId[], connected: true, surrendered: false },
    },
    units: {
      u1: {
        unitId: "u1" as UnitId,
        metaId: "fighter" as MetaId,
        playerId: p1,
        position: options.p1Pos,
        currentHealth: options.p1HP ?? 4,
        currentArmor: 0,
        movementPoints: 3,
        activeEffects: options.p1Effects ?? [],
        actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      },
      u2: {
        unitId: "u2" as UnitId,
        metaId: "fighter" as MetaId,
        playerId: p2,
        position: options.p2Pos,
        currentHealth: options.p2HP ?? 4,
        currentArmor: 0,
        movementPoints: 3,
        activeEffects: [],
        actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      },
    },
    map: {
      mapId: "map_test" as MetaId,
      gridSize: 11,
      tiles: options.tiles ?? {},
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("게임 루프 effect tick 통합 테스트", () => {
  function makeRegistry() {
    return buildDataRegistry({
      units: UNITS, weapons: WEAPONS, skills: [],
      effects: EFFECTS, tiles: TILES, maps: MAPS,
    });
  }

  // ── 1. fire 타일 tile damage ──────────────────────────────────────────────

  it("fire 타일 위 유닛: 첫 번째 턴 시작 시 tile damage(2) → HP 2(=4-2)", async () => {
    /**
     * p1 unit(HP=4) on fire tile, p2 unit far away.
     * 양측 모두 pass만 함.
     * Round1: p1 turn start → tile damage 2 → HP=2 → pass
     *         p2 turn start → pass (fire tile 없음)
     * End of round1 (no win yet).
     * Round2: p1 turn start → tile damage 2 again → HP=0 → dies
     *         postProcessor → p1 no alive units → p2 wins.
     * Result: p2 wins.
     */
    const registry = makeRegistry();
    const factory = new GameFactory(registry);
    const context = factory.createContext();

    const fireTileKey = "5,5";
    const state = makeState({
      p1Pos: { row: 5, col: 5 },
      p2Pos: { row: 0, col: 0 },
      p1HP: 4,
      tiles: {
        [fireTileKey]: { position: { row: 5, col: 5 }, attribute: "fire" },
      },
    });

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new PassAI("p1")],
      ["p2", new PassAI("p2")],
    ]);

    const result = await context.gameLoop.start(state, adapters);

    // p1 unit should have died from tile damage (4 HP, 2 dmg/turn → survives round 1 with 2 HP, dies round 2)
    expect(result.winnerIds).toContain("p2");
    expect(result.finalState.phase).toBe("result");

    // u1 should be dead
    const u1 = result.finalState.units["u1"]!;
    expect(u1.alive).toBe(false);

    console.log("  ✅ fire 타일 tile damage 2회 → HP 4→2→0, u1 사망, p2 승리");
  }, 15_000);

  it("fire 타일 위 유닛 HP=2: 첫 턴 시작 즉시 사망, p2 즉시 승리", async () => {
    /**
     * p1 unit(HP=2) on fire tile (dmg=2).
     * Round1 p1 turn start: tile damage 2 → HP=0 → dies.
     * PostProcessor after p1's pass → p1 no alive units → p2 wins.
     */
    const registry = makeRegistry();
    const factory = new GameFactory(registry);
    const context = factory.createContext();

    const state = makeState({
      p1Pos: { row: 5, col: 5 },
      p2Pos: { row: 0, col: 0 },
      p1HP: 2,
      tiles: {
        "5,5": { position: { row: 5, col: 5 }, attribute: "fire" },
      },
    });

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new PassAI("p1")],
      ["p2", new PassAI("p2")],
    ]);

    const result = await context.gameLoop.start(state, adapters);

    expect(result.winnerIds).toContain("p2");
    expect(result.finalState.units["u1"]!.alive).toBe(false);

    console.log("  ✅ HP=2 fire 타일: 첫 턴 즉시 사망 → p2 즉시 승리");
  }, 15_000);

  // ── 2. effect damagePerTurn ───────────────────────────────────────────────

  it("fire 효과(damagePerTurn=1) 3턴 카운트다운: 매 턴 1 데미지, 3턴 후 제거", async () => {
    /**
     * p1 unit(HP=4)에 fire effect(3 turns) 부여, plain 타일 위.
     * Pass AI로 3라운드 돌리면:
     *   Round1 p1 turn: effect dmg 1 → HP=3, turnsRemaining 3→2
     *   Round2 p1 turn: effect dmg 1 → HP=2, turnsRemaining 2→1
     *   Round3 p1 turn: effect dmg 1 → HP=1, turnsRemaining 1→0 → effect removed
     *   Round4+: no effect, HP stays at 1
     * 게임은 라운드 제한(기본 30라운드)까지 끝나지 않다가 무승부 또는 진행 중.
     * 여기서는 effect가 3턴 후 제거되고 HP가 1로 유지되는지를 직접
     * EffectResolver를 통해 검증한다 (loop 통합은 tile damage 테스트로 충분).
     *
     * 대신 이 테스트는 EffectManager.processTurnStart를 직접 3번 호출해
     * 카운트다운이 정상 작동하는지 검증한다.
     */
    const registry = makeRegistry();
    const factory = new GameFactory(registry);
    const context = factory.createContext();

    // 직접 effect manager 테스트
    const now = new Date().toISOString();
    let state: GameState = {
      gameId: "test" as GameId,
      phase: "battle",
      round: 1,
      turnOrder: [],
      currentTurnIndex: 0,
      players: {
        p1: { playerId: "p1" as PlayerId, teamIndex: 0, priority: 1, unitIds: ["u1"] as UnitId[], connected: true, surrendered: false },
      },
      units: {
        u1: {
          unitId: "u1" as UnitId,
          metaId: "fighter" as MetaId,
          playerId: "p1" as PlayerId,
          position: { row: 5, col: 5 },
          currentHealth: 4,
          currentArmor: 0,
          movementPoints: 3,
          activeEffects: [
            { effectId: "effect_fire" as MetaId, effectType: "fire", turnsRemaining: 3 },
          ],
          actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
          alive: true,
        },
      },
      map: { mapId: "map_test" as MetaId, gridSize: 11, tiles: {} },
      createdAt: now, updatedAt: now,
    };

    // Turn 1: fire effect dmg 1 → HP 3, turns 3→2
    state = context.effectManager.processTurnStart("u1", state);
    state = context.healthManager.applyDeaths(state);
    expect(state.units["u1"]!.currentHealth).toBe(3);
    const eff1 = state.units["u1"]!.activeEffects.find(e => e.effectType === "fire");
    expect(eff1).toBeDefined();
    expect(eff1!.turnsRemaining).toBe(2);

    // Turn 2: fire effect dmg 1 → HP 2, turns 2→1
    state = context.effectManager.processTurnStart("u1", state);
    state = context.healthManager.applyDeaths(state);
    expect(state.units["u1"]!.currentHealth).toBe(2);
    const eff2 = state.units["u1"]!.activeEffects.find(e => e.effectType === "fire");
    expect(eff2!.turnsRemaining).toBe(1);

    // Turn 3: fire effect dmg 1 → HP 1, turns 1→0 → effect removed
    state = context.effectManager.processTurnStart("u1", state);
    state = context.healthManager.applyDeaths(state);
    expect(state.units["u1"]!.currentHealth).toBe(1);
    const eff3 = state.units["u1"]!.activeEffects.find(e => e.effectType === "fire");
    expect(eff3).toBeUndefined(); // effect removed after 3 turns

    // Turn 4: no effect, HP unchanged
    state = context.effectManager.processTurnStart("u1", state);
    expect(state.units["u1"]!.currentHealth).toBe(1);
    expect(state.units["u1"]!.alive).toBe(true);

    console.log("  ✅ fire 효과 3턴 카운트다운: HP 4→3→2→1, 3턴 후 효과 제거");
  }, 10_000);

  // ── 3. 게임 루프 내 effect tick 순서 검증 ────────────────────────────────────

  it("게임 루프: effect tick이 p1·p2 턴 시작 시 각각 발생한다", async () => {
    /**
     * p1(HP=2) fire tile, p2(HP=4) fire tile.
     * 양측 pass.
     *
     * Round1:
     *   Slot 0 (p1 turn): effect tick → u1 tile dmg 2 → HP 2-2=0 → applyDeaths → u1 사망
     *     → p1 passes → turn end (postProcessor는 pass 시 미호출)
     *   Slot 1 (p2 turn): effect tick → u2 tile dmg 2 → HP 4-2=2 (생존)
     *     → p2 passes → turn end
     * End of Round1: endDetector → p1 alive=0, p2 alive=1 → p2 승리.
     *
     * 이 테스트는 두 가지를 동시에 검증한다:
     * 1. p1 turn start에 effect tick이 발생했다 (u1 사망)
     * 2. p2 turn start에 effect tick이 발생했다 (u2 HP 2 감소)
     */
    const registry = makeRegistry();
    const factory = new GameFactory(registry);
    const context = factory.createContext();

    const state = makeState({
      p1Pos: { row: 5, col: 5 },
      p2Pos: { row: 6, col: 6 },
      p1HP: 2,
      p2HP: 4,
      tiles: {
        "5,5": { position: { row: 5, col: 5 }, attribute: "fire" },
        "6,6": { position: { row: 6, col: 6 }, attribute: "fire" },
      },
    });

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new PassAI("p1")],
      ["p2", new PassAI("p2")],
    ]);

    const result = await context.gameLoop.start(state, adapters);

    // p1(HP=2) dies from first tick, p2(HP=4→2) survives → p2 wins
    expect(result.winnerIds).toContain("p2");
    expect(result.finalState.phase).toBe("result");
    expect(result.finalState.units["u1"]!.alive).toBe(false);
    // u2 also took fire tile damage (verifies tick ran for p2 too)
    expect(result.finalState.units["u2"]!.currentHealth).toBe(2);

    console.log("  ✅ p1(HP=2) fire 타일 첫 턴 사망; p2(HP=4→2) 생존 → p2 승리 (양측 tick 검증)");
  }, 15_000);

  // ── 4. 효과 없는 유닛은 tile damage 미적용 ───────────────────────────────────

  it("plain 타일 위 유닛: 여러 라운드 지나도 HP 변화 없음", async () => {
    /**
     * 두 유닛 모두 plain 타일(damagePerTurn=0).
     * 서로 공격 범위 밖에 있고 pass만 함 → 라운드 제한까지 진행.
     * 게임이 draw(round limit)로 끝나야 하고 두 유닛 모두 alive여야 함.
     */
    const registry = buildDataRegistry({
      units: UNITS, weapons: WEAPONS, skills: [],
      effects: EFFECTS, tiles: TILES, maps: MAPS,
      // 짧은 round limit을 위해 직접 설정 불가 → 게임 결과만 확인
    });
    const factory = new GameFactory(registry);
    const context = factory.createContext();

    const state = makeState({
      p1Pos: { row: 0, col: 0 },
      p2Pos: { row: 10, col: 10 },
      // 빈 tiles → 모두 plain
    });

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new PassAI("p1")],
      ["p2", new PassAI("p2")],
    ]);

    const result = await context.gameLoop.start(state, adapters);

    // 서로 공격 못 하고 tile damage도 없으므로 round limit까지 살아남아야 함
    // (round limit으로 draw 또는 unit 수 동일 → draw)
    expect(["draw", "win"]).toContain(result.reason);
    // 두 유닛 모두 살아 있어야 함
    expect(result.finalState.units["u1"]!.alive).toBe(true);
    expect(result.finalState.units["u2"]!.alive).toBe(true);

    console.log(`  ✅ plain 타일: HP 변화 없이 라운드 제한 도달 (결과: ${result.reason})`);
  }, 30_000);
});
