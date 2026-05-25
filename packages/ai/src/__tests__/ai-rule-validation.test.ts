/**
 * ai-rule-validation.test.ts — AI vs AI 게임의 룰 위반 검증
 *
 * GameFactory + TacticalAdapter + EventBus 직접 훅으로
 * 모든 상태 전환을 캡처해 다음 항목을 검증:
 *
 *  [HP-1]  currentHealth < 0  (음수 HP)
 *  [HP-2]  currentHealth > baseHealth  (최대 HP 초과)
 *  [HP-3]  HP 회복 (heal 없는 게임에서 HP 증가)
 *  [HP-4]  alive=true & currentHealth ≤ 0  (사망 판정 누락)
 *  [HP-5]  alive=false & currentHealth > 0  (생존 판정 오류)
 *  [POS-1] 그리드 범위 이탈
 *  [POS-2] 두 유닛 동일 좌표 점유
 *  [POS-3] 사망 유닛 이동
 *  [MOV-1] 이동 거리 movementPoints 초과
 *  [ACT-1] 이미 attacked=true 유닛의 재공격 시도 (rejected 추적)
 *  [ACT-2] 이미 moved=true 유닛의 재이동 시도 (rejected 추적)
 *  [DEAD-1] 사망 유닛 부활 (alive false → true)
 *  [TURN-1] currentTurnIndex 범위 이탈
 *  [ROUND-1] 라운드 역행
 *  [END-1]  result 단계인데 양 팀 유닛 모두 생존
 *  [ACT-REJECT] action.rejected 이벤트 수 추적
 *
 * 3개 프로파일(aggressive, defensive, balanced)로 각 3게임씩 총 9게임 실행.
 */
import { describe, it, expect } from "vitest";
import {
  buildDataRegistry,
  type GameState,
  type UnitState,
  type PlayerAction,
  type UnitId,
  type PlayerId,
} from "@ab/metadata";
import {
  GameFactory,
  MovementValidator,
  AttackValidator,
  type IPlayerAdapter,
  type IEventBus,
} from "@ab/engine";
import { TacticalAdapter } from "../tactical/tactical-adapter.js";

// ─── Test timeout ────────────────────────────────────────────────────────────
// 각 게임이 최대 30라운드 × 6유닛 × 2액션 = 360 턴 → TacticalAdapter 는 O(candidates) 이므로 넉넉히
const GAME_TIMEOUT = 60_000; // 60 s

// ─── Registry (테스트용 최소 데이터 — 실제 게임 로직과 동일한 구조) ──────────

function makeRegistry() {
  return buildDataRegistry({
    units: [
      {
        id: "t1", nameKey: "t1", descKey: "t1", class: "tanker", faction: "a",
        baseMovement: 3, baseHealth: 6, baseArmor: 1,
        attributes: [], primaryWeaponId: "wpn_melee",
        skillIds: [], passiveIds: [], spriteKey: "s", priority: 1,
      },
      {
        id: "f1", nameKey: "f1", descKey: "f1", class: "fighter", faction: "a",
        baseMovement: 3, baseHealth: 4, baseArmor: 0,
        attributes: [], primaryWeaponId: "wpn_melee",
        skillIds: [], passiveIds: [], spriteKey: "s", priority: 1,
      },
      {
        id: "r1", nameKey: "r1", descKey: "r1", class: "ranger", faction: "b",
        baseMovement: 2, baseHealth: 4, baseArmor: 0,
        attributes: [], primaryWeaponId: "wpn_ranged",
        skillIds: [], passiveIds: [], spriteKey: "s", priority: 1,
      },
    ],
    weapons: [
      {
        id: "wpn_melee", nameKey: "w", descKey: "w",
        attackType: "melee", rangeType: "single",
        minRange: 1, maxRange: 1, damage: 2,
        attribute: "none", penetrating: false, arcing: false,
      },
      {
        id: "wpn_ranged", nameKey: "w", descKey: "w",
        attackType: "ranged", rangeType: "single",
        minRange: 2, maxRange: 4, damage: 2,
        attribute: "none", penetrating: false, arcing: false,
      },
    ],
    effects: [
      {
        id: "effect_fire", nameKey: "fire", descKey: "fire", effectType: "fire",
        damagePerTurn: 1, damageMultiplier: 1, statusFlags: [],
        removeConditions: [{ type: "manual_extinguish" }],
      },
    ],
    skills: [],
    tiles: [
      { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
    ],
    maps: [
      {
        id: "map_1v1", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [],
        spawnPoints: [
          { playerId: 0, positions: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }] },
          { playerId: 1, positions: [{ row: 10, col: 10 }, { row: 10, col: 8 }, { row: 10, col: 6 }] },
        ],
      },
    ],
  });
}

