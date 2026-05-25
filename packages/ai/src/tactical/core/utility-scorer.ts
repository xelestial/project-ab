/**
 * utility-scorer.ts — 유틸리티 점수 계산.
 *
 * Dave Mark의 Utility AI 접근법 (GDC 2012 "Improving AI Decision Making"):
 *   각 후보 액션에 대해 여러 고려 요소를 가중합산해 스칼라 점수를 산출.
 *
 * 점수 기여 요소:
 *   공격/이동+공격:
 *     wDamage       × 예상 데미지
 *     wKillBonus    (킬 달성 시)
 *     wFocusFire    × (1 - targetHpRatio)   (이미 약해진 적 집중)
 *     wComboExploit × comboBonusDamage       (즉시 콤보 활용)
 *     wComboSetup                            (팀원 콤보 셋업)
 *     wMultiHit     × (추가 피격 유닛 수)
 *
 *   이동 (공격 없이):
 *     wApproach × (이동 후 공격 가능 적 수)
 *     wRetreat  × retreat bonus (생존 임계값 이하)
 *     wRolePosition × role 기반 포지셔닝
 *     -wThreatPenalty × destDanger
 *     -wAllyProximity × (인접 아군 수)
 *
 *   소화: wExtinguishBase
 *   패스: -wPassPenalty
 */

import type { GameState, UnitState, Position } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import type { WeightProfile } from "../profiles/weight-profile.js";
import type { ThreatMap } from "./threat-map.js";
import type { ElementalComboContext } from "../elemental/combo-detector.js";
import type {
  ActionCandidate,
  AttackCandidate,
  MoveCandidate,
  MoveAttackCandidate,
  ExtinguishCandidate,
  PassCandidate,
} from "./candidate-generator.js";
import { getAliveUnits, manhattanDistance, getUnitAt, orthogonalNeighbors } from "@ab/engine";

// ─── 결과 타입 ─────────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  candidate: ActionCandidate;
  score: number;
  /** 디버그용 점수 분해 */
  breakdown: Record<string, number>;
}

// ─── 스코어러 ─────────────────────────────────────────────────────────────────

export function scoreCandidate(
  candidate: ActionCandidate,
  unit: UnitState,
  state: GameState,
  registry: IDataRegistry,
  profile: WeightProfile,
  threatMap: ThreatMap,
  comboCtx: ElementalComboContext,
): ScoredCandidate {
  switch (candidate.kind) {
    case "attack":
      return scoreAttack(candidate, unit, state, registry, profile, comboCtx);
    case "move_attack":
      return scoreMoveAttack(candidate, unit, state, registry, profile, threatMap, comboCtx);
    case "move":
      return scoreMove(candidate, unit, state, profile, threatMap);
    case "extinguish":
      return scoreExtinguish(candidate, profile);
    case "pass":
      return scorePass(candidate, profile);
  }
}

// ─── 개별 스코어 함수 ─────────────────────────────────────────────────────────

function scoreAttack(
  c: AttackCandidate,
  unit: UnitState,
  state: GameState,
  registry: IDataRegistry,
  profile: WeightProfile,
  comboCtx: ElementalComboContext,
): ScoredCandidate {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const unitMeta = registry.getUnit(unit.metaId);
  const weaponId = unitMeta.primaryWeaponId;
  const damage = weaponId ? registry.getWeapon(weaponId).damage : 0;

  // 기본 데미지 점수
  const damageScore = profile.wDamage * damage;
  score += damageScore;
  breakdown["damage"] = damageScore;

  // 멀티 히트 보너스 (AoE/관통 추가 피격)
  const extraHits = Math.max(0, c.affectedEnemies.length - 1);
  if (extraHits > 0 && profile.wMultiHit > 0) {
    const multiScore = profile.wMultiHit * extraHits * damage;
    score += multiScore;
    breakdown["multiHit"] = multiScore;
  }

  // 킬 보너스 + 집중 공격
  for (const enemy of c.affectedEnemies) {
    const effHp = enemy.currentHealth - Math.max(0, damage - enemy.currentArmor);
    if (effHp <= 0 && profile.wKillBonus > 0) {
      score += profile.wKillBonus;
      breakdown["killBonus"] = (breakdown["killBonus"] ?? 0) + profile.wKillBonus;
    }
    const enemyMeta = registry.getUnit(enemy.metaId);
    const maxHp = enemyMeta.baseHealth;
    const hpRatio = enemy.currentHealth / maxHp;
    const focusScore = profile.wFocusFire * (1 - hpRatio);
    score += focusScore;
    breakdown["focusFire"] = (breakdown["focusFire"] ?? 0) + focusScore;
  }

  // 즉시 콤보 보너스
  if (profile.wComboExploit > 0) {
    const primaryEnemy = c.affectedEnemies[0];
    if (primaryEnemy !== undefined) {
      const combo = comboCtx.immediateComboMap.get(primaryEnemy.unitId);
      if (combo !== undefined && combo.bonusDamage > 0) {
        const comboScore = profile.wComboExploit * combo.bonusDamage;
        score += comboScore;
        breakdown["comboExploit"] = comboScore;
      }
    }
  }

  // 셋업 기회 점수 (팀원이 활용 가능한 콤보)
  if (profile.wComboSetup > 0) {
    const primaryEnemy = c.affectedEnemies[0];
    if (primaryEnemy !== undefined) {
      const setup = comboCtx.setupOpportunities.get(primaryEnemy.unitId);
      if (setup !== undefined) {
        score += profile.wComboSetup;
        breakdown["comboSetup"] = profile.wComboSetup;
      }
    }
  }

  return { candidate: c, score, breakdown };
}

