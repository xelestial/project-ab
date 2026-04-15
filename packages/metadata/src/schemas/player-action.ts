import { z } from "zod";
import { PlayerIdSchema, UnitIdSchema, PositionSchema, MetaIdSchema } from "./base.js";

// ─── Base ─────────────────────────────────────────────────────────────────────

const BaseActionSchema = z.object({
  playerId: PlayerIdSchema,
  unitId: UnitIdSchema,
});

// ─── Action types ─────────────────────────────────────────────────────────────

export const MoveActionSchema = BaseActionSchema.extend({
  type: z.literal("move"),
  destination: PositionSchema,
});

export const AttackActionSchema = BaseActionSchema.extend({
  type: z.literal("attack"),
  target: PositionSchema,
});

export const SkillActionSchema = BaseActionSchema.extend({
  type: z.literal("skill"),
  skillId: MetaIdSchema,
  /** Target position (if skill requires one) */
  target: PositionSchema.optional(),
});

export const ExtinguishActionSchema = BaseActionSchema.extend({
  type: z.literal("extinguish"),
  /** Self-extinguish: unitId is the unit on fire */
});

export const PassActionSchema = BaseActionSchema.extend({
  type: z.literal("pass"),
});

export const DraftPlaceActionSchema = z.object({
  type: z.literal("draft_place"),
  playerId: PlayerIdSchema,
  /** Optional: assigned unit ID (generated server-side if omitted) */
  unitId: UnitIdSchema.optional(),
  metaId: MetaIdSchema,
  position: PositionSchema,
});

// ─── Union ────────────────────────────────────────────────────────────────────

export const PlayerActionSchema = z.discriminatedUnion("type", [
  MoveActionSchema,
  AttackActionSchema,
  SkillActionSchema,
  ExtinguishActionSchema,
  PassActionSchema,
  DraftPlaceActionSchema,
]);

export type MoveAction = z.infer<typeof MoveActionSchema>;
export type AttackAction = z.infer<typeof AttackActionSchema>;
export type SkillAction = z.infer<typeof SkillActionSchema>;
export type ExtinguishAction = z.infer<typeof ExtinguishActionSchema>;
export type PassAction = z.infer<typeof PassActionSchema>;
export type DraftPlaceAction = z.infer<typeof DraftPlaceActionSchema>;
export type PlayerAction = z.infer<typeof PlayerActionSchema>;
