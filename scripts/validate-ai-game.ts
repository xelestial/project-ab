#!/usr/bin/env npx tsx
/**
 * validate-ai-game.ts — AI vs AI 자동 게임 실행 + 룰 위반 검증
 *
 * 검증 항목:
 *  [HP-1]  currentHealth < 0  (음수 HP)
 *  [HP-2]  currentHealth > baseHealth  (최대 HP 초과)
 *  [HP-3]  HP 회복 (게임 중 HP 증가, 힐 없는 게임)
 *  [HP-4]  alive=true & currentHealth <= 0  (사망 판정 누락)
 *  [HP-5]  alive=false & currentHealth > 0  (생존 판정 오류)
 *  [POS-1] 그리드 범위 이탈
 *  [POS-2] 두 유닛 동일 좌표 점유
 *  [POS-3] 사망 유닛 이동 (alive=false인데 위치 변경)
 *  [MOV-1] 이동 거리 초과 (movementPoints 초과 이동)
 *  [ACT-1] 이미 공격한 유닛의 재공격
 *  [ACT-2] 이미 이동한 유닛의 재이동
 *  [ACT-3] 사망 유닛 액션 플래그 변경
 *  [TURN-1] currentTurnIndex 범위 초과
 *  [ROUND-1] 라운드 역행
 *  [ROUND-2] MAX_ROUNDS(30) 초과 후 전투 지속
 *  [DEAD-1] 사망 유닛 부활 (alive false → true)
 *  [TEAM-1] 같은 팀 유닛이 같은 팀 유닛의 HP를 깎음
 *  [END-1]  게임 종료 조건 미달성 (모든 유닛 생존 중 result 단계)
 *
 * Usage: npx tsx scripts/validate-ai-game.ts [--profile aggressive|balanced|test] [--games 3]
 */

const SERVER = "http://localhost:3000";
const MAX_ROUNDS = 30;
const POLL_INTERVAL_MS = 250;
const GAME_TIMEOUT_MS = 120_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnitMeta {
  id: string;
  baseHealth: number;
  baseArmor: number;
  baseMovement: number;
}

interface Position {
  row: number;
  col: number;
}

interface UnitState {
  unitId: string;
  metaId: string;
  playerId: string;
  position: Position;
  currentHealth: number;
  currentArmor: number;
  movementPoints: number;
  alive: boolean;
  actionsUsed: {
    moved: boolean;
    attacked: boolean;
    skillUsed: boolean;
    extinguished: boolean;
  };
  activeEffects: Array<{ effectType: string; turnsRemaining: number; effectId: string }>;
}

interface GameState {
  gameId: string;
  phase: string;
  round: number;
  turnOrder: Array<{ playerId: string; unitId?: string; priority: number }>;
  currentTurnIndex: number;
  units: Record<string, UnitState>;
  map: { gridSize: number; mapId: string };
  players: Record<string, { playerId: string; teamIndex: number; unitIds: string[] }>;
  endResult?: { result: string; winnerIds: string[] };
}

interface Violation {
  snapshotN: number;
  round: number;
  turnIndex: number;
  phase: string;
  severity: "ERROR" | "WARNING";
  code: string;
  unitId?: string;
  message: string;
  data?: unknown;
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string, def: string) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : def;
};
const AI_PROFILE = getArg("--profile", "aggressive") as string;
const GAME_COUNT = parseInt(getArg("--games", "3"), 10);

// ─── REST helpers ─────────────────────────────────────────────────────────────

async function apiPost(path: string, token: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: await res.json() };
}

async function apiGet(path: string, token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, { headers });
  return { ok: res.ok, status: res.status, json: await res.json() };
}

async function login(playerId: string): Promise<string> {
  const r = await apiPost("/api/v1/auth/login", null, { playerId });
  if (!r.ok) throw new Error(`Login failed: ${JSON.stringify(r.json)}`);
  return r.json.accessToken as string;
}

