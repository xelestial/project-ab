/**
 * 로그 재구성 테스트
 *
 * 1. TacticalAdapter로 1게임 플레이 → GameLogEntry[] 저장
 * 2. 로그를 human-readable 형식으로 출력
 * 3. 동일한 초기 상태(unit ID 동일)에서 ReplayAdapter로 게임 재현
 * 4. 원본 게임과 재현 게임의 결과(승자·최종 HP)가 일치하는지 검증
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, PlayerId } from "@ab/metadata";
import {
  GameFactory, GameLogger,
  MovementValidator, AttackValidator,
} from "@ab/engine";
import type { IPlayerAdapter } from "@ab/engine";
import { TacticalAdapter, ReplayAdapter } from "@ab/ai";
import type {
  GameLogEntry, GameStartEntry, RoundStartEntry,
  TurnStartEntry, EffectTickEntry, ActionEntry,
  TurnEndEntry, RoundEndEntry, GameEndEntry,
} from "@ab/engine";

// ─── Registry ────────────────────────────────────────────────────────────────

// All tiles forced to "plain" so terrain is deterministic regardless of
// Math.random() state from other tests running in the same process.
const GRID = 11;
const ALL_PLAIN_OVERRIDES = Array.from({ length: GRID }, (_, row) =>
  Array.from({ length: GRID }, (_, col) => ({
    position: { row, col },
    tileType: "plain" as const,
  })),
).flat();

const REGISTRY = buildDataRegistry({
  units: [
    {
      id: "t1", nameKey: "tanker", descKey: "t", class: "tanker", faction: "a",
      baseMovement: 3, baseHealth: 6, baseArmor: 1, attributes: [],
      primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
    },
    {
      id: "f1", nameKey: "fighter", descKey: "f", class: "fighter", faction: "a",
      baseMovement: 3, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn_melee", skillIds: [], spriteKey: "s",
    },
    {
      id: "r1", nameKey: "ranger", descKey: "r", class: "ranger", faction: "b",
      baseMovement: 2, baseHealth: 4, baseArmor: 0, attributes: [],
      primaryWeaponId: "wpn_ranged", skillIds: [], spriteKey: "s",
    },
  ],
  weapons: [
    {
      id: "wpn_melee", nameKey: "melee", descKey: "m",
      attackType: "melee", rangeType: "single",
      minRange: 1, maxRange: 1, damage: 2, attribute: "none", penetrating: false, arcing: false,
    },
    {
      id: "wpn_ranged", nameKey: "ranged", descKey: "r",
      attackType: "ranged", rangeType: "single",
      minRange: 2, maxRange: 4, damage: 2, attribute: "none", penetrating: false, arcing: false,
    },
  ],
  skills: [],
  effects: [],
  tiles: [
    {
      id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t",
      moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0,
    },
  ],
  maps: [
    {
      id: "map_1v1", nameKey: "map", descKey: "m", playerCounts: [2], tileOverrides: ALL_PLAIN_OVERRIDES,
      spawnPoints: [
        { playerId: 0, positions: [{ row: 3, col: 3 }, { row: 3, col: 5 }, { row: 3, col: 7 }] },
        { playerId: 1, positions: [{ row: 7, col: 3 }, { row: 7, col: 5 }, { row: 7, col: 7 }] },
      ],
    },
  ],
});

// ─── Human-readable log printer ───────────────────────────────────────────────

function uid(id: string): string { return id.slice(0, 10); }
function pos(p: { row: number; col: number }): string { return `(${p.row},${p.col})`; }

function printLog(entries: GameLogEntry[]): void {
  console.log("\n══════════════════════════════════════════════════");
  console.log(` GAME LOG — ${entries.length} 엔트리`);
  console.log("══════════════════════════════════════════════════");

  for (const e of entries) {
    const seq = String(e.seq).padStart(3, " ");
    switch (e.type) {
      case "game_start": {
        const gs = e as GameStartEntry;
        console.log(`[${seq}] 🎮 GAME START  map=${gs.mapId} grid=${gs.gridSize}×${gs.gridSize}`);
        for (const u of gs.units) {
          console.log(`        ${uid(u.unitId)}  player=${u.playerId}  pos=${pos(u.position)}  hp=${u.hp}/${u.hp}  armor=${u.armor}`);
        }
        break;
      }
      case "round_start": {
        const rs = e as RoundStartEntry;
        const order = rs.turnOrder
          .map(s => `${s.playerId}/${s.unitId ? uid(s.unitId) : "?"}`)
          .join(" → ");
        console.log(`[${seq}] ━━ ROUND ${String(rs.round).padStart(2)} START  ${order}`);
        break;
      }
      case "turn_start": {
        const ts = e as TurnStartEntry;
        console.log(`[${seq}]   ▶ R${ts.round}T${ts.turnIndex}  ${ts.playerId}  ${ts.unitId ? uid(ts.unitId) : ""}`);
        break;
      }
      case "effect_tick": {
        const et = e as EffectTickEntry;
        const affected = et.affected
          .map(a => `${uid(a.unitId)} ${a.hpBefore}→${a.hpAfter}${a.died ? " 💀" : ""}`)
          .join(", ");
        console.log(`[${seq}]   ⚡ 효과틱  ${et.playerId}  [${affected}]`);
        break;
      }
      case "action": {
        const ac = e as ActionEntry;
        if (!ac.accepted) {
          console.log(`[${seq}]   ✗ REJECTED  ${ac.actionType}  ${uid(ac.unitId)}  err=${ac.errorCode}`);
          break;
        }
        switch (ac.actionType) {
          case "move":
            console.log(`[${seq}]   → 이동  ${uid(ac.unitId)}  ${pos(ac.movedFrom!)} → ${pos(ac.movedTo!)}`);
            break;
          case "attack": {
            const dmg = ac.outcomes
              .filter(o => o.hpBefore !== o.hpAfter || o.died)
              .map(o => `${uid(o.unitId)} ${o.hpBefore}→${o.hpAfter}${o.died ? " 💀" : ""}`)
              .join(", ");
            console.log(`[${seq}]   ⚔  ${uid(ac.unitId)} → ${ac.targetUnitId ? uid(ac.targetUnitId) : "?"}  ${pos(ac.targetPosition!)}  [${dmg || "무효"}]`);
            break;
          }
          default:
            console.log(`[${seq}]   ?  ${ac.actionType}  ${uid(ac.unitId)}`);
        }
        break;
      }
      case "turn_end": {
        const te = e as TurnEndEntry;
        console.log(`[${seq}]   ◀ R${te.round}T${te.turnIndex}  ${te.playerId}`);
        break;
      }
      case "round_end": {
        const re = e as RoundEndEntry;
        console.log(`[${seq}] ━━ ROUND ${String(re.round).padStart(2)} END`);
        break;
      }
      case "game_end": {
        const ge = e as GameEndEntry;
        console.log(`[${seq}] 🏁 GAME END  승자: ${ge.winnerIds.join(",") || "무승부"}  이유: ${ge.reason}`);
        for (const u of ge.finalUnits) {
          const alive = u.alive ? "생존" : "💀사망";
          console.log(`        ${uid(u.unitId)}  hp=${u.hp}  ${alive}`);
        }
        break;
      }
    }
  }
  console.log("══════════════════════════════════════════════════\n");
}

// ─── 게임 실행 헬퍼 ───────────────────────────────────────────────────────────

interface RunResult {
  winnerIds: string[];
  reason: string;
  finalUnits: Array<{ unitId: string; hp: number; alive: boolean; position: { row: number; col: number } }>;
  entries: GameLogEntry[];
}

async function runGame(
  state: GameState,                        // 공유된 초기 상태 (unit ID 동일)
  gameId: string,                          // 이 실행의 고유 log 키
  adapters: Map<string, IPlayerAdapter>,
): Promise<RunResult> {
  const factory = new GameFactory(REGISTRY);
  const context = factory.createContext();
  const logger = context.logger as GameLogger;

  // gameId만 바꾼 복사본 — unit ID는 그대로 유지
  const runState: GameState = { ...state, gameId: gameId as import("@ab/metadata").GameId };

  const result = await context.gameLoop.start(runState, adapters);
  const entries = logger.getLog(gameId);

  const gameEnd = entries[entries.length - 1] as GameEndEntry;
  return {
    winnerIds: result.winnerIds,
    reason: result.reason,
    finalUnits: gameEnd.finalUnits,
    entries,
  };
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("로그 재구성", () => {
  it("원본 게임 로그로 게임을 완전히 재현할 수 있다", async () => {
    const factory = new GameFactory(REGISTRY);
    const movVal = new MovementValidator(REGISTRY);
    const atkVal = new AttackValidator(REGISTRY);

    // 초기 상태를 한 번만 생성 → unit ID 고정
    // priority를 다르게 설정해 플레이어 순서가 항상 p1→p2로 결정론적이 되도록 함
    // (같은 priority면 랜덤 코인플립이 발생해 원본/재현 간 순서가 달라질 수 있음)
    const baseState = factory.createBattleState(
      {
        gameId: "base",
        mapId: "map_1v1",
        players: [
          { playerId: "p1", teamIndex: 0, priority: 1 },
          { playerId: "p2", teamIndex: 1, priority: 2 },
        ],
      },
      new Map([
        ["p1", [
          { metaId: "t1", position: { row: 3, col: 3 } },
          { metaId: "f1", position: { row: 3, col: 5 } },
          { metaId: "r1", position: { row: 3, col: 7 } },
        ]],
        ["p2", [
          { metaId: "t1", position: { row: 7, col: 3 } },
          { metaId: "f1", position: { row: 7, col: 5 } },
          { metaId: "r1", position: { row: 7, col: 7 } },
        ]],
      ]),
    );

    // ── [1] 원본 게임 ──────────────────────────────────────────────────────────
    console.log("▶ 원본 게임 (aggressive vs defensive)...");
    const origAdapters = new Map<string, IPlayerAdapter>([
      ["p1", new TacticalAdapter("p1", movVal, atkVal, REGISTRY, { profile: "aggressive" })],
      ["p2", new TacticalAdapter("p2", movVal, atkVal, REGISTRY, { profile: "defensive" })],
    ]);
    const orig = await runGame(baseState, "orig-001", origAdapters);

    // ── [2] 로그 출력 ─────────────────────────────────────────────────────────
    printLog(orig.entries);

    const typeCounts = orig.entries.reduce(
      (acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    console.log("📊 원본 로그:", typeCounts);
    console.log(`   총 ${orig.entries.length}개 엔트리  seq 1→${orig.entries[orig.entries.length - 1]!.seq}`);
    console.log(`   승자: ${orig.winnerIds.join(",") || "무승부"}  이유: ${orig.reason}\n`);

    // ── [3] ReplayAdapter로 재현 ──────────────────────────────────────────────
    console.log("🔄 ReplayAdapter로 게임 재현 중...");
    const replayAdapters = new Map<string, IPlayerAdapter>([
      ["p1", new ReplayAdapter("p1", orig.entries)],
      ["p2", new ReplayAdapter("p2", orig.entries)],
    ]);
    const replay = await runGame(baseState, "replay-001", replayAdapters);

    // ── [4] 결과 비교 ─────────────────────────────────────────────────────────
    console.log("\n📋 결과 비교:");
    console.log(`   원본  승자: ${orig.winnerIds.join(",") || "무승부"}  이유: ${orig.reason}`);
    console.log(`   재현  승자: ${replay.winnerIds.join(",") || "무승부"}  이유: ${replay.reason}`);

    console.log("\n   유닛별 최종 HP:");
    let allMatch = true;
    for (const origUnit of orig.finalUnits) {
      const repUnit = replay.finalUnits.find(u => u.unitId === origUnit.unitId);
      const hpOk = repUnit?.hp === origUnit.hp;
      const aliveOk = repUnit?.alive === origUnit.alive;
      const match = hpOk && aliveOk;
      if (!match) allMatch = false;
      const icon = match ? "✅" : "❌";
      console.log(`   ${icon} ${uid(origUnit.unitId)}  원본: hp=${origUnit.hp}/${origUnit.alive ? "생존" : "사망"}  재현: hp=${repUnit?.hp ?? "?"}/${repUnit?.alive ? "생존" : "사망"}`);
    }

    const replayCounts = replay.entries.reduce(
      (acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    console.log("\n📊 재현 로그:", replayCounts);
    console.log(`   총 ${replay.entries.length}개 엔트리  승자: ${replay.winnerIds.join(",") || "무승부"}\n`);

    // ── Assertions ────────────────────────────────────────────────────────────

    // 승자 일치
    expect(replay.winnerIds.sort()).toEqual(orig.winnerIds.sort());

    // 전체 유닛 생존/사망·HP 일치
    for (const origUnit of orig.finalUnits) {
      const repUnit = replay.finalUnits.find(u => u.unitId === origUnit.unitId);
      expect(repUnit, `unit ${origUnit.unitId} missing from replay finalUnits`).toBeDefined();
      expect(repUnit!.alive).toBe(origUnit.alive);
      expect(repUnit!.hp).toBe(origUnit.hp);
    }

    // 재현 로그도 유효한 구조
    expect(replay.entries[0]!.type).toBe("game_start");
    expect(replay.entries[replay.entries.length - 1]!.type).toBe("game_end");

    if (allMatch) {
      console.log("✅ 완전한 재구성 성공 — 모든 유닛의 최종 HP/생사 일치");
    }
  }, 30_000);
});
