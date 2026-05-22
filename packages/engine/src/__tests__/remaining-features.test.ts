/**
 * Tests for three previously unimplemented features:
 *
 *  A. Stun enforcement  — units with "stun" effect cannot move or attack
 *  B. Confusion mechanic — weapon.confusion applies "confused" effect; confused
 *                           unit cannot use the blocked attackType
 *  C. canTargetSelf guard — weapons without canTargetSelf=true cannot target
 *                            the attacker's own tile
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import type { GameState, UnitState, GameChange } from "@ab/metadata";
import { AttackValidator } from "../validators/attack-validator.js";
import { AttackResolver } from "../resolvers/attack-resolver.js";
import { MovementValidator } from "../validators/movement-validator.js";
import { TileTransitionResolver } from "../resolvers/tile-transition-resolver.js";

// ─── Shared fixture data ──────────────────────────────────────────────────────

const WPN_MELEE = {
  id: "wpn_melee",
  nameKey: "n", descKey: "d",
  attackType: "melee", rangeType: "single",
  minRange: 1, maxRange: 1,
  damage: 2, attribute: "none",
  penetrating: false, arcing: false,
};

const WPN_RANGED = {
  id: "wpn_ranged",
  nameKey: "n", descKey: "d",
  attackType: "ranged", rangeType: "single",
  minRange: 2, maxRange: 4,
  damage: 2, attribute: "none",
  penetrating: false, arcing: false,
};

/** Weapon that applies confusion (blocks ranged) on hit */
const WPN_CONFUSE_RANGED = {
  id: "wpn_confuse_ranged",
  nameKey: "n", descKey: "d",
  attackType: "melee", rangeType: "single",
  minRange: 1, maxRange: 1,
  damage: 1, attribute: "none",
  penetrating: false, arcing: false,
  confusion: { blocksAttackType: "ranged" },
};

/** Weapon that applies confusion (blocks melee) on hit */
const WPN_CONFUSE_MELEE = {
  id: "wpn_confuse_melee",
  nameKey: "n", descKey: "d",
  attackType: "ranged", rangeType: "single",
  minRange: 2, maxRange: 3,
  damage: 1, attribute: "none",
  penetrating: false, arcing: false,
  confusion: { blocksAttackType: "melee" },
};

/** Self-targeting special weapon (like self_ignite) */
const WPN_SELF_TARGET = {
  id: "wpn_self_target",
  nameKey: "n", descKey: "d",
  attackType: "special", rangeType: "single",
  minRange: 0, maxRange: 0,
  damage: 0, attribute: "none",
  penetrating: false, arcing: false,
  canTargetSelf: true,
};

const UNIT_ATTACKER = {
  id: "u_attacker", nameKey: "n", descKey: "d",
  class: "fighter", faction: "a",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_melee",
  passiveIds: [], spriteKey: "s", priority: 1,
};

const UNIT_RANGED_ATTACKER = {
  id: "u_ranged_attacker", nameKey: "n", descKey: "d",
  class: "ranger", faction: "a",
  baseMovement: 2, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_ranged",
  passiveIds: [], spriteKey: "s", priority: 1,
};

const UNIT_CONFUSE_RANGED_ATTACKER = {
  id: "u_confuse_ranged", nameKey: "n", descKey: "d",
  class: "fighter", faction: "a",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_confuse_ranged",
  passiveIds: [], spriteKey: "s", priority: 1,
};

const UNIT_CONFUSE_MELEE_ATTACKER = {
  id: "u_confuse_melee", nameKey: "n", descKey: "d",
  class: "ranger", faction: "a",
  baseMovement: 2, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_confuse_melee",
  passiveIds: [], spriteKey: "s", priority: 1,
};

const UNIT_SELF_TARGET = {
  id: "u_self_target", nameKey: "n", descKey: "d",
  class: "support", faction: "a",
  baseMovement: 2, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_self_target",
  passiveIds: [], spriteKey: "s", priority: 1,
};

const UNIT_TARGET = {
  id: "u_target", nameKey: "n", descKey: "d",
  class: "fighter", faction: "b",
  baseMovement: 3, baseHealth: 4, baseArmor: 0,
  primaryWeaponId: "wpn_melee",
  passiveIds: [], spriteKey: "s", priority: 1,
};

