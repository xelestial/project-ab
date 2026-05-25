/**
 * combo-detector.ts — 원소 콤보 기회 감지.
 *
 * buildComboContext():
 *   1. immediateComboMap: 이 턴에 즉시 발동 가능한 콤보 (유닛 효과 + 타일)
 *   2. setupOpportunities: 아군 무기로 타일/효과를 생성하면 팀원이 활용 가능한 콤보
 */

import type { GameState, UnitState, Position, AttackAttribute } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import { getTileAttribute } from "@ab/engine";
import { getUnitComboBonus, getTileComboBonus } from "./combo-table.js";

// ─── 결과 타입 ────────────────────────────────────────────────────────────────

export interface ComboOpportunity {
  bonusDamage: number;
  description: string;
}

export interface SetupOpportunity {
  /** 아군이 이 무기 속성/효과로 선공하면 팀원이 활용 가능 */
  setupAttr: AttackAttribute;
  /** 활용 가능한 팀원 무기 속성 */
  triggerAttr: AttackAttribute;
}

export interface ElementalComboContext {
  /**
   * 키: enemyUnitId → 즉시 콤보 보너스 정보.
   * 이미 효과가 붙거나 특수 타일 위에 서 있는 적에게 공격 시 적용.
   */
  immediateComboMap: Map<string, ComboOpportunity>;

  /**
   * 키: enemyUnitId → 셋업 기회.
   * "이 적에게 먼저 water를 바르면 팀원이 electric으로 Shock 가능" 등.
   */
  setupOpportunities: Map<string, SetupOpportunity>;
}

// ─── 구현 ─────────────────────────────────────────────────────────────────────

export function buildComboContext(
  myUnit: UnitState,
  enemies: UnitState[],
  allies: UnitState[],          // 같은 playerId의 다른 유닛 (2v2 포함)
  state: GameState,
  registry: IDataRegistry,
): ElementalComboContext {
  const immediateComboMap = new Map<string, ComboOpportunity>();
  const setupOpportunities = new Map<string, SetupOpportunity>();

  // 내 무기 속성 + chainShock 여부
  const unitMeta = registry.getUnit(myUnit.metaId);
  const weaponId = unitMeta.primaryWeaponId;
  if (!weaponId) return { immediateComboMap, setupOpportunities };

  const weapon = registry.getWeapon(weaponId);
  const myAttr = weapon.attribute as AttackAttribute;
  const myIsChainShock = weapon.chainShock === true;

  // 팀원 무기 속성 수집
  const alliedAttrs = new Set<AttackAttribute>();
  for (const ally of allies) {
    const allyMeta = registry.getUnit(ally.metaId);
    const allyWpnId = allyMeta.primaryWeaponId;
    if (allyWpnId) {
      const allyWpn = registry.getWeapon(allyWpnId);
      if (allyWpn.attribute !== "none") alliedAttrs.add(allyWpn.attribute as AttackAttribute);
    }
  }

  for (const enemy of enemies) {
    const tileAttr = getTileAttribute(state, enemy.position);
    let bestBonus = 0;
    let bestDesc = "";

    // 1. 타일 콤보 (내 무기 속성이 현재 타일과 콤보)
    const tileAttrToCheck = myIsChainShock ? "chainShock" : myAttr;
    const tileBonus = getTileComboBonus(tileAttr, tileAttrToCheck);
    if (tileBonus > bestBonus) { bestBonus = tileBonus; bestDesc = `Tile combo (${tileAttr}+${myAttr})`; }

    // 2. 유닛 효과 콤보 (적에 붙은 효과 + 내 무기 속성)
    for (const effect of enemy.activeEffects) {
      const unitBonus = getUnitComboBonus(effect.effectType, myAttr);
      if (unitBonus > bestBonus) { bestBonus = unitBonus; bestDesc = `Unit combo (${effect.effectType}+${myAttr})`; }
    }

    if (bestBonus > 0) {
      immediateComboMap.set(enemy.unitId, { bonusDamage: bestBonus, description: bestDesc });
    }

    // 3. 셋업 기회: 내 무기로 타일을 생성하면 팀원이 활용 가능
    if (weapon.applyTileEffect) {
      const applyAttr = weapon.applyTileEffect as AttackAttribute;
      // water → electric, fire → acid, ice → ice 등
      const triggerAttr = SETUP_TRIGGER_MAP[applyAttr];
      if (triggerAttr !== undefined && alliedAttrs.has(triggerAttr)) {
        setupOpportunities.set(enemy.unitId, {
          setupAttr: applyAttr,
          triggerAttr,
        });
      }
    }
  }

  return { immediateComboMap, setupOpportunities };
}

/**
 * 셋업 타일 → 최적 트리거 무기 속성 매핑.
 * 예: water 타일을 깔면 electric이 chain shock 가능.
 */
const SETUP_TRIGGER_MAP: Partial<Record<AttackAttribute, AttackAttribute>> = {
  water: "electric",
  fire: "fire",     // fire 타일 위 화염 공격 = 증폭
  ice: "ice",
  acid: "fire",     // acid 타일 + fire = acid amplify
};
