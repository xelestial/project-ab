/**
 * tactical-adapter.ts — BG3/DOS2 스타일 유틸리티 AI 어댑터.
 *
 * IPlayerAdapter 구현체.
 * MCTS 대신 순수 유틸리티 함수 기반으로 <200ms 내 결정.
 *
 * requestAction() 파이프라인:
 *   [1] 위협 맵 빌드
 *   [2] 콤보 컨텍스트 빌드
 *   [3] 후보 액션 생성
 *   [4] 행동 오버라이드 확인 (즉사/화재/후퇴)
 *   [5] 유틸리티 점수 계산
 *   [6] 최고 점수 액션 반환 (동점 시 결정론적 타이브레이크)
 *
 * requestUnitOrder() 파이프라인:
 *   UnitOrderPlanner → 공격 가능 유닛 우선, 클래스 기반 정렬
 */

import type { GameState, PlayerAction, PlayerId, UnitId } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type {
  IPlayerAdapter,
  IMovementValidator,
  IAttackValidator,
} from "@ab/engine";
import { getPlayerUnits, getAliveUnits } from "@ab/engine";

import type { ProfileName } from "./profiles/weight-profile.js";
import { getWeightProfile } from "./profiles/weight-profile.js";
import { buildThreatMap } from "./core/threat-map.js";
import { generateCandidates } from "./core/candidate-generator.js";
import { scoreCandidate } from "./core/utility-scorer.js";
import { applyBehaviorOverride } from "./core/behavior-override.js";
import { planUnitOrder } from "./core/unit-order-planner.js";
import { buildComboContext } from "./elemental/combo-detector.js";

// ─── 옵션 ─────────────────────────────────────────────────────────────────────

export interface TacticalAdapterOptions {
  /** 가중치 프로파일 이름 (default: "balanced") */
  profile?: ProfileName;
}

const DEFAULT_OPTIONS: Required<TacticalAdapterOptions> = {
  profile: "balanced",
};

// ─── 어댑터 ───────────────────────────────────────────────────────────────────

export class TacticalAdapter implements IPlayerAdapter {
  readonly type = "ai" as const;

  private readonly opts: Required<TacticalAdapterOptions>;

  constructor(
    readonly playerId: string,
    private readonly movementValidator: IMovementValidator,
    private readonly attackValidator: IAttackValidator,
    private readonly registry: IDataRegistry,
    options: TacticalAdapterOptions = {},
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  // ─── IPlayerAdapter 구현 ──────────────────────────────────────────────────

  async requestDraftPlacement(
    state: GameState,
    _timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    const pool = state.draft?.poolIds ?? [];
    const firstUnit = pool[0];
    if (firstUnit === undefined) throw new Error("Empty draft pool");

    const draftedIds = new Set(state.draft?.slots.map((s) => s.metaId) ?? []);
    const available = pool.find((id) => !draftedIds.has(id)) ?? firstUnit;

    return {
      type: "draft_place",
      playerId: this.playerId as PlayerId,
      unitId: "" as UnitId,
      metaId: available,
      position: { row: 0, col: 0 },
    };
  }

  async requestAction(state: GameState, _timeoutMs?: number): Promise<PlayerAction> {
    const profile = getWeightProfile(this.opts.profile);

    // 현재 턴 슬롯 확인
    const slot = state.turnOrder[state.currentTurnIndex];
    const activeUnitId = slot?.unitId;

    // 현재 유닛 조회
    const myUnits = getPlayerUnits(state, this.playerId).filter(
      (u) => u.alive && (activeUnitId === undefined || u.unitId === activeUnitId),
    );

    if (myUnits.length === 0) return this.makePass(state);

    const unit = myUnits[0]!;

    // [1] 위협 맵
    const enemies = getAliveUnits(state).filter((u) => u.playerId !== this.playerId);
    const threatMap = buildThreatMap(enemies, state, this.registry, this.attackValidator);

    // [2] 콤보 컨텍스트
    const allies = getAliveUnits(state).filter(
      (u) => u.playerId === this.playerId && u.unitId !== unit.unitId,
    );
    const comboCtx = buildComboContext(unit, enemies, allies, state, this.registry);

    // [3] 후보 액션 생성
    const candidates = generateCandidates(unit, state, this.movementValidator, this.attackValidator);

    if (candidates.length === 0) return this.makePass(state);

    // [4] 유틸리티 점수 계산
    const scored = candidates.map((c) =>
      scoreCandidate(c, unit, state, this.registry, profile, threatMap, comboCtx),
    );

    // [5] 행동 오버라이드 확인
    const override = applyBehaviorOverride(scored, unit, profile, this.registry);
    if (override !== null) {
      return this.candidateToAction(override.candidate, unit);
    }

    // [6] 최고 점수 선택 (동점 시 결정론적 타이브레이크)
    const best = pickBest(scored);
    return this.candidateToAction(best.candidate, unit);
  }

  async requestUnitOrder(
    state: GameState,
    aliveUnitIds: UnitId[],
    _timeoutMs: number,
  ): Promise<UnitId[]> {
    return planUnitOrder(aliveUnitIds, state, this.registry, this.attackValidator);
  }

  onStateUpdate(_state: GameState): void {
    // 향후 상태 캐싱에 활용 가능
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────────────────────────

  private candidateToAction(
    candidate: import("./core/candidate-generator.js").ActionCandidate,
    unit: import("@ab/metadata").UnitState,
  ): PlayerAction {
    const pid = this.playerId as PlayerId;
    switch (candidate.kind) {
      case "attack":
        return {
          type: "attack",
          playerId: pid,
          unitId: unit.unitId,
          target: candidate.target,
        };
      case "move_attack":
        // 이동+공격: 먼저 이동 액션을 반환 (다음 턴에 공격)
        // 게임 루프는 이동 후 다시 requestAction을 호출하므로
        // 이동 후 공격은 자연스럽게 2번 호출로 처리됨
        return {
          type: "move",
          playerId: pid,
          unitId: unit.unitId,
          destination: candidate.destination,
        };
      case "move":
        return {
          type: "move",
          playerId: pid,
          unitId: unit.unitId,
          destination: candidate.destination,
        };
      case "extinguish":
        return {
          type: "extinguish",
          playerId: pid,
          unitId: unit.unitId,
        };
      case "pass":
        return {
          type: "pass",
          playerId: pid,
          unitId: unit.unitId,
        };
    }
  }

  private makePass(state: GameState): PlayerAction {
    const unit = getPlayerUnits(state, this.playerId).find((u) => u.alive);
    return {
      type: "pass",
      playerId: this.playerId as PlayerId,
      unitId: (unit?.unitId ?? "") as UnitId,
    };
  }
}

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

/**
 * 최고 점수 후보 선택.
 * 동점 시 action type 우선순위로 결정론적 선택:
 *   attack > move_attack > extinguish > move > pass
 */
function pickBest(
  scored: import("./core/utility-scorer.js").ScoredCandidate[],
): import("./core/utility-scorer.js").ScoredCandidate {
  const ACTION_TYPE_ORDER: Record<string, number> = {
    attack: 0,
    move_attack: 1,
    extinguish: 2,
    move: 3,
    pass: 4,
  };

  return scored.reduce((best, current) => {
    if (current.score > best.score) return current;
    if (current.score === best.score) {
      const bestOrder = ACTION_TYPE_ORDER[best.candidate.kind] ?? 9;
      const currOrder = ACTION_TYPE_ORDER[current.candidate.kind] ?? 9;
      if (currOrder < bestOrder) return current;
    }
    return best;
  });
}
