// ============================================================
// P-01: No hardcoding — all game constants defined here
// ============================================================

// Grid
export const GRID_SIZE = 11 as const;
export const GRID_MIN = 0 as const;
export const GRID_MAX = GRID_SIZE - 1;

// Player / Unit counts
export const MIN_PLAYERS = 2 as const;
export const MAX_PLAYERS = 4 as const;
export const UNITS_PER_PLAYER = 3 as const;
export const TEAM_SIZE_2V2 = 2 as const;

// Rounds / Turns
export const MAX_ROUNDS = 30 as const;

// Draft
export const DRAFT_TIMEOUT_MS = 180_000 as const; // 180 s
export const DRAFT_POOL_SIZE = 6 as const; // shared pool in 2v2
export const MAX_DRAFT_SLOTS = 3 as const; // max units each player can draft (= UNITS_PER_PLAYER)

// Priority
export const PRIORITY_DEFAULT = 1 as const;

// Movement costs
export const MOVE_COST_DEFAULT = 1 as const;
export const MOVE_COST_RIVER = 2 as const;
export const MOVE_COST_RIVER_EXIT = 1 as const;
export const MOVE_COST_SAND = 2 as const;

// Damage modifiers
export const ARMOR_REDUCTION_FLAT = 1 as const; // armor reduces by 1 per point
export const KNOCKBACK_COLLISION_DAMAGE = 1 as const;
export const RIVER_PUSH_DAMAGE = 0 as const; // no direct damage, only effect loss

// Effect durations (turns) — 0 = permanent until condition met
export const FREEZE_DURATION_TURNS = 1 as const;
export const FIRE_DURATION_TURNS = 3 as const;
export const ACID_DURATION_TURNS = 3 as const;
export const ELECTRIC_DURATION_TURNS = 1 as const;

// Tile isometric rendering (pixels)
export const TILE_WIDTH = 64 as const;
export const TILE_HEIGHT = 32 as const;
export const TILE_DEPTH = 8 as const;

// Animation timings (ms)
export const ANIM_MOVE_MS = 300 as const;
export const ANIM_ATTACK_MS = 500 as const;
export const ANIM_EFFECT_MS = 400 as const;
export const ANIM_DEATH_MS = 600 as const;
export const ANIM_TURN_TRANSITION_MS = 800 as const;

// Error / validation
export const MAX_PATH_LENGTH = GRID_SIZE * GRID_SIZE;
