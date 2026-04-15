/**
 * TileManager — tile attribute conversion and periodic tile state management.
 */
import type { GameState, Position, AttackAttribute } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import type { ITileResolver } from "../resolvers/tile-resolver.js";

export interface ITileManager {
  processAttackOnTile(
    position: Position,
    attackAttribute: AttackAttribute,
    attackerId: string,
    weaponId: string,
    state: GameState,
  ): GameState;
}

export class TileManager implements ITileManager {
  constructor(
    private readonly resolver: ITileResolver,
    private readonly applicator: IStateApplicator,
  ) {}

  processAttackOnTile(
    position: Position,
    attackAttribute: AttackAttribute,
    attackerId: string,
    weaponId: string,
    state: GameState,
  ): GameState {
    const changes = this.resolver.resolveAttributeConversion(
      position,
      attackAttribute,
      attackerId,
      weaponId,
      state,
    );
    if (changes.length === 0) return state;
    return this.applicator.apply(changes, state);
  }
}
