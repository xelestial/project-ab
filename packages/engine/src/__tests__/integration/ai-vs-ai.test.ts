/**
 * AI vs AI 통합 테스트 — 전체 게임 루프가 정상 종료되는지 검증.
 * RandomAdapter 두 개를 사용해 최대 30라운드 안에 게임이 끝나야 한다.
 */
import { describe, it, expect } from "vitest";
import { GameFactory } from "../../context/game-factory.js";
import { MovementValidator } from "../../validators/movement-validator.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import type { IPlayerAdapter } from "../../loop/game-loop.js";
import { buildDataRegistry, type PlayerId, type UnitId, type MetaId, type GameId } from "@ab/metadata";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UNITS = [
  {
    id: "t1", nameKey: "u", descKey: "u", class: "tanker", faction: "a",
    baseMovement: 3, baseHealth: 6, baseArmor: 1,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
  },
  {
    id: "f1", nameKey: "u", descKey: "u", class: "fighter", faction: "b",
    baseMovement: 3, baseHealth: 4, baseArmor: 0,
    attributes: [], primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
  },
  {
    id: "r1", nameKey: "u", descKey: "u", class: "ranger", faction: "b",
    baseMovement: 2, baseHealth: 4, baseArmor: 0,
    attributes: [], primaryWeaponId: "wpn_ranged", skillIds: [], spriteKey: "s",
  },
];

const WEAPONS = [
  {
    id: "wpn_melee", nameKey: "w", descKey: "w",
    attackType: "melee", rangeType: "single", minRange: 1, maxRange: 1,
    damage: 2, attribute: "none", penetrating: false, arcing: false,
  },
  {
    id: "wpn_ranged", nameKey: "w", descKey: "w",
    attackType: "ranged", rangeType: "single", minRange: 2, maxRange: 4,
    damage: 2, attribute: "none", penetrating: false, arcing: false,
  },
];

const EFFECTS: unknown[] = [];
const TILES = [
  { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
  { id: "tile_mountain", tileType: "mountain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: true, damagePerTurn: 0 },
];

const MAPS = [
  {
    id: "map_2p", nameKey: "m", descKey: "m", playerCounts: [2],
    tileOverrides: [],
    spawnPoints: [
      { playerId: 0, positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }] },
      { playerId: 1, positions: [{ row: 10, col: 10 }, { row: 10, col: 9 }, { row: 10, col: 8 }] },
    ],
  },
];

// ─── Simple AI adapter for integration test ────────────────────────────────────

class SimpleAI implements IPlayerAdapter {
  readonly type = "ai" as const;

  constructor(
    readonly playerId: string,
    private readonly mv: MovementValidator,
    private readonly av: AttackValidator,
  ) {}

  async requestDraftPlacement(
    _state: import("@ab/metadata").GameState,
    _timeoutMs: number,
  ): Promise<Extract<import("@ab/metadata").PlayerAction, { type: "draft_place" }>> {
    // Not used in battle-only test
    throw new Error("not in draft");
  }

  async requestUnitOrder(
    _state: import("@ab/metadata").GameState,
    aliveUnitIds: UnitId[],
    _timeoutMs: number,
  ): Promise<UnitId[]> {
    return aliveUnitIds;
  }

  async requestAction(state: import("@ab/metadata").GameState): Promise<import("@ab/metadata").PlayerAction> {
    // For unit-level slots, only act on the specific unit assigned to this turn slot
    const currentSlot = state.turnOrder[state.currentTurnIndex];
    const slotUnitId = currentSlot?.unitId;

    const myUnits = Object.values(state.units).filter(
      (u) =>
        u.alive &&
        u.playerId === this.playerId &&
        (slotUnitId === undefined || u.unitId === slotUnitId),
    );
    const enemies = Object.values(state.units).filter(
      (u) => u.alive && u.playerId !== this.playerId,
    );

    for (const unit of myUnits) {
      // Try attack — prefer enemy-occupied tiles
      if (!unit.actionsUsed.attacked) {
        const allTargets = this.av.getAttackableTargets(unit, state);
        // Filter to tiles with enemies first; fall back to any valid target
        const enemyTargets = allTargets.filter((t) =>
          enemies.some((e) => e.position.row === t.row && e.position.col === t.col),
        );
        const target = enemyTargets[0] ?? allTargets[0];
        if (target !== undefined) {
          return {
            type: "attack",
            playerId: this.playerId as PlayerId,
            unitId: unit.unitId,
            target,
          };
        }
      }
      // Try move toward nearest enemy
      if (!unit.actionsUsed.moved && enemies.length > 0) {
        const reachable = this.mv.getReachableTiles(unit, state);
        if (reachable.length > 0) {
          const nearestEnemy = enemies.reduce((a, b) =>
            Math.abs(a.position.row - unit.position.row) + Math.abs(a.position.col - unit.position.col) <
            Math.abs(b.position.row - unit.position.row) + Math.abs(b.position.col - unit.position.col)
              ? a
              : b,
          );
          const sorted = [...reachable].sort(
            (a, b) =>
              Math.abs(a.row - nearestEnemy.position.row) + Math.abs(a.col - nearestEnemy.position.col) -
              (Math.abs(b.row - nearestEnemy.position.row) + Math.abs(b.col - nearestEnemy.position.col)),
          );
          return {
            type: "move",
            playerId: this.playerId as PlayerId,
            unitId: unit.unitId,
            destination: sorted[0]!,
          };
        }
      }
    }

    const first = myUnits[0];
    return {
      type: "pass",
      playerId: this.playerId as PlayerId,
      unitId: (first?.unitId ?? "") as UnitId,
    };
  }

