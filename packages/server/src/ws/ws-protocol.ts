/**
 * WebSocket protocol types — shared between server and client (Unity/React).
 * P-10: All references by ID; no circular imports.
 *
 * ⚠️ Unity clients connect via the same WebSocket URL and protocol.
 *    Only the rendering layer differs — the message format is identical.
 */
import { z } from "zod";
import { PlayerActionSchema } from "@ab/metadata";

// ─── Client → Server messages ─────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    gameId: z.string(),
    playerId: z.string(),
    token: z.string(),
  }),
  z.object({
    type: z.literal("spectate"),
    gameId: z.string(),
  }),
  z.object({
    type: z.literal("action"),
    gameId: z.string(),
    action: PlayerActionSchema,
  }),
  z.object({
    type: z.literal("unit_order"),
    gameId: z.string(),
    unitOrder: z.array(z.string()),
  }),
  z.object({
    type: z.literal("ping"),
  }),
  z.object({
    type: z.literal("surrender"),
    gameId: z.string(),
    playerId: z.string(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → Client messages ─────────────────────────────────────────────────

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("joined"),
    gameId: z.string(),
    playerId: z.string(),
  }),
  z.object({
    type: z.literal("spectator_joined"),
    gameId: z.string(),
    spectatorCount: z.number(),
  }),
  z.object({
    type: z.literal("state_update"),
    gameId: z.string(),
    state: z.unknown(), // GameState — sent as JSON
  }),
  z.object({
    type: z.literal("action_accepted"),
    gameId: z.string(),
    action: PlayerActionSchema,
  }),
  z.object({
    type: z.literal("action_rejected"),
    gameId: z.string(),
    errorCode: z.string(),
    errorMessage: z.string(),
  }),
  z.object({
    type: z.literal("turn_start"),
    gameId: z.string(),
    playerId: z.string(),
    turnIndex: z.number(),
    round: z.number(),
    timeoutMs: z.number(),
  }),
  z.object({
    type: z.literal("game_end"),
    gameId: z.string(),
    winnerIds: z.array(z.string()),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("request_unit_order"),
    gameId: z.string(),
    aliveUnitIds: z.array(z.string()),
    timeoutMs: z.number(),
  }),
  z.object({
    type: z.literal("pong"),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── Serialization ────────────────────────────────────────────────────────────

export function encodeMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    return ClientMessageSchema.parse(parsed);
  } catch {
    return null;
  }
}
