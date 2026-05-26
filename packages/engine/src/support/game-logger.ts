/**
 * GameLogger — records the full lifecycle of a game for reconstruction and replay.
 *
 * Every event is a `GameLogEntry` — a discriminated union with a monotonic
 * sequence number. Reading entries in sequence is enough to replay the entire
 * game from scratch without running the engine:
 *
 *   game_start   → initial unit positions, HP, map tiles
 *   round_start  → activation order for the coming round
 *   turn_start   → whose unit's turn begins
 *   effect_tick  → fire / acid / river HP changes at turn start
 *   action       → player action + per-unit outcomes (HP before→after)
 *   turn_end     → turn finished
 *   round_end    → round finished
 *   game_end     → winner IDs, reason, final HP snapshot
 */
import type { GameState, GameChange, PlayerAction, Position } from "@ab/metadata";

// ─── Per-unit outcome ─────────────────────────────────────────────────────────

export interface UnitOutcome {
  unitId: string;
  /** HP at the moment the action / tick was processed */
  hpBefore: number;
  /** HP after all changes in this action / tick resolved */
  hpAfter: number;
  died: boolean;
  /** Where the unit was before it moved (acting unit, move action) */
  movedFrom?: Position;
  /** Where the unit moved to (acting unit, move / rush) */
  movedTo?: Position;
  /** Where the unit was before being knocked back */
  knockedFrom?: Position;
  /** Where the unit landed after knockback */
  knockedTo?: Position;
  /** Effect types added by this action */
  effectsAdded?: string[];
  /** Effect types removed by this action */
  effectsRemoved?: string[];
}

// ─── Entry types ──────────────────────────────────────────────────────────────

export interface GameStartEntry {
  seq: number;
  type: "game_start";
  timestamp: number;
  gameId: string;
  mapId: string;
  gridSize: number;
  players: Array<{ playerId: string; teamIndex: number; priority: number }>;
  /** All units at game start */
  units: Array<{
    unitId: string;
    metaId: string;
    playerId: string;
    position: Position;
    hp: number;
    armor: number;
    movementPoints: number;
  }>;
  /** Non-default tile states present at game start */
  tiles: Array<{ key: string; position: Position; attribute: string }>;
}

export interface RoundStartEntry {
  seq: number;
  type: "round_start";
  timestamp: number;
  gameId: string;
  round: number;
  /** Activation order for this round (playerId + optional unitId) */
  turnOrder: Array<{ playerId: string; unitId?: string; priority: number }>;
}

export interface TurnStartEntry {
  seq: number;
  type: "turn_start";
  timestamp: number;
  gameId: string;
  round: number;
  turnIndex: number;
  playerId: string;
  /** Undefined for player-level slots (no single-unit focus) */
  unitId?: string;
}

export interface EffectTickEntry {
  seq: number;
  type: "effect_tick";
  timestamp: number;
  gameId: string;
  round: number;
  turnIndex: number;
  /** The player whose turn start triggered these effect ticks */
  playerId: string;
  /** Only units whose HP actually changed */
  affected: UnitOutcome[];
}

export interface ActionEntry {
  seq: number;
  type: "action";
  timestamp: number;
  gameId: string;
  round: number;
  turnIndex: number;
  playerId: string;
  unitId: string;
  actionType: "move" | "attack" | "skill" | "extinguish" | "pass" | string;
  /** Where the acting unit started (move action) */
  movedFrom?: Position;
  /** Where the acting unit ended up (move action) */
  movedTo?: Position;
  /** Target grid position (attack / skill) */
  targetPosition?: Position;
  /** Unit standing at targetPosition in the pre-action state (attack) */
  targetUnitId?: string;
  /** Per-unit HP / state changes produced by this action */
  outcomes: UnitOutcome[];
  /** Tile attribute conversions triggered by this action */
  tilesChanged: Array<{ position: Position; from: string; to: string }>;
  accepted: boolean;
  errorCode?: string;
}