  onStateUpdate() {}
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe("AI vs AI integration", () => {
  it("completes a full game without error", async () => {
    const registry = buildDataRegistry({
      units: UNITS, weapons: WEAPONS, skills: [],
      effects: EFFECTS, tiles: TILES, maps: MAPS,
    });

    const factory = new GameFactory(registry);
    const context = factory.createContext();

    // Build initial state manually (skip draft)
    const now = new Date().toISOString();
    const p1Id = "p1" as PlayerId;
    const p2Id = "p2" as PlayerId;

    const makeUnit = (
      id: string,
      metaId: string,
      playerId: PlayerId,
      row: number,
      col: number,
    ) => ({
      unitId: id as UnitId,
      metaId: metaId as MetaId,
      playerId,
      position: { row, col },
      currentHealth: 6,
      currentArmor: 0,
      movementPoints: 3,
      activeEffects: [] as import("@ab/metadata").ActiveEffect[],
      actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
      alive: true,
    });

    const initialState: import("@ab/metadata").GameState = {
      gameId: "test-ai-vs-ai" as GameId,
      phase: "battle",
      round: 1,
      turnOrder: [
        { playerId: p1Id, priority: 1 },
        { playerId: p2Id, priority: 1 },
      ],
      currentTurnIndex: 0,
      players: {
        p1: { playerId: p1Id, teamIndex: 0, priority: 1, unitIds: ["u1a", "u1b"] as UnitId[], connected: true, surrendered: false },
        p2: { playerId: p2Id, teamIndex: 1, priority: 1, unitIds: ["u2a", "u2b"] as UnitId[], connected: true, surrendered: false },
      },
      units: {
        u1a: makeUnit("u1a", "t1", p1Id, 1, 1),
        u1b: makeUnit("u1b", "f1", p1Id, 1, 2),
        u2a: makeUnit("u2a", "t1", p2Id, 9, 9),
        u2b: makeUnit("u2b", "f1", p2Id, 9, 8),
      },
      map: { mapId: "map_2p" as MetaId, gridSize: 11, tiles: {} },
      createdAt: now,
      updatedAt: now,
    };

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new SimpleAI("p1", mv, av)],
      ["p2", new SimpleAI("p2", mv, av)],
    ]);

    const result = await context.gameLoop.start(initialState, adapters);

    expect(result.gameId).toBe("test-ai-vs-ai");
    expect(["win", "draw"]).toContain(result.reason);
    // Game must complete (winner or round limit)
    expect(result.finalState.phase).toBe("result");
  }, 30_000 /* allow up to 30s */);

  it("game ends when one player loses all units", async () => {
    const registry = buildDataRegistry({
      units: UNITS, weapons: WEAPONS, skills: [],
      effects: EFFECTS, tiles: TILES, maps: MAPS,
    });

    const factory = new GameFactory(registry);
    const context = factory.createContext();

    const now = new Date().toISOString();
    const p1Id = "p1" as PlayerId;
    const p2Id = "p2" as PlayerId;

    // p2 has a single unit with 1 HP — should die quickly
    const initialState: import("@ab/metadata").GameState = {
      gameId: "test-death" as GameId,
      phase: "battle",
      round: 1,
      turnOrder: [
        { playerId: p1Id, priority: 1 },
        { playerId: p2Id, priority: 1 },
      ],
      currentTurnIndex: 0,
      players: {
        p1: { playerId: p1Id, teamIndex: 0, priority: 1, unitIds: ["u1"] as UnitId[], connected: true, surrendered: false },
        p2: { playerId: p2Id, teamIndex: 1, priority: 1, unitIds: ["u2"] as UnitId[], connected: true, surrendered: false },
      },
      units: {
        u1: {
          unitId: "u1" as UnitId, metaId: "t1" as MetaId, playerId: p1Id,
          position: { row: 5, col: 4 },
          currentHealth: 6, currentArmor: 0, movementPoints: 3,
          activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
          alive: true,
        },
        u2: {
          unitId: "u2" as UnitId, metaId: "f1" as MetaId, playerId: p2Id,
          position: { row: 5, col: 5 }, // adjacent to u1
          currentHealth: 1, // will die from 1 hit (damage 2 > 1 hp)
          currentArmor: 0, movementPoints: 3,
          activeEffects: [], actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
          alive: true,
        },
      },
      map: { mapId: "map_2p" as MetaId, gridSize: 11, tiles: {} },
      createdAt: now,
      updatedAt: now,
    };

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;

    const adapters = new Map<string, IPlayerAdapter>([
      ["p1", new SimpleAI("p1", mv, av)],
      ["p2", new SimpleAI("p2", mv, av)],
    ]);

    const result = await context.gameLoop.start(initialState, adapters);

    expect(result.finalState.phase).toBe("result");
    // p1 should win (p2 unit dies from attack)
    expect(result.winnerIds).toContain("p1");
  }, 15_000);
});
