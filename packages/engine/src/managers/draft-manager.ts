/**
 * DraftManager — draft phase: unit placement, timeout, turn-order generation.
 *
 * Rules (confirmed):
 * - 2-player: simultaneous, 180s timeout → random if expired
 * - 4-player (2v2): shared 6-slot pool, team priority sum determines first team
 * - Priority default = 1; same sum → Round 1 random, subsequent rounds alternate
 * - Draft order (2p): A1,B1,A2,B2,A3,B3 by priority
 * - Pool enforcement: each metaId in pool can only be drafted once
 * - Timeout fallback: unconfirmed placements get random units from remaining pool
 */
import type {
  GameState,
  DraftPlaceAction,
  TurnSlot,
  PlayerId,
  UnitId,
  MetaId,
  DraftSlot,
} from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import type { IDataRegistry } from "@ab/metadata";
import { DRAFT_TIMEOUT_MS, PRIORITY_DEFAULT, MAX_DRAFT_SLOTS } from "@ab/metadata";
import { posKey } from "../state/game-state-utils.js";

export interface IDraftManager {
  startDraft(state: GameState): GameState;
  placeUnit(action: DraftPlaceAction, state: GameState): GameState;
  finalizeDraft(state: GameState): GameState;
  applyTimeout(state: GameState): GameState;
  isDraftComplete(state: GameState): boolean;
}

export class DraftManager implements IDraftManager {
  constructor(
    private readonly registry: IDataRegistry,
    private readonly applicator: IStateApplicator,
  ) {}

  startDraft(state: GameState): GameState {
    // Transition to draft phase
    return this.applicator.apply(
      [{ type: "phase_change", from: state.phase, to: "draft" }],
      state,
    );
  }

  placeUnit(action: DraftPlaceAction, state: GameState): GameState {
    if (state.phase !== "draft" || state.draft === undefined) return state;

    // Validate unit is in the pool (pool enforcement)
    const poolHas = state.draft.poolIds.includes(action.metaId);
    if (!poolHas) return state;

    // Validate the metaId hasn't already been drafted by this player
    const alreadyDraftedByPlayer = state.draft.slots.some(
      (s) => s.metaId === action.metaId && s.playerId === action.playerId,
    );
    if (alreadyDraftedByPlayer) return state;

    // Enforce per-player slot limit (from map meta, fallback to MAX_DRAFT_SLOTS)
    const mapMeta = this.registry.getMap(state.map.mapId);
    const maxSlots = mapMeta.maxUnitsPerPlayer ?? MAX_DRAFT_SLOTS;
    const playerSlotCount = state.draft.slots.filter(
      (s) => s.playerId === action.playerId,
    ).length;
    if (playerSlotCount >= maxSlots) return state;

    // Validate spawn point is within allowed positions for this player
    const playerIndex = Object.values(state.players).findIndex(
      (p) => p.playerId === action.playerId,
    );
    if (playerIndex < 0) return state;

    const spawnPoints = mapMeta.spawnPoints.find((sp) => sp.playerId === playerIndex);
    if (spawnPoints === undefined) return state;

    const isValidSpawn = spawnPoints.positions.some(
      (p) => p.row === action.position.row && p.col === action.position.col,
    );
    if (!isValidSpawn) return state;

    // Check position not already occupied
    const occupied = Object.values(state.units).some(
      (u) => u.alive && u.position.row === action.position.row && u.position.col === action.position.col,
    );
    if (occupied) return state;

    // Create the unit and place it
    const unitMeta = this.registry.getUnit(action.metaId);
    const unitId = `${action.playerId}_${action.metaId}_${Date.now()}` as UnitId;

    const newUnit = {
      unitId,
      metaId: unitMeta.id,
      playerId: action.playerId,
      position: action.position,
      currentHealth: unitMeta.baseHealth,
      currentArmor: unitMeta.baseArmor,
      movementPoints: unitMeta.baseMovement,
      activeEffects: [] as import("@ab/metadata").ActiveEffect[],
      actionsUsed: {
        moved: false,
        attacked: false,
        skillUsed: false,
        extinguished: false,
      },
      alive: true,
    };

    const newSlot: DraftSlot = {
      playerId: action.playerId,
      metaId: action.metaId,
      position: action.position,
      confirmed: true,
    };

    return {
      ...state,
      units: {
        ...state.units,
        [unitId]: newUnit,
      },
      players: {
        ...state.players,
        [action.playerId]: {
          ...state.players[action.playerId]!,
          unitIds: [...(state.players[action.playerId]?.unitIds ?? []), unitId],
        },
      },
      draft: {
        ...state.draft,
        slots: [...state.draft.slots, newSlot],
      },
    };
  }

