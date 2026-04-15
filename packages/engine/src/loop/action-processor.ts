/**
 * ActionProcessor — validates + resolves + applies a single player action.
 * Pipeline: TurnManager → Validator → Resolver → StateApplicator → PostProcessor
 */
import type { GameState, PlayerAction } from "@ab/metadata";
import type { IMovementValidator } from "../validators/movement-validator.js";
import type { IAttackValidator } from "../validators/attack-validator.js";
import type { IMovementResolver } from "../resolvers/movement-resolver.js";
import type { IAttackResolver } from "../resolvers/attack-resolver.js";
import type { IEffectResolver } from "../resolvers/effect-resolver.js";
import type { IStateApplicator } from "../state/state-applicator.js";
import type { ITurnManager } from "../managers/turn-manager.js";
import type { IHealthManager } from "../managers/health-manager.js";
import type { IEffectManager } from "../managers/effect-manager.js";
import type { ITileManager } from "../managers/tile-manager.js";
import type { IDataRegistry } from "@ab/metadata";
import { ErrorCode } from "@ab/metadata";

export interface ActionResult {
  accepted: boolean;
  errorCode?: string | undefined;
  newState: GameState;
}

export interface IActionProcessor {
  process(action: PlayerAction, state: GameState): ActionResult;
}

export class ActionProcessor implements IActionProcessor {
  constructor(
    private readonly turnManager: ITurnManager,
    private readonly movementValidator: IMovementValidator,
    private readonly attackValidator: IAttackValidator,
    private readonly movementResolver: IMovementResolver,
    private readonly attackResolver: IAttackResolver,
    private readonly effectResolver: IEffectResolver,
    private readonly applicator: IStateApplicator,
    private readonly healthManager: IHealthManager,
    private readonly effectManager: IEffectManager,
    private readonly tileManager: ITileManager,
    private readonly registry: IDataRegistry,
  ) {}

  process(action: PlayerAction, state: GameState): ActionResult {
    switch (action.type) {
      case "move":
        return this.processMove(action, state);
      case "attack":
        return this.processAttack(action, state);
      case "skill":
        return this.processSkill(action, state);
      case "extinguish":
        return this.processExtinguish(action, state);
      case "pass":
        return this.processPass(action, state);
      case "draft_place":
        return { accepted: false, errorCode: ErrorCode.TURN_INVALID_PHASE, newState: state };
      default: {
        const _e: never = action;
        return { accepted: false, errorCode: ErrorCode.INTERNAL_ERROR, newState: state };
      }
    }
  }

  // ─── Move ─────────────────────────────────────────────────────────────────

  private processMove(
    action: Extract<PlayerAction, { type: "move" }>,
    state: GameState,
  ): ActionResult {
    const unit = state.units[action.unitId];
    if (unit === undefined) {
      return { accepted: false, errorCode: ErrorCode.UNKNOWN_UNIT, newState: state };
    }

    if (!this.turnManager.isActionAllowed(action.unitId, "move", state)) {
      return { accepted: false, errorCode: ErrorCode.MOVE_ALREADY_MOVED, newState: state };
    }

    const validation = this.movementValidator.validateMove(unit, action.destination, state);
    if (!validation.valid) {
      return { accepted: false, errorCode: validation.errorCode, newState: state };
    }

    const changes = this.movementResolver.resolve(unit, action.destination, state);
    let newState = this.applicator.apply(changes, state);

    // Mark as moved
    const updatedUnit = newState.units[action.unitId]!;
    newState = this.applicator.apply(
      [{ type: "unit_actions_reset", unitId: action.unitId }],
      newState,
    );
    // Re-apply moved=true (reset doesn't set moved — we update manually)
    newState = {
      ...newState,
      units: {
        ...newState.units,
        [action.unitId]: {
          ...newState.units[action.unitId]!,
          actionsUsed: { ...newState.units[action.unitId]!.actionsUsed, moved: true },
        },
      },
    };

    // Post-move: check deaths
    newState = this.healthManager.applyDeaths(newState);

    return { accepted: true, newState };
  }

  // ─── Attack ───────────────────────────────────────────────────────────────

