/**
 * combo-table.ts — 원소 콤보 상수 테이블.
 *
 * 두 종류의 콤보:
 *   1. UnitCombo: 이미 적 유닛에 붙은 효과 + 새 공격 속성 → 보너스 데미지
 *   2. TileCombo: 적이 서 있는 타일 속성 + 공격 무기 속성/특성 → 보너스
 *
 * 실제 게임 데이터 기반:
 *   - wpn_bc_water_bomb: applyTileEffect=water
 *   - wpn_shock_melee: attr=electric, chainShock=true
 *   - wpn_ba_melee_fire / wpn_rb_penetrate_fire: applyTileEffect=fire
 *   - wpn_td/fd/rd_ice: attr=ice, applyTileEffect=ice
 */

import type { AttackAttribute } from "@ab/metadata";
import type { TileAttributeType, UnitEffectType } from "@ab/metadata";

// ─── 유닛 콤보 (적 유닛 효과 + 공격 속성) ─────────────────────────────────────

export interface UnitCombo {
  /** 적 유닛에 이미 붙어 있어야 하는 효과 */
  readonly existingEffect: UnitEffectType;
  /** 이번 공격의 속성 */
  readonly incomingAttr: AttackAttribute;
  /** 추가 데미지 예상치 */
  readonly bonusDamage: number;
  /** 콤보 설명 */
  readonly description: string;
}

export const UNIT_COMBOS: readonly UnitCombo[] = [
  // water 효과 + electric → Shock (chainShock 증폭)
  { existingEffect: "water",    incomingAttr: "electric", bonusDamage: 3, description: "Shock" },
  // fire  효과 + water   → Steam (fire 소멸)
  { existingEffect: "fire",     incomingAttr: "water",    bonusDamage: 0, description: "Steam" },
  // water 효과 + ice     → Freeze
  { existingEffect: "water",    incomingAttr: "ice",      bonusDamage: 0, description: "Freeze" },
  // acid  효과 + fire    → Acid Amplify
  { existingEffect: "acid",     incomingAttr: "fire",     bonusDamage: 2, description: "Acid Amplify" },
  // fire  효과 + ice     → Extinguish
  { existingEffect: "fire",     incomingAttr: "ice",      bonusDamage: 0, description: "Extinguish" },
  // sand  효과 + electric → Grounded (electric 차단)
  { existingEffect: "sand",     incomingAttr: "electric", bonusDamage: 0, description: "Grounded" },
] as const;

// ─── 타일 콤보 (타일 속성 + 무기 특성) ─────────────────────────────────────────

export interface TileCombo {
  /** 적이 서 있는 타일 속성 */
  readonly requiredTile: TileAttributeType;
  /** 공격 무기 속성 또는 특성 */
  readonly incomingAttr: AttackAttribute | "chainShock";
  /** 추가 데미지 예상치 */
  readonly bonusDamage: number;
  readonly description: string;
}

export const TILE_COMBOS: readonly TileCombo[] = [
  // water 타일 + chainShock → 광역 전기 피해
  { requiredTile: "water",    incomingAttr: "chainShock", bonusDamage: 2, description: "Tile Chain Shock" },
  // water 타일 + electric   → 전기 증폭
  { requiredTile: "water",    incomingAttr: "electric",   bonusDamage: 2, description: "Tile Electric" },
  // fire  타일 + fire       → 화염 증폭
  { requiredTile: "fire",     incomingAttr: "fire",       bonusDamage: 1, description: "Fire Amplify" },
  // acid  타일 + any        → 산성 지면 보너스
  { requiredTile: "acid",     incomingAttr: "none",       bonusDamage: 1, description: "Acid Ground" },
  // ice   타일 + ice        → 빙결 보너스
  { requiredTile: "ice",      incomingAttr: "ice",        bonusDamage: 1, description: "Cryo Amplify" },
] as const;

/**
 * 공격 속성 + 타일 속성 기반 콤보 보너스 조회.
 * chainShock=true인 무기는 incomingAttr="chainShock"로 전달.
 */
export function getTileComboBonus(
  tileAttr: TileAttributeType,
  weaponAttr: AttackAttribute | "chainShock",
): number {
  let bonus = 0;
  for (const combo of TILE_COMBOS) {
    if (combo.requiredTile === tileAttr) {
      if (combo.incomingAttr === weaponAttr || combo.incomingAttr === "none") {
        bonus += combo.bonusDamage;
      }
    }
  }
  return bonus;
}

/**
 * 유닛 효과 + 공격 속성 기반 콤보 보너스 조회.
 */
export function getUnitComboBonus(
  existingEffect: UnitEffectType,
  incomingAttr: AttackAttribute,
): number {
  for (const combo of UNIT_COMBOS) {
    if (combo.existingEffect === existingEffect && combo.incomingAttr === incomingAttr) {
      return combo.bonusDamage;
    }
  }
  return 0;
}