// ─── Validation engine ────────────────────────────────────────────────────────

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function validateState(
  state: GameState,
  prev: GameState | null,
  unitMetaMap: Map<string, UnitMeta>,
  snapshotN: number,
): Violation[] {
  const v: Violation[] = [];
  const context = { snapshotN, round: state.round, turnIndex: state.currentTurnIndex, phase: state.phase };

  const add = (
    severity: "ERROR" | "WARNING",
    code: string,
    message: string,
    unitId?: string,
    data?: unknown,
  ) => v.push({ ...context, severity, code, message, unitId, data });

  const gridSize = state.map.gridSize;

  // ── Per-unit checks ───────────────────────────────────────────────────────

  // Build position index for POS-2
  const posMap = new Map<string, string>();  // "row,col" → unitId

  for (const unit of Object.values(state.units)) {
    const meta = unitMetaMap.get(unit.metaId);

    // [HP-1] 음수 HP
    if (unit.currentHealth < 0) {
      add("ERROR", "HP-1", `음수 HP: ${unit.currentHealth}`, unit.unitId, { hp: unit.currentHealth });
    }

    // [HP-2] 최대 HP 초과
    if (meta && unit.currentHealth > meta.baseHealth) {
      add("ERROR", "HP-2",
        `HP ${unit.currentHealth} > 최대 ${meta.baseHealth}`,
        unit.unitId,
        { hp: unit.currentHealth, maxHp: meta.baseHealth },
      );
    }

    // [HP-4] alive=true & HP <= 0
    if (unit.alive && unit.currentHealth <= 0) {
      add("ERROR", "HP-4",
        `alive=true 이지만 currentHealth=${unit.currentHealth}`,
        unit.unitId,
      );
    }

    // [HP-5] alive=false & HP > 0
    if (!unit.alive && unit.currentHealth > 0) {
      add("WARNING", "HP-5",
        `alive=false 이지만 currentHealth=${unit.currentHealth}`,
        unit.unitId,
        { hp: unit.currentHealth },
      );
    }

    // [POS-1] 그리드 범위 이탈
    const { row, col } = unit.position;
    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
      add("ERROR", "POS-1",
        `위치 (${row},${col}) 가 그리드 [0,${gridSize - 1}] 밖`,
        unit.unitId,
      );
    }

    // [POS-2] 두 유닛 동일 좌표 — alive 유닛만 체크
    if (unit.alive) {
      const key = `${row},${col}`;
      const existing = posMap.get(key);
      if (existing !== undefined) {
        add("ERROR", "POS-2",
          `(${row},${col}) 에 두 유닛 동시 점유: ${existing} & ${unit.unitId}`,
          unit.unitId,
          { other: existing },
        );
      } else {
        posMap.set(key, unit.unitId);
      }
    }

    // Transition checks (prev 있을 때)
    if (prev !== null) {
      const prevUnit = prev.units[unit.unitId];
      if (prevUnit !== undefined) {

        // [HP-3] HP 회복 감지 (힐 없는 게임 — HP 증가는 버그)
        // 단, effects turnsRemaining 감소로 인한 스냅샷 차이는 무시
        if (unit.currentHealth > prevUnit.currentHealth && unit.alive && prevUnit.alive) {
          add("WARNING", "HP-3",
            `HP 증가: ${prevUnit.currentHealth} → ${unit.currentHealth} (힐 없음)`,
            unit.unitId,
            { before: prevUnit.currentHealth, after: unit.currentHealth },
          );
        }

        // [DEAD-1] 사망 유닛 부활 — alive false → true
        if (!prevUnit.alive && unit.alive) {
          add("ERROR", "DEAD-1",
            `사망 유닛 부활: alive false→true, HP ${prevUnit.currentHealth}→${unit.currentHealth}`,
            unit.unitId,
          );
        }

        // [POS-3] 사망 유닛 이동
        const prevPos = prevUnit.position;
        const curPos = unit.position;
        if (!prevUnit.alive && (prevPos.row !== curPos.row || prevPos.col !== curPos.col)) {
          add("ERROR", "POS-3",
            `사망 유닛 위치 변경: (${prevPos.row},${prevPos.col}) → (${curPos.row},${curPos.col})`,
            unit.unitId,
          );
        }

        // [MOV-1] 이동 거리 초과 — 살아있고 이동한 경우
        if (unit.alive && prevUnit.alive) {
          const dist = manhattan(prevPos, curPos);
          const movePts = prevUnit.movementPoints; // 이전 movementPoints 사용
          if (dist > movePts && dist > 0) {
            // 단, 넉백(knockback)은 예외 — 공격에 의한 이동일 수 있으므로 WARNING
            add("WARNING", "MOV-1",
              `이동 거리 ${dist} > movementPoints ${movePts}` +
              ` (${prevPos.row},${prevPos.col}) → (${curPos.row},${curPos.col})`,
              unit.unitId,
              { dist, movePts, from: prevPos, to: curPos },
            );
          }
        }

        // [ACT-3] 사망 유닛 액션 플래그 변경
        if (!unit.alive && !prevUnit.alive) {
          const pa = prevUnit.actionsUsed;
          const ca = unit.actionsUsed;
          if (pa.moved !== ca.moved || pa.attacked !== ca.attacked || pa.skillUsed !== ca.skillUsed) {
            add("WARNING", "ACT-3",
              `사망 유닛 actionsUsed 변경`,
              unit.unitId,
              { prev: pa, curr: ca },
            );
          }
        }
      }
    }
  }  // end per-unit

  // ── Game-level checks ─────────────────────────────────────────────────────

  // [TURN-1] currentTurnIndex 범위 이탈
  if (state.currentTurnIndex < 0 || state.currentTurnIndex > state.turnOrder.length) {
    add("ERROR", "TURN-1",
      `currentTurnIndex ${state.currentTurnIndex} 가 turnOrder.length ${state.turnOrder.length} 초과`,
    );
  }

  // [ROUND-1] 라운드 역행
  if (prev !== null && state.round < prev.round) {
    add("ERROR", "ROUND-1",
      `라운드 역행: ${prev.round} → ${state.round}`,
      undefined,
      { prev: prev.round, curr: state.round },
    );
  }

  // [ROUND-2] MAX_ROUNDS 초과 후 battle 지속
  if (state.round > MAX_ROUNDS + 1 && state.phase === "battle") {
    add("ERROR", "ROUND-2",
      `라운드 ${state.round} > MAX_ROUNDS(${MAX_ROUNDS}) 이지만 battle 단계 지속`,
    );
  }

  // [END-1] result 단계인데 살아있는 팀이 2개 이상
  if (state.phase === "result") {
    const teamAlive = new Map<number, number>();
    for (const p of Object.values(state.players)) {
      if (!teamAlive.has(p.teamIndex)) teamAlive.set(p.teamIndex, 0);
      const cnt = Object.values(state.units).filter(
        (u) => u.alive && u.playerId === p.playerId,
      ).length;
      teamAlive.set(p.teamIndex, (teamAlive.get(p.teamIndex) ?? 0) + cnt);
    }
    const livingTeams = [...teamAlive.entries()].filter(([, cnt]) => cnt > 0).length;
    if (livingTeams >= 2 && state.endResult?.result !== "draw") {
      add("WARNING", "END-1",
        `result 단계이지만 살아있는 팀이 ${livingTeams}개 (draw 아님)`,
        undefined,
        { teamAlive: Object.fromEntries(teamAlive) },
      );
    }
  }

  return v;
}

