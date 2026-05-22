/**
 * EffectValidator unit tests — canApplyEffect / canRemoveEffect.
 */
import { describe, it, expect } from "vitest";
import { EffectValidator } from "../validators/effect-validator.js";
import { TestStateBuilder, makeRegistry } from "./test-helpers.js";
import type { ActiveEffect } from "@ab/metadata";

function makeValidator() {
  return new EffectValidator(makeRegistry());
}

// ─── canApplyEffect ────────────────────────────────────────────────────────────

describe("EffectValidator.canApplyEffect", () => {
  it("freeze can always be applied to a plain unit", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canApplyEffect("effect_freeze", state.units["u1"]!, state);
    expect(result.valid).toBe(true);
  });

  it("freeze can be applied even to a frozen unit (overwrite)", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withFrozenUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canApplyEffect("effect_freeze", state.units["u1"]!, state);
    expect(result.valid).toBe(true);
  });

  it("fire cannot be applied to a frozen unit", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withFrozenUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canApplyEffect("effect_fire", state.units["u1"]!, state);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBeTruthy();
  });

  it("acid cannot be applied to a frozen unit", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withFrozenUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canApplyEffect("effect_acid", state.units["u1"]!, state);
    expect(result.valid).toBe(false);
  });

  it("fire can be applied to a non-frozen unit", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canApplyEffect("effect_fire", state.units["u1"]!, state);
    expect(result.valid).toBe(true);
  });

  it("sand can be applied to a non-frozen unit", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canApplyEffect("effect_sand", state.units["u1"]!, state);
    expect(result.valid).toBe(true);
  });
});

// ─── canRemoveEffect ──────────────────────────────────────────────────────────

describe("EffectValidator.canRemoveEffect", () => {
  const fireEffect: ActiveEffect = {
    effectId: "effect_fire" as import("@ab/metadata").MetaId,
    effectType: "fire",
    turnsRemaining: 2,
    appliedOnTurn: 1,
  };

  const sandEffect: ActiveEffect = {
    effectId: "effect_sand" as import("@ab/metadata").MetaId,
    effectType: "sand",
    appliedOnTurn: 1,
  };

  const freezeEffect: ActiveEffect = {
    effectId: "effect_freeze" as import("@ab/metadata").MetaId,
    effectType: "freeze",
    turnsRemaining: 1,
    appliedOnTurn: 1,
  };

  it("returns invalid when effect is not on the unit", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5)
      .build();

    const result = validator.canRemoveEffect("effect_fire", state.units["u1"]!, "turns_expired");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBeTruthy();
  });

  it("allows fire removal via turns_expired", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_fire", state.units["u1"]!, "turns_expired");
    expect(result.valid).toBe(true);
  });

  it("allows fire removal via manual_extinguish", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_fire", state.units["u1"]!, "manual_extinguish");
    expect(result.valid).toBe(true);
  });

  it("allows fire removal via river_entry", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_fire", state.units["u1"]!, "river_entry");
    expect(result.valid).toBe(true);
  });

  it("denies fire removal via on_move (fire does not have on_move condition)", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [fireEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_fire", state.units["u1"]!, "on_move");
    expect(result.valid).toBe(false);
  });

  it("allows sand removal via on_move", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [sandEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_sand", state.units["u1"]!, "on_move");
    expect(result.valid).toBe(true);
  });

  it("denies sand removal via turns_expired", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [sandEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_sand", state.units["u1"]!, "turns_expired");
    expect(result.valid).toBe(false);
  });

  it("allows freeze removal via turns_expired", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [freezeEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_freeze", state.units["u1"]!, "turns_expired");
    expect(result.valid).toBe(true);
  });

  it("allows freeze removal via collision_with_frozen", () => {
    const validator = makeValidator();
    const state = TestStateBuilder.create()
      .withUnit("u1", "f1", "p1", 5, 5, { activeEffects: [freezeEffect] })
      .build();

    const result = validator.canRemoveEffect("effect_freeze", state.units["u1"]!, "collision_with_frozen");
    expect(result.valid).toBe(true);
  });
});
