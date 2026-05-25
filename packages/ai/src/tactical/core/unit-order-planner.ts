/**
 * unit-order-planner.ts — 유닛 행동 순서 계획.
 *
 * 라운드 시작 시 유닛 행동 순서를 결정.
 * 기준 (우선순위 순):
 *   1. 적을 즉시 공격 가능한 유닛 (공격 가능 적 수 많을수록 먼저)
 *   2. 이동 후 공격 가능한 유닛
 *   3. 유닛 class별 기본 순서: fighter/brute → ranger → tanker → support/utility
 *   4. 동점 시: unitId 알파벳 순 (결정론적 타이브레이크)
 */

import type { GameState, UnitState, UnitId } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { IAttackValidator } from "@ab/engine";
import { getAliveUnits, manhattanDistance } from "@ab/engine";

// ─── 클래스 우선순위 ──────────────────────────────────────────────────────────

const CLASS_PRIORITY: Record<string, number> = {
  fighter:   1,
  brute:     1,
  ranger:    2,
  artillery: 2,
  tanker:    3,
  mage:      3,
  support:   4,
  utility:   5,
  obstacle:  9,
};

function getClassPriority(unitClass: string): number {
  return CLASS_PRIORITY[unitClass] ?? 5;
}

// ─── 공개 함수 ────────────────────────────────────────────────────────────────

/**
 * aliveUnitIds를 전술적 우선순위 기반으로 정렬 후 반환.
 */
export function planUnitOrder(
  aliveUnitIds: UnitId[],
  state: GameState,
  registry: IDataRegistry,
  attackValidator: IAttackValidator,
): UnitId[] {
  const enemies = getAliveUnits(state).filter((u) => {
    // playerId를 모르므로 aliveUnitIds 대응 플레이어 ID 추출
    return !aliveUnitIds.some((id) => id === u.unitId);
  });

  // 각 유닛에 대한 점수 계산
  const unitScores = aliveUnitIds.map((id) => {
    const unit = state.units[id];
    if (unit === undefined || !unit.alive) return { id, score: -Infinity, classPriority: 9 };

    const meta = registry.getUnit(unit.metaId);

    // 즉시 공격 가능 적 수
    const immediateTargets = attackValidator.getAttackableTargets(unit, state).filter((pos) =>
      enemies.some((e) => e.position.row === pos.row && e.position.col === pos.col),
    ).length;

    // 이동 후 공격 가능 대략적 적 수 (맨하탄 거리 4 이하 적 수로 근사)
    const potentialTargets = enemies.filter(
      (e) => manhattanDistance(unit.position, e.position) <= (meta.primaryWeaponId
        ? registry.getWeapon(meta.primaryWeaponId).maxRange + (unit.movementPoints)
        : 2),
    ).length;

    // 점수: 즉시 공격 가능 > 이동 후 공격 가능 > 클래스 우선순위
    const score = immediateTargets * 100 + potentialTargets * 10;

    return { id, score, classPriority: getClassPriority(meta.class) };
  });

  // 정렬: score 내림차순 → classPriority 오름차순 → id 오름차순 (결정론적)
  unitScores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.classPriority !== b.classPriority) return a.classPriority - b.classPriority;
    return a.id < b.id ? -1 : 1;
  });

  return unitScores.map((s) => s.id);
}

// ─── 타이브레이크 ─────────────────────────────────────────────────────────────

/**
 * 두 후보 점수가 같을 때 결정론적 선택.
 * test 프로파일에서 특히 중요.
 */
export function tiebreak(ids: string[]): string {
  return [...ids].sort()[0] ?? ids[0] ?? "";
}
