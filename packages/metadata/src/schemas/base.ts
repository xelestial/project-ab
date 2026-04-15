import { z } from "zod";

// ─── Scalar branded types ───────────────────────────────────────────────────

export const GameIdSchema = z.string().min(1).brand("GameId");
export const PlayerIdSchema = z.string().min(1).brand("PlayerId");
export const UnitIdSchema = z.string().min(1).brand("UnitId");
export const MetaIdSchema = z.string().min(1).brand("MetaId");

export type GameId = z.infer<typeof GameIdSchema>;
export type PlayerId = z.infer<typeof PlayerIdSchema>;
export type UnitId = z.infer<typeof UnitIdSchema>;
export type MetaId = z.infer<typeof MetaIdSchema>;

// ─── Grid position ──────────────────────────────────────────────────────────
// Note: no max bound here — each map defines its own gridSize.
// Runtime bounds checks use state.map.gridSize (see game-state-utils.ts).

export const PositionSchema = z.object({
  row: z.number().int().min(0),
  col: z.number().int().min(0),
});
export type Position = z.infer<typeof PositionSchema>;

// ─── Enumerations ───────────────────────────────────────────────────────────

export const DirectionSchema = z.enum(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const GamePhaseSchema = z.enum(["waiting", "draft", "battle", "result"]);
export type GamePhase = z.infer<typeof GamePhaseSchema>;

export const ActionTypeSchema = z.enum(["move", "attack", "skill", "extinguish", "pass", "draft_place"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const AttackTypeSchema = z.enum(["melee", "ranged", "artillery"]);
export type AttackType = z.infer<typeof AttackTypeSchema>;

export const RangeTypeSchema = z.enum(["single", "line", "area", "penetrate", "beam"]);
export type RangeType = z.infer<typeof RangeTypeSchema>;

export const AttackAttributeSchema = z.enum(["fire", "water", "acid", "electric", "ice", "sand", "none"]);
export type AttackAttribute = z.infer<typeof AttackAttributeSchema>;

export const UnitClassSchema = z.enum(["tanker", "fighter", "ranger", "mage", "support"]);
export type UnitClass = z.infer<typeof UnitClassSchema>;

/** Unit-based status effects */
export const UnitEffectTypeSchema = z.enum(["freeze", "fire", "acid", "water", "sand", "electric"]);
export type UnitEffectType = z.infer<typeof UnitEffectTypeSchema>;

/** Tile attribute (what a tile currently "is") */
export const TileAttributeTypeSchema = z.enum([
  "road", "plain", "mountain",  // basic — visual only, no gameplay effect
  "sand",                        // special basic tile
  "river",                       // special: cross costs 2/tile, cannot stop
  "fire", "water", "acid", "electric", "ice", // converted attributes
]);
export type TileAttributeType = z.infer<typeof TileAttributeTypeSchema>;

export const LocaleSchema = z.enum(["ko", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const EndResultSchema = z.enum(["win", "loss", "draw", "disconnect"]);
export type EndResult = z.infer<typeof EndResultSchema>;

// ─── ValidationResult ────────────────────────────────────────────────────────

export const ValidationResultSchema = z.discriminatedUnion("valid", [
  z.object({ valid: z.literal(true) }),
  z.object({ valid: z.literal(false), errorCode: z.string() }),
]);
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const VALID: ValidationResult = { valid: true };
export function invalid(errorCode: string): ValidationResult {
  return { valid: false, errorCode };
}
