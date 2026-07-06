import type {
  DialogueActorViewModel,
  DialogueCharacterMeta,
  GameState,
  IDataRegistry,
  UnitId,
} from "@ab/metadata";

export interface IDialogueActorResolver {
  /**
   * Resolve a runtime unit instance into a dialogue actor view model.
   *
   * Flow:
   *   UnitId -> UnitState.metaId -> UnitDialogueBinding -> DialogueCharacterMeta
   *
   * This keeps dialogue actor identity outside UnitMeta/UnitDef while still allowing
   * any spawned unit to speak when a binding exists.
   */
  resolveUnitActor(
    unitId: UnitId,
    state: GameState,
    emotionId?: string,
  ): DialogueActorViewModel | undefined;
}

export class DialogueActorResolver implements IDialogueActorResolver {
  constructor(private readonly registry: IDataRegistry) {}

  resolveUnitActor(
    unitId: UnitId,
    state: GameState,
    emotionId = "normal",
  ): DialogueActorViewModel | undefined {
    const unit = state.units[unitId];
    if (unit === undefined) return undefined;

    const unitMeta = this.registry.getUnit(unit.metaId);
    const binding = this.registry.getDialogueBindingForUnit(unit.metaId);

    if (binding === undefined || !binding.canSpeak || binding.characterId === undefined) {
      return {
        actorId: unit.metaId,
        sourceUnitId: unit.unitId,
        displayNameKey: unitMeta.nameKey,
        portraitKey: unitMeta.spriteKey,
        thumbnailKey: unitMeta.spriteKey,
        canSpeak: false,
      };
    }

    const character = this.registry.getDialogueCharacter(binding.characterId);
    const portraitKey = this.resolvePortraitKey(character, emotionId, unitMeta.spriteKey);

    const actor: DialogueActorViewModel = {
      actorId: character.id,
      sourceUnitId: unit.unitId,
      displayNameKey: character.displayNameKey,
      portraitKey,
      canSpeak: true,
    };

    if (character.thumbnailKey !== undefined) {
      actor.thumbnailKey = character.thumbnailKey;
    }
    if (character.layout !== undefined) {
      actor.layout = character.layout;
    }

    return actor;
  }

  private resolvePortraitKey(
    character: DialogueCharacterMeta,
    emotionId: string,
    fallbackKey: string,
  ): string {
    const requested = character.portraits[emotionId];
    if (requested !== undefined) return requested;

    const defaultPortrait = character.portraits[character.defaultEmotion];
    if (defaultPortrait !== undefined) return defaultPortrait;

    const firstPortrait = Object.values(character.portraits)[0];
    return firstPortrait ?? fallbackKey;
  }
}
