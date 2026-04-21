// ============================================================
// P-07: All user-visible text references are key-based.
// Error codes map to i18n keys — no Korean/English strings here.
// ============================================================

export const ErrorCode = {
  // Movement
  MOVE_OUT_OF_RANGE: "error.move.out_of_range",
  MOVE_BLOCKED_MOUNTAIN: "error.move.blocked_mountain",
  MOVE_BLOCKED_UNIT: "error.move.blocked_unit",
  MOVE_INSUFFICIENT_MP: "error.move.insufficient_mp",
  MOVE_ALREADY_MOVED: "error.move.already_moved",
  MOVE_FROZEN: "error.move.frozen",
  MOVE_NO_PATH: "error.move.no_path",

  // Attack
  ATTACK_OUT_OF_RANGE: "error.attack.out_of_range",
  ATTACK_NO_LOS: "error.attack.no_los",
  ATTACK_ALREADY_ATTACKED: "error.attack.already_attacked",
  ATTACK_FROZEN: "error.attack.frozen",
  ATTACK_INVALID_TARGET: "error.attack.invalid_target",
  ATTACK_RUSH_BLOCKED: "error.attack.rush_blocked",
  ATTACK_PULL_BLOCKED: "error.attack.pull_blocked",
  ATTACK_CLEAR_PATH_REQUIRED: "error.attack.clear_path_required",

  // Skill
  SKILL_NOT_FOUND: "error.skill.not_found",
  SKILL_ALREADY_USED: "error.skill.already_used",
  SKILL_FROZEN: "error.skill.frozen",

  // Draft
  DRAFT_TIMEOUT: "error.draft.timeout",
  DRAFT_SLOT_OCCUPIED: "error.draft.slot_occupied",
  DRAFT_INVALID_UNIT: "error.draft.invalid_unit",
  DRAFT_PHASE_OVER: "error.draft.phase_over",

  // Turn / Phase
  TURN_NOT_YOUR_TURN: "error.turn.not_your_turn",
  TURN_INVALID_PHASE: "error.turn.invalid_phase",

  // Extinguish
  EXTINGUISH_NOT_ON_FIRE: "error.extinguish.not_on_fire",
  EXTINGUISH_ALREADY_ACTED: "error.extinguish.already_acted",

  // Generic
  INTERNAL_ERROR: "error.internal",
  UNKNOWN_UNIT: "error.unknown.unit",
  UNKNOWN_WEAPON: "error.unknown.weapon",
  UNKNOWN_EFFECT: "error.unknown.effect",
  UNKNOWN_MAP: "error.unknown.map",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
