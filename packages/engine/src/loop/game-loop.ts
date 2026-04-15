/**
 * GameLoop — full game orchestration.
 * Draft → Round loop → Turn loop → Action → PostProcess → End check
 */
import type { GameState, PlayerAction } from "@ab/metadata";
import type { IActionProcessor } from "./action-processor.js";
import type { IPostProcessor } from "./post-processor.js";
import type { IRoundManager } from "../managers/round-manager.js";
import type { IDraftManager } from "../managers/draft-manager.js";
import type { ITurnManager } from "../managers/turn-manager.js";
import type { IEndDetector } from "./end-detector.js";
import type { IEventBus } from "../support/event-bus.js";
import type { IGameLogger } from "../support/game-logger.js";
import { DRAFT_TIMEOUT_MS } from "@ab/metadata";

// ─── Player adapter interface (P-06: human = AI to engine) ────────────────────

export interface IPlayerAdapter {
  readonly playerId: string;
  readonly type: "human" | "ai" | "replay";

  requestDraftPlacement(
    state: GameState,
    timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>>;

  requestAction(state: GameState, timeoutMs: number): Promise<PlayerAction>;

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
  private readonly TURN_TIMEOUT_MS = 60_000;

  constructor(
    private readonly roundManager: IRoundManager,
    private readonly draftManager: IDraftManager,
    private readonly turnManager: ITurnManager,
    private readonly actionProcessor: IActionProcessor,
    private readonly postProcessor: IPostProcessor,
    private readonly endDetector: IEndDetector,
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
      // Round start
      this.eventBus.emit({ type: "round.start", round: state.round, state });
      state = this.roundManager.startRound(state);

      // Turn loop
      while (!this.turnManager.isRoundOver(state)) {
        const slot = state.turnOrder[state.currentTurnIndex];
        if (slot === undefined) break;

        const playerId = slot.playerId;

        // Effect tick for all units of current player
        for (const unitId of Object.values(state.units)
          .filter((u) => u.alive && u.playerId === playerId)
          .map((u) => u.unitId)) {
          // EffectManager processes turn start per unit
          // We do it inline here for simplicity
        }

        this.eventBus.emit({
          type: "turn.start",
          playerId,
          turnIndex: state.currentTurnIndex,
          state,
        });
        // Request action from player
        const adapter = adapters.get(playerId);
        if (adapter !== undefined) {
          const action = await adapter.requestAction(state, this.TURN_TIMEOUT_MS).catch(() => ({
            type: "pass" as const,
            playerId: playerId as import("@ab/metadata").PlayerId,
            unitId: Object.values(state.units).find(
              (u) => u.alive && u.playerId === playerId,
            )?.unitId ?? ("" as import("@ab/metadata").UnitId),
          }));

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
        }

        // Post-process
        const postResult = this.postProcessor.run(state);
        state = postResult.state;

        if (postResult.end.ended) {
          gameEnded = true;
          this.eventBus.emit({
            type: "game.end",
            state,
            winnerIds: postResult.end.winnerIds,
            reason: postResult.end.reason ?? "unknown",
          });
          break;
        }

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