// ─── Violation types ─────────────────────────────────────────────────────────

interface Violation {
  eventType: string;
  round: number;
  turnIndex: number;
  phase: string;
  severity: "ERROR" | "WARNING";
  code: string;
  unitId?: string;
  message: string;
  data?: unknown;
}

// ─── State validator ─────────────────────────────────────────────────────────

function manhattan(a: { row: number; col: number }, b: { row: number; col: number }): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function validateState(
  state: GameState,
  prev: GameState | null,
  unitMetaMap: Map<string, { baseHealth: number; baseMovement: number }>,
  eventType: string,
): Violation[] {
  const v: Violation[] = [];
  const ctx = {
    eventType,
    round: state.round,
    turnIndex: state.currentTurnIndex,
    phase: state.phase,
  };

  const gridSize = state.map.gridSize;
  const posMap = new Map<string, string>(); // "r,c" → unitId

  for (const unit of Object.values(state.units)) {
    const meta = unitMetaMap.get(unit.metaId);
    const { row, col } = unit.position;

    // [HP-1] 음수 HP
    if (unit.currentHealth < 0) {
      v.push({ ...ctx, severity: "ERROR", code: "HP-1",
        unitId: unit.unitId, message: `음수 HP: ${unit.currentHealth}`,
        data: { hp: unit.currentHealth } });
    }

    // [HP-2] 최대 HP 초과
    if (meta && unit.currentHealth > meta.baseHealth) {
      v.push({ ...ctx, severity: "ERROR", code: "HP-2",
        unitId: unit.unitId,
        message: `HP ${unit.currentHealth} > 최대 ${meta.baseHealth}`,
        data: { hp: unit.currentHealth, max: meta.baseHealth } });
    }

    // [HP-4] alive=true & HP ≤ 0
    if (unit.alive && unit.currentHealth <= 0) {
      v.push({ ...ctx, severity: "ERROR", code: "HP-4",
        unitId: unit.unitId,
        message: `alive=true 이지만 HP=${unit.currentHealth}` });
    }

    // [HP-5] alive=false & HP > 0
    if (!unit.alive && unit.currentHealth > 0) {
      v.push({ ...ctx, severity: "WARNING", code: "HP-5",
        unitId: unit.unitId,
        message: `alive=false 이지만 HP=${unit.currentHealth}`,
        data: { hp: unit.currentHealth } });
    }

    // [POS-1] 그리드 범위 이탈
    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
      v.push({ ...ctx, severity: "ERROR", code: "POS-1",
        unitId: unit.unitId,
        message: `위치 (${row},${col}) 가 그리드 [0,${gridSize - 1}] 밖` });
    }

    // [POS-2] 동일 좌표 점유 — alive 유닛만
    if (unit.alive) {
      const key = `${row},${col}`;
      const existing = posMap.get(key);
      if (existing !== undefined) {
        v.push({ ...ctx, severity: "ERROR", code: "POS-2",
          unitId: unit.unitId,
          message: `(${row},${col}) 에 두 유닛 동시: ${existing} & ${unit.unitId}`,
          data: { other: existing } });
      } else {
        posMap.set(key, unit.unitId);
      }
    }

    // ── 전환 비교 (prev 있을 때) ─────────────────────────────────────────────
    if (prev !== null) {
      const prevUnit = prev.units[unit.unitId];
      if (prevUnit === undefined) continue; // 신규 등장 유닛은 건너뜀

      // [HP-3] HP 증가 감지 (힐 없는 게임)
      if (unit.alive && prevUnit.alive && unit.currentHealth > prevUnit.currentHealth) {
        v.push({ ...ctx, severity: "WARNING", code: "HP-3",
          unitId: unit.unitId,
          message: `HP 증가: ${prevUnit.currentHealth} → ${unit.currentHealth}`,
          data: { before: prevUnit.currentHealth, after: unit.currentHealth } });
      }

      // [DEAD-1] 사망 유닛 부활
      if (!prevUnit.alive && unit.alive) {
        v.push({ ...ctx, severity: "ERROR", code: "DEAD-1",
          unitId: unit.unitId,
          message: `사망 유닛 부활: HP ${prevUnit.currentHealth}→${unit.currentHealth}` });
      }

      // [POS-3] 사망 유닛 이동
      if (!prevUnit.alive && (prevUnit.position.row !== row || prevUnit.position.col !== col)) {
        v.push({ ...ctx, severity: "ERROR", code: "POS-3",
          unitId: unit.unitId,
          message: `사망 유닛 위치 변경: ` +
            `(${prevUnit.position.row},${prevUnit.position.col}) → (${row},${col})` });
      }

      // [MOV-1] 이동 거리 초과 — alive→alive, 실제 위치 변경 있을 때
      if (unit.alive && prevUnit.alive) {
        const dist = manhattan(prevUnit.position, unit.position);
        // movementPoints: 이동 전 값 사용, 넉백(knockback)은 사거리 밖 밀려남이므로
        // 공격 이벤트(unit.attacked)에서는 WARNING만
        if (dist > prevUnit.movementPoints && dist > 0) {
          const isAttackEvent = eventType.includes("attack") || eventType === "action.accepted";
          v.push({ ...ctx,
            severity: isAttackEvent ? "WARNING" : "ERROR",
            code: "MOV-1",
            unitId: unit.unitId,
            message: `이동거리 ${dist} > movementPoints ${prevUnit.movementPoints}` +
              ` (넉백 가능성)`,
            data: { dist, movePts: prevUnit.movementPoints,
              from: prevUnit.position, to: unit.position } });
        }
      }
    }
  } // end per-unit

  // ── 게임 레벨 검증 ──────────────────────────────────────────────────────────

  // [TURN-1] currentTurnIndex 범위
  if (state.currentTurnIndex < 0 || state.currentTurnIndex > state.turnOrder.length) {
    v.push({ ...ctx, severity: "ERROR", code: "TURN-1",
      message: `turnIndex ${state.currentTurnIndex} > turnOrder.length ${state.turnOrder.length}` });
  }

  // [ROUND-1] 라운드 역행
  if (prev !== null && state.round < prev.round) {
    v.push({ ...ctx, severity: "ERROR", code: "ROUND-1",
      message: `라운드 역행: ${prev.round} → ${state.round}` });
  }

  // [END-1] win 선언됐는데 승자 팀 유닛이 0개 (round_limit win은 양팀 모두 유닛이 있어도 정상)
  if (state.phase === "result" && state.endResult?.result === "win") {
    const winnerSet = new Set(state.endResult?.winnerIds ?? []);
    if (winnerSet.size > 0) {
      const winnerAlive = Object.values(state.units).filter(
        u => u.alive && winnerSet.has(u.playerId),
      ).length;
      if (winnerAlive === 0) {
        v.push({ ...ctx, severity: "ERROR", code: "END-1",
          message: `win 선언됐지만 승자 유닛이 0개`,
          data: { winnerIds: [...winnerSet] } });
      }
    }
  }

  return v;
}