  finalizeDraft(state: GameState): GameState {
    // Build turn order for round 1 from priorities
    const turnOrder = this.buildTurnOrder(state, 1, null);

    const newState: GameState = {
      ...state,
      turnOrder,
      currentTurnIndex: 0,
    };

    return this.applicator.apply(
      [{ type: "phase_change", from: "draft", to: "battle" }],
      newState,
    );
  }

  /**
   * Apply timeout fallback: players who haven't placed all their units get
   * random units from the remaining pool placed at unoccupied spawn points.
   */
  applyTimeout(state: GameState): GameState {
    if (state.phase !== "draft" || state.draft === undefined) return state;

    let current = state;
    const fullPool = current.draft!.poolIds;
    const mapMeta = this.registry.getMap(current.map.mapId);
    const maxSlots = mapMeta.maxUnitsPerPlayer ?? MAX_DRAFT_SLOTS;
    const players = Object.values(current.players);

    for (const player of players) {
      const playerSlotCount = current.draft!.slots.filter(
        (s) => s.playerId === player.playerId,
      ).length;

      if (playerSlotCount >= maxSlots) continue;

      // Find spawn positions for this player
      const playerIndex = players.indexOf(player);
      const spawnPoints = mapMeta.spawnPoints.find((sp) => sp.playerId === playerIndex);
      if (spawnPoints === undefined) continue;

      const usedPositions = new Set(
        Object.values(current.units).filter(u => u.alive).map(u => posKey(u.position)),
      );
      const availableSpawns = spawnPoints.positions.filter(
        (p) => !usedPositions.has(posKey(p)),
      );

      // Already drafted meta IDs for THIS player
      const playerDraftedIds = new Set(
        current.draft!.slots.filter(s => s.playerId === player.playerId).map(s => s.metaId),
      );
      // Pool available for this player (cycle through full pool, skipping already taken)
      const playerPool = fullPool.filter((id) => !playerDraftedIds.has(id));

      const slotsNeeded = maxSlots - playerSlotCount;
      let poolIdx = 0;
      for (let i = 0; i < slotsNeeded; i++) {
        // Find next available metaId from pool (wrap around if needed)
        const metaId = playerPool[poolIdx % playerPool.length];
        if (metaId === undefined) break;
        poolIdx++;

        const spawnPos = availableSpawns[i];
        if (spawnPos === undefined) break;

        // Direct unit creation (bypass global alreadyDrafted check to allow same type per player)
        const unitMeta = this.registry.getUnit(metaId);
        const unitId = `${player.playerId}_${metaId}_${Date.now()}_${i}` as UnitId;
        current = {
          ...current,
          units: {
            ...current.units,
            [unitId]: {
              unitId,
              metaId: unitMeta.id,
              playerId: player.playerId,
              position: spawnPos,
              currentHealth: unitMeta.baseHealth,
              currentArmor: unitMeta.baseArmor,
              movementPoints: unitMeta.baseMovement,
              activeEffects: [] as import("@ab/metadata").ActiveEffect[],
              actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
              alive: true,
            },
          },
          players: {
            ...current.players,
            [player.playerId]: {
              ...current.players[player.playerId]!,
              unitIds: [...(current.players[player.playerId]?.unitIds ?? []), unitId],
            },
          },
          draft: {
            ...current.draft!,
            slots: [...current.draft!.slots, {
              playerId: player.playerId,
              metaId: metaId as MetaId,
              position: spawnPos,
              confirmed: false, // timeout placement
            }],
          },
        };
      }
    }

    // Finalize the draft (builds turn order + transitions to battle)
    return this.finalizeDraft(current);
  }

