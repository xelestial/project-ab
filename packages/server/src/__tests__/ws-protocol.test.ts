import { describe, it, expect } from "vitest";
import { encodeMessage, decodeMessage } from "../ws/ws-protocol.js";

describe("ws-protocol", () => {
  describe("encodeMessage", () => {
    it("encodes pong message", () => {
      const encoded = encodeMessage({ type: "pong" });
      expect(JSON.parse(encoded)).toEqual({ type: "pong" });
    });

    it("encodes game_end message", () => {
      const msg = {
        type: "game_end" as const,
        gameId: "g1",
        winnerIds: ["p1"],
        reason: "all_units_dead",
      };
      const encoded = encodeMessage(msg);
      expect(JSON.parse(encoded).type).toBe("game_end");
    });
  });

  describe("decodeMessage", () => {
    it("decodes join message", () => {
      const raw = JSON.stringify({
        type: "join",
        gameId: "g1",
        playerId: "p1",
        token: "tok",
      });
      const msg = decodeMessage(raw);
      expect(msg).not.toBeNull();
      expect(msg?.type).toBe("join");
    });

    it("decodes ping message", () => {
      const raw = JSON.stringify({ type: "ping" });
      const msg = decodeMessage(raw);
      expect(msg?.type).toBe("ping");
    });

    it("decodes action message with move action", () => {
      const raw = JSON.stringify({
        type: "action",
        gameId: "g1",
        action: {
          type: "move",
          playerId: "p1",
          unitId: "u1",
          destination: { row: 3, col: 4 },
        },
      });
      const msg = decodeMessage(raw);
      expect(msg?.type).toBe("action");
    });

    it("returns null for invalid JSON", () => {
      expect(decodeMessage("not json")).toBeNull();
    });

    it("returns null for unknown message type", () => {
      const raw = JSON.stringify({ type: "teleport" });
      expect(decodeMessage(raw)).toBeNull();
    });

    it("returns null for malformed action", () => {
      const raw = JSON.stringify({ type: "action", gameId: "g1" }); // missing action
      expect(decodeMessage(raw)).toBeNull();
    });

    it("decodes spectate message", () => {
      const raw = JSON.stringify({ type: "spectate", gameId: "g1" });
      const msg = decodeMessage(raw);
      expect(msg?.type).toBe("spectate");
    });

    it("decodes surrender message", () => {
      const raw = JSON.stringify({ type: "surrender", gameId: "g1", playerId: "p1" });
      const msg = decodeMessage(raw);
      expect(msg?.type).toBe("surrender");
    });
  });

  describe("ServerMessage — new types", () => {
    it("encodes spectator_joined", () => {
      const encoded = encodeMessage({ type: "spectator_joined", gameId: "g1", spectatorCount: 3 });
      const parsed = JSON.parse(encoded);
      expect(parsed.type).toBe("spectator_joined");
      expect(parsed.spectatorCount).toBe(3);
    });
  });
});