const FIXTURE_EFFECTS = [
  {
    id: "effect_freeze",
    nameKey: "n", descKey: "d",
    effectType: "freeze",
    damagePerTurn: 0,
    blocksAllActions: true,
    alsoAffectsTile: false,
    clearsAllEffectsOnApply: true,
    removeConditions: [{ type: "turns", count: 1 }],
  },
  {
    id: "effect_stun",
    nameKey: "n", descKey: "d",
    effectType: "stun",
    damagePerTurn: 0,
    blocksAllActions: true,
    alsoAffectsTile: false,
    removeConditions: [{ type: "turns", count: 1 }],
  },
  {
    id: "effect_confused_ranged",
    nameKey: "n", descKey: "d",
    effectType: "confused",
    damagePerTurn: 0,
    blocksAllActions: false,
    alsoAffectsTile: false,
    blocksAttackType: "ranged",
    removeConditions: [{ type: "turns", count: 2 }],
  },
  {
    id: "effect_confused_melee",
    nameKey: "n", descKey: "d",
    effectType: "confused",
    damagePerTurn: 0,
    blocksAllActions: false,
    alsoAffectsTile: false,
    blocksAttackType: "melee",
    removeConditions: [{ type: "turns", count: 2 }],
  },
];

const FIXTURE_MAPS = [
  {
    id: "map_test",
    nameKey: "n", descKey: "d",
    playerCounts: [2],
    tileOverrides: [],
    spawnPoints: [
      { playerId: 0, positions: [{ row: 0, col: 0 }] },
      { playerId: 1, positions: [{ row: 10, col: 10 }] },
    ],
  },
];

function makeRegistry(extraWeapons: object[] = []) {
  return buildDataRegistry({
    units: [
      UNIT_ATTACKER, UNIT_RANGED_ATTACKER, UNIT_CONFUSE_RANGED_ATTACKER,
      UNIT_CONFUSE_MELEE_ATTACKER, UNIT_SELF_TARGET, UNIT_TARGET,
    ],
    weapons: [WPN_MELEE, WPN_RANGED, WPN_CONFUSE_RANGED, WPN_CONFUSE_MELEE, WPN_SELF_TARGET, ...extraWeapons],
    skills: [],
    effects: FIXTURE_EFFECTS,
    tiles: [],
    maps: FIXTURE_MAPS,
    elementalReactions: [],
  });
}

