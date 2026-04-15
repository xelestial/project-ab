/**
 * HeuristicAdapter — rule-based AI.
 * Strategy:
 *   1. Extinguish if on fire and cannot attack
 *   2. Attack the weakest reachable enemy
 *   3. Move toward closest enemy
 *   4. Pass
 *
 * Phase 1 placeholder: uses RandomAdapter internally;
 * the heuristic scoring will be expanded in Phase 2.
 */
import type { GameState, PlayerAction, PlayerId, UnitId, UnitState, Position } from "@ab/metadata";
import type { IPlayerAdapter } from "@ab/engine";
import type { IMovementValidator } from "@ab/engine";
import type { IAttackValidator } from "@ab/engine";
import { getPlayerUnits, getAliveUnits, manhattanDistance, isOnFire } from "@ab/engine";

export class HeuristicAdapter implements IPlayerAdapter {
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
    const pool = state.draft?.poolIds ?? [];
    const firstUnit = pool[0];
    if (firstUnit === undefined) throw new Error("Empty pool");
    return {
      type: "draft_place",
      playerId: this.playerId as PlayerId,
      metaId: firstUnit,
      position: { row: 0, col: 0 },
    };
  }

  async requestAction(state: GameState, _timeoutMs: number): Promise<PlayerAction> {
    const myUnits = getPlayerUnits(state, this.playerId).filter((u) => u.alive);
    const enemies = getAliveUnits(state).filter((u) => u.playerId !== this.playerId);

    for (const unit of myUnits) {
      // 1. Extinguish if on fire and already attacked / cannot attack
      if (isOnFire(unit) && unit.actionsUsed.attacked) {
        return {
          type: "extinguish",
          playerId: this.playerId as PlayerId,
          unitId: unit.unitId,
        };
      }

      // 2. Attack weakest reachable enemy
      if (!unit.actionsUsed.attacked) {
        const targets = this.attackValidator.getAttackableTargets(unit, state);
        if (targets.length > 0) {
          const target = this.pickWeakestTarget(targets, enemies);
          if (target !== undefined) {
            return {
              type: "attack",
              playerId: this.playerId as PlayerId,
              unitId: unit.unitId,
              target,
            };
          }
          // No enemy at target but position is valid — still attack
          const t = targets[0]!;
          return {
            type: "attack",
            playerId: this.playerId as PlayerId,
            unitId: unit.unitId,
            target: t,
          };
        }
      }

      // 3. Move toward closest enemy
      if (!unit.actionsUsed.moved && enemies.length > 0) {
        const closest = this.findClosestEnemy(unit.position, enemies);
        if (closest !== undefined) {
          const reachable = this.movementValidator.getReachableTiles(unit, state);
          if (reachable.length > 0) {
            const best = this.pickClosestTo(reachable, closest.position);
            return {
              type: "move",
              playerId: this.playerId as PlayerId,
              unitId: unit.unitId,
              destination: best,
            };
          }
        }
      }
    }

    // 4. Pass
    const first = myUnits[0];
    return {
      type: "pass",
      playerId: this.playerId as PlayerId,
      unitId: (first?.unitId ?? "") as UnitId,
    };
  }

  onStateUpdate(_state: GameState): void {}

  // ─── Scoring helpers ───────────────────────────────────────────────────────

  private pickWeakestTarget(
    targetPositions: Position[],
    enemies: UnitState[],
  ): Position | undefined {
    let weakest: { pos: Position; hp: number } | undefined;
    for (const pos of targetPositions) {
      const enemy = enemies.find((e) => e.position.row === pos.row && e.position.col === pos.col);
      if (enemy !== undefined) {
        if (weakest === undefined || enemy.currentHealth < weakest.hp) {
          weakest = { pos, hp: enemy.currentHealth };
        }
      }
    }
    return weakest?.pos;
  }

  private findClosestEnemy(from: Position, enemies: UnitState[]): UnitState | undefined {
    let closest: UnitState | undefined;
    let minDist = Infinity;
    for (const e of enemies) {
      const d = manhattanDistance(from, e.position);
      if (d < minDist) {
        minDist = d;
        closest = e;
      }
    }
    return closest;
  }

  private pickClosestTo(positions: Position[], target: Position): Position {
    let best = positions[0]!;
    let bestDist = manhattanDistance(best, target);
    for (const p of positions.slice(1)) {
      const d = manhattanDistance(p, target);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }
}