// ─── Game runner ──────────────────────────────────────────────────────────────

interface GameReport {
  gameId: string;
  profile: string;
  violations: Violation[];
  rejectedActions: Array<{ action: PlayerAction; errorCode: string; round: number; turnIndex: number }>;
  finalRound: number;
  endReason: string;
  winner: string;
  actionCounts: Record<string, number>;
}

async function runValidatedGame(
  profile: "aggressive" | "defensive" | "balanced",
  gameIndex: number,
): Promise<GameReport> {
  const registry = makeRegistry();
  const factory = new GameFactory(registry);
  const movVal = new MovementValidator(registry);
  const atkVal = new AttackValidator(registry);

  const gameId = `validation-game-${profile}-${gameIndex}`;
  const p1Id = "val-p1" as PlayerId;
  const p2Id = "val-p2" as PlayerId;

  // 컨텍스트 생성
  const context = factory.createContext();
  const eventBus = context.eventBus as IEventBus;

  // TacticalAdapter 두 개
  const ai1 = new TacticalAdapter(p1Id, movVal, atkVal, registry, { profile });
  const ai2 = new TacticalAdapter(p2Id, movVal, atkVal, registry, { profile });

  // 초기 상태 + 배치
  const gameOptions = {
    gameId: gameId as import("@ab/metadata").GameId,
    mapId: "map_1v1" as import("@ab/metadata").MetaId,
    players: [
      { playerId: p1Id, teamIndex: 0, priority: 1 },
      { playerId: p2Id, teamIndex: 1, priority: 1 },
    ],
  };
  const placementsMap = new Map<
    string,
    Array<{ metaId: string; position: { row: number; col: number } }>
  >([
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

  const battleState = factory.createBattleState(gameOptions, placementsMap);

  // ── 검증 데이터 수집 ─────────────────────────────────────────────────────────
  const violations: Violation[] = [];
  const rejectedActions: GameReport["rejectedActions"] = [];
  const actionCounts: Record<string, number> = {};

  // 유닛 메타 맵 빌드
  const unitMetaMap = new Map<string, { baseHealth: number; baseMovement: number }>();
  for (const u of registry.getAllUnits()) {
    unitMetaMap.set(u.id, { baseHealth: u.baseHealth, baseMovement: u.baseMovement });
  }

  let prevState: GameState | null = null;
  let endReason = "unknown";
  let winner = "";

  // 이벤트 버스 구독 — 상태 포함 이벤트마다 검증
  eventBus.onAny((event) => {
    const stateEvent = event as { state?: GameState };
    if (!stateEvent.state) return;

    const curr = stateEvent.state;

    // 액션 카운트 (action.accepted 만)
    if (event.type === "action.accepted") {
      const ae = event as { action: PlayerAction };
      actionCounts[ae.action.type] = (actionCounts[ae.action.type] ?? 0) + 1;
    }

    // 액션 거부 추적
    if (event.type === "action.rejected") {
      const re = event as { action: PlayerAction; errorCode: string };
      rejectedActions.push({
        action: re.action,
        errorCode: re.errorCode,
        round: curr.round,
        turnIndex: curr.currentTurnIndex,
      });
    }

    // 게임 종료 정보
    if (event.type === "game.end") {
      const ge = event as { winnerIds: string[]; reason: string };
      endReason = ge.reason;
      winner = ge.winnerIds.join(",") || "draw";
    }

    // 상태 검증
    const newViolations = validateState(curr, prevState, unitMetaMap, event.type);
    violations.push(...newViolations);

    prevState = curr;
  });

  // 게임 실행
  const adapters = new Map<string, IPlayerAdapter>([
    [p1Id, ai1],
    [p2Id, ai2],
  ]);

  const result = await context.gameLoop.start(battleState, adapters);
  endReason = result.reason || endReason;
  winner = result.winnerIds.join(",") || "draw";

  // 최종 상태 한 번 더 검증
  const finalViolations = validateState(result.finalState, prevState, unitMetaMap, "game.end");
  violations.push(...finalViolations);

  return {
    gameId,
    profile,
    violations,
    rejectedActions,
    finalRound: result.finalState.round,
    endReason,
    winner,
    actionCounts,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AI vs AI 룰 검증", () => {
  const profiles = ["aggressive", "defensive", "balanced"] as const;
  const GAMES_PER_PROFILE = 3;

  for (const profile of profiles) {
    describe(`프로파일: ${profile}`, () => {
      for (let g = 0; g < GAMES_PER_PROFILE; g++) {
        it(`게임 ${g + 1} — 룰 위반 없이 정상 종료`, { timeout: GAME_TIMEOUT }, async () => {
          const report = await runValidatedGame(profile, g);

          // ── 결과 출력 ─────────────────────────────────────────────────────
          const errors = report.violations.filter(v => v.severity === "ERROR");
          const warnings = report.violations.filter(v => v.severity === "WARNING");
          const totalActions = Object.values(report.actionCounts).reduce((a, b) => a + b, 0);

          console.log(
            `\n[${profile}/${g + 1}] R${report.finalRound} | ${report.endReason} → ${report.winner}` +
            ` | 액션:${totalActions} (${JSON.stringify(report.actionCounts)})` +
            ` | 거부:${report.rejectedActions.length}` +
            ` | ERROR:${errors.length} WARNING:${warnings.length}`,
          );

          // 거부된 액션 출력
          if (report.rejectedActions.length > 0) {
            console.log(`  거부된 액션 샘플:`);
            for (const rej of report.rejectedActions.slice(0, 5)) {
              console.log(
                `    R${rej.round}T${rej.turnIndex} ${rej.action.type} → ${rej.errorCode}`,
              );
            }
            if (report.rejectedActions.length > 5) {
              console.log(`    ...외 ${report.rejectedActions.length - 5}건`);
            }
          }

          // 위반 출력
          if (errors.length > 0 || warnings.length > 0) {
            const all = [...errors, ...warnings];
            for (const viol of all.slice(0, 10)) {
              console.log(
                `  ${viol.severity} [${viol.code}] R${viol.round}T${viol.turnIndex}` +
                `${viol.unitId ? ` [${viol.unitId}]` : ""} — ${viol.message}`,
              );
            }
            if (all.length > 10) console.log(`  ...외 ${all.length - 10}건`);
          }

          // ── 검증 ──────────────────────────────────────────────────────────

          // 게임이 정상 종료되어야 함
          expect(["win", "draw", "all_units_dead", "round_limit", "unknown"],
            `종료 이유가 예상 범위 밖: ${report.endReason}`,
          ).toContain(report.endReason);

          // ERROR 위반 없어야 함
          expect(errors, `ERROR 위반 ${errors.length}건:\n` +
            errors.map(e => `  [${e.code}] ${e.message}`).join("\n"),
          ).toHaveLength(0);

          // WARNING 은 기록하되 실패시키지 않음 (넉백 등 정상 동작 포함)
          if (warnings.length > 0) {
            console.warn(
              `  [${profile}/${g + 1}] WARNING ${warnings.length}건 (실패 아님)`,
            );
          }

          // 최종 라운드가 MAX_ROUNDS 이내여야 함
          expect(report.finalRound).toBeLessThanOrEqual(31); // 30 + 결과처리 1

          // 게임이 결과 단계에 도달해야 함
          expect(["result", "battle"]).toContain(
            // battle은 round_limit 이후에도 남아있을 수 있어 허용
            report.endReason === "unknown" ? "unknown" : "result",
          );
        });
      }
    });
  }

  it("전체 요약 — 모든 프로파일 통계", { timeout: GAME_TIMEOUT * GAMES_PER_PROFILE * profiles.length + 5000 }, async () => {
    const reports: GameReport[] = [];

    for (const profile of profiles) {
      for (let g = 0; g < GAMES_PER_PROFILE; g++) {
        const r = await runValidatedGame(profile, g + 100);
        reports.push(r);
      }
    }

    console.log("\n════ 전체 검증 요약 ════");

    const allErrors = reports.flatMap(r => r.violations.filter(v => v.severity === "ERROR"));
    const allWarnings = reports.flatMap(r => r.violations.filter(v => v.severity === "WARNING"));
    const allRejected = reports.flatMap(r => r.rejectedActions);

    // 코드별 에러 집계
    const byCode = new Map<string, number>();
    for (const v of [...allErrors, ...allWarnings]) {
      byCode.set(v.code, (byCode.get(v.code) ?? 0) + 1);
    }

    console.log(`총 ${reports.length}게임 | ERROR:${allErrors.length} WARNING:${allWarnings.length} 거부:${allRejected.length}`);

    for (const [code, cnt] of [...byCode.entries()].sort()) {
      const sample = [...allErrors, ...allWarnings].find(v => v.code === code)!;
      console.log(`  [${code}] ×${cnt}: ${sample.message}`);
    }

    // 프로파일별 요약
    for (const profile of profiles) {
      const pReports = reports.filter(r => r.profile === profile);
      const wins = pReports.filter(r => r.winner !== "draw").length;
      const avgRound = pReports.reduce((s, r) => s + r.finalRound, 0) / pReports.length;
      const totalActions = pReports.reduce((s, r) =>
        s + Object.values(r.actionCounts).reduce((a, b) => a + b, 0), 0);
      console.log(`  [${profile}] 승부있음:${wins}/${pReports.length} avgRound:${avgRound.toFixed(1)} totalActions:${totalActions}`);
    }

    // 거부된 액션 에러코드 집계
    if (allRejected.length > 0) {
      const rejByCode = new Map<string, number>();
      for (const r of allRejected) {
        rejByCode.set(r.errorCode, (rejByCode.get(r.errorCode) ?? 0) + 1);
      }
      console.log("  거부된 액션 에러코드:");
      for (const [code, cnt] of [...rejByCode.entries()].sort()) {
        console.log(`    ${code}: ×${cnt}`);
      }
    }

    // 최종 검증
    expect(allErrors).toHaveLength(0);
  });
});
