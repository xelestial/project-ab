// ============================================================
// P-07: Central i18n helper — all user-visible text goes through getText()
// ============================================================

import type { Locale } from "./schemas/index.js";
export type { Locale };

type TranslationMap = Record<string, string>;
type Translations = Record<Locale, TranslationMap>;

const translations: Translations = {
  ko: {
    // Movement errors
    "error.move.out_of_range": "이동 범위를 벗어났습니다.",
    "error.move.blocked_mountain": "산악 지형으로 이동할 수 없습니다.",
    "error.move.blocked_unit": "해당 위치에 멈출 수 없습니다.",
    "error.move.insufficient_mp": "이동력이 부족합니다.",
    "error.move.already_moved": "이미 이동을 완료했습니다.",
    "error.move.frozen": "빙결 상태에서는 행동할 수 없습니다.",
    "error.move.no_path": "경로를 찾을 수 없습니다.",

    // Attack errors
    "error.attack.out_of_range": "공격 범위를 벗어났습니다.",
    "error.attack.no_los": "시야가 차단되어 있습니다.",
    "error.attack.already_attacked": "이미 공격을 완료했습니다.",
    "error.attack.frozen": "빙결 상태에서는 공격할 수 없습니다.",
    "error.attack.invalid_target": "유효하지 않은 대상입니다.",

    // Skill errors
    "error.skill.not_found": "스킬을 찾을 수 없습니다.",
    "error.skill.already_used": "이미 스킬을 사용했습니다.",
    "error.skill.frozen": "빙결 상태에서는 스킬을 사용할 수 없습니다.",

    // Draft errors
    "error.draft.timeout": "드래프트 시간이 초과되었습니다.",
    "error.draft.slot_occupied": "이미 배치된 위치입니다.",
    "error.draft.invalid_unit": "유효하지 않은 유닛입니다.",
    "error.draft.phase_over": "드래프트 단계가 종료되었습니다.",

    // Turn / Phase
    "error.turn.not_your_turn": "현재 차례가 아닙니다.",
    "error.turn.invalid_phase": "현재 페이즈에서 불가능한 행동입니다.",

    // Extinguish
    "error.extinguish.not_on_fire": "화염 상태가 아닙니다.",
    "error.extinguish.already_acted": "이미 행동을 완료했습니다.",

    // Generic
    "error.internal": "내부 오류가 발생했습니다.",
    "error.unknown.unit": "알 수 없는 유닛입니다.",
    "error.unknown.weapon": "알 수 없는 무기입니다.",
    "error.unknown.effect": "알 수 없는 효과입니다.",
    "error.unknown.map": "알 수 없는 맵입니다.",

    // Game phases
    "phase.draft": "드래프트",
    "phase.battle": "전투",
    "phase.result": "결과",

    // Turn labels
    "turn.your_turn": "내 차례",
    "turn.opponent_turn": "상대 차례",
    "turn.round": "{round}라운드",

    // End conditions
    "end.all_units_dead": "모든 유닛 전멸",
    "end.round_limit": "라운드 제한 도달",
    "end.surrender": "항복",
    "end.disconnect": "연결 끊김",
    "end.winner": "{player}의 승리!",
    "end.draw": "무승부",

    // Unit stats
    "stat.health": "체력",
    "stat.armor": "방어력",
    "stat.movement": "이동력",

    // Effects
    "effect.freeze": "빙결",
    "effect.fire": "화염",
    "effect.acid": "산성",
    "effect.water": "물",
    "effect.sand": "모래",
    "effect.electric": "감전",

    // Tile attributes
    "tile.road": "도로",
    "tile.plain": "평지",
    "tile.mountain": "산악",
    "tile.sand": "모래",
    "tile.river": "강",
    "tile.fire": "화염 타일",
    "tile.water": "물 타일",
    "tile.acid": "산성 타일",
    "tile.electric": "감전 타일",
    "tile.ice": "빙결 타일",
  },
  en: {
    // Movement errors
    "error.move.out_of_range": "Out of movement range.",
    "error.move.blocked_mountain": "Cannot move onto mountain terrain.",
    "error.move.blocked_unit": "Cannot stop on that position.",
    "error.move.insufficient_mp": "Insufficient movement points.",
    "error.move.already_moved": "Already moved this turn.",
    "error.move.frozen": "Cannot act while frozen.",
    "error.move.no_path": "No valid path found.",

    // Attack errors
    "error.attack.out_of_range": "Target is out of attack range.",
    "error.attack.no_los": "Line of sight is blocked.",
    "error.attack.already_attacked": "Already attacked this turn.",
    "error.attack.frozen": "Cannot attack while frozen.",
    "error.attack.invalid_target": "Invalid target.",

    // Skill errors
    "error.skill.not_found": "Skill not found.",
    "error.skill.already_used": "Skill already used this game.",
    "error.skill.frozen": "Cannot use skills while frozen.",

    // Draft errors
    "error.draft.timeout": "Draft timed out.",
    "error.draft.slot_occupied": "Position already occupied.",
    "error.draft.invalid_unit": "Invalid unit selection.",
    "error.draft.phase_over": "Draft phase has ended.",

    // Turn / Phase
    "error.turn.not_your_turn": "It is not your turn.",
    "error.turn.invalid_phase": "Action not available in this phase.",

    // Extinguish
    "error.extinguish.not_on_fire": "Unit is not on fire.",
    "error.extinguish.already_acted": "Already performed an action.",

    // Generic
    "error.internal": "An internal error occurred.",
    "error.unknown.unit": "Unknown unit.",
    "error.unknown.weapon": "Unknown weapon.",
    "error.unknown.effect": "Unknown effect.",
    "error.unknown.map": "Unknown map.",

    // Game phases
    "phase.draft": "Draft",
    "phase.battle": "Battle",
    "phase.result": "Result",

    // Turn labels
    "turn.your_turn": "Your Turn",
    "turn.opponent_turn": "Opponent's Turn",
    "turn.round": "Round {round}",

    // End conditions
    "end.all_units_dead": "All Units Eliminated",
    "end.round_limit": "Round Limit Reached",
    "end.surrender": "Surrender",
    "end.disconnect": "Disconnected",
    "end.winner": "{player} Wins!",
    "end.draw": "Draw",

    // Unit stats
    "stat.health": "Health",
    "stat.armor": "Armor",
    "stat.movement": "Movement",

    // Effects
    "effect.freeze": "Freeze",
    "effect.fire": "Fire",
    "effect.acid": "Acid",
    "effect.water": "Water",
    "effect.sand": "Sand",
    "effect.electric": "Electric",

    // Tile attributes
    "tile.road": "Road",
    "tile.plain": "Plain",
    "tile.mountain": "Mountain",
    "tile.sand": "Sand",
    "tile.river": "River",
    "tile.fire": "Fire Tile",
    "tile.water": "Water Tile",
    "tile.acid": "Acid Tile",
    "tile.electric": "Electric Tile",
    "tile.ice": "Ice Tile",
  },
};

let _locale: Locale = "ko";

export function setLocale(locale: Locale): void {
  _locale = locale;
}

export function getLocale(): Locale {
  return _locale;
}

/**
 * Retrieve a translated string by key with optional interpolation.
 * Usage: getText("turn.round", { round: 3 }) → "3라운드"
 */
export function getText(key: string, params?: Record<string, string | number>): string {
  const map = translations[_locale];
  let text = map[key];

  if (text === undefined) {
    // Fallback to English, then to the key itself
    text = translations["en"][key] ?? key;
  }

  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }

  return text;
}
