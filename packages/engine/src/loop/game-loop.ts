/**
 * GameLoop — full game orchestration.
 * Draft → Round loop → Turn loop → Action → PostProcess → End check
 */
import type { GameState, PlayerAction, UnitId } from "@ab/metadata";
import type { IActionProcessor } from "./action-processor.js";
import type { IPostProcessor } from "./post-processor.js";
import type { IRoundManager } from "../managers/round-manager.js";
import type { IDraftManager } from "../managers/draft-manager.js";
import type { ITurnManager } from "../managers/turn-manager.js";
import type { IEndDetector } from "./end-detector.js";
import type { IEffectManager } from "../managers/effect-manager.js";
import type { IHealthManager } from "../managers/health-manager.js";
import type { IEventBus } from "../support/event-bus.js";
import type { IGameLogger } from "../support/game-logger.js";
import { DRAFT_TIMEOUT_MS, TURN_TIMEOUT_MS, UNIT_ORDER_TIMEOUT_MS } from "@ab/metadata";

// ─── Player adapter interface (P-06: human = AI to engine) ────────────────────

export interface IPlayerAdapter {
  readonly playerId: string;
  readonly type: "human" | "ai" | "replay";

  requestDraftPlacement(
    state: GameState,
    timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>>;

  requestAction(state: GameState, timeoutMs: number): Promise<PlayerAction>;

  /**
   * Called once at the start of each round. The player submits the desired
   * activation order for their alive units (first element = acts first).
   * Timeout auto-submits in the default order.
   */
  requestUnitOrder(
    state: GameState,
    aliveUnitIds: UnitId[],
    timeoutMs: number,
  ): Promise<UnitId[]>;

  onStateUpdate(state: GameState): void;
}

// ─── GameResult ───────────────────────────────────────────────────────────────

export interface GameResult {
  gameId: string;
  winnerIds: string[];
  reason: string;
  finalState: GameState;
}

// ─── GameLoop ─────────────────────────────────────────────────────────────────

export interface IGameLoop {
  start(initialState: GameState, adapters: Map<string, IPlayerAdapter>): Promise<GameResult>;
}

export class GameLoop implements IGameLoop {
  constructor(
    private readonly roundManager: IRoundManager,
    private readonly draftManager: IDraftManager,
    private readonly turnManager: ITurnManager,
    private readonly actionProcessor: IActionProcessor,
    private readonly postProcessor: IPostProcessor,
    private readonly endDetector: IEndDetector,
    private readonly effectManager: IEffectManager,
    private readonly healthManager: IHealthManager,
    private readonly eventBus: IEventBus,
    private readonly logger: IGameLogger,
  ) {}

