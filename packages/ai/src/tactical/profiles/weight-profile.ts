/**
 * WeightProfile — 전술 AI 행동 가중치 테이블.
 *
 * 4개 프로파일:
 *   aggressive — 공격 최우선, 위험 무시
 *   defensive  — 생존 최우선, 포지셔닝 중시
 *   balanced   — 균형 잡힌 기본값
 *   test       — 결정론적 e2e 테스트 전용 (정수 가중치, 콤보/위협 비활성화)
 */

export interface WeightProfile {
  readonly name: string;

  // ── 공격 ──────────────────────────────────────────────────────────────────
  /** 데미지 1당 기본 점수 */
  readonly wDamage: number;
  /** 킬 달성 시 추가 보너스 */
  readonly wKillBonus: number;
  /** 이미 피해 입은 적 집중 공격 보너스 (HP 비율이 낮을수록 높음) */
  readonly wFocusFire: number;
  /** 원소 콤보 셋업 점수 (타일 생성 등) */
  readonly wComboSetup: number;
  /** 원소 콤보 폭발 점수 (기존 효과 이용 공격) */
  readonly wComboExploit: number;
  /** AoE/관통으로 추가 피격 유닛당 보너스 배율 */
  readonly wMultiHit: number;

  // ── 이동 ──────────────────────────────────────────────────────────────────
  /** 이동 후 공격 가능 적 수에 따른 접근 점수 배율 */
  readonly wApproach: number;
  /** 저체력 후퇴 점수 배율 */
  readonly wRetreat: number;
  /** 역할별 최적 포지셔닝 점수 */
  readonly wRolePosition: number;
  /** 위험 타일 이동 패널티 배율 */
  readonly wThreatPenalty: number;
  /** 아군 밀집 패널티 (인접 타일 아군 수당) */
  readonly wAllyProximity: number;

  // ── 기타 액션 ─────────────────────────────────────────────────────────────
  /** 소화 기본 점수 */
  readonly wExtinguishBase: number;
  /** pass 패널티 (행동 낭비) */
  readonly wPassPenalty: number;
  /** 스킬 사용 보너스 */
  readonly wSkillBonus: number;

  // ── 자기 보존 ─────────────────────────────────────────────────────────────
  /** 이 HP 비율 이하일 때 후퇴 로직 활성화 (0~1) */
  readonly wSurvivalThreshold: number;
}

// ─── 4개 프로파일 ─────────────────────────────────────────────────────────────

export const WEIGHT_PROFILES = {
  /**
   * aggressive — 돌진형.
   * 킬과 데미지를 최우선시하고 위험을 무시.
   */
  aggressive: {
    name: "aggressive",
    wDamage: 3.0,
    wKillBonus: 5.0,
    wFocusFire: 2.0,
    wComboSetup: 0.5,
    wComboExploit: 4.0,
    wMultiHit: 1.5,
    wApproach: 2.0,
    wRetreat: 0.3,
    wRolePosition: 0.5,
    wThreatPenalty: 0.5,
    wAllyProximity: 0.2,
    wExtinguishBase: 1.0,
    wPassPenalty: 2.0,
    wSkillBonus: 3.0,
    wSurvivalThreshold: 0.15,
  } satisfies WeightProfile,

  /**
   * defensive — 생존형.
   * 위험 회피, 콤보 준비, 체력 관리 중시.
   */
  defensive: {
    name: "defensive",
    wDamage: 1.5,
    wKillBonus: 3.0,
    wFocusFire: 1.0,
    wComboSetup: 2.0,
    wComboExploit: 2.5,
    wMultiHit: 1.0,
    wApproach: 0.5,
    wRetreat: 2.5,
    wRolePosition: 2.0,
    wThreatPenalty: 3.0,
    wAllyProximity: 0.8,
    wExtinguishBase: 3.0,
    wPassPenalty: 0.5,
    wSkillBonus: 1.5,
    wSurvivalThreshold: 0.40,
  } satisfies WeightProfile,

  /**
   * balanced — 균형형.
   * 공격성과 방어성 사이의 기본값. 일반 게임에 사용.
   */
  balanced: {
    name: "balanced",
    wDamage: 2.0,
    wKillBonus: 4.0,
    wFocusFire: 1.5,
    wComboSetup: 1.5,
    wComboExploit: 3.0,
    wMultiHit: 1.2,
    wApproach: 1.2,
    wRetreat: 1.2,
    wRolePosition: 1.5,
    wThreatPenalty: 1.5,
    wAllyProximity: 0.5,
    wExtinguishBase: 2.0,
    wPassPenalty: 1.0,
    wSkillBonus: 2.0,
    wSurvivalThreshold: 0.30,
  } satisfies WeightProfile,

  /**
   * test — 결정론적 e2e 테스트 전용.
   *
   * 설계 원칙:
   *   - 정수 가중치만 사용 (부동소수점 오차 없음)
   *   - wKillBonus=100: 킬 기회가 있으면 반드시 공격
   *   - wFocusFire=10: 가장 약한 적 집중
   *   - 콤보/위협 비활성화 (불확실성 제거)
   *   - 동점 시 tiebreak()으로 결정론적 해소
   */
  test: {
    name: "test",
    wDamage: 2,
    wKillBonus: 100,
    wFocusFire: 10,
    wComboSetup: 0,
    wComboExploit: 0,
    wMultiHit: 0,
    wApproach: 1,
    wRetreat: 0,
    wRolePosition: 0,
    wThreatPenalty: 0,
    wAllyProximity: 0,
    wExtinguishBase: 50,
    wPassPenalty: 5,
    wSkillBonus: 0,
    wSurvivalThreshold: 0,
  } satisfies WeightProfile,
} as const;

export type ProfileName = keyof typeof WEIGHT_PROFILES;

export function getWeightProfile(name: ProfileName): WeightProfile {
  return WEIGHT_PROFILES[name];
}
