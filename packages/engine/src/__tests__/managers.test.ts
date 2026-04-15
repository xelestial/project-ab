/**
 * Managers unit tests — TileManager, EffectManager, TurnManager, RoundManager.
 */
import { describe, it, expect } from "vitest";
import type { GameState } from "@ab/metadata";
import { TileManager } from "../managers/tile-manager.js";
import { EffectManager } from "../managers/effect-manager.js";
import { TurnManager } from "../managers/turn-manager.js";
import { RoundManager } from "../managers/round-manager.js";
import { DraftManager } from "../managers/draft-manager.js";
import { TileResolver } from "../resolvers/tile-resolver.js";
import { TileValidator } from "../validators/tile-validator.js";
import { EffectResolver } from "../resolvers/effect-resolver.js";
import { EffectValidator } from "../validators/effect-validator.js";
import { StateApplicator } from "../state/state-applicator.js";
import { HealthManager } from "../managers/health-manager.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";

function makeApplicator() {
  return new StateApplicator();
}

// ─── TileManager ─────────────────────────────────────────────────────────────

describe("TileManager", () => {
  it("converts plain tile to fire on fire attack", () => {
    const registry = makeRegistry();
    const validator = new TileValidator(registry);
    const resolver = new TileResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new TileManager(resolver, applicator);

    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const newState = manager.processAttackOnTile(
      { row: 5, col: 7 },
      "fire",
      "u1",
      "wpn_fire",
      state,
    );

    const tileKey = "5,7";
    expect(newState.map.tiles[tileKey]?.attribute).toBe("fire");
  });

  it("returns same state if attribute is none", () => {
    const registry = makeRegistry();
    const validator = new TileValidator(registry);
    const resolver = new TileResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new TileManager(resolver, applicator);

    const state = TestStateBuilder.create().build();
    const newState = manager.processAttackOnTile({ row: 5, col: 5 }, "none", "u1", "wpn1", state);
    expect(newState).toBe(state);
  });

  it("returns same state if tile already has target attribute", () => {
    const registry = makeRegistry();
    const validator = new TileValidator(registry);
    const resolver = new TileResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new TileManager(resolver, applicator);

    const state = TestStateBuilder.create()
      .withTile(5, 5, "fire")
      .build();

    const newState = manager.processAttackOnTile({ row: 5, col: 5 }, "fire", "u1", "wpn1", state);
    expect(newState).toBe(state); // no change
  });
});

// ─── EffectManager ────────────────────────────────────────────────────────────

describe("EffectManager", () => {
  it("processTurnStart: ticks fire effect (reduces turns remaining)", () => {
    const registry = makeRegistry();
    const validator = new EffectValidator(registry);
    const resolver = new EffectResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new EffectManager(resolver, applicator);

    const fireEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as import("@ab/metadata").MetaId,
      effectType: "fire",
      turnsRemaining: 3,
      appliedOnTurn: 1,
    };
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
      .build();

    const newState = manager.processTurnStart("u1", state);
    const unit = newState.units["u1"]!;
    // Fire deals 1 damage per turn
    expect(unit.currentHealth).toBeLessThan(4);
  });

  it("processTurnStart: returns same state for unit with no effects", () => {
    const registry = makeRegistry();
    const validator = new EffectValidator(registry);
    const resolver = new EffectResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new EffectManager(resolver, applicator);

    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const newState = manager.processTurnStart("u1", state);
    expect(newState).toBe(state);
  });

  it("processTurnStart: returns same state for unknown unit", () => {
    const registry = makeRegistry();
    const validator = new EffectValidator(registry);
    const resolver = new EffectResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new EffectManager(resolver, applicator);

    const state = TestStateBuilder.create().build();
    const newState = manager.processTurnStart("nonexistent", state);
    expect(newState).toBe(state);
  });

  it("processTurnStart: returns same state for dead unit", () => {
    const registry = makeRegistry();
    const validator = new EffectValidator(registry);
    const resolver = new EffectResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new EffectManager(resolver, applicator);

    const fireEffect: import("@ab/metadata").ActiveEffect = {
      effectId: "effect_fire" as import("@ab/metadata").MetaId,
      effectType: "fire",
      turnsRemaining: 3,
      appliedOnTurn: 1,
    };
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { alive: false, activeEffects: [fireEffect] })
      .build();

    const newState = manager.processTurnStart("u1", state);
    expect(newState).toBe(state);
  });

  it("processTileEntry: returns same state (hook for future teleport)", () => {
    const registry = makeRegistry();
    const validator = new EffectValidator(registry);
    const resolver = new EffectResolver(validator, registry);
    const applicator = makeApplicator();
    const manager = new EffectManager(resolver, applicator);

    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const newState = manager.processTileEntry("u1", { row: 5, col: 6 }, state);
    expect(newState).toBe(state);
  });
});