  async start(
    initialState: GameState,
    adapters: Map<string, IPlayerAdapter>,
  ): Promise<GameResult> {
    let state = initialState;

    this.eventBus.emit({ type: "game.start", state });

    // ─── Draft phase (skip if state was pre-built in battle phase) ───────────
    if (state.phase !== "battle") {
      state = this.draftManager.startDraft(state);
      this.eventBus.emit({ type: "draft.start", state });

      state = await this.runDraftPhase(state, adapters);
      // applyTimeout auto-fills remaining slots for any player who didn't place, then finalizes
      state = this.draftManager.applyTimeout(state);
      this.eventBus.emit({ type: "draft.end", state });
    }

    // ─── Battle phase ─────────────────────────────────────────────────────────
    let gameEnded = false;

    while (!gameEnded) {
      // ── Unit order draft: each player picks their unit activation order ──────
      const lastFirstPlayerId = state.round > 1 ? (state.turnOrder[0]?.playerId ?? null) : null;
      const unitOrders = await this.collectUnitOrders(adapters, state, UNIT_ORDER_TIMEOUT_MS);
      const turnOrder = this.draftManager.buildTurnOrder(
        state,
        state.round,
        lastFirstPlayerId,
        unitOrders,
      );
      state = { ...state, turnOrder };

      // Round start
      this.eventBus.emit({ type: "round.start", round: state.round, state });
      state = this.roundManager.startRound(state);

      // Turn loop
      while (!this.turnManager.isRoundOver(state)) {
        const slot = state.turnOrder[state.currentTurnIndex];
        if (slot === undefined) break;

        const playerId = slot.playerId;

        // Skip dead unit slots silently
        if (slot.unitId !== undefined) {
          const slotUnit = state.units[slot.unitId];
          if (slotUnit === undefined || !slotUnit.alive) {
            state = this.turnManager.endTurn(state);
            continue;
          }
        }

        // Effect tick for all units of current player (fire/acid damage, countdown)
        for (const unitId of Object.values(state.units)
          .filter((u) => u.alive && u.playerId === playerId)
          .map((u) => u.unitId)) {
          state = this.effectManager.processTurnStart(unitId, state);
        }
        state = this.healthManager.applyDeaths(state);

        this.eventBus.emit({
          type: "turn.start",
          playerId,
          turnIndex: state.currentTurnIndex,
          state,
        });

        // ── Multi-action turn loop: unit may move then attack ────────────────
        const adapter = adapters.get(playerId);
        let turnEnded = false;

        while (!turnEnded && adapter !== undefined) {
          // If unit-level slot: stop when both actions used or unit died
          if (slot.unitId !== undefined) {
            const slotUnit = state.units[slot.unitId];
            if (slotUnit === undefined || !slotUnit.alive) break;
            if (slotUnit.actionsUsed.moved && slotUnit.actionsUsed.attacked) break;
          }

          const passAction: PlayerAction = {
            type: "pass" as const,
            playerId: playerId as import("@ab/metadata").PlayerId,
            unitId: (slot.unitId ??
              Object.values(state.units).find(
                (u) => u.alive && u.playerId === playerId,
              )?.unitId ??
              "") as import("@ab/metadata").UnitId,
          };

          const action = await adapter
            .requestAction(state, TURN_TIMEOUT_MS)
            .catch(() => passAction);

          // Pass always ends the turn
          if (action.type === "pass") {
            turnEnded = true;
            break;
          }

          const result = this.actionProcessor.process(action, state);

          if (result.accepted) {
            this.logger.logAction(action, [], result.newState);
            this.eventBus.emit({
              type: "action.accepted",
              action,
              changes: [],
              state: result.newState,
            });
          } else {
            this.eventBus.emit({
              type: "action.rejected",
              action,
              errorCode: result.errorCode ?? "unknown",
            });
          }

          state = result.newState;
          adapter.onStateUpdate(state);
          for (const [, a] of adapters) {
            if (a.playerId !== playerId) a.onStateUpdate(state);
          }

          // Post-process after each sub-action
          const subPostResult = this.postProcessor.run(state);
          state = subPostResult.state;

          if (subPostResult.end.ended) {
            gameEnded = true;
            this.eventBus.emit({
              type: "game.end",
              state,
              winnerIds: subPostResult.end.winnerIds,
              reason: subPostResult.end.reason ?? "unknown",
            });
            break;
          }

          // Attack always ends the turn (no attack-then-move)
          if (action.type === "attack") {
            turnEnded = true;
            break;
          }
        }

        if (gameEnded) break;

        this.eventBus.emit({
          type: "turn.end",
          playerId,
          turnIndex: state.currentTurnIndex,
          state,
        });

        // Advance turn
        state = this.turnManager.endTurn(state);
      }

      if (gameEnded) break;

      // Check round limit
      const endCheck = this.endDetector.check(state);
      if (endCheck.ended) {
        gameEnded = true;
        state = {
          ...state,
          phase: "result",
          endResult: {
            result: endCheck.winnerIds.length > 0 ? "win" : "draw",
            winnerIds: endCheck.winnerIds as import("@ab/metadata").PlayerId[],
          },
        };
        this.eventBus.emit({
          type: "game.end",
          state,
          winnerIds: endCheck.winnerIds,
          reason: endCheck.reason ?? "unknown",
        });
        break;
      }

      this.eventBus.emit({ type: "round.end", round: state.round, state });
      state = this.roundManager.endRound(state);
    }

    return {
      gameId: state.gameId,
      winnerIds: state.endResult?.winnerIds ?? [],
      reason: state.endResult?.result ?? "unknown",
      finalState: state,
    };
  }

  // ─── Unit order collection ────────────────────────────────────────────────

  /**
   * Ask every player to submit their unit activation order for the coming round.
   * Both players are asked concurrently; either may time out and auto-submit.
   */
  private async collectUnitOrders(
    adapters: Map<string, IPlayerAdapter>,
    state: GameState,
    timeoutMs: number,
  ): Promise<Map<string, UnitId[]>> {
    const orders = new Map<string, UnitId[]>();
    await Promise.all(
      [...adapters.entries()].map(async ([playerId, adapter]) => {
        const aliveUnitIds = Object.values(state.units)
          .filter((u) => u.alive && u.playerId === playerId)
          .map((u) => u.unitId) as UnitId[];
        try {
          const submitted = await adapter.requestUnitOrder(state, aliveUnitIds, timeoutMs);
          // Validate: keep only alive unit IDs, append any the player missed
          const aliveSet = new Set<UnitId>(aliveUnitIds);
          const valid = submitted.filter((uid) => aliveSet.has(uid));
          const missing = aliveUnitIds.filter((uid) => !valid.includes(uid));
          orders.set(playerId, [...valid, ...missing]);
        } catch {
          orders.set(playerId, aliveUnitIds);
        }
      }),
    );
    return orders;
  }

  // ─── Draft phase logic ────────────────────────────────────────────────────

  private async runDraftPhase(
    state: GameState,
    adapters: Map<string, IPlayerAdapter>,
  ): Promise<GameState> {
    let current = state;

    const placements = await Promise.allSettled(
      [...adapters.entries()].map(async ([playerId, adapter]) => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), DRAFT_TIMEOUT_MS),
        );
        const placementPromise = adapter.requestDraftPlacement(current, DRAFT_TIMEOUT_MS);
        return Promise.race([placementPromise, timeoutPromise]);
      }),
    );

    for (const result of placements) {
      if (result.status === "fulfilled") {
        current = this.draftManager.placeUnit(result.value, current);
      }
      // Timeout / rejection = random placement handled by applyTimeout
    }

    return current;
  }
}
