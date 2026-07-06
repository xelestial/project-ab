import { describe, expect, it } from "vitest";
import { buildDataRegistry, type UnitId } from "@ab/metadata";
import { DialogueActorResolver } from "../narrative/dialogue-actor-resolver.js";
import {
  FIXTURE_EFFECTS,
  FIXTURE_MAPS,
  FIXTURE_SKILLS,
  FIXTURE_TILES,
  FIXTURE_UNITS,
  FIXTURE_WEAPONS,
  TestStateBuilder,
} from "./test-helpers.js";

function makeDialogueRegistry() {
  return buildDataRegistry({
    units: FIXTURE_UNITS,
    weapons: FIXTURE_WEAPONS,
    skills: FIXTURE_SKILLS,
    effects: FIXTURE_EFFECTS,
    tiles: FIXTURE_TILES,
    maps: FIXTURE_MAPS,
    dialogueCharacters: [
      {
        id: "char_t1",
        displayNameKey: "char.t1.name",
        thumbnailKey: "char_t1_thumb",
        portraits: {
          normal: "char_t1_normal",
          injured: "char_t1_injured",
        },
        defaultEmotion: "normal",
        layout: { offsetX: 10, offsetY: -4, scale: 0.95 },
      },
    ],
    unitDialogueBindings: [
      { unitMetaId: "t1", characterId: "char_t1", canSpeak: true },
      { unitMetaId: "f1", canSpeak: false },
    ],
  });
}

describe("DialogueActorResolver", () => {
  it("resolves a runtime unit through UnitState.metaId -> dialogue binding -> character", () => {
    const registry = makeDialogueRegistry();
    const resolver = new DialogueActorResolver(registry);
    const state = TestStateBuilder.create()
      .withUnit("p1_u0", "t1", "p1", 1, 1)
      .build();

    const actor = resolver.resolveUnitActor("p1_u0" as UnitId, state, "injured");

    expect(actor).toEqual({
      actorId: "char_t1",
      sourceUnitId: "p1_u0",
      displayNameKey: "char.t1.name",
      portraitKey: "char_t1_injured",
      thumbnailKey: "char_t1_thumb",
      layout: { offsetX: 10, offsetY: -4, scale: 0.95 },
      canSpeak: true,
    });
  });

  it("falls back to default emotion when requested emotion is missing", () => {
    const registry = makeDialogueRegistry();
    const resolver = new DialogueActorResolver(registry);
    const state = TestStateBuilder.create()
      .withUnit("p1_u0", "t1", "p1", 1, 1)
      .build();

    const actor = resolver.resolveUnitActor("p1_u0" as UnitId, state, "angry");

    expect(actor?.portraitKey).toBe("char_t1_normal");
  });

  it("falls back to UnitMeta presentation when no speaking binding exists", () => {
    const registry = makeDialogueRegistry();
    const resolver = new DialogueActorResolver(registry);
    const state = TestStateBuilder.create()
      .withUnit("p1_u1", "r1", "p1", 1, 2)
      .build();

    const actor = resolver.resolveUnitActor("p1_u1" as UnitId, state);

    expect(actor).toEqual({
      actorId: "r1",
      sourceUnitId: "p1_u1",
      displayNameKey: "unit.r1.name",
      portraitKey: "unit_ranger_a",
      thumbnailKey: "unit_ranger_a",
      canSpeak: false,
    });
  });

  it("honors explicit canSpeak=false bindings", () => {
    const registry = makeDialogueRegistry();
    const resolver = new DialogueActorResolver(registry);
    const state = TestStateBuilder.create()
      .withUnit("p1_u2", "f1", "p1", 1, 3)
      .build();

    const actor = resolver.resolveUnitActor("p1_u2" as UnitId, state);

    expect(actor?.actorId).toBe("f1");
    expect(actor?.canSpeak).toBe(false);
    expect(actor?.portraitKey).toBe("unit_fighter_a");
  });

  it("returns undefined when the unit instance does not exist", () => {
    const registry = makeDialogueRegistry();
    const resolver = new DialogueActorResolver(registry);
    const state = TestStateBuilder.create().build();

    expect(resolver.resolveUnitActor("missing" as UnitId, state)).toBeUndefined();
  });
});