function makeState(units: UnitState[], tiles: Record<string, { attribute: string }> = {}): GameState {
  const now = new Date().toISOString();
  return {
    gameId: "g" as import("@ab/metadata").GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: "p1" as import("@ab/metadata").PlayerId, priority: 1 },
      { playerId: "p2" as import("@ab/metadata").PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: {
        playerId: "p1" as import("@ab/metadata").PlayerId,
        teamIndex: 0, priority: 1,
        unitIds: units.filter((u) => u.playerId === "p1").map((u) => u.unitId),
        connected: true, surrendered: false,
      },
      p2: {
        playerId: "p2" as import("@ab/metadata").PlayerId,
        teamIndex: 1, priority: 1,
        unitIds: units.filter((u) => u.playerId === "p2").map((u) => u.unitId),
        connected: true, surrendered: false,
      },
    },
    units: Object.fromEntries(units.map((u) => [u.unitId, u])),
    map: {
      mapId: "map_test" as import("@ab/metadata").MetaId,
      gridSize: 11,
      tiles: Object.fromEntries(
        Object.entries(tiles).map(([k, v]) => [
          k,
          { position: { row: Number(k.split(",")[0]), col: Number(k.split(",")[1]) }, attribute: v.attribute },
        ]),
      ),
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeUnit(
  unitId: string,
  metaId: string,
  playerId: string,
  row: number,
  col: number,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    unitId: unitId as import("@ab/metadata").UnitId,
    metaId: metaId as import("@ab/metadata").MetaId,
    playerId: playerId as import("@ab/metadata").PlayerId,
    position: { row, col },
    currentHealth: 4,
    currentArmor: 0,
    movementPoints: 3,
    activeEffects: [],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
    ...overrides,
  };
}

function stunEffect(): import("@ab/metadata").ActiveEffect {
  return {
    effectId: "effect_stun" as import("@ab/metadata").MetaId,
    effectType: "stun",
    turnsRemaining: 1,
    appliedOnTurn: 1,
  };
}

function confusedRangedEffect(): import("@ab/metadata").ActiveEffect {
  return {
    effectId: "effect_confused_ranged" as import("@ab/metadata").MetaId,
    effectType: "confused",
    turnsRemaining: 2,
    appliedOnTurn: 1,
  };
}

function confusedMeleeEffect(): import("@ab/metadata").ActiveEffect {
  return {
    effectId: "effect_confused_melee" as import("@ab/metadata").MetaId,
    effectType: "confused",
    turnsRemaining: 2,
    appliedOnTurn: 1,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("A. Stun enforcement", () => {
  const registry = makeRegistry();
  const attackValidator = new AttackValidator(registry);
  const moveValidator = new MovementValidator(registry);

  it("stunned unit cannot attack — returns ATTACK_STUN error", () => {
    const attacker = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [stunEffect()],
    });
    const target = makeUnit("u2", "u_target", "p2", 5, 6);
    const state = makeState([attacker, target]);

    const result = attackValidator.validateAttack(attacker, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toContain("stun");
  });

  it("stunned unit cannot move — returns MOVE_STUN error", () => {
    const unit = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [stunEffect()],
    });
    const state = makeState([unit]);

    const result = moveValidator.validateMove(unit, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toContain("stun");
  });

  it("getAttackableTargets returns empty for stunned unit", () => {
    const unit = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [stunEffect()],
    });
    const state = makeState([unit]);
    expect(attackValidator.getAttackableTargets(unit, state)).toHaveLength(0);
  });

  it("getReachableTiles returns empty for stunned unit", () => {
    const unit = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [stunEffect()],
    });
    const state = makeState([unit]);
    expect(moveValidator.getReachableTiles(unit, state)).toHaveLength(0);
  });

  it("non-stunned unit can still move and attack normally", () => {
    const attacker = makeUnit("u1", "u_attacker", "p1", 5, 5);
    const target = makeUnit("u2", "u_target", "p2", 5, 6);
    const state = makeState([attacker, target]);

    expect(attackValidator.validateAttack(attacker, { row: 5, col: 6 }, state).valid).toBe(true);
    expect(moveValidator.validateMove(attacker, { row: 5, col: 7 }, state).valid).toBe(true);
  });

  it("stun error code differs from frozen error code", () => {
    const stunned = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [stunEffect()],
    });
    const frozen = makeUnit("u2", "u_attacker", "p1", 5, 5, {
      activeEffects: [{ effectId: "effect_freeze" as import("@ab/metadata").MetaId, effectType: "freeze", turnsRemaining: 1, appliedOnTurn: 1 }],
    });
    const target = makeUnit("u3", "u_target", "p2", 5, 6);
    const state1 = makeState([stunned, target]);
    const state2 = makeState([frozen, target]);

    const stunnedResult = attackValidator.validateAttack(stunned, { row: 5, col: 6 }, state1);
    const frozenResult = attackValidator.validateAttack(frozen, { row: 5, col: 6 }, state2);
    expect(stunnedResult.errorCode).not.toBe(frozenResult.errorCode);
    expect(stunnedResult.errorCode).toContain("stun");
    expect(frozenResult.errorCode).toContain("frozen");
  });
});

