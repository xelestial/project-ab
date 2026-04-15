import { z } from "zod";
import {
  GameIdSchema,
  PlayerIdSchema,
  UnitIdSchema,
  MetaIdSchema,
  PositionSchema,
  GamePhaseSchema,
  UnitEffectTypeSchema,
  TileAttributeTypeSchema,
  EndResultSchema,
} from "./base.js";

// ─── ActionsUsed ─────────────────────────────────────────────────────────────

export const ActionsUsedSchema = z.object({
  moved: z.boolean(),
  attacked: z.boolean(),
  /** Only one skill per game; tracks if used globally */
  skillUsed: z.boolean(),
  extinguished: z.boolean(),
});
export type ActionsUsed = z.infer<typeof ActionsUsedSchema>;

// ─── ActiveEffect ─────────────────────────────────────────────────────────────

export const ActiveEffectSchema = z.object({
  effectId: MetaIdSchema,
  effectType: UnitEffectTypeSchema,
  /** Turns remaining; undefined = permanent until condition */
  turnsRemaining: z.number().int().min(0).optional(),
  /** Turn on which this effect was applied */
  appliedOnTurn: z.number().int().min(1),
});
export type ActiveEffect = z.infer<typeof ActiveEffectSchema>;

// ─── UnitState ────────────────────────────────────────────────────────────────

export const UnitStateSchema = z.object({
  unitId: UnitIdSchema,
  metaId: MetaIdSchema,
  playerId: PlayerIdSchema,
  position: PositionSchema,
  currentHealth: z.number().int(),
  currentArmor: z.number().int().min(0),
  /** Effective movement points for this turn (from UnitMeta.baseMovement) */
  movementPoints: z.number().int().min(0),
  activeEffects: z.array(ActiveEffectSchema),
  actionsUsed: ActionsUsedSchema,
  /** false = dead / removed from board */
  alive: z.boolean(),
});
export type UnitState = z.infer<typeof UnitStateSchema>;

// ─── TileState ────────────────────────────────────────────────────────────────

export const TileStateSchema = z.object({
  position: PositionSchema,
  /** Current attribute of this tile (starts as MapMeta definition) */
  attribute: TileAttributeTypeSchema,
  /** Turns remaining for converted attributes; undefined = permanent */
  attributeTurnsRemaining: z.number().int().min(0).optional(),
});
export type TileState = z.infer<typeof TileStateSchema>;

// ─── MapState ─────────────────────────────────────────────────────────────────

export const MapStateSchema = z.object({
  mapId: MetaIdSchema,
  /** Grid dimension (gridSize × gridSize). Copied from MapMeta at game creation. */
  gridSize: z.number().int().min(5),
  /** Base tile type for cells not explicitly in the tiles map. Defaults to "plain". */
  baseTile: TileAttributeTypeSchema.optional(),
  /** Flat map: "row,col" → TileState (only tiles with non-default state stored) */
  tiles: z.record(z.string(), TileStateSchema),
});
export type MapState = z.infer<typeof MapStateSchema>;

// ─── DraftSlot ────────────────────────────────────────────────────────────────

export const DraftSlotSchema = z.object({
  /** Which player drafted this slot */
  playerId: PlayerIdSchema,
  /** The chosen unit metadata ID */
  metaId: MetaIdSchema,
  /** Board position chosen by the player */
  position: PositionSchema.optional(),
  /** true = confirmed; false = still placing */
  confirmed: z.boolean(),
});
export type DraftSlot = z.infer<typeof DraftSlotSchema>;

export const DraftStateSchema = z.object({
  /** Available units to choose from */
  poolIds: z.array(MetaIdSchema),
  /** Placed/confirmed slots indexed by slot index */
  slots: z.array(DraftSlotSchema),
  /** Countdown ms remaining (updated by server) */
  timeoutRemainingMs: z.number().int().min(0),
});
export type DraftState = z.infer<typeof DraftStateSchema>;

// ─── TurnSlot ─────────────────────────────────────────────────────────────────

export const TurnSlotSchema = z.object({
  playerId: PlayerIdSchema,
  priority: z.number().int().min(1),
});
export type TurnSlot = z.infer<typeof TurnSlotSchema>;

// ─── PlayerState ──────────────────────────────────────────────────────────────

export const PlayerStateSchema = z.object({
  playerId: PlayerIdSchema,
  /** 0-indexed team (0 = team A, 1 = team B in 2v2; same as playerId index in 1v1) */
  teamIndex: z.number().int().min(0),
  priority: z.number().int().min(1),
  /** IDs of units belonging to this player */
  unitIds: z.array(UnitIdSchema),
  connected: z.boolean(),
  surrendered: z.boolean(),
});
export type PlayerState = z.infer<typeof PlayerStateSchema>;

// ─── GameState (immutable snapshot) ──────────────────────────────────────────

export const GameStateSchema = z.object({
  gameId: GameIdSchema,
  phase: GamePhaseSchema,
  round: z.number().int().min(1),
  /** Ordered turn sequence for current round */
  turnOrder: z.array(TurnSlotSchema),
  /** Index into turnOrder for current active player */
  currentTurnIndex: z.number().int().min(0),
  players: z.record(z.string(), PlayerStateSchema),
  units: z.record(z.string(), UnitStateSchema),
  map: MapStateSchema,
  draft: DraftStateSchema.optional(),
  /** Set when phase === "result" */
  endResult: z
    .object({
      result: EndResultSchema,
      winnerIds: z.array(PlayerIdSchema),
    })
    .optional(),
  /** ISO timestamp */
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GameState = z.infer<typeof GameStateSchema>;
