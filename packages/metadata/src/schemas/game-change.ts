import { z } from "zod";
import {
  UnitIdSchema,
  PlayerIdSchema,
  PositionSchema,
  UnitEffectTypeSchema,
  TileAttributeTypeSchema,
  MetaIdSchema,
  AttackAttributeSchema,
} from "./base.js";

// ─── Damage source discriminated union ───────────────────────────────────────

export const DamageSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attack"), attackerId: UnitIdSchema, weaponId: MetaIdSchema }),
  z.object({ type: z.literal("effect"), effectId: MetaIdSchema }),
  z.object({ type: z.literal("tile"), tileAttribute: TileAttributeTypeSchema }),
  z.object({ type: z.literal("collision") }),
  z.object({ type: z.literal("river_push") }),
]);
export type DamageSource = z.infer<typeof DamageSourceSchema>;

// ─── Individual change types ──────────────────────────────────────────────────

export const UnitMoveChangeSchema = z.object({
  type: z.literal("unit_move"),
  unitId: UnitIdSchema,
  from: PositionSchema,
  to: PositionSchema,
  /** If true, this is a rush movement — does NOT set actionsUsed.moved */
  isRushMovement: z.boolean().optional(),
});

export const UnitDamageChangeSchema = z.object({
  type: z.literal("unit_damage"),
  unitId: UnitIdSchema,
  amount: z.number().int().min(0),
  source: DamageSourceSchema,
  /** Health value after applying damage */
  hpAfter: z.number().int(),
});

export const UnitHealChangeSchema = z.object({
  type: z.literal("unit_heal"),
  unitId: UnitIdSchema,
  amount: z.number().int().min(0),
  hpAfter: z.number().int(),
});

export const UnitEffectAddChangeSchema = z.object({
  type: z.literal("unit_effect_add"),
  unitId: UnitIdSchema,
  effectId: MetaIdSchema,
  effectType: UnitEffectTypeSchema,
  turnsRemaining: z.number().int().min(0).optional(),
});

export const UnitEffectRemoveChangeSchema = z.object({
  type: z.literal("unit_effect_remove"),
  unitId: UnitIdSchema,
  effectId: MetaIdSchema,
  effectType: UnitEffectTypeSchema,
});

export const UnitDeathChangeSchema = z.object({
  type: z.literal("unit_death"),
  unitId: UnitIdSchema,
  position: PositionSchema,
  killedBy: DamageSourceSchema,
});

export const UnitKnockbackChangeSchema = z.object({
  type: z.literal("unit_knockback"),
  unitId: UnitIdSchema,
  from: PositionSchema,
  to: PositionSchema,
  /** Position that was blocked (if collision occurred) */
  blockedBy: z.union([UnitIdSchema, z.literal("wall")]).optional(),
});

/** Unit loses all effects + attributes when pushed into river */
export const UnitRiverEnterChangeSchema = z.object({
  type: z.literal("unit_river_enter"),
  unitId: UnitIdSchema,
  position: PositionSchema,
  clearedEffectIds: z.array(MetaIdSchema),
  clearedAttributes: z.array(AttackAttributeSchema),
});

/** Unit exits river — attributes restore */
export const UnitRiverExitChangeSchema = z.object({
  type: z.literal("unit_river_exit"),
  unitId: UnitIdSchema,
  position: PositionSchema,
});

export const UnitPullChangeSchema = z.object({
  type: z.literal("unit_pull"),
  unitId: UnitIdSchema,
  from: PositionSchema,
  to: PositionSchema,
});
export type UnitPullChange = z.infer<typeof UnitPullChangeSchema>;

export const UnitActionsResetChangeSchema = z.object({
  type: z.literal("unit_actions_reset"),
  unitId: UnitIdSchema,
});

export const TileAttributeChangeSchema = z.object({
  type: z.literal("tile_attribute_change"),
  position: PositionSchema,
  from: TileAttributeTypeSchema,
  to: TileAttributeTypeSchema,
  /** Attack that caused this conversion, if any */
  causedBy: z.object({ attackerId: UnitIdSchema, attribute: AttackAttributeSchema }).optional(),
});

export const TileEffectTickChangeSchema = z.object({
  type: z.literal("tile_effect_tick"),
  position: PositionSchema,
  /** Turns remaining after tick; undefined if permanent */
  turnsRemaining: z.number().int().min(0).optional(),
});

export const TurnAdvanceChangeSchema = z.object({
  type: z.literal("turn_advance"),
  from: z.object({ playerId: PlayerIdSchema, turnIndex: z.number().int() }),
  to: z.object({ playerId: PlayerIdSchema, turnIndex: z.number().int() }),
});

export const RoundAdvanceChangeSchema = z.object({
  type: z.literal("round_advance"),
  from: z.number().int(),
  to: z.number().int(),
});

export const PhaseChangeSchema = z.object({
  type: z.literal("phase_change"),
  from: z.string(),
  to: z.string(),
});

// ─── GameChange union ─────────────────────────────────────────────────────────

export const GameChangeSchema = z.discriminatedUnion("type", [
  UnitMoveChangeSchema,
  UnitDamageChangeSchema,
  UnitHealChangeSchema,
  UnitEffectAddChangeSchema,
  UnitEffectRemoveChangeSchema,
  UnitDeathChangeSchema,
  UnitKnockbackChangeSchema,
  UnitRiverEnterChangeSchema,
  UnitRiverExitChangeSchema,
  UnitPullChangeSchema,
  UnitActionsResetChangeSchema,
  TileAttributeChangeSchema,
  TileEffectTickChangeSchema,
  TurnAdvanceChangeSchema,
  RoundAdvanceChangeSchema,
  PhaseChangeSchema,
]);

export type UnitMoveChange = z.infer<typeof UnitMoveChangeSchema>;
export type UnitDamageChange = z.infer<typeof UnitDamageChangeSchema>;
export type UnitHealChange = z.infer<typeof UnitHealChangeSchema>;
export type UnitEffectAddChange = z.infer<typeof UnitEffectAddChangeSchema>;
export type UnitEffectRemoveChange = z.infer<typeof UnitEffectRemoveChangeSchema>;
export type UnitDeathChange = z.infer<typeof UnitDeathChangeSchema>;
export type UnitKnockbackChange = z.infer<typeof UnitKnockbackChangeSchema>;
export type UnitRiverEnterChange = z.infer<typeof UnitRiverEnterChangeSchema>;
export type UnitRiverExitChange = z.infer<typeof UnitRiverExitChangeSchema>;
export type UnitActionsResetChange = z.infer<typeof UnitActionsResetChangeSchema>;
export type TileAttributeChange = z.infer<typeof TileAttributeChangeSchema>;
export type TileEffectTickChange = z.infer<typeof TileEffectTickChangeSchema>;
export type TurnAdvanceChange = z.infer<typeof TurnAdvanceChangeSchema>;
export type RoundAdvanceChange = z.infer<typeof RoundAdvanceChangeSchema>;
export type PhaseChange = z.infer<typeof PhaseChangeSchema>;
export type GameChange = z.infer<typeof GameChangeSchema>;