export interface TurnEndEntry {
  seq: number;
  type: "turn_end";
  timestamp: number;
  gameId: string;
  round: number;
  turnIndex: number;
  playerId: string;
}

export interface RoundEndEntry {
  seq: number;
  type: "round_end";
  timestamp: number;
  gameId: string;
  round: number;
}

export interface GameEndEntry {
  seq: number;
  type: "game_end";
  timestamp: number;
  gameId: string;
  round: number;
  winnerIds: string[];
  reason: string;
  /** Final snapshot of all units (alive and dead) */
  finalUnits: Array<{
    unitId: string;
    metaId: string;
    playerId: string;
    position: Position;
    hp: number;
    alive: boolean;
  }>;
}

export type GameLogEntry =
  | GameStartEntry
  | RoundStartEntry
  | TurnStartEntry
  | EffectTickEntry
  | ActionEntry
  | TurnEndEntry
  | RoundEndEntry
  | GameEndEntry;

// ─── IGameLogger ──────────────────────────────────────────────────────────────

export interface IGameLogger {
  /** Emit at the very start, before any draft or battle phase. */
  logGameStart(state: GameState): void;

  /** Emit at the start of each battle round, after startRound() has reset state. */
  logRoundStart(state: GameState): void;

  /** Emit when a unit's turn begins (after effect ticks). */
  logTurnStart(round: number, turnIndex: number, playerId: string, unitId: string | undefined, gameId: string): void;

  /**
   * Emit after effect ticks + applyDeaths at each turn start.
   * If no unit HP changed, the entry is omitted to keep logs lean.
   */
  logEffectTick(
    round: number,
    turnIndex: number,
    playerId: string,
    stateBefore: GameState,
    stateAfter: GameState,
  ): void;

  /**
   * Emit for every player action (accepted or rejected).
   * Pass `stateBefore` so hpBefore can be recorded per unit.
   */
  logAction(
    action: PlayerAction,
    changes: GameChange[],
    stateBefore: GameState,
    stateAfter: GameState,
    accepted?: boolean,
    errorCode?: string,
  ): void;

  /** Emit when a turn ends. */
  logTurnEnd(round: number, turnIndex: number, playerId: string, gameId: string): void;

  /** Emit when a round ends. */
  logRoundEnd(round: number, gameId: string): void;

  /** Emit when the game is over. */
  logGameEnd(winnerIds: string[], reason: string, finalState: GameState): void;

  /** Retrieve all entries for a game, in sequence order. */
  getLog(gameId: string): GameLogEntry[];

  /** Remove all log entries for a game. */
  clear(gameId: string): void;

  /** No-op debug hook kept for backward compatibility. */
  logEvent(type: string, payload: unknown): void;
}

// ─── GameLogger ───────────────────────────────────────────────────────────────

export class GameLogger implements IGameLogger {
  private readonly logs = new Map<string, GameLogEntry[]>();
  private readonly seqs = new Map<string, number>();

  // ── Sequence helpers ──────────────────────────────────────────────────────

  private nextSeq(gameId: string): number {
    const n = (this.seqs.get(gameId) ?? 0) + 1;
    this.seqs.set(gameId, n);
    return n;
  }