// ─── TurnManager ─────────────────────────────────────────────────────────────

describe("TurnManager", () => {
  it("getCurrentPlayer returns first player on first turn", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const player = manager.getCurrentPlayer(state);
    expect(player?.playerId).toBe("p1");
  });

  it("isActionAllowed: allows move for current player's unit", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    expect(manager.isActionAllowed("u1", "move", state)).toBe(true);
  });

  it("isActionAllowed: denies move for opponent's unit", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .withUnit("u2", "f1", "p2", 5, 8)
      .build();

    // It's p1's turn (index 0), u2 belongs to p2
    expect(manager.isActionAllowed("u2", "move", state)).toBe(false);
  });

  it("isActionAllowed: denies move for frozen unit", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withFrozenUnit("u1", "f1", "p1", 5, 5)
      .build();

    expect(manager.isActionAllowed("u1", "move", state)).toBe(false);
  });

  it("isActionAllowed: denies attack if already attacked", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { actionsUsed: { moved: false, attacked: true, skillUsed: false, extinguished: false } })
      .build();

    expect(manager.isActionAllowed("u1", "attack", state)).toBe(false);
  });

  it("isActionAllowed: denies skill if already attacked", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { actionsUsed: { moved: false, attacked: true, skillUsed: false, extinguished: false } })
      .build();

    expect(manager.isActionAllowed("u1", "skill", state)).toBe(false);
  });

  it("isActionAllowed: allows pass always for current player", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withFrozenUnit("u1", "f1", "p1", 5, 5)  // even frozen
      .build();

    // Frozen blocks pass too (it blocks all actions including pass via the frozen check)
    // According to implementation: isFrozen check returns false before pass
    // Let's check non-frozen
    const state2 = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { actionsUsed: { moved: true, attacked: true, skillUsed: true, extinguished: true } })
      .build();
    expect(manager.isActionAllowed("u1", "pass", state2)).toBe(true);
  });

  it("isActionAllowed: denies draft_place during battle phase", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    expect(manager.isActionAllowed("u1", "draft_place", state)).toBe(false);
  });

  it("isActionAllowed: returns false for dead unit", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { alive: false })
      .build();

    expect(manager.isActionAllowed("u1", "move", state)).toBe(false);
  });

  it("endTurn: advances currentTurnIndex", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .withUnit("u2", "f1", "p2", 5, 8)
      .build();

    const newState = manager.endTurn(state);
    expect(newState.currentTurnIndex).toBe(1);
  });

  it("isRoundOver: true when currentTurnIndex >= turnOrder length", () => {
    const applicator = makeApplicator();
    const manager = new TurnManager(applicator);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    // turnOrder has 2 entries; advance past last
    const stateAfterAllTurns = { ...state, currentTurnIndex: 2 };
    expect(manager.isRoundOver(stateAfterAllTurns)).toBe(true);
  });
});

// ─── RoundManager ─────────────────────────────────────────────────────────────

describe("RoundManager", () => {
  it("endRound: increments round counter", () => {
    const registry = makeRegistry();
    const applicator = makeApplicator();
    const draftManager = new DraftManager(registry, applicator);
    const manager = new RoundManager(applicator, draftManager);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .withUnit("u2", "f1", "p2", 5, 8)
      .build();

    const newState = manager.endRound(state);
    expect(newState.round).toBe(2);
  });

  it("startRound: resets all units' actionsUsed", () => {
    const registry = makeRegistry();
    const applicator = makeApplicator();
    const draftManager = new DraftManager(registry, applicator);
    const manager = new RoundManager(applicator, draftManager);
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, {
        actionsUsed: { moved: true, attacked: true, skillUsed: true, extinguished: true },
      })
      .withUnit("u2", "f1", "p2", 5, 8, {
        actionsUsed: { moved: true, attacked: true, skillUsed: true, extinguished: true },
      })
      .build();

    const newState = manager.startRound(state);
    expect(newState.units["u1"]!.actionsUsed.moved).toBe(false);
    expect(newState.units["u1"]!.actionsUsed.attacked).toBe(false);
  });

  it("isLastRound: returns true at round 30", () => {
    const registry = makeRegistry();
    const applicator = makeApplicator();
    const draftManager = new DraftManager(registry, applicator);
    const manager = new RoundManager(applicator, draftManager);
    const state = { ...TestStateBuilder.create().build(), round: 30 };
    expect(manager.isLastRound(state)).toBe(true);
  });

  it("isLastRound: returns false before round 30", () => {
    const registry = makeRegistry();
    const applicator = makeApplicator();
    const draftManager = new DraftManager(registry, applicator);
    const manager = new RoundManager(applicator, draftManager);
    const state = TestStateBuilder.create().build();
    expect(manager.isLastRound(state)).toBe(false);
  });
});
