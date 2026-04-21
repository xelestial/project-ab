import { z } from "zod";
import {
  MetaIdSchema,
  AttackTypeSchema,
  RangeTypeSchema,
  AttackAttributeSchema,
  UnitClassSchema,
  UnitEffectTypeSchema,
  TileAttributeTypeSchema,
  PositionSchema,
} from "./base.js";

// ─── Knockback spec ──────────────────────────────────────────────────────────

export const KnockbackSpecSchema = z.object({
  /** Number of tiles pushed */
  distance: z.number().int().min(1),
  /**
   * "away"   — pushed away from attacker
   * "fixed"  — pushed in a direction defined per skill/weapon
   */
  direction: z.enum(["away", "fixed"]),
  /** If direction is "fixed", provide a vector */
  fixedDelta: z.object({ dRow: z.number().int(), dCol: z.number().int() }).optional(),
});
export type KnockbackSpec = z.infer<typeof KnockbackSpecSchema>;

// ─── Area spec ───────────────────────────────────────────────────────────────

export const AreaSpecSchema = z.object({
  /** Manhattan radius */
  radius: z.number().int().min(0),
  /** Whether center tile is also hit */
  includeCenter: z.boolean(),
});
export type AreaSpec = z.infer<typeof AreaSpecSchema>;

// ─── WeaponMeta ──────────────────────────────────────────────────────────────

export const WeaponMetaSchema = z.object({
  id: MetaIdSchema,
  nameKey: z.string(),
  descKey: z.string(),
  attackType: AttackTypeSchema,
  rangeType: RangeTypeSchema,
  /** Manhattan range (min/max). Melee: [1,1], Ranged: e.g. [2,3] */
  minRange: z.number().int().min(0),
  maxRange: z.number().int().min(1),
  damage: z.number().int().min(0),
  /** Element applied on hit */
  attribute: AttackAttributeSchema,
  knockback: KnockbackSpecSchema.optional(),
  area: AreaSpecSchema.optional(),
  /** Does this attack pierce (penetrate) through units? */
  penetrating: z.boolean().default(false),
  /** Can this attack arc over mountains? (artillery) */
  arcing: z.boolean().default(false),
  /** Rush attack: attacker moves to adjacent of target during attack */
  rush: z.object({ requiresClearPath: z.boolean().default(true) }).optional(),
  /** Pull attack: target is pulled to adjacent of attacker */
  pull: z.object({ landAdjacent: z.boolean().default(true) }).optional(),
  /** Adjacent tile absorb: attacker can absorb adjacent tile attribute for attack */
  adjacentTileAbsorb: z.boolean().default(false),
  /** Requires clear straight-line path (no units or mountains between) */
  requiresClearPath: z.boolean().default(false),
});
export type WeaponMeta = z.infer<typeof WeaponMetaSchema>;

// ─── Skill meta ──────────────────────────────────────────────────────────────

export const SkillMetaSchema = z.object({
  id: MetaIdSchema,
  nameKey: z.string(),
  descKey: z.string(),
  /**
   * "active"  — player triggers manually, uses the attack action
   * "passive" — always on
   * "reactive"— triggers on specific conditions (e.g. being hit)
   */
  type: z.enum(["active", "passive", "reactive"]),
  /** One use per game */
  oneShot: z.boolean().default(true),
  /** Weapon template to use when this skill is activated (active skills) */
  weaponId: MetaIdSchema.optional(),
  /** Self-buff or conditional effect to apply (passive / reactive) */
  effectId: MetaIdSchema.optional(),
});
export type SkillMeta = z.infer<typeof SkillMetaSchema>;

// ─── UnitMeta ─────────────────────────────────────────────────────────────────

export const UnitMetaSchema = z.object({
  id: MetaIdSchema,
  nameKey: z.string(),
  descKey: z.string(),
  class: UnitClassSchema,
  faction: z.string().min(1),
  baseMovement: z.number().int().min(1),
  baseHealth: z.number().int().min(1),
  baseArmor: z.number().int().min(0),
  /** Intrinsic attributes (e.g. a fire unit is immune to fire) */
  attributes: z.array(AttackAttributeSchema).default([]),
  primaryWeaponId: MetaIdSchema,
  skillIds: z.array(MetaIdSchema).default([]),
  passiveIds: z.array(MetaIdSchema).default([]),
  /** Asset sprite path key */
  spriteKey: z.string(),
});
export type UnitMeta = z.infer<typeof UnitMetaSchema>;

// ─── EffectMeta ───────────────────────────────────────────────────────────────

export const RemoveConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turns"), count: z.number().int().min(1) }),
  z.object({ type: z.literal("on_move") }),
  z.object({ type: z.literal("on_attack") }),
  z.object({ type: z.literal("manual_extinguish") }),
  z.object({ type: z.literal("collision_with_frozen") }),
  z.object({ type: z.literal("river_entry") }),
]);
export type RemoveCondition = z.infer<typeof RemoveConditionSchema>;