  private push(gameId: string, entry: GameLogEntry): void {
    const list = this.logs.get(gameId) ?? [];
    list.push(entry);
    this.logs.set(gameId, list);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  logGameStart(state: GameState): void {
    const entry: GameStartEntry = {
      seq: this.nextSeq(state.gameId),
      type: "game_start",
      timestamp: Date.now(),
      gameId: state.gameId,
      mapId: state.map.mapId,
      gridSize: state.map.gridSize,
      players: Object.values(state.players).map((p) => ({
        playerId: p.playerId,
        teamIndex: p.teamIndex,
        priority: p.priority,
      })),
      units: Object.values(state.units).map((u) => ({
        unitId: u.unitId,
        metaId: u.metaId,
        playerId: u.playerId,
        position: u.position,
        hp: u.currentHealth,
        armor: u.currentArmor,
        movementPoints: u.movementPoints,
      })),
      tiles: Object.entries(state.map.tiles).map(([key, tile]) => ({
        key,
        position: tile.position,
        attribute: tile.attribute,
      })),
    };
    this.push(state.gameId, entry);
  }

  logRoundStart(state: GameState): void {
    const entry: RoundStartEntry = {
      seq: this.nextSeq(state.gameId),
      type: "round_start",
      timestamp: Date.now(),
      gameId: state.gameId,
      round: state.round,
      turnOrder: state.turnOrder.map((slot) => ({
        playerId: slot.playerId,
        priority: slot.priority,
        ...(slot.unitId !== undefined ? { unitId: slot.unitId as string } : {}),
      })),
    };
    this.push(state.gameId, entry);
  }

  logTurnStart(
    round: number,
    turnIndex: number,
    playerId: string,
    unitId: string | undefined,
    gameId: string,
  ): void {
    const entry: TurnStartEntry = {
      seq: this.nextSeq(gameId),
      type: "turn_start",
      timestamp: Date.now(),
      gameId,
      round,
      turnIndex,
      playerId,
      ...(unitId !== undefined ? { unitId } : {}),
    };
    this.push(gameId, entry);
  }

  logEffectTick(
    round: number,
    turnIndex: number,
    playerId: string,
    stateBefore: GameState,
    stateAfter: GameState,
  ): void {
    const affected: UnitOutcome[] = [];

    for (const [unitId, unitAfter] of Object.entries(stateAfter.units)) {
      const unitBefore = stateBefore.units[unitId];
      if (unitBefore === undefined) continue;

      const hpBefore = unitBefore.currentHealth;
      const hpAfter = unitAfter.currentHealth;
      const diedNow = unitBefore.alive && !unitAfter.alive;

      if (hpBefore !== hpAfter || diedNow) {
        affected.push({
          unitId,
          hpBefore,
          hpAfter,
          died: diedNow,
        });
      }
    }

    // Skip entry if nothing changed
    if (affected.length === 0) return;

    const entry: EffectTickEntry = {
      seq: this.nextSeq(stateBefore.gameId),
      type: "effect_tick",
      timestamp: Date.now(),
      gameId: stateBefore.gameId,
      round,
      turnIndex,
      playerId,
      affected,
    };
    this.push(stateBefore.gameId, entry);
  }

  logAction(
    action: PlayerAction,
    changes: GameChange[],
    stateBefore: GameState,
    stateAfter: GameState,
    accepted = true,
    errorCode?: string,
  ): void {
    if (action.type === "draft_place") return;

    const entry: ActionEntry = {
      seq: this.nextSeq(stateBefore.gameId),
      type: "action",
      timestamp: Date.now(),
      gameId: stateBefore.gameId,
      round: stateBefore.round,
      turnIndex: stateBefore.currentTurnIndex,
      playerId: action.playerId,
      unitId: action.unitId,
      actionType: action.type,
      outcomes: [],
      tilesChanged: [],
      accepted,
      ...(errorCode !== undefined ? { errorCode } : {}),
    };

    // Resolve target unit and positions from action type
    if (action.type === "attack") {
      entry.targetPosition = action.target;
      // Find the unit occupying the target tile in the pre-action state
      const target = Object.values(stateBefore.units).find(
        (u) => u.alive && u.position.row === action.target.row && u.position.col === action.target.col,
      );
      if (target !== undefined) entry.targetUnitId = target.unitId;
    } else if (action.type === "skill" && action.target !== undefined) {
      entry.targetPosition = action.target;
    }

    // Build per-unit outcome map from changes
    const outcomeMap = new Map<string, UnitOutcome>();

    const getOrCreate = (unitId: string): UnitOutcome => {
      let o = outcomeMap.get(unitId);
      if (o === undefined) {
        const hp = stateBefore.units[unitId]?.currentHealth ?? 0;
        o = { unitId, hpBefore: hp, hpAfter: hp, died: false };
        outcomeMap.set(unitId, o);
      }
      return o;
    };

    for (const change of changes) {
      switch (change.type) {
        case "unit_move": {
          const o = getOrCreate(change.unitId);
          o.movedFrom = change.from;
          o.movedTo = change.to;
          // Mirror into the top-level action fields for the acting unit
          if (change.unitId === action.unitId) {
            entry.movedFrom = change.from;
            entry.movedTo = change.to;
          }
          break;
        }
        case "unit_damage": {
          const o = getOrCreate(change.unitId);
          // hpAfter is the authoritative value from the resolver
          o.hpAfter = change.hpAfter;
          break;
        }
        case "unit_heal": {
          const o = getOrCreate(change.unitId);
          o.hpAfter = change.hpAfter;
          break;
        }
        case "unit_death": {
          const o = getOrCreate(change.unitId);
          o.died = true;
          break;
        }
        case "unit_knockback": {
          const o = getOrCreate(change.unitId);
          o.knockedFrom = change.from;
          o.knockedTo = change.to;
          break;
        }
        case "unit_effect_add": {
          const o = getOrCreate(change.unitId);
          o.effectsAdded = [...(o.effectsAdded ?? []), change.effectType];
          break;
        }
        case "unit_effect_remove": {
          const o = getOrCreate(change.unitId);
          o.effectsRemoved = [...(o.effectsRemoved ?? []), change.effectType];
          break;
        }
        case "tile_attribute_change": {
          entry.tilesChanged.push({
            position: change.position,
            from: change.from,
            to: change.to,
          });
          break;
        }
        // Other change types (unit_spawn, phase_change, etc.) are not
        // per-unit outcomes and are omitted from action entries.
      }
    }

    // Ensure the unit that died (via unit_death change) always has correct
    // hpAfter — fall back to stateAfter if the damage change was absent.
    for (const [uid, o] of outcomeMap) {
      if (o.died) {
        const afterUnit = stateAfter.units[uid];
        if (afterUnit !== undefined) {
          o.hpAfter = Math.min(o.hpAfter, afterUnit.currentHealth);
        }
      }
    }

    entry.outcomes = [...outcomeMap.values()];
    this.push(stateBefore.gameId, entry);
  }

  logTurnEnd(round: number, turnIndex: number, playerId: string, gameId: string): void {
    const entry: TurnEndEntry = {
      seq: this.nextSeq(gameId),
      type: "turn_end",
      timestamp: Date.now(),
      gameId,
      round,
      turnIndex,
      playerId,
    };
    this.push(gameId, entry);
  }

  logRoundEnd(round: number, gameId: string): void {
    const entry: RoundEndEntry = {
      seq: this.nextSeq(gameId),
      type: "round_end",
      timestamp: Date.now(),
      gameId,
      round,
    };
    this.push(gameId, entry);
  }

  logGameEnd(winnerIds: string[], reason: string, finalState: GameState): void {
    const entry: GameEndEntry = {
      seq: this.nextSeq(finalState.gameId),
      type: "game_end",
      timestamp: Date.now(),
      gameId: finalState.gameId,
      round: finalState.round,
      winnerIds,
      reason,
      finalUnits: Object.values(finalState.units).map((u) => ({
        unitId: u.unitId,
        metaId: u.metaId,
        playerId: u.playerId,
        position: u.position,
        hp: u.currentHealth,
        alive: u.alive,
      })),
    };
    this.push(finalState.gameId, entry);
  }

  getLog(gameId: string): GameLogEntry[] {
    return this.logs.get(gameId) ?? [];
  }

  clear(gameId: string): void {
    this.logs.delete(gameId);
    this.seqs.delete(gameId);
  }

  logEvent(_type: string, _payload: unknown): void {
    // No-op — kept for backward compatibility with debug callers.
  }
}