  isDraftComplete(state: GameState): boolean {
    if (state.draft === undefined) return false;

    const mapMeta = this.registry.getMap(state.map.mapId);
    const maxSlots = mapMeta.maxUnitsPerPlayer ?? MAX_DRAFT_SLOTS;

    // All players have filled their slot quota
    const players = Object.values(state.players);
    return players.every((p) => {
      const count = state.draft!.slots.filter((s) => s.playerId === p.playerId && s.confirmed).length;
      return count >= maxSlots;
    });
  }

  /**
   * Build turn order for a round.
   * Rules:
   * - Sort by priority ascending (lower = acts first)
   * - Same priority: round 1 = random, subsequent = alternate (loser of last coin flip goes first)
   * - For 2-player: A1,B1,A2,B2,A3,B3 structure within the round
   * - For 2v2: team priority sum determines team order; within each team, players alternate
   */
  buildTurnOrder(
    state: GameState,
    round: number,
    lastFirstPlayerId: string | null,
  ): TurnSlot[] {
    const players = Object.values(state.players).filter((p) => !p.surrendered);

    // 2v2 mode: group by teamIndex
    const teamCount = new Set(players.map((p) => p.teamIndex)).size;
    if (teamCount > 1 && players.length > 2) {
      return this.buildTwoVsTwoTurnOrder(players, round, lastFirstPlayerId);
    }

    // Standard 1v1 / single-team
    players.sort((a, b) => a.priority - b.priority);

    // Same priority resolution
    const samePriority = players.every((p) => p.priority === players[0]!.priority);
    if (samePriority) {
      if (round === 1 || lastFirstPlayerId === null) {
        // Random
        if (Math.random() < 0.5) players.reverse();
      } else {
        // Alternate: whoever went first last round goes last this round
        const lastFirstIdx = players.findIndex((p) => p.playerId === lastFirstPlayerId);
        if (lastFirstIdx === 0) {
          // Move the previous first-player to the end
          const [first, ...rest] = players;
          players.splice(0, players.length, ...rest, first!);
        }
      }
    }

    return players.map((p) => ({
      playerId: p.playerId,
      priority: p.priority,
    }));
  }

  /**
   * 2v2 turn order: interleave teams (T0_P0, T1_P0, T0_P1, T1_P1).
   * Team order determined by team priority sums; same sum = alternate.
   */
  private buildTwoVsTwoTurnOrder(
    players: import("@ab/metadata").PlayerState[],
    round: number,
    lastFirstPlayerId: string | null,
  ): TurnSlot[] {
    // Group by teamIndex
    const teams = new Map<number, typeof players>();
    for (const p of players) {
      if (!teams.has(p.teamIndex)) teams.set(p.teamIndex, []);
      teams.get(p.teamIndex)!.push(p);
    }

    // Sort teams by priority sum
    const sortedTeams = [...teams.entries()].sort(
      ([, aPlayers], [, bPlayers]) =>
        aPlayers.reduce((s, p) => s + p.priority, 0) -
        bPlayers.reduce((s, p) => s + p.priority, 0),
    );

    // Same sum: alternate
    const teamSums = sortedTeams.map(([, ps]) => ps.reduce((s, p) => s + p.priority, 0));
    if (teamSums[0] === teamSums[1] && lastFirstPlayerId !== null && round > 1) {
      sortedTeams.reverse();
    }

    // Interleave: T0[0], T1[0], T0[1], T1[1] ...
    const slots: TurnSlot[] = [];
    const maxLen = Math.max(...sortedTeams.map(([, ps]) => ps.length));
    for (let i = 0; i < maxLen; i++) {
      for (const [, teamPlayers] of sortedTeams) {
        const player = teamPlayers[i];
        if (player !== undefined) {
          slots.push({ playerId: player.playerId, priority: player.priority });
        }
      }
    }

    return slots;
  }
}
