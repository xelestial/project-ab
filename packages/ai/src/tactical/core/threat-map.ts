/**
 * threat-map.ts — 위험 그리드 빌더.
 *
 * 적 유닛들의 현재 위치에서 공격 가능한 타일을 수집해
 * 정규화된 위험도 [0,1] 그리드를 반환한다.
 *
 * 설계 원칙:
 *   - 현재 위치 공격 범위: 가중치 1.0
 *   - 이동 후 공격 가능 범위 (최대 8타일 미리 보기): 가중치 0.5
 *   - 중복 타일은 가산 후 clamp [0,1]
 */

import type { GameState, UnitState, Position } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IAttackValidator } from "@ab/engine";
import { orthogonalNeighbors, getUnitAt } from "@ab/engine";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ThreatMap {
  /** [0,1] 위험도. 0 = 안전, 1 = 고위험. */
  getDanger(pos: Position): number;
  /** 디버그 / 시각화용 원시 그리드 */
  getRawGrid(): number[][];
}

// ─── 빌더 ─────────────────────────────────────────────────────────────────────

export function buildThreatMap(
  enemies: UnitState[],
  state: GameState,
  _registry: IDataRegistry,
  attackValidator: IAttackValidator,
): ThreatMap {
  const gs = state.map.gridSize;
  // raw[row][col] = 누적 위험도 (clamp 전)
  const raw: number[][] = Array.from({ length: gs }, () => new Array<number>(gs).fill(0));

  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    // 1. 현재 위치에서 공격 가능한 타일 (가중치 1.0)
    const immediateTargets = attackValidator.getAttackableTargets(enemy, state);
    for (const pos of immediateTargets) {
      raw[pos.row]![pos.col]! += 1.0;
    }

    // 2. 이동 후 공격 범위 예측 (가중치 0.5, 최대 8타일 미리 보기)
    //    적이 아직 이동하지 않은 경우에만 계산
    if (!enemy.actionsUsed.moved) {
      const movePreviews = getAdjacentMovePositions(enemy, state, 8);
      for (const dest of movePreviews) {
        // 적이 dest로 이동했다고 가정한 임시 상태 생성
        const tempState = simulateEnemyMove(enemy, dest, state);
        const targetsAfterMove = attackValidator.getAttackableTargets(
          { ...enemy, position: dest, actionsUsed: { ...enemy.actionsUsed, moved: true } },
          tempState,
        );
        for (const pos of targetsAfterMove) {
          raw[pos.row]![pos.col]! += 0.5;
        }
      }
    }
  }

  // 최대값으로 정규화
  let maxVal = 0;
  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      if (raw[r]![c]! > maxVal) maxVal = raw[r]![c]!;
    }
  }

  // 정규화 (maxVal=0이면 모두 0)
  const normalized: number[][] = Array.from({ length: gs }, (_, r) =>
    Array.from({ length: gs }, (__, c) =>
      maxVal > 0 ? Math.min(raw[r]![c]! / maxVal, 1) : 0,
    ),
  );

  return {
    getDanger(pos: Position): number {
      return normalized[pos.row]?.[pos.col] ?? 0;
    },
    getRawGrid(): number[][] {
      return normalized;
    },
  };
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * 적이 이동할 수 있는 인접 타일을 최대 `limit`개 반환.
 * 실제 이동 검증 대신 간단한 BFS로 빠른 근사치 계산.
 */
function getAdjacentMovePositions(
  enemy: UnitState,
  state: GameState,
  limit: number,
): Position[] {
  const gs = state.map.gridSize;
  const neighbors = orthogonalNeighbors(enemy.position, gs);
  const result: Position[] = [];

  for (const n of neighbors) {
    if (result.length >= limit) break;
    // 이미 다른 유닛이 있으면 스킵
    if (getUnitAt(state, n) !== undefined) continue;
    result.push(n);
  }

  return result;
}

/**
 * 적이 dest로 이동했다고 가정한 임시 상태 (위치만 변경).
 * 실제 게임 상태 변경 없이 참조 수준의 경량 복사.
 */
function simulateEnemyMove(
  enemy: UnitState,
  dest: Position,
  state: GameState,
): GameState {
  return {
    ...state,
    units: {
      ...state.units,
      [enemy.unitId]: { ...enemy, position: dest },
    },
  };
}
