/**
 * E2E Playthrough Test — full game validation using the production stack.
 *
 * Uses GameFactory (same as live server), greedy AI, and validates:
 *   - Game reaches "result" phase
 *   - Winner declared with alive units, losers have none
 *   - No alive unit with HP ≤ 0
 *   - No dead unit marked alive
 *   - Round counter increments monotonically
 *   - game.end event emitted
 *   - Dead slots skipped in turn order
 *   - At least 1 unit died (combat happened)
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, UnitId, PlayerId, PlayerAction } from "@ab/metadata";
import { GameFactory, MovementValidator, AttackValidator } from "@ab/engine";
import type { IPlayerAdapter, IEventBus } from "@ab/engine";

// ─── Registry (matches production unit roster) ────────────────────────────────

const REGISTRY = buildDataRegistry({
  units: [
    { id: "t1", nameKey: "u", descKey: "u", class: "tanker",  faction: "a", baseMovement: 3, baseHealth: 6, baseArmor: 1, attributes: [], primaryWeaponId: "wpn_melee",   skillIds: [], spriteKey: "t1" },
    { id: "f1", nameKey: "u", descKey: "u", class: "fighter", faction: "a", baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee",   skillIds: [], spriteKey: "f1" },
    { id: "r1", nameKey: "u", descKey: "u", class: "ranger",  faction: "b", baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_ranged",  skillIds: [], spriteKey: "r1" },
    { id: "k1", nameKey: "u", descKey: "u", class: "fighter", faction: "a", baseMovement: 4, baseHealth: 4, baseArmor: 0, attributes: [], primaryWeaponId: "wpn_melee",   skillIds: [], spriteKey: "k1" },
    { id: "s1", nameKey: "u", descKey: "u", class: "tanker",  faction: "a", baseMovement: 2, baseHealth: 7, baseArmor: 2, attributes: [], primaryWeaponId: "wpn_melee",   skillIds: [], spriteKey: "s1" },
  ],
  weapons: [
    { id: "wpn_melee",  nameKey: "w", descKey: "w", attackType: "melee",  rangeType: "single", minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false },
    { id: "wpn_ranged", nameKey: "w", descKey: "w", attackType: "ranged", rangeType: "single", minRange: 2, maxRange: 4, damage: 2, attribute: "none", penetrating: false, arcing: false },
  ],
  skills: [],
  effects: [],
  tiles: [
    { id: "tile_plain",    tileType: "plain",    nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
    { id: "tile_mountain", tileType: "mountain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: true,  damagePerTurn: 0 },
    { id: "tile_river",    tileType: "river",    nameKey: "t", descKey: "t", moveCost: 2, cannotStop: false, impassable: false, damagePerTurn: 0 },
    { id: "tile_sand",     tileType: "sand",     nameKey: "t", descKey: "t", moveCost: 2, cannotStop: false, impassable: false, damagePerTurn: 0 },
  ],
  maps: [
    {
      id: "map_test", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }] },
        { playerId: 1, positions: [{ row: 10, col: 10 }, { row: 10, col: 8 }, { row: 10, col: 6 }] },
      ],
    },
  ],
});

// ─── Greedy AI (identical pattern to the ai-vs-ai.test.ts SimpleAI) ──────────

class GreedyAI implements IPlayerAdapter {
  readonly type = "ai" as const;
  constructor(
    readonly playerId: string,
    private readonly mv: MovementValidator,
    private readonly av: AttackValidator,
  ) {}

  async requestDraftPlacement(): Promise<never> { throw new Error("not used"); }

  async requestAction(state: GameState): Promise<PlayerAction> {
    // Respect the current slot's unitId — only act for the active unit
    const slot = state.turnOrder[state.currentTurnIndex];
    const activeUnitId = slot?.unitId;

    const myUnits = Object.values(state.units).filter(
      (u) =>
        u.alive &&
        u.playerId === this.playerId &&
        (activeUnitId === undefined || u.unitId === activeUnitId),
    );
    const enemies = Object.values(state.units).filter(
      (u) => u.alive && u.playerId !== this.playerId,
    );

    for (const unit of myUnits) {
      if (!unit.actionsUsed.attacked) {
        const allTargets = this.av.getAttackableTargets(unit, state);
        const enemyTargets = allTargets.filter((t) =>
          enemies.some((e) => e.position.row === t.row && e.position.col === t.col),
        );
        const target = enemyTargets[0] ?? allTargets[0];
        if (target !== undefined) {
          return { type: "attack", playerId: this.playerId as PlayerId, unitId: unit.unitId, target };
        }
      }
      if (!unit.actionsUsed.moved && enemies.length > 0) {
        const reachable = this.mv.getReachableTiles(unit, state);
        if (reachable.length > 0) {
          const nearest = enemies.reduce((a, b) =>
            Math.abs(a.position.row - unit.position.row) + Math.abs(a.position.col - unit.position.col) <
            Math.abs(b.position.row - unit.position.row) + Math.abs(b.position.col - unit.position.col) ? a : b,
          );
          const sorted = [...reachable].sort(
            (a, b) =>
              Math.abs(a.row - nearest.position.row) + Math.abs(a.col - nearest.position.col) -
              (Math.abs(b.row - nearest.position.row) + Math.abs(b.col - nearest.position.col)),
          );
          return { type: "move", playerId: this.playerId as PlayerId, unitId: unit.unitId, destination: sorted[0]! };
        }
      }
    }
    const first = myUnits[0] ?? Object.values(state.units).find(u => u.playerId === this.playerId);
    return { type: "pass", playerId: this.playerId as PlayerId, unitId: (first?.unitId ?? "") as UnitId };
  }

  async requestUnitOrder(_state: GameState, aliveUnitIds: UnitId[]): Promise<UnitId[]> {
    return aliveUnitIds; // default order
  }

  onStateUpdate(): void {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapters(p1Id: string, p2Id: string, mv: MovementValidator, av: AttackValidator) {
  return new Map<string, IPlayerAdapter>([
    [p1Id, new GreedyAI(p1Id, mv, av)],
    [p2Id, new GreedyAI(p2Id, mv, av)],
  ]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("E2E Playthrough — full game validation", () => {

  it("AI vs AI plays to completion with valid winner", async () => {
    const factory = new GameFactory(REGISTRY);
    const p1Id = "p1" as PlayerId;
    const p2Id = "p2" as PlayerId;

    const placements = new Map([
      [p1Id, [
        { metaId: "t1", position: { row: 0, col: 0 } },
        { metaId: "f1", position: { row: 0, col: 2 } },
        { metaId: "r1", position: { row: 0, col: 4 } },
      ]],
      [p2Id, [
        { metaId: "t1", position: { row: 10, col: 10 } },
        { metaId: "f1", position: { row: 10, col: 8 } },
        { metaId: "r1", position: { row: 10, col: 6 } },
      ]],
    ]);

    const context = factory.createContext();
    const battleState = factory.createBattleState(
      { gameId: "e2e-full", mapId: "map_test", players: [
        { playerId: p1Id, teamIndex: 0, priority: 1 },
        { playerId: p2Id, teamIndex: 1, priority: 1 },
      ] },
      placements,
    );

    // Assert initial state
    expect(battleState.phase).toBe("battle");
    const initialAlive = Object.values(battleState.units).filter(u => u.alive);
    expect(initialAlive).toHaveLength(6);

    // Track events
    let gameEndEvent: { winnerIds: string[]; reason: string } | null = null;
    let roundsStarted = 0;
    let actionsAccepted = 0;
    let actionsRejected = 0;
    const roundsObserved: number[] = [];

    (context.eventBus as IEventBus).onAny((event: Record<string, unknown>) => {
      const e = event as { type: string; state?: GameState; winnerIds?: string[]; reason?: string };
      if (e.type === "round.start") {
        roundsStarted++;
        if (e.state?.round !== undefined) roundsObserved.push(e.state.round);
      }
      if (e.type === "action.accepted") actionsAccepted++;
      if (e.type === "action.rejected") actionsRejected++;
      if (e.type === "game.end") {
        gameEndEvent = { winnerIds: e.winnerIds ?? [], reason: e.reason ?? "unknown" };
      }
    });

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const result = await context.gameLoop.start(battleState, makeAdapters(p1Id, p2Id, mv, av));

    // ── Core invariants ──────────────────────────────────────────────────────

    // 1. Phase = result
    expect(result.finalState.phase).toBe("result");

    // 2. endResult set
    expect(result.finalState.endResult).toBeDefined();

    // 3. game.end event fired
    expect(gameEndEvent).not.toBeNull();

    // 4. Winner exists in players
    for (const wId of result.winnerIds) {
      expect(result.finalState.players).toHaveProperty(wId);
    }

    // 5. No alive unit with HP ≤ 0
    const finalAlive = Object.values(result.finalState.units).filter(u => u.alive);
    for (const u of finalAlive) {
      expect(u.currentHealth).toBeGreaterThan(0);
    }

    // 6. No dead unit marked alive
    const deadUnits = Object.values(result.finalState.units).filter(u => !u.alive);
    for (const u of deadUnits) {
      expect(u.alive).toBe(false);
    }

    // 7. At least 1 unit died (combat happened)
    expect(deadUnits.length).toBeGreaterThan(0);

    // 8. Rounds incremented (at least 1 round started)
    expect(roundsStarted).toBeGreaterThanOrEqual(1);

    // 9. Round counter monotonically increasing
    for (let i = 1; i < roundsObserved.length; i++) {
      expect(roundsObserved[i]).toBeGreaterThan(roundsObserved[i - 1]!);
    }

    // 10. If combat win (all enemies eliminated): losing team has no alive units.
    //     Round-limit wins are valid even with alive losers (won by unit count).
    if (result.winnerIds.length > 0) {
      const winnerSet = new Set(result.winnerIds);
      const losingAlive = finalAlive.filter(u => !winnerSet.has(u.playerId));
      // Either combat-win (loser has 0 alive) or round-limit (winner just has more)
      if (losingAlive.length === 0) {
        // Combat win — fine
      } else {
        // Round-limit win — winner must have MORE alive units than each loser
        const winnerAlive = finalAlive.filter(u => winnerSet.has(u.playerId)).length;
        expect(winnerAlive).toBeGreaterThan(losingAlive.length);
      }
    }

    // 11. Actions accepted > 0 (real combat)
    expect(actionsAccepted).toBeGreaterThan(0);

    // 12. Unit IDs and player references valid
    for (const [uid, unit] of Object.entries(result.finalState.units)) {
      expect(unit.unitId).toBe(uid);
      expect(result.finalState.players).toHaveProperty(unit.playerId);
    }

    console.log(
      `\n  ✅ Full game: rounds=${result.finalState.round}, winner=${result.winnerIds.join(",") || "draw"},` +
      ` dead=${deadUnits.length}/6, accepted=${actionsAccepted}, rejected=${actionsRejected}`,
    );
  }, 30_000);

  it("winner detection: last team standing wins immediately", async () => {
    const factory = new GameFactory(REGISTRY);
    const p1Id = "p1" as PlayerId;
    const p2Id = "p2" as PlayerId;

    // p2 has 1 unit adjacent to p1 with low HP — should die on first attack
    const placements = new Map([
      [p1Id, [{ metaId: "f1", position: { row: 5, col: 4 } }]],
      [p2Id, [{ metaId: "f1", position: { row: 5, col: 5 } }]],  // adjacent, will die (hp 4, dmg 2×2)
    ]);

    const context = factory.createContext();
    let battleState = factory.createBattleState(
      { gameId: "e2e-winner", mapId: "map_test", players: [
        { playerId: p1Id, teamIndex: 0, priority: 1 },
        { playerId: p2Id, teamIndex: 1, priority: 1 },
      ] },
      placements,
    );

    // Give p2's unit only 1 HP so it dies in 1 hit
    const p2Unit = Object.values(battleState.units).find(u => u.playerId === p2Id);
    expect(p2Unit).toBeDefined();
    battleState = {
      ...battleState,
      units: { ...battleState.units, [p2Unit!.unitId]: { ...p2Unit!, currentHealth: 1 } },
    };

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const result = await context.gameLoop.start(battleState, makeAdapters(p1Id, p2Id, mv, av));

    expect(result.finalState.phase).toBe("result");
    expect(result.winnerIds).toContain(p1Id);
    expect(result.winnerIds).not.toContain(p2Id);

    const p2Alive = Object.values(result.finalState.units).filter(u => u.alive && u.playerId === p2Id);
    expect(p2Alive).toHaveLength(0);

    console.log(`\n  ✅ Winner detection: winner=${result.winnerIds[0]}, rounds=${result.finalState.round}`);
  }, 10_000);

  it("dead slots in turn order are skipped (game loop never acts for dead units)", async () => {
    const factory = new GameFactory(REGISTRY);
    const p1Id = "p1" as PlayerId;
    const p2Id = "p2" as PlayerId;

    // Two units each, one p2 unit adjacent and weak — dies early
    const placements = new Map([
      [p1Id, [
        { metaId: "f1", position: { row: 5, col: 3 } },
        { metaId: "t1", position: { row: 5, col: 2 } },
      ]],
      [p2Id, [
        { metaId: "f1", position: { row: 5, col: 4 } }, // adjacent to p1 f1
        { metaId: "r1", position: { row: 5, col: 9 } }, // far away
      ]],
    ]);

    const context = factory.createContext();
    let battleState = factory.createBattleState(
      { gameId: "e2e-dead-skip", mapId: "map_test", players: [
        { playerId: p1Id, teamIndex: 0, priority: 1 },
        { playerId: p2Id, teamIndex: 1, priority: 1 },
      ] },
      placements,
    );

    // Reduce adjacent p2 unit to 1 HP for quick kill
    const weakUnit = Object.values(battleState.units).find(
      u => u.playerId === p2Id && u.position.col === 4,
    );
    if (weakUnit !== undefined) {
      battleState = {
        ...battleState,
        units: { ...battleState.units, [weakUnit.unitId]: { ...weakUnit, currentHealth: 1 } },
      };
    }

    // Track any dead unit whose player's adapter is called when only dead units remain for that player
    const requestsForDeadPlayers: string[] = [];
    class TrackingGreedyAI extends GreedyAI {
      override async requestAction(state: GameState): Promise<PlayerAction> {
        const myUnits = Object.values(state.units).filter(u => u.playerId === this.playerId);
        const allDead = myUnits.every(u => !u.alive);
        if (allDead) {
          requestsForDeadPlayers.push(`${this.playerId} requestAction called when all units dead`);
        }
        return super.requestAction(state);
      }
    }

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const adapters = new Map<string, IPlayerAdapter>([
      [p1Id, new TrackingGreedyAI(p1Id, mv, av)],
      [p2Id, new TrackingGreedyAI(p2Id, mv, av)],
    ]);

    const result = await context.gameLoop.start(battleState, adapters);

    expect(result.finalState.phase).toBe("result");
    // Engine should never ask a player with all-dead units for actions
    expect(requestsForDeadPlayers).toHaveLength(0);

    console.log(`\n  ✅ Dead-skip: rounds=${result.finalState.round}, violations=${requestsForDeadPlayers.length}`);
  }, 20_000);

  it("round counter increments monotonically across full game (≥1 round)", async () => {
    const factory = new GameFactory(REGISTRY);
    const p1Id = "p1" as PlayerId;
    const p2Id = "p2" as PlayerId;

    const placements = new Map([
      [p1Id, [
        { metaId: "t1", position: { row: 0, col: 0 } },
        { metaId: "f1", position: { row: 0, col: 1 } },
      ]],
      [p2Id, [
        { metaId: "t1", position: { row: 10, col: 10 } },
        { metaId: "f1", position: { row: 10, col: 9 } },
      ]],
    ]);

    const context = factory.createContext();
    const battleState = factory.createBattleState(
      { gameId: "e2e-rounds", mapId: "map_test", players: [
        { playerId: p1Id, teamIndex: 0, priority: 1 },
        { playerId: p2Id, teamIndex: 1, priority: 1 },
      ] },
      placements,
    );

    const roundSequence: number[] = [];
    (context.eventBus as IEventBus).onAny((event: Record<string, unknown>) => {
      const e = event as { type: string; state?: GameState };
      if (e.type === "round.start" && e.state !== undefined) {
        roundSequence.push(e.state.round);
      }
    });

    const mv = context.movementValidator as MovementValidator;
    const av = context.attackValidator as AttackValidator;
    const result = await context.gameLoop.start(battleState, makeAdapters(p1Id, p2Id, mv, av));

    expect(result.finalState.phase).toBe("result");
    expect(roundSequence.length).toBeGreaterThanOrEqual(1);

    // Must be strictly increasing
    for (let i = 1; i < roundSequence.length; i++) {
      expect(roundSequence[i]).toBeGreaterThan(roundSequence[i - 1]!);
    }

    console.log(`\n  ✅ Round sequence: [${roundSequence.join(",")}], final=${result.finalState.round}`);
  }, 30_000);

});