export const EffectMetaSchema = z.object({
  id: MetaIdSchema,
  nameKey: z.string(),
  descKey: z.string(),
  /** What kind of unit-based effect this maps to */
  effectType: UnitEffectTypeSchema,
  /** Damage dealt per turn (start of affected player's turn) */
  damagePerTurn: z.number().int().min(0).default(0),
  /** Whether this effect prevents all actions */
  blocksAllActions: z.boolean().default(false),
  /** Whether this effect is also applied to the tile simultaneously */
  alsoAffectsTile: z.boolean().default(false),
  /**
   * When this effect is applied, clear all OTHER existing effects first.
   * e.g. freeze wipes out fire/acid/etc before applying itself.
   */
  clearsAllEffectsOnApply: z.boolean().default(false),
  removeConditions: z.array(RemoveConditionSchema),
});
export type EffectMeta = z.infer<typeof EffectMetaSchema>;

// ─── TileAttributeMeta ────────────────────────────────────────────────────────

export const TileAttributeMetaSchema = z.object({
  id: MetaIdSchema,
  tileType: TileAttributeTypeSchema,
  nameKey: z.string(),
  descKey: z.string(),
  /** Movement cost to enter this tile (default 1) */
  moveCost: z.number().int().min(1).default(1),
  /** If true, units cannot stop on this tile but may pass through */
  cannotStop: z.boolean().default(false),
  /** If true, units cannot enter this tile at all */
  impassable: z.boolean().default(false),
  /**
   * Effect applied to unit when it steps onto this tile.
   * River is handled specially — not an effect but a mechanic.
   */
  appliesEffectId: MetaIdSchema.optional(),
  /**
   * Effect types removed from a unit when it enters this tile.
   * e.g. water tile removes ["fire", "acid"].
   */
  removesEffectTypes: z.array(UnitEffectTypeSchema).default([]),
  /**
   * If true, ALL existing effects are removed before appliesEffectId is applied.
   * e.g. ice tile clears fire/acid/etc then applies freeze.
   */
  clearsAllEffects: z.boolean().default(false),
  /**
   * If this tile type deals periodic damage to standing units
   * (e.g. fire tile = 2 dmg/turn)
   */
  damagePerTurn: z.number().int().min(0).default(0),
});
export type TileAttributeMeta = z.infer<typeof TileAttributeMetaSchema>;

// ─── UnitPassiveMeta ──────────────────────────────────────────────────────────

export const PassiveTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("on_tile_entry_of"), tileAttribute: TileAttributeTypeSchema }),
  z.object({ type: z.literal("on_tile_entry_any_attribute") }),
  z.object({ type: z.literal("always_on") }),
]);
export type PassiveTrigger = z.infer<typeof PassiveTriggerSchema>;

export const PassiveActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heal_self"), amount: z.number().int().min(1) }),
  z.object({ type: z.literal("convert_entered_tile"), to: TileAttributeTypeSchema }),
  z.object({ type: z.literal("spread_entered_tile_attr") }),
  z.object({ type: z.literal("immune_tile_effects") }),
  z.object({ type: z.literal("immune_tile_damage") }),
  z.object({ type: z.literal("immune_elemental_effects") }),
]);
export type PassiveAction = z.infer<typeof PassiveActionSchema>;

export const UnitPassiveMetaSchema = z.object({
  id: MetaIdSchema,
  nameKey: z.string(),
  descKey: z.string(),
  trigger: PassiveTriggerSchema,
  actions: z.array(PassiveActionSchema),
});
export type UnitPassiveMeta = z.infer<typeof UnitPassiveMetaSchema>;

// ─── ElementalReaction ────────────────────────────────────────────────────────

/**
 * Defines how an attack attribute interacts with a target unit's current effect.
 * Looked up at attack time; all matching reactions are applied.
 */
export const ElementalReactionSchema = z.object({
  /** The attacking weapon/tile attribute */
  attackAttr: AttackAttributeSchema,
  /** The effect the target must currently have for this reaction to trigger */
  targetEffect: UnitEffectTypeSchema,
  /** Multiplier applied to the attack's base damage (0 = full block) */
  damageMultiplier: z.number().min(0).max(2),
  /** Effects removed from the target when this reaction fires */
  removedEffects: z.array(UnitEffectTypeSchema),
});
export type ElementalReaction = z.infer<typeof ElementalReactionSchema>;

// ─── MapMeta ──────────────────────────────────────────────────────────────────

export const SpawnPointSchema = z.object({
  playerId: z.number().int().min(0), // 0-indexed player slot
  positions: z.array(PositionSchema),
});
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;

export const ObjectPlacementSchema = z.object({
  position: PositionSchema,
  tileType: TileAttributeTypeSchema,
});
export type ObjectPlacement = z.infer<typeof ObjectPlacementSchema>;

export const MapMetaSchema = z.object({
  id: MetaIdSchema,
  nameKey: z.string(),
  descKey: z.string(),
  /** Supported player counts */
  playerCounts: z.array(z.number().int().min(2).max(4)),
  /** Grid is gridSize × gridSize; defaults to GRID_SIZE (11) if omitted */
  gridSize: z.number().int().min(5).optional(),
  /** Max units each player may draft; defaults to MAX_DRAFT_SLOTS (3) if omitted */
  maxUnitsPerPlayer: z.number().int().min(1).optional(),
  /** Number of players per team (1 = free-for-all / 1v1, 2 = 2v2, etc.) */
  teamSize: z.number().int().min(1).optional(),
  /** Grid is always gridSize × gridSize; this defines non-plain overrides */
  tileOverrides: z.array(ObjectPlacementSchema).default([]),
  spawnPoints: z.array(SpawnPointSchema),
});
export type MapMeta = z.infer<typeof MapMetaSchema>;