  private processAttack(
    action: Extract<PlayerAction, { type: "attack" }>,
    state: GameState,
  ): ActionResult {
    const unit = state.units[action.unitId];
    if (unit === undefined) {
      return { accepted: false, errorCode: ErrorCode.UNKNOWN_UNIT, newState: state };
    }

    if (!this.turnManager.isActionAllowed(action.unitId, "attack", state)) {
      return { accepted: false, errorCode: ErrorCode.ATTACK_ALREADY_ATTACKED, newState: state };
    }

    const validation = this.attackValidator.validateAttack(unit, action.target, state);
    if (!validation.valid) {
      return { accepted: false, errorCode: validation.errorCode, newState: state };
    }

    const changes = this.attackResolver.resolve(unit, action.target, state);
    let newState = this.applicator.apply(changes, state);

    // Mark as attacked
    newState = {
      ...newState,
      units: {
        ...newState.units,
        [action.unitId]: {
          ...newState.units[action.unitId]!,
          actionsUsed: { ...newState.units[action.unitId]!.actionsUsed, attacked: true },
        },
      },
    };

    // Post-attack: check deaths
    newState = this.healthManager.applyDeaths(newState);

    return { accepted: true, newState };
  }

  // ─── Skill ────────────────────────────────────────────────────────────────

  private processSkill(
    action: Extract<PlayerAction, { type: "skill" }>,
    state: GameState,
  ): ActionResult {
    const unit = state.units[action.unitId];
    if (unit === undefined) {
      return { accepted: false, errorCode: ErrorCode.UNKNOWN_UNIT, newState: state };
    }

    if (!this.turnManager.isActionAllowed(action.unitId, "skill", state)) {
      return { accepted: false, errorCode: ErrorCode.SKILL_ALREADY_USED, newState: state };
    }

    const skillMeta = this.registry.getSkill(action.skillId);

    // Active skills use a weapon — resolve as attack
    if (skillMeta.type === "active" && skillMeta.weaponId !== undefined && action.target !== undefined) {
      const validation = this.attackValidator.validateAttack(unit, action.target, state);
      if (!validation.valid) {
        return { accepted: false, errorCode: validation.errorCode, newState: state };
      }

      const changes = this.attackResolver.resolve(unit, action.target, state);
      let newState = this.applicator.apply(changes, state);

      // Mark skill used + attacked
      newState = {
        ...newState,
        units: {
          ...newState.units,
          [action.unitId]: {
            ...newState.units[action.unitId]!,
            actionsUsed: {
              ...newState.units[action.unitId]!.actionsUsed,
              attacked: true,
              skillUsed: true,
            },
          },
        },
      };

      newState = this.healthManager.applyDeaths(newState);
      return { accepted: true, newState };
    }

    // Passive skills don't need processing here
    return { accepted: true, newState: state };
  }

  // ─── Extinguish ───────────────────────────────────────────────────────────

  private processExtinguish(
    action: Extract<PlayerAction, { type: "extinguish" }>,
    state: GameState,
  ): ActionResult {
    const unit = state.units[action.unitId];
    if (unit === undefined) {
      return { accepted: false, errorCode: ErrorCode.UNKNOWN_UNIT, newState: state };
    }

    if (!this.turnManager.isActionAllowed(action.unitId, "extinguish", state)) {
      return { accepted: false, errorCode: ErrorCode.EXTINGUISH_ALREADY_ACTED, newState: state };
    }

    const fireEffect = unit.activeEffects.find((e) => e.effectType === "fire");
    if (fireEffect === undefined) {
      return { accepted: false, errorCode: ErrorCode.EXTINGUISH_NOT_ON_FIRE, newState: state };
    }

    const changes = this.effectResolver.resolveRemove(fireEffect.effectId, unit, "manual_extinguish");
    let newState = this.applicator.apply(changes, state);

    // Extinguish consumes ENTIRE turn: both move and attack are spent
    newState = {
      ...newState,
      units: {
        ...newState.units,
        [action.unitId]: {
          ...newState.units[action.unitId]!,
          actionsUsed: {
            ...newState.units[action.unitId]!.actionsUsed,
            moved: true,
            attacked: true,
            extinguished: true,
          },
        },
      },
    };

    return { accepted: true, newState };
  }

  // ─── Pass ─────────────────────────────────────────────────────────────────

  private processPass(
    _action: Extract<PlayerAction, { type: "pass" }>,
    state: GameState,
  ): ActionResult {
    // Pass does nothing — turn manager will advance the turn
    return { accepted: true, newState: state };
  }
}