describe("B. Confusion mechanic", () => {
  const registry = makeRegistry();
  const attackValidator = new AttackValidator(registry);
  const tileTransition = new TileTransitionResolver(registry);
  const resolver = new AttackResolver(attackValidator, registry, tileTransition);

  it("confusion weapon applies effect_confused_ranged to hit target", () => {
    const attacker = makeUnit("u1", "u_confuse_ranged", "p1", 5, 5);
    const target = makeUnit("u2", "u_target", "p2", 5, 6);
    const state = makeState([attacker, target]);

    const changes = resolver.resolve(attacker, { row: 5, col: 6 }, state);
    const effectAdd = changes.find(
      (c): c is Extract<GameChange, { type: "unit_effect_add" }> =>
        c.type === "unit_effect_add" && c.unitId === "u2",
    );
    expect(effectAdd).toBeDefined();
    expect(effectAdd?.effectType).toBe("confused");
    expect(effectAdd?.effectId).toBe("effect_confused_ranged");
  });

  it("unit confused for ranged cannot use ranged weapon — returns ATTACK_CONFUSED", () => {
    // attacker has ranged weapon (wpn_ranged), but is confused for ranged
    const attacker = makeUnit("u1", "u_ranged_attacker", "p1", 5, 5, {
      activeEffects: [confusedRangedEffect()],
    });
    const target = makeUnit("u2", "u_target", "p2", 5, 8); // dist=3, in ranged range
    const state = makeState([attacker, target]);

    const result = attackValidator.validateAttack(attacker, { row: 5, col: 8 }, state);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toContain("confused");
  });

  it("unit confused for ranged can still use melee weapon", () => {
    const attacker = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [confusedRangedEffect()],
    });
    const target = makeUnit("u2", "u_target", "p2", 5, 6); // dist=1, melee range
    const state = makeState([attacker, target]);

    const result = attackValidator.validateAttack(attacker, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(true);
  });

  it("unit confused for melee cannot use melee weapon — returns ATTACK_CONFUSED", () => {
    const attacker = makeUnit("u1", "u_attacker", "p1", 5, 5, {
      activeEffects: [confusedMeleeEffect()],
    });
    const target = makeUnit("u2", "u_target", "p2", 5, 6); // dist=1, melee range
    const state = makeState([attacker, target]);

    const result = attackValidator.validateAttack(attacker, { row: 5, col: 6 }, state);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toContain("confused");
  });

  it("getAttackableTargets returns empty when confused for weapon's attack type", () => {
    const attacker = makeUnit("u1", "u_ranged_attacker", "p1", 5, 5, {
      activeEffects: [confusedRangedEffect()],
    });
    const state = makeState([attacker]);
    expect(attackValidator.getAttackableTargets(attacker, state)).toHaveLength(0);
  });

  it("confusion not applied when target already has the effect", () => {
    const attacker = makeUnit("u1", "u_confuse_ranged", "p1", 5, 5);
    const target = makeUnit("u2", "u_target", "p2", 5, 6, {
      activeEffects: [confusedRangedEffect()], // already confused for ranged
    });
    const state = makeState([attacker, target]);

    const changes = resolver.resolve(attacker, { row: 5, col: 6 }, state);
    const effectAdds = changes.filter(
      (c) => c.type === "unit_effect_add" && (c as Extract<GameChange, { type: "unit_effect_add" }>).effectType === "confused",
    );
    // Should not double-apply
    expect(effectAdds).toHaveLength(0);
  });

  it("confused effect turns remaining = 2 (lasts 1 full player turn)", () => {
    const attacker = makeUnit("u1", "u_confuse_ranged", "p1", 5, 5);
    const target = makeUnit("u2", "u_target", "p2", 5, 6);
    const state = makeState([attacker, target]);

    const changes = resolver.resolve(attacker, { row: 5, col: 6 }, state);
    const effectAdd = changes.find(
      (c): c is Extract<GameChange, { type: "unit_effect_add" }> =>
        c.type === "unit_effect_add" && (c as Extract<GameChange, { type: "unit_effect_add" }>).effectType === "confused",
    );
    expect(effectAdd?.turnsRemaining).toBe(2);
  });
});

describe("C. canTargetSelf guard", () => {
  const registry = makeRegistry();
  const attackValidator = new AttackValidator(registry);

  it("weapon without canTargetSelf cannot target own tile", () => {
    // melee weapon (canTargetSelf defaults to false), range [1,1]
    // targeting self at dist=0 should fail
    const unit = makeUnit("u1", "u_attacker", "p1", 5, 5);
    const state = makeState([unit]);

    const result = attackValidator.validateAttack(unit, { row: 5, col: 5 }, state);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toContain("invalid_target");
  });

  it("weapon with canTargetSelf=true can target own tile", () => {
    const unit = makeUnit("u1", "u_self_target", "p1", 5, 5);
    const state = makeState([unit]);

    // wpn_self_target has minRange=0, maxRange=0, canTargetSelf=true
    const result = attackValidator.validateAttack(unit, { row: 5, col: 5 }, state);
    expect(result.valid).toBe(true);
  });

  it("getAttackableTargets excludes own tile for non-self-targeting weapon", () => {
    const unit = makeUnit("u1", "u_attacker", "p1", 5, 5);
    const state = makeState([unit]);

    const targets = attackValidator.getAttackableTargets(unit, state);
    // Should not contain own position
    const selfTarget = targets.find((t) => t.row === 5 && t.col === 5);
    expect(selfTarget).toBeUndefined();
  });

  it("getAttackableTargets includes own tile for canTargetSelf weapon", () => {
    const unit = makeUnit("u1", "u_self_target", "p1", 5, 5);
    const state = makeState([unit]);

    const targets = attackValidator.getAttackableTargets(unit, state);
    const selfTarget = targets.find((t) => t.row === 5 && t.col === 5);
    expect(selfTarget).toBeDefined();
  });

  it("ranged weapon without canTargetSelf also blocked at own tile (dist=0)", () => {
    const unit = makeUnit("u1", "u_ranged_attacker", "p1", 5, 5);
    const state = makeState([unit]);

    const result = attackValidator.validateAttack(unit, { row: 5, col: 5 }, state);
    expect(result.valid).toBe(false);
  });
});
