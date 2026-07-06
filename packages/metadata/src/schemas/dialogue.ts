import { z } from "zod";
import { MetaIdSchema, UnitIdSchema } from "./base.js";

// ─── Dialogue character metadata ─────────────────────────────────────────────

export const DialogueCharacterLayoutSchema = z.object({
  /** Horizontal portrait offset in dialogue UI space */
  offsetX: z.number().default(0),
  /** Vertical portrait offset in dialogue UI space */
  offsetY: z.number().default(0),
  /** Per-character portrait scale correction */
  scale: z.number().positive().default(1),
});
export type DialogueCharacterLayout = z.infer<typeof DialogueCharacterLayoutSchema>;

export const DialoguePortraitMapSchema = z.record(z.string().min(1));
export type DialoguePortraitMap = z.infer<typeof DialoguePortraitMapSchema>;

export const DialogueCharacterMetaSchema = z.object({
  /** Stable dialogue actor identity, e.g. char_sejin */
  id: MetaIdSchema,
  /** i18n key displayed in the name plate */
  displayNameKey: z.string().min(1),
  /** Small UI thumbnail asset key. If omitted, resolver falls back to portrait/battle sprite. */
  thumbnailKey: z.string().min(1).optional(),
  /** emotion id -> large dialogue portrait asset key */
  portraits: DialoguePortraitMapSchema,
  /** Emotion used when the requested emotion is missing */
  defaultEmotion: z.string().min(1).default("normal"),
  /** Optional UI correction for portrait placement */
  layout: DialogueCharacterLayoutSchema.optional(),
}).refine(
  (v) => v.portraits[v.defaultEmotion] !== undefined,
  { message: "defaultEmotion must exist in portraits" },
);
export type DialogueCharacterMeta = z.infer<typeof DialogueCharacterMetaSchema>;

// ─── Unit -> dialogue actor binding ──────────────────────────────────────────

export const UnitDialogueBindingSchema = z.object({
  /** UnitMeta.id. Kept outside UnitMeta so battle metadata stays rule-focused. */
  unitMetaId: MetaIdSchema,
  /** DialogueCharacterMeta.id. Required only when canSpeak=true. */
  characterId: MetaIdSchema.optional(),
  /** Obstacles or anonymous units can explicitly opt out of dialogue. */
  canSpeak: z.boolean().default(true),
}).refine(
  (v) => !v.canSpeak || v.characterId !== undefined,
  { message: "characterId is required when canSpeak is true" },
);
export type UnitDialogueBinding = z.infer<typeof UnitDialogueBindingSchema>;

// ─── Runtime view model produced by the dialogue actor resolver ──────────────

export const DialogueActorViewModelSchema = z.object({
  /** Resolved actor id. Usually DialogueCharacterMeta.id; fallback can be UnitMeta.id. */
  actorId: MetaIdSchema,
  /** Runtime unit instance that caused this actor resolution, if any. */
  sourceUnitId: UnitIdSchema.optional(),
  displayNameKey: z.string().min(1),
  portraitKey: z.string().min(1),
  thumbnailKey: z.string().min(1).optional(),
  layout: DialogueCharacterLayoutSchema.optional(),
  canSpeak: z.boolean(),
});
export type DialogueActorViewModel = z.infer<typeof DialogueActorViewModelSchema>;