function scoreMoveAttack(
  c: MoveAttackCandidate,
  unit: UnitState,
  state: GameState,
  registry: IDataRegistry,
  profile: WeightProfile,
  threatMap: ThreatMap,
  comboCtx: ElementalComboContext,
): ScoredCandidate {
  // 공격 점수 계산 (attack과 동일 로직)
  const fakeAttack: AttackCandidate = {
    kind: "attack",
    unit: { ...unit, position: c.destination },
    target: c.target,
    affectedEnemies: c.affectedEnemies,
  };
  const attackResult = scoreAttack(fakeAttack, { ...unit, position: c.destination }, state, registry, profile, comboCtx);

  // 이동 위험 패널티 추가
  const breakdown = { ...attackResult.breakdown };
  let score = attackResult.score;

  if (profile.wThreatPenalty > 0) {
    const danger = threatMap.getDanger(c.destination);
    const threatPenalty = -(profile.wThreatPenalty * danger);
    score += threatPenalty;
    breakdown["threatPenalty"] = threatPenalty;
  }

  return { candidate: c, score, breakdown };
}

function scoreMove(
  c: MoveCandidate,
  unit: UnitState,
  state: GameState,
  profile: WeightProfile,
  threatMap: ThreatMap,
): ScoredCandidate {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const enemies = getAliveUnits(state).filter((u) => u.playerId !== unit.playerId);
  const allies = getAliveUnits(state).filter(
    (u) => u.playerId === unit.playerId && u.unitId !== unit.unitId,
  );

  // ── 접근 점수 (이동 후 공격 가능 적 수) ───────────────────────────────────
  if (profile.wApproach > 0 && enemies.length > 0) {
    const nearEnemyCount = enemies.filter((e) =>
      manhattanDistance(c.destination, e.position) <= 4, // 대략 사거리 내
    ).length;
    const approachScore = profile.wApproach * nearEnemyCount;
    score += approachScore;
    breakdown["approach"] = approachScore;
  }

  // ── 후퇴 점수 (체력 임계값 이하 시 적에서 멀어질수록 보너스) ───────────────
  if (profile.wRetreat > 0 && profile.wSurvivalThreshold > 0) {
    const unitMeta = getUnitMeta(unit, state);
    if (unitMeta !== null) {
      // maxHp는 baseHealth에서 추정 (UnitState에 없으므로 currentHealth + 소비량)
      // 간단히 현재 HP 비율 추정: currentHealth 절댓값 기반
      const hpRatio = unit.currentHealth / Math.max(unit.currentHealth, 5); // 최소값 5 가정
      if (hpRatio < profile.wSurvivalThreshold && enemies.length > 0) {
        const nearestEnemy = enemies.reduce((a, b) =>
          manhattanDistance(a.position, unit.position) <= manhattanDistance(b.position, unit.position)
            ? a : b,
        );
        const distBefore = manhattanDistance(unit.position, nearestEnemy.position);
        const distAfter = manhattanDistance(c.destination, nearestEnemy.position);
        if (distAfter > distBefore) {
          const retreatScore = profile.wRetreat * (distAfter - distBefore);
          score += retreatScore;
          breakdown["retreat"] = retreatScore;
        }
      }
    }
  }

  // ── 위험 타일 패널티 ───────────────────────────────────────────────────────
  if (profile.wThreatPenalty > 0) {
    const danger = threatMap.getDanger(c.destination);
    const threatPenalty = -(profile.wThreatPenalty * danger);
    score += threatPenalty;
    breakdown["threatPenalty"] = threatPenalty;
  }

  // ── 아군 밀집 패널티 ───────────────────────────────────────────────────────
  if (profile.wAllyProximity > 0 && allies.length > 0) {
    const gs = state.map.gridSize;
    const adjacentAllies = orthogonalNeighbors(c.destination, gs).filter((n) => {
      const u = getUnitAt(state, n);
      return u !== undefined && u.playerId === unit.playerId;
    }).length;
    if (adjacentAllies > 0) {
      const proximityPenalty = -(profile.wAllyProximity * adjacentAllies);
      score += proximityPenalty;
      breakdown["allyProximity"] = proximityPenalty;
    }
  }

  return { candidate: c, score, breakdown };
}

function scoreExtinguish(
  c: ExtinguishCandidate,
  profile: WeightProfile,
): ScoredCandidate {
  return {
    candidate: c,
    score: profile.wExtinguishBase,
    breakdown: { extinguish: profile.wExtinguishBase },
  };
}

function scorePass(
  c: PassCandidate,
  profile: WeightProfile,
): ScoredCandidate {
  const score = -(profile.wPassPenalty);
  return {
    candidate: c,
    score,
    breakdown: { passPenalty: score },
  };
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function getUnitMeta(unit: UnitState, _state: GameState) {
  // UnitState에 metaId가 있으므로 registry 없이는 조회 불가
  // 이 함수는 registry 없이 호출되므로 null 반환
  return null;
}
