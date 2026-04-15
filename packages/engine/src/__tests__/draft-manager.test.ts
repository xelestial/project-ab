/**
 * DraftManager — pool enforcement, slot limits, 2v2 turn order, timeout fallback.
 */
import { describe, it, expect } from "vitest";
import type { GameState, DraftSlot } from "@ab/metadata";
import { DraftManager } from "../managers/draft-manager.js";
import { StateApplicator } from "../state/state-applicator.js";
import { makeRegistry, FIXTURE_MAPS } from "./test-helpers.js";

function makeManager() {
  const registry = makeRegistry();
  const applicator = new StateApplicator();
  return { manager: new DraftManager(registry, applicator), registry };
}

function makeDraftState(overrides: Partial<GameState> = {}): GameState {
  const now = new Date().toISOString();
  return {
    gameId: "draft-test" as import("@ab/metadata").GameId,
    phase: "draft",
    round: 1,
    turnOrder: [],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: [], connected: true, surrendered: false },
      p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: [], connected: true, surrendered: false },
    },
    units: {},
    map: { mapId: "map_test" as import("@ab/metadata").MetaId, gridSize: 11, tiles: {} },
    draft: {
      poolIds: ["t1", "f1", "r1", "t1", "f1", "r1"] as import("@ab/metadata").MetaId[],
      slots: [],
      timeoutRemainingMs: 180_000,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("DraftManager", () => {
  describe("startDraft", () => {
    it("transitions phase to draft", () => {
      const { manager } = makeManager();
      const state: GameState = {
        ...makeDraftState(),
        phase: "waiting",
      };

      const newState = manager.startDraft(state);
      expect(newState.phase).toBe("draft");
    });
  });

  describe("placeUnit", () => {
    it("places a valid unit at valid spawn point", () => {
      const { manager } = makeManager();
      const state = makeDraftState();

      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 }, // valid spawn for p1 (playerIndex 0)
        },
        state,
      );

      expect(Object.keys(newState.units)).toHaveLength(1);
      expect(newState.draft!.slots).toHaveLength(1);
      expect(newState.draft!.slots[0]!.confirmed).toBe(true);
    });

    it("rejects placement if metaId not in pool", () => {
      const { manager } = makeManager();
      const state = makeDraftState();

      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "nonexistent_unit" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 },
        },
        state,
      );

      expect(Object.keys(newState.units)).toHaveLength(0);
    });

    it("rejects placement if same player already drafted that metaId", () => {
      // Per-player uniqueness: a player cannot draft the same unit twice,
      // but two different players CAN draft the same unit type.
      const { manager } = makeManager();
      const state = makeDraftState({
        draft: {
          poolIds: ["t1", "f1", "r1"] as import("@ab/metadata").MetaId[],
          slots: [
            // p2 already drafted t1
            { playerId: "p2" as import("@ab/metadata").PlayerId, metaId: "t1" as import("@ab/metadata").MetaId, position: { row: 10, col: 10 }, confirmed: true },
          ],
          timeoutRemainingMs: 180_000,
        },
      });

      // p2 tries to draft t1 again → rejected
      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p2" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          position: { row: 10, col: 9 },
        },
        state,
      );

      // Still only 1 draft slot (not added again)
      expect(newState.draft!.slots).toHaveLength(1);
    });

    it("allows different players to draft the same metaId", () => {
      // Different players CAN pick the same unit type (per-player independence)
      const { manager } = makeManager();
      const state = makeDraftState({
        draft: {
          poolIds: ["t1", "f1", "r1"] as import("@ab/metadata").MetaId[],
          slots: [
            { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "t1" as import("@ab/metadata").MetaId, position: { row: 0, col: 0 }, confirmed: true },
          ],
          timeoutRemainingMs: 180_000,
        },
      });

      // p2 drafts t1 — should succeed (p2 hasn't drafted t1 yet)
      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p2" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          position: { row: 10, col: 10 },
        },
        state,
      );

      expect(newState.draft!.slots).toHaveLength(2);
      expect(Object.keys(newState.units)).toHaveLength(1);
    });

    it("rejects placement if player slot limit reached (3 units)", () => {
      const { manager } = makeManager();
      const existingSlots: DraftSlot[] = [
        { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "t1" as import("@ab/metadata").MetaId, position: { row: 0, col: 0 }, confirmed: true },
        { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "f1" as import("@ab/metadata").MetaId, position: { row: 0, col: 1 }, confirmed: true },
        { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "r1" as import("@ab/metadata").MetaId, position: { row: 0, col: 2 }, confirmed: true },
      ];
      const state = makeDraftState({
        draft: {
          poolIds: ["t1", "f1", "r1", "t1"] as import("@ab/metadata").MetaId[],
          slots: existingSlots,
          timeoutRemainingMs: 180_000,
        },
      });

      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 },
        },
        state,
      );

      // Draft slots should remain at 3 (no new addition)
      expect(newState.draft!.slots.filter(s => s.playerId === "p1")).toHaveLength(3);
    });

    it("rejects placement at invalid spawn position", () => {
      const { manager } = makeManager();
      const state = makeDraftState();

      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "f1" as import("@ab/metadata").MetaId,
          position: { row: 5, col: 5 }, // not a spawn point
        },
        state,
      );

      expect(Object.keys(newState.units)).toHaveLength(0);
    });

    it("rejects placement at occupied position", () => {
      const { manager, registry } = makeManager();
      // Place t1 first at (0,0)
      let state = makeDraftState();
      state = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 },
        },
        state,
      );

      // Try to place f1 at same position
      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "f1" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 },
        },
        state,
      );

      // Still only 1 unit
      expect(Object.keys(newState.units)).toHaveLength(1);
    });

    it("returns same state when not in draft phase", () => {
      const { manager } = makeManager();
      const state = { ...makeDraftState(), phase: "battle" as const };

      const newState = manager.placeUnit(
        {
          type: "draft_place",
          playerId: "p1" as import("@ab/metadata").PlayerId,
          unitId: "" as import("@ab/metadata").UnitId,
          metaId: "t1" as import("@ab/metadata").MetaId,
          position: { row: 0, col: 0 },
        },
        state,
      );

      expect(newState).toBe(state);
    });
  });

  describe("finalizeDraft", () => {
    it("transitions to battle phase", () => {
      const { manager } = makeManager();
      const state = makeDraftState();

      const newState = manager.finalizeDraft(state);
      expect(newState.phase).toBe("battle");
    });

    it("builds turn order with currentTurnIndex 0", () => {
      const { manager } = makeManager();
      const state = makeDraftState();

      const newState = manager.finalizeDraft(state);
      expect(newState.currentTurnIndex).toBe(0);
      expect(newState.turnOrder.length).toBeGreaterThan(0);
    });
  });

  describe("isDraftComplete", () => {
    it("returns false when no draft state", () => {
      const { manager } = makeManager();
      const state = { ...makeDraftState(), draft: undefined };
      expect(manager.isDraftComplete(state)).toBe(false);
    });

    it("returns false when players haven't filled all slots", () => {
      const { manager } = makeManager();
      const state = makeDraftState(); // empty slots
      expect(manager.isDraftComplete(state)).toBe(false);
    });

    it("returns true when both players have 3 confirmed slots", () => {
      const { manager } = makeManager();
      const slots: DraftSlot[] = [
        { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "t1" as import("@ab/metadata").MetaId, confirmed: true },
        { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "f1" as import("@ab/metadata").MetaId, confirmed: true },
        { playerId: "p1" as import("@ab/metadata").PlayerId, metaId: "r1" as import("@ab/metadata").MetaId, confirmed: true },
        { playerId: "p2" as import("@ab/metadata").PlayerId, metaId: "t1" as import("@ab/metadata").MetaId, confirmed: true },
        { playerId: "p2" as import("@ab/metadata").PlayerId, metaId: "f1" as import("@ab/metadata").MetaId, confirmed: true },
        { playerId: "p2" as import("@ab/metadata").PlayerId, metaId: "r1" as import("@ab/metadata").MetaId, confirmed: true },
      ];
      const state = makeDraftState({ draft: { poolIds: [], slots, timeoutRemainingMs: 0 } });
      expect(manager.isDraftComplete(state)).toBe(true);
    });
  });

  describe("buildTurnOrder", () => {
    it("returns players sorted by priority", () => {
      const { manager } = makeManager();
      const state: GameState = {
        ...makeDraftState(),
        players: {
          p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 2, unitIds: [], connected: true, surrendered: false },
          p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: [], connected: true, surrendered: false },
        },
      };

      const order = manager.buildTurnOrder(state, 1, null);
      // Lower priority goes first
      expect(order[0]!.playerId).toBe("p2");
      expect(order[1]!.playerId).toBe("p1");
    });

    it("alternates first player in subsequent rounds when same priority", () => {
      const { manager } = makeManager();
      const state = makeDraftState(); // both have priority 1

      const order = manager.buildTurnOrder(state, 2, "p1");
      // p1 went first last round → p2 should go first now
      expect(order[0]!.playerId).toBe("p2");
    });

    it("excludes surrendered players", () => {
      const { manager } = makeManager();
      const state: GameState = {
        ...makeDraftState(),
        players: {
          p1: { playerId: "p1" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: [], connected: true, surrendered: false },
          p2: { playerId: "p2" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: [], connected: true, surrendered: true },
        },
      };

      const order = manager.buildTurnOrder(state, 1, null);
      expect(order).toHaveLength(1);
      expect(order[0]!.playerId).toBe("p1");
    });
  });

  describe("2v2 turn order", () => {
    it("interleaves teams: T0P0, T1P0, T0P1, T1P1", () => {
      const { manager } = makeManager();
      const state: GameState = {
        ...makeDraftState(),
        players: {
          p1a: { playerId: "p1a" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: [], connected: true, surrendered: false },
          p1b: { playerId: "p1b" as import("@ab/metadata").PlayerId, teamIndex: 0, priority: 1, unitIds: [], connected: true, surrendered: false },
          p2a: { playerId: "p2a" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: [], connected: true, surrendered: false },
          p2b: { playerId: "p2b" as import("@ab/metadata").PlayerId, teamIndex: 1, priority: 1, unitIds: [], connected: true, surrendered: false },
        },
      };

      const order = manager.buildTurnOrder(state, 1, null);
      expect(order).toHaveLength(4);

      // Alternating team membership
      const teamIndices = order.map(slot => {
        const player = state.players[slot.playerId];
        return player?.teamIndex;
      });
      // Should alternate: 0,1,0,1 or 1,0,1,0
      expect(teamIndices[0]).not.toBe(teamIndices[1]);
      expect(teamIndices[1]).not.toBe(teamIndices[2]);
    });
  });

  describe("applyTimeout", () => {
    it("returns same state if not in draft phase", () => {
      const { manager } = makeManager();
      const state = { ...makeDraftState(), phase: "battle" as const };
      const result = manager.applyTimeout(state);
      expect(result).toBe(state);
    });

    it("finalizes draft and transitions to battle phase", () => {
      const { manager } = makeManager();
      const state = makeDraftState();

      const result = manager.applyTimeout(state);
      expect(result.phase).toBe("battle");
    });
  });
});
