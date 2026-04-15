/**
 * AttackValidator — pure function validator for unit attacks.
 * P-03: No side effects.
 */
import type { GameState, UnitState, Position, ValidationResult, WeaponMeta, MetaId } from "@ab/metadata";
import type { IDataRegistry } from "@ab/metadata";
import { ErrorCode, VALID, invalid } from "@ab/metadata";
import {
  manhattanDistance,
  isFrozen,
  isInBounds,
  linePositions,
  getUnitAt,
  getTileAttribute,
} from "../state/game-state-utils.js";

// ─── Return types ─────────────────────────────────────────────────────────────

export interface AffectedPosition {
  position: Position;
  /** Is this the primary target or splash/penetration? */
  isPrimary: boolean;
}

export interface AttackValidation {
  valid: boolean;
  errorCode?: string;
  affectedPositions?: AffectedPosition[];
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IAttackValidator {
  validateAttack(unit: UnitState, target: Position, state: GameState): AttackValidation;
  getAttackableTargets(unit: UnitState, state: GameState): Position[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class AttackValidator implements IAttackValidator {
  constructor(private readonly registry: IDataRegistry) {}

  validateAttack(unit: UnitState, target: Position, state: GameState): AttackValidation {
    // 1. Frozen
    if (isFrozen(unit)) {
      return { valid: false, errorCode: ErrorCode.ATTACK_FROZEN };
    }

    // 2. Already attacked
    if (unit.actionsUsed.attacked) {
      return { valid: false, errorCode: ErrorCode.ATTACK_ALREADY_ATTACKED };
    }

    // 3. Bounds
    if (!isInBounds(target, state.map.gridSize)) {
      return { valid: false, errorCode: ErrorCode.ATTACK_INVALID_TARGET };
    }

    const unitMeta = this.registry.getUnit(unit.metaId);
    const weapon = this.registry.getWeapon(unitMeta.primaryWeaponId);

    // 4. Range check (Manhattan)
    const dist = manhattanDistance(unit.position, target);
    if (dist < weapon.minRange || dist > weapon.maxRange) {
      return { valid: false, errorCode: ErrorCode.ATTACK_OUT_OF_RANGE };
    }

    // 5. Attack-type specific checks
    const typeCheck = this.checkAttackType(weapon, unit, target, state);
    if (!typeCheck.valid) return typeCheck;

    // 6. Calculate affected positions
    const affected = this.calcAffectedPositions(weapon, unit.position, target, state);

    return { valid: true, affectedPositions: affected };
  }

  getAttackableTargets(unit: UnitState, state: GameState): Position[] {
    if (isFrozen(unit) || unit.actionsUsed.attacked) return [];

    const unitMeta = this.registry.getUnit(unit.metaId);
    const weapon = this.registry.getWeapon(unitMeta.primaryWeaponId);
    const targets: Position[] = [];
    const gs = state.map.gridSize;

    for (let row = 0; row < gs; row++) {
      for (let col = 0; col < gs; col++) {
        const pos: Position = { row, col };
        const dist = manhattanDistance(unit.position, pos);
        if (dist < weapon.minRange || dist > weapon.maxRange) continue;
        const check = this.checkAttackType(weapon, unit, pos, state);
        if (check.valid) targets.push(pos);
      }
    }
    return targets;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private checkAttackType(
    weapon: WeaponMeta,
    unit: UnitState,
    target: Position,
    state: GameState,
  ): ValidationResult {
    switch (weapon.attackType) {
      case "melee":
        // Melee: target must be adjacent (minRange=1, maxRange=1 enforced above)
        return VALID;

      case "ranged":
        // Ranged: free targeting — no LOS check (confirmed rule)
        return VALID;

      case "artillery":
        // Artillery: must have at least one unit/object between attacker and target
        return this.checkArtilleryLOS(unit.position, target, state);

      default:
        return VALID;
    }
  }

  /**
   * Artillery requires at least 1 unit or object to exist between
   * attacker and target on the same straight line.
   */
  private checkArtilleryLOS(from: Position, target: Position, state: GameState): ValidationResult {
    const path = linePositions(from, target, state.map.gridSize);
    // path includes the target; we want everything BETWEEN from and target
    const between = path.slice(0, -1);
    const hasObstruction = between.some((p) => {
      const unit = getUnitAt(state, p);
      if (unit !== undefined) return true;
      const attr = getTileAttribute(state, p);
      return attr === "mountain"; // mountains count as obstructions for arc
    });
    if (!hasObstruction) {
      return invalid(ErrorCode.ATTACK_NO_LOS);
    }
    return VALID;
  }

  /**
   * Calculate all tiles affected by this weapon's attack.
   * Respects penetrating, beam, area, and shield blocking.
   */
  private calcAffectedPositions(
    weapon: WeaponMeta,
    from: Position,
    target: Position,
    state: GameState,
  ): AffectedPosition[] {
    const gridSizeForCalc = state.map.gridSize;
    switch (weapon.rangeType) {
      case "single":
        return [{ position: target, isPrimary: true }];

      case "penetrate": {
        // Primary target + tiles behind along same direction (blocked by shield unit)
        const line = linePositions(from, target, gridSizeForCalc);
        const result: AffectedPosition[] = [];
        let passedTarget = false;
        for (const pos of line) {
          if (!passedTarget && !posEqual(pos, target)) continue;
          if (posEqual(pos, target)) {
            passedTarget = true;
            result.push({ position: pos, isPrimary: true });
            // Check if target unit has shield — blocks propagation
            const unitAtTarget = getUnitAt(state, target);
            if (unitAtTarget !== undefined && unitHasShield(unitAtTarget, this.registry)) break;
          } else {
            result.push({ position: pos, isPrimary: false });
            // Shield on subsequent units also blocks
            const u = getUnitAt(state, pos);
            if (u !== undefined && unitHasShield(u, this.registry)) break;
          }
        }
        return result;
      }

      case "beam": {
        // Entire straight line from attacker to target direction (blocked by shield)
        const line = linePositions(from, target, gridSizeForCalc);
        const result: AffectedPosition[] = [];
        for (const pos of line) {
          const isPrimary = posEqual(pos, target);
          result.push({ position: pos, isPrimary });
          const u = getUnitAt(state, pos);
          if (u !== undefined && unitHasShield(u, this.registry)) break;
        }
        return result;
      }

      case "area": {
        const spec = weapon.area;
        if (spec === undefined) return [{ position: target, isPrimary: true }];
        const positions: AffectedPosition[] = [];
        const radius = spec.radius;
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) + Math.abs(dc) > radius) continue;
            if (!spec.includeCenter && dr === 0 && dc === 0) continue;
            const p: Position = { row: target.row + dr, col: target.col + dc };
            if (isInBounds(p, gridSizeForCalc)) {
              positions.push({ position: p, isPrimary: dr === 0 && dc === 0 });
            }
          }
        }
        return positions;
      }

      case "line": {
        // Used by rush — single target in straight line
        return [{ position: target, isPrimary: true }];
      }

      default:
        return [{ position: target, isPrimary: true }];
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function posEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function unitHasShield(unit: UnitState, registry: IDataRegistry): boolean {
  const meta = registry.getUnit(unit.metaId);
  return meta.skillIds.includes("skill_shield_defend" as MetaId);
}
