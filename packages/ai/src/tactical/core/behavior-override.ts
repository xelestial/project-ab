/**
 * behavior-override.ts — 즉각 반응 행동 오버라이드.
 *
 * 다음 우선순위로 즉각 반환할 후보 액션을 확인:
 *   1. ImmediateKill   — 공격 시 적이 사망하면 즉시 그 액션 반환
 *   2. FireExtinguish  — 현재 유닛에 fire 효과 → 소화 액션
 *   3. SurvivalRetreat — HP가 임계값 이하 + 이동 후 더 안전 → 이동 강제
 *
 * 반환값이 null이면 오버라이드 없음 → 일반 유틸리티 스코어링으로 진행.
 */

import type { UnitState } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { WeightProfile } from "../profiles/weight-profile.js";
import type { ScoredCandidate } from "./utility-scorer.js";
import type {
  ActionCandidate,
  AttackCandidate,
  MoveAttackCandidate,
  ExtinguishCandidate,
} from "./candidate-generator.js";

// ─── 공개 함수 ─────────────────────────────────────────────────────────────────

/**
 * 즉각 반응해야 할 후보 액션이 있으면 반환.
 * null이면 오버라이드 없음.
 */
export function applyBehaviorOverride(
  scored: ScoredCandidate[],
  unit: UnitState,
  profile: WeightProfile,
  registry: IDataRegistry,
): ScoredCandidate | null {
  // 1. 즉사 기회 — 최우선
  const killShot = findKillShot(scored, unit, registry);
  if (killShot !== null) return killShot;

  // 2. 화재 소화 — 생명 위협 즉시 처리
  const fireExtinguish = findFireExtinguish(scored, unit);
  if (fireExtinguish !== null) return fireExtinguish;

  // 3. 생존 후퇴 — HP 임계값 이하
  if (profile.wSurvivalThreshold > 0) {
    const retreat = findSurvivalRetreat(scored, unit, profile, registry);
    if (retreat !== null) return retreat;
  }

  return null;
}

// ─── 내부 로직 ─────────────────────────────────────────────────────────────────

/**
 * 공격 또는 이동+공격으로 적이 즉사하는 후보 탐색.
 * 여럿이면 가장 많은 적을 죽이는 후보 선택.
 */
function findKillShot(
  scored: ScoredCandidate[],
  unit: UnitState,
  registry: IDataRegistry,
): ScoredCandidate | null {
  const killCandidates = scored.filter((sc) => {
    const c = sc.candidate;
    if (c.kind !== "attack" && c.kind !== "move_attack") return false;
    return canKillAny(c as AttackCandidate | MoveAttackCandidate, unit, registry);
  });

  if (killCandidates.length === 0) return null;

  // 가장 많은 적을 죽이는 후보 선택
  killCandidates.sort((a, b) => {
    const ca = a.candidate as AttackCandidate | MoveAttackCandidate;
    const cb = b.candidate as AttackCandidate | MoveAttackCandidate;
    return countKills(cb, unit, registry) - countKills(ca, unit, registry);
  });

  return killCandidates[0] ?? null;
}

function canKillAny(
  c: AttackCandidate | MoveAttackCandidate,
  unit: UnitState,
  registry: IDataRegistry,
): boolean {
  const weaponId = registry.getUnit(unit.metaId).primaryWeaponId;
  if (!weaponId) return false;
  const damage = registry.getWeapon(weaponId).damage;

  return c.affectedEnemies.some(
    (enemy) => enemy.currentHealth - Math.max(0, damage - enemy.currentArmor) <= 0,
  );
}

function countKills(
  c: AttackCandidate | MoveAttackCandidate,
  unit: UnitState,
  registry: IDataRegistry,
): number {
  const weaponId = registry.getUnit(unit.metaId).primaryWeaponId;
  if (!weaponId) return 0;
  const damage = registry.getWeapon(weaponId).damage;

  return c.affectedEnemies.filter(
    (enemy) => enemy.currentHealth - Math.max(0, damage - enemy.currentArmor) <= 0,
  ).length;
}

/**
 * 소화 액션 탐색 (화재 상태).
 */
function findFireExtinguish(
  scored: ScoredCandidate[],
  unit: UnitState,
): ScoredCandidate | null {
  const hasFire = unit.activeEffects.some((e) => e.effectType === "fire");
  if (!hasFire) return null;

  return scored.find((sc) => sc.candidate.kind === "extinguish") ?? null;
}

/**
 * 생존 후퇴 탐색 (HP 비율이 임계값 이하 + 적에서 멀어지는 이동 후보).
 */
function findSurvivalRetreat(
  scored: ScoredCandidate[],
  unit: UnitState,
  profile: WeightProfile,
  registry: IDataRegistry,
): ScoredCandidate | null {
  const unitMeta = registry.getUnit(unit.metaId);
  const maxHp = unitMeta.baseHealth;
  const hpRatio = unit.currentHealth / maxHp;

  if (hpRatio >= profile.wSurvivalThreshold) return null;

  // 이동 후보 중 위협 패널티가 가장 낮은 것 선택
  const moveCandidates = scored.filter((sc) => sc.candidate.kind === "move");
  if (moveCandidates.length === 0) return null;

  // 가장 안전한 이동 (retreat breakdown 점수가 가장 높은)
  const sorted = [...moveCandidates].sort((a, b) => {
    const retreatA = a.breakdown["retreat"] ?? 0;
    const retreatB = b.breakdown["retreat"] ?? 0;
    return retreatB - retreatA;
  });

  const best = sorted[0];
  // 후퇴 점수가 있는 경우에만 오버라이드
  if (best !== undefined && (best.breakdown["retreat"] ?? 0) > 0) {
    return best;
  }

  return null;
}