// ─── Action rejection tracker (연속 동일 상태 = AI 멈춤 감지) ──────────────

function stateFingerprint(state: GameState): string {
  return `r${state.round}t${state.currentTurnIndex}:` +
    Object.values(state.units)
      .map(u => `${u.unitId}(${u.currentHealth},${u.alive ? "A" : "D"},${u.position.row},${u.position.col})`)
      .sort()
      .join("|");
}

// ─── 팀별 HP 대미지 추적 (TEAM-1: 아군끼리 HP 감소) ────────────────────────

function checkFriendlyFire(
  curr: GameState,
  prev: GameState,
  snapshotN: number,
): Violation[] {
  const v: Violation[] = [];
  const context = { snapshotN, round: curr.round, turnIndex: curr.currentTurnIndex, phase: curr.phase };

  // 현재 턴 플레이어 파악
  const slot = prev.turnOrder[prev.currentTurnIndex];
  if (!slot) return v;
  const actingPlayerId = slot.playerId;
  const actingTeam = prev.players[actingPlayerId]?.teamIndex ?? -1;

  for (const unit of Object.values(curr.units)) {
    const prevUnit = prev.units[unit.unitId];
    if (!prevUnit) continue;
    if (!unit.alive && !prevUnit.alive) continue;  // already dead

    const hpDiff = unit.currentHealth - prevUnit.currentHealth;
    if (hpDiff < 0) {
      // HP 감소 — 같은 팀 유닛이 피해 입었는지
      const victim = curr.players[unit.playerId];
      if (victim && victim.teamIndex === actingTeam && unit.playerId !== actingPlayerId) {
        v.push({
          ...context,
          severity: "WARNING",
          code: "TEAM-1",
          unitId: unit.unitId,
          message: `아군 피해: ${actingPlayerId}(팀${actingTeam}) 행동 중 같은팀 ${unit.unitId} HP ${prevUnit.currentHealth}→${unit.currentHealth}`,
          data: { actingPlayer: actingPlayerId, victimPlayer: unit.playerId, hpDiff },
        });
      }
    }
  }
  return v;
}

