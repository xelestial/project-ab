/**
 * candidate-generator.ts — 가능한 모든 액션 후보 생성.
 *
 * 한 유닛에 대해:
 *   1. 공격 후보  — 적 점유 타일 & 비어있는 타일 (AoE)
 *   2. 이동 후보  — 도달 가능한 타일 전체 (공격 전/후 이동 모두)
 *   3. 소화 후보  — 화재 효과가 있을 때
 *   4. 패스       — 항상 포함 (최저 점수 폴백)
 *
 * MoveAttackCandidate: 이동 후 공격 시뮬레이션도 포함.
 *   이동 → 공격 조합을 미리 계산해 유틸리티 스코어에 활용.
 */

import type { GameState, UnitState, Position, PlayerId, UnitId } from "@ab/metadata";
import type { IMovementValidator, IAttackValidator } from "@ab/engine";
import { getAliveUnits, getUnitAt, posKey } from "@ab/engine";

// ─── 후보 타입 ─────────────────────────────────────────────────────────────────

export type ActionCandidate =
  | AttackCandidate
  | MoveCandidate
  | MoveAttackCandidate
  | ExtinguishCandidate
  | PassCandidate;

export interface AttackCandidate {
  kind: "attack";
  unit: UnitState;
  target: Position;
  /** 영향받는 적 목록 (AoE 포함) */
  affectedEnemies: UnitState[];
}

export interface MoveCandidate {
  kind: "move";
  unit: UnitState;
  destination: Position;
}

export interface MoveAttackCandidate {
  kind: "move_attack";
  unit: UnitState;
  destination: Position;
  target: Position;
  /** 이동 후 공격 시 영향받는 적 */
  affectedEnemies: UnitState[];
}

export interface ExtinguishCandidate {
  kind: "extinguish";
  unit: UnitState;
}

export interface PassCandidate {
  kind: "pass";
  unit: UnitState;
}

// ─── 생성기 ───────────────────────────────────────────────────────────────────

export function generateCandidates(
  unit: UnitState,
  state: GameState,
  movementValidator: IMovementValidator,
  attackValidator: IAttackValidator,
): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const enemies = getAliveUnits(state).filter((u) => u.playerId !== unit.playerId);

  // ── 1. 즉시 공격 후보 ──────────────────────────────────────────────────────
  if (!unit.actionsUsed.attacked) {
    const attackTargets = attackValidator.getAttackableTargets(unit, state);
    for (const target of attackTargets) {
      const validation = attackValidator.validateAttack(unit, target, state);
      if (!validation.valid || !validation.affectedPositions) continue;

      const affected = validation.affectedPositions
        .map((ap) => getUnitAt(state, ap.position))
        .filter((u): u is UnitState => u !== undefined && u.playerId !== unit.playerId && u.alive);

      // 영향받는 적이 없으면 의미 없는 공격 — 건너뜀
      if (affected.length === 0) continue;
      candidates.push({ kind: "attack", unit, target, affectedEnemies: affected });
    }
  }

  // ── 2. 이동 후보 (이동만) ──────────────────────────────────────────────────
  if (!unit.actionsUsed.moved) {
    const reachable = movementValidator.getReachableTiles(unit, state);

    for (const dest of reachable) {
      candidates.push({ kind: "move", unit, destination: dest });
    }

    // ── 3. 이동 후 공격 후보 (아직 공격 안 한 경우) ────────────────────────
    if (!unit.actionsUsed.attacked) {
      const seenDestTargetPairs = new Set<string>();

      for (const dest of reachable) {
        // 적이 없는 빈 타일로만 이동 가능 (이미 getReachableTiles가 걸러줌)
        // 임시로 유닛을 이동시킨 상태 시뮬레이션
        const tempUnit: UnitState = {
          ...unit,
          position: dest,
          actionsUsed: { ...unit.actionsUsed, moved: true },
        };
        const tempState = simulateMove(unit, dest, state);
        const attackTargetsAfterMove = attackValidator.getAttackableTargets(tempUnit, tempState);

        for (const target of attackTargetsAfterMove) {
          const key = `${posKey(dest)}->${posKey(target)}`;
          if (seenDestTargetPairs.has(key)) continue;

          const targetUnit = getUnitAt(state, target);
          if (targetUnit === undefined || targetUnit.playerId === unit.playerId) continue;

          const validation = attackValidator.validateAttack(tempUnit, target, tempState);
          if (!validation.valid || !validation.affectedPositions) continue;

          const affected = validation.affectedPositions
            .map((ap) => {
              // 이동 전 원래 상태에서 적 위치 조회
              return getUnitAt(state, ap.position);
            })
            .filter((u): u is UnitState => u !== undefined && u.playerId !== unit.playerId && u.alive);

          seenDestTargetPairs.add(key);
          candidates.push({
            kind: "move_attack",
            unit,
            destination: dest,
            target,
            affectedEnemies: affected,
          });
        }
      }
    }
  }

  // ── 4. 소화 후보 ──────────────────────────────────────────────────────────
  const hasFire = unit.activeEffects.some((e) => e.effectType === "fire");
  if (hasFire && !unit.actionsUsed.extinguished && !unit.actionsUsed.attacked) {
    candidates.push({ kind: "extinguish", unit });
  }

  // ── 5. 패스 (항상 포함) ────────────────────────────────────────────────────
  candidates.push({ kind: "pass", unit });

  return candidates;
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * 유닛이 dest로 이동한 임시 GameState (경량 복사).
 * 충돌 없음을 보장하기 위해 원래 위치를 제거하고 dest에 배치.
 */
function simulateMove(unit: UnitState, dest: Position, state: GameState): GameState {
  return {
    ...state,
    units: {
      ...state.units,
      [unit.unitId]: { ...unit, position: dest },
    },
  };
}
