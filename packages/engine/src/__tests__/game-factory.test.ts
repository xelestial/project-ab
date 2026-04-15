/**
 * GameFactory — DI container assembly and createInitialState.
 */
import { describe, it, expect } from "vitest";
import { GameFactory } from "../context/game-factory.js";
import { makeRegistry, FIXTURE_MAPS } from "./test-helpers.js";

describe("GameFactory", () => {
  describe("createContext", () => {
    it("assembles all modules without error", () => {
      const registry = makeRegistry();
      const factory = new GameFactory(registry);
      const ctx = factory.createContext();

      expect(ctx.movementValidator).toBeDefined();
      expect(ctx.attackValidator).toBeDefined();
      expect(ctx.effectValidator).toBeDefined();
      expect(ctx.tileValidator).toBeDefined();
      expect(ctx.movementResolver).toBeDefined();
      expect(ctx.attackResolver).toBeDefined();
      expect(ctx.effectResolver).toBeDefined();
      expect(ctx.tileResolver).toBeDefined();
      expect(ctx.healthManager).toBeDefined();
      expect(ctx.effectManager).toBeDefined();
      expect(ctx.tileManager).toBeDefined();
      expect(ctx.turnManager).toBeDefined();
      expect(ctx.draftManager).toBeDefined();
      expect(ctx.roundManager).toBeDefined();
      expect(ctx.endDetector).toBeDefined();
      expect(ctx.actionProcessor).toBeDefined();
      expect(ctx.postProcessor).toBeDefined();
      expect(ctx.gameLoop).toBeDefined();
      expect(ctx.eventBus).toBeDefined();
      expect(ctx.logger).toBeDefined();
    });
  });

  describe("createInitialState", () => {
    it("creates a waiting-phase GameState with correct gameId", () => {
      const registry = makeRegistry();
      const factory = new GameFactory(registry);

      const state = factory.createInitialState({
        gameId: "test-game-1",
        mapId: "map_test",
        players: [
          { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0 },
          { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1 },
        ],
      });

      expect(state.gameId).toBe("test-game-1");
      expect(state.phase).toBe("waiting");
      expect(state.round).toBe(1);
      expect(state.currentTurnIndex).toBe(0);
    });

    it("creates player entries with default priority 1", () => {
      const registry = makeRegistry();
      const factory = new GameFactory(registry);

      const state = factory.createInitialState({
        gameId: "g1",
        mapId: "map_test",
        players: [
          { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0 },
          { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1 },
        ],
      });

      expect(state.players["p1"]!.priority).toBe(1);
      expect(state.players["p2"]!.priority).toBe(1);
      expect(state.players["p1"]!.teamIndex).toBe(0);
      expect(state.players["p2"]!.teamIndex).toBe(1);
    });

    it("creates state with empty units and empty turn order", () => {
      const registry = makeRegistry();
      const factory = new GameFactory(registry);

      const state = factory.createInitialState({
        gameId: "g1",
        mapId: "map_test",
        players: [
          { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0 },
        ],
      });

      expect(Object.keys(state.units)).toHaveLength(0);
      expect(state.turnOrder).toHaveLength(0);
    });

    it("creates draft state when draftPoolIds provided", () => {
      const registry = makeRegistry();
      const factory = new GameFactory(registry);

      const state = factory.createInitialState({
        gameId: "g1",
        mapId: "map_test",
        players: [
          { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0 },
        ],
        draftPoolIds: ["t1", "f1", "r1"],
      });

      expect(state.draft).toBeDefined();
      expect(state.draft!.poolIds).toHaveLength(3);
      expect(state.draft!.timeoutRemainingMs).toBe(180_000);
    });

    it("creates no draft state when draftPoolIds not provided", () => {
      const registry = makeRegistry();
      const factory = new GameFactory(registry);

      const state = factory.createInitialState({
        gameId: "g1",
        mapId: "map_test",
        players: [
          { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0 },
        ],
      });

      expect(state.draft).toBeUndefined();
    });
  });
});
