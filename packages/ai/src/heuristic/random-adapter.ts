/**
 * RandomAdapter — simplest possible IPlayerAdapter.
 * Picks a random valid action. Used for AI vs AI testing and baseline.
 */
import type { GameState, PlayerAction, PlayerId, UnitId } from "@ab/metadata";
import type { IPlayerAdapter } from "@ab/engine";
import type { IMovementValidator } from "@ab/engine";
import type { IAttackValidator } from "@ab/engine";
import { getPlayerUnits } from "@ab/engine";

export class RandomAdapter implements IPlayerAdapter {
  readonly type = "ai" as const;

  constructor(
    readonly playerId: string,
    private readonly movementValidator: IMovementValidator,
    private readonly attackValidator: IAttackValidator,
  ) {}

  async requestDraftPlacement(
    state: GameState,
    _timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    // Pick first available unit from pool and first available spawn point
    const pool = state.draft?.poolIds ?? [];
    const firstUnit = pool[0];
    if (firstUnit === undefined) {
      throw new Error("No units in draft pool");
    }

    // Find an unoccupied spawn position
    // For simplicity: pick row 0, col 0 area (map metadata provides real spawn points)
    // This is a stub; a real implementation reads MapMeta.spawnPoints
    const position = { row: 0, col: 0 };

    return {
      type: "draft_place",
      playerId: this.playerId as PlayerId,
      metaId: firstUnit,
      position,
    };
  }

  async requestAction(state: GameState, _timeoutMs: number): Promise<PlayerAction> {
    const aliveUnits = getPlayerUnits(state, this.playerId).filter((u) => u.alive);

    for (const unit of aliveUnits) {
      // Try attack first
      if (!unit.actionsUsed.attacked) {
        const targets = this.attackValidator.getAttackableTargets(unit, state);
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)]!;
          return {
            type: "attack",
            playerId: this.playerId as PlayerId,
            unitId: unit.unitId,
            target,
          };
        }
      }

      // Try move
      if (!unit.actionsUsed.moved) {
        const reachable = this.movementValidator.getReachableTiles(unit, state);
        if (reachable.length > 0) {
          const dest = reachable[Math.floor(Math.random() * reachable.length)]!;
          return {
            type: "move",
            playerId: this.playerId as PlayerId,
            unitId: unit.unitId,
            destination: dest,
          };
        }
      }
    }

    // Fallback: pass with first unit
    const first = aliveUnits[0];
    return {
      type: "pass",
      playerId: this.playerId as PlayerId,
      unitId: (first?.unitId ?? "") as UnitId,
    };
  }

  async requestUnitOrder(
    _state: GameState,
    aliveUnitIds: UnitId[],
    _timeoutMs: number,
  ): Promise<UnitId[]> {
    return [...aliveUnitIds];
  }

  onStateUpdate(_state: GameState): void {
    // AI does not need to react to state updates in real time
  }
}