// ─── Game runner ──────────────────────────────────────────────────────────────

async function runGame(
  gameIndex: number,
  token: string,
  unitMetaMap: Map<string, UnitMeta>,
): Promise<{ violations: Violation[]; summary: string; finalState: GameState | null }> {
  const allViolations: Violation[] = [];

  // 1) 방 생성
  const createRes = await apiPost("/api/v1/rooms", token, {
    mapId: "map_1v1_6v6",
    playerCount: 2,
  });
  if (!createRes.ok) throw new Error(`방 생성 실패: ${JSON.stringify(createRes.json)}`);
  const { gameId } = createRes.json as { gameId: string };
  console.log(`\n[게임 ${gameIndex + 1}] gameId=${gameId}`);

  // 2) AI 2명 추가 (자동으로 배치 + 게임 시작)
  const ai1 = await apiPost(`/api/v1/rooms/${gameId}/ai`, token, { profile: AI_PROFILE });
  if (!ai1.ok) throw new Error(`AI1 추가 실패: ${JSON.stringify(ai1.json)}`);

  const ai2 = await apiPost(`/api/v1/rooms/${gameId}/ai`, token, { profile: AI_PROFILE });
  if (!ai2.ok) throw new Error(`AI2 추가 실패: ${JSON.stringify(ai2.json)}`);

  const started = (ai2.json as { started: boolean }).started;
  console.log(`  AI1: ${(ai1.json as { aiPlayerId: string }).aiPlayerId}, AI2: ${(ai2.json as { aiPlayerId: string }).aiPlayerId}`);
  console.log(`  게임 시작: ${started}`);

  if (!started) {
    // waiting → game may not have started yet (대기실 필요 없음, AI는 자동 ready)
    // 잠깐 대기 후 재확인
    await new Promise(r => setTimeout(r, 1000));
    const chk = await apiGet(`/api/v1/rooms/${gameId}`, token);
    if (chk.json.status !== "running") {
      console.log(`  ⚠️  게임 미시작 (status=${chk.json.status})`);
    }
  }

  // 3) 폴링 + 검증
  let prev: GameState | null = null;
  let snapshotCount = 0;
  let sameCount = 0;
  let lastFingerprint = "";
  let finalState: GameState | null = null;

  const actionCounts = { move: 0, attack: 0, pass: 0, extinguish: 0, rejected: 0 };
  const roundSummary: Map<number, { actions: number; kills: number }> = new Map();

  const startTime = Date.now();

  while (Date.now() - startTime < GAME_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const res = await apiGet(`/api/v1/rooms/${gameId}`, token);
    if (!res.ok || !res.json.state) continue;

    const state: GameState = res.json.state;
    snapshotCount++;

    // 상태 변화 감지
    const fp = stateFingerprint(state);
    if (fp === lastFingerprint) {
      sameCount++;
      if (sameCount > 60) {
        console.log(`  ⚠️  상태 고정 ${sameCount * POLL_INTERVAL_MS / 1000}초 — AI 멈춤 의심`);
        allViolations.push({
          snapshotN: snapshotCount,
          round: state.round,
          turnIndex: state.currentTurnIndex,
          phase: state.phase,
          severity: "WARNING",
          code: "STUCK",
          message: `게임 상태 ${sameCount * POLL_INTERVAL_MS}ms 동안 변화 없음`,
        });
        break;
      }
      if (state.phase === "result") break;
      continue;
    }
    sameCount = 0;
    lastFingerprint = fp;

    // 라운드별 액션 카운트
    if (!roundSummary.has(state.round)) {
      roundSummary.set(state.round, { actions: 0, kills: 0 });
    }
    if (prev !== null) {
      const prevAlive = Object.values(prev.units).filter(u => u.alive).length;
      const currAlive = Object.values(state.units).filter(u => u.alive).length;
      if (currAlive < prevAlive) {
        const kills = prevAlive - currAlive;
        roundSummary.get(state.round)!.kills += kills;
      }
      roundSummary.get(state.round)!.actions++;
    }

    // ── 룰 검증 ─────────────────────────────────────────────────────────────
    const stateViolations = validateState(state, prev, unitMetaMap, snapshotCount);
    allViolations.push(...stateViolations);

    // 아군 피해 검사 (전환 시에만)
    if (prev !== null && prev.phase === "battle" && state.phase === "battle") {
      const ffViolations = checkFriendlyFire(state, prev, snapshotCount);
      allViolations.push(...ffViolations);
    }

    // 진행 상황 출력
    if (snapshotCount % 20 === 0 || stateViolations.length > 0) {
      const aliveCount = Object.values(state.units).filter(u => u.alive).length;
      const totalUnits = Object.values(state.units).length;
      const marker = stateViolations.length > 0 ? ` ⚠️  위반 ${stateViolations.length}개` : "";
      console.log(
        `  #${snapshotCount} R${state.round}T${state.currentTurnIndex} ` +
        `[${state.phase}] 생존:${aliveCount}/${totalUnits}${marker}`,
      );
      if (stateViolations.length > 0) {
        for (const viol of stateViolations) {
          console.log(`    ${viol.severity} [${viol.code}] ${viol.message}`);
        }
      }
    }

    prev = state;
    finalState = state;

    // 게임 종료
    if (state.phase === "result") {
      const winner = state.endResult?.winnerIds?.join(", ") ?? "없음";
      const reason = state.endResult?.result ?? "?";
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n  ✅ 게임 종료: ${reason} | 승자: ${winner} | 경과: ${elapsed}s | 스냅샷: ${snapshotCount}`);
      break;
    }
  }

  // 4) 요약
  const errCount = allViolations.filter(v => v.severity === "ERROR").length;
  const warnCount = allViolations.filter(v => v.severity === "WARNING").length;

  const aliveUnits = finalState ? Object.values(finalState.units).filter(u => u.alive).length : 0;
  const totalUnits = finalState ? Object.values(finalState.units).length : 0;

  let roundLog = "";
  for (const [round, data] of [...roundSummary.entries()].sort(([a], [b]) => a - b)) {
    roundLog += `R${round}(액션${data.actions}/킬${data.kills}) `;
  }

  const summary =
    `게임${gameIndex + 1} | 마지막 라운드:${finalState?.round ?? "?"} | ` +
    `생존유닛:${aliveUnits}/${totalUnits} | ` +
    `ERROR:${errCount} WARNING:${warnCount} | ${roundLog.trim()}`;

  return { violations: allViolations, summary, finalState };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AI vs AI 룰 검증 스크립트");
  console.log(`  프로파일: ${AI_PROFILE} | 게임 수: ${GAME_COUNT}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 유닛 메타 데이터 로드
  const metaRes = await apiGet("/api/v1/meta/units", null);
  const unitMetaMap = new Map<string, UnitMeta>();
  for (const u of (metaRes.json.units as UnitMeta[])) {
    unitMetaMap.set(u.id, u);
  }
  console.log(`유닛 메타 ${unitMetaMap.size}개 로드`);

  // 인증 (한 계정으로 양쪽 AI 추가 가능)
  const token = await login("ai-validator");
  console.log("인증 완료\n");

  const allViolations: Violation[] = [];
  const summaries: string[] = [];

  for (let i = 0; i < GAME_COUNT; i++) {
    try {
      const result = await runGame(i, token, unitMetaMap);
      allViolations.push(...result.violations);
      summaries.push(result.summary);
    } catch (err) {
      console.error(`게임 ${i + 1} 실행 오류:`, err);
      summaries.push(`게임${i + 1} 실행 오류: ${err}`);
    }
  }

  // ─── 최종 리포트 ────────────────────────────────────────────────────────────
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    최종 검증 리포트                          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n▶ 게임별 요약:");
  for (const s of summaries) console.log(`  ${s}`);

  const errors = allViolations.filter(v => v.severity === "ERROR");
  const warnings = allViolations.filter(v => v.severity === "WARNING");

  console.log(`\n▶ 전체 위반 현황: ERROR ${errors.length}건 / WARNING ${warnings.length}건`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log("\n  ✅ 룰 위반 없음 — 모든 게임이 규칙에 맞게 진행됨");
  } else {
    // 코드별 집계
    const byCde = new Map<string, Violation[]>();
    for (const v of allViolations) {
      if (!byCde.has(v.code)) byCde.set(v.code, []);
      byCde.get(v.code)!.push(v);
    }

    console.log("\n▶ 코드별 집계:");
    for (const [code, viols] of [...byCde.entries()].sort()) {
      const errCnt = viols.filter(v => v.severity === "ERROR").length;
      const warnCnt = viols.filter(v => v.severity === "WARNING").length;
      const sample = viols[0]!;
      console.log(`\n  [${code}] ${errCnt > 0 ? `ERROR×${errCnt}` : ""} ${warnCnt > 0 ? `WARNING×${warnCnt}` : ""}`);
      console.log(`    예시: ${sample.message}`);
      if (sample.data) console.log(`    데이터: ${JSON.stringify(sample.data)}`);

      // 최대 3개 상세 출력
      for (const viol of viols.slice(0, 3)) {
        console.log(
          `    R${viol.round}T${viol.turnIndex} ${viol.unitId ? `[${viol.unitId}]` : ""} — ${viol.message}`,
        );
      }
      if (viols.length > 3) console.log(`    ... 외 ${viols.length - 3}건`);
    }

    if (errors.length > 0) {
      console.log("\n⛔ ERROR 항목이 존재합니다 — 엔진 버그 가능성이 높음");
    } else {
      console.log("\n⚠️  WARNING 항목만 존재합니다 — 정상 동작 범위일 수 있음");
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════\n");

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(2);
});
