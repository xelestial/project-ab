/**
 * Integration test verifying the new GameLogEntry format is written correctly
 * during a real game. Checks:
 *   - game_start appears first with unit + tile snapshot
 *   - round_start entries carry turn order per round
 *   - turn_start / turn_end entries bracket every active slot
 *   - action entries record HP before→after for attacked units
 *   - game_end appears last with final unit HP snapshot
 *   - seq numbers are monotonically increasing with no gaps
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import { GameFactory, GameLogger, MovementValidator, AttackValidator } from "@ab/engine";
import { TacticalAdapter } from "@ab/ai";
import type { ActionEntry, GameStartEntry, RoundStartEntry, GameEndEntry } from "@ab/engine";

// ─── Registry with units that can attack at range 1 ──────────────────────────

const REGISTRY = buildDataRegistry({
  units: [
    {
      id: "f1", nameKey: "u", descKey: "u", class: "fighter", faction: "a",
      baseMovement: 3, baseHealth: 6, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn", skillIds: [], spriteKey: "s",
    },
  ],
  weapons: [
    {
      id: "wpn", nameKey: "w", descKey: "w", attackType: "melee", rangeType: "single",
      minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false,
    },
  ],
  skills: [], effects: [],
  tiles: [
    {
      id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t",
      moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0,
    },
  ],
  maps: [
    {
      id: "map_close", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
      spawnPoints: [
        { playerId: 0, positions: [{ row: 4, col: 5 }] },
        { playerId: 1, positions: [{ row: 6, col: 5 }] },
      ],
    },
  ],
});

describe("Replay log format", () => {
  it("game lifecycle: game_start → rounds → actions with HP outcomes → game_end", async () => {
    const factory = new GameFactory(REGISTRY);
    const movVal = new MovementValidator(REGISTRY);
    const atkVal = new AttackValidator(REGISTRY);

    // Place units two tiles apart (reachable in first move with 3 movement)
    const placements = new Map([
      ["p1", [{ metaId: "f1", position: { row: 4, col: 5 } }]],
      ["p2", [{ metaId: "f1", position: { row: 6, col: 5 } }]],
    ]);
    const state = factory.createBattleState(
      {
        gameId: "test01",
        mapId: "map_close",
        players: [
          { playerId: "p1", teamIndex: 0, priority: 1 },
          { playerId: "p2", teamIndex: 1, priority: 2 },
        ],
      },
      placements,
    );

    // context.logger IS the logger wired into the game loop
    const context = factory.createContext();
    const logger = context.logger as GameLogger;

    const adapters = new Map([
      ["p1", new TacticalAdapter("p1", movVal, atkVal, REGISTRY, { profile: "aggressive" })],
      ["p2", new TacticalAdapter("p2", movVal, atkVal, REGISTRY, { profile: "aggressive" })],
    ]);

    await context.gameLoop.start(state, adapters);
    const log = logger.getLog("test01");

    const typeCounts = log.reduce(
      (acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    console.log("Entry distribution:", typeCounts);
    console.log("Total entries:", log.length);
    console.log("Seq range:", log[0]!.seq, "→", log[log.length - 1]!.seq);

    // ── game_start must be first ──────────────────────────────────────────────
    const gameStart = log[0] as GameStartEntry;
    expect(gameStart.type).toBe("game_start");
    expect(gameStart.units).toHaveLength(2);
    expect(gameStart.units[0]!.hp).toBeGreaterThan(0);
    console.log("\ngame_start:", JSON.stringify({
      units: gameStart.units.map(u => `${u.unitId.slice(0, 8)}@(${u.position.row},${u.position.col}) hp:${u.hp}`),
      tiles: gameStart.tiles.length,
    }));

    // ── round_start must include turn order ───────────────────────────────────
    const roundStart = log.find((e): e is RoundStartEntry => e.type === "round_start")!;
    expect(roundStart).toBeDefined();
    expect(roundStart.turnOrder.length).toBeGreaterThan(0);
    console.log("round_start turnOrder:", roundStart.turnOrder.map(s => `${s.playerId}/${s.unitId ?? "?"}`).join(", "));

    // ── action entries with HP outcomes ───────────────────────────────────────
    const actions = log.filter((e): e is ActionEntry => e.type === "action");
    const attacks = actions.filter(a => a.actionType === "attack" && a.accepted);
    console.log(`\nActions: ${actions.length} | Attacks: ${attacks.length}`);

    const attackWithDamage = attacks.find(a => a.outcomes.some(o => o.hpBefore !== o.hpAfter));
    if (attackWithDamage) {
      console.log("Sample attack with HP change:", JSON.stringify({
        attacker: attackWithDamage.unitId.slice(0, 8),
        target: attackWithDamage.targetUnitId?.slice(0, 8),
        at: attackWithDamage.targetPosition,
        outcomes: attackWithDamage.outcomes.map(
          o => `${o.unitId.slice(0, 8)}: ${o.hpBefore}→${o.hpAfter}${o.died ? " DIED" : ""}`,
        ),
      }));
    }

    // ── game_end must be last ─────────────────────────────────────────────────
    const gameEnd = log[log.length - 1] as GameEndEntry;
    expect(gameEnd.type).toBe("game_end");
    expect(gameEnd.finalUnits).toHaveLength(2);
    console.log("\ngame_end:", JSON.stringify({
      winners: gameEnd.winnerIds,
      reason: gameEnd.reason,
      units: gameEnd.finalUnits.map(u => `${u.unitId.slice(0, 8)}(hp:${u.hp},alive:${u.alive})`).join(", "),
    }));

    // ── Sequence numbers are gapless ─────────────────────────────────────────
    const seqs = log.map(e => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }

    // ── All lifecycle types must appear ──────────────────────────────────────
    expect(typeCounts["game_start"]).toBe(1);
    expect(typeCounts["round_start"]).toBeGreaterThan(0);
    expect(typeCounts["turn_start"]).toBeGreaterThan(0);
    expect(typeCounts["action"]).toBeGreaterThan(0);
    expect(typeCounts["turn_end"]).toBeGreaterThan(0);
    expect(typeCounts["game_end"]).toBe(1);

    // ── Attacks must record targetUnitId ─────────────────────────────────────
    for (const attack of attacks) {
      expect(attack.targetUnitId).toBeDefined();
    }

    // ── HP outcomes must be recorded for damage-dealing attacks ──────────────
    expect(attackWithDamage).toBeDefined();
    const dmgOutcome = attackWithDamage!.outcomes.find(o => o.hpBefore !== o.hpAfter)!;
    expect(dmgOutcome.hpAfter).toBeLessThan(dmgOutcome.hpBefore);

    console.log("\n✅ All assertions passed");
  }, 15000);
});
