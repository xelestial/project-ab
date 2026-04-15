/**
 * PostProcessor — runs after every action.
 * Checks deaths, tile conditions, and game-end conditions.
 */
import type { GameState } from "@ab/metadata";
import type { IHealthManager } from "../managers/health-manager.js";
import type { IEndDetector, EndResult } from "./end-detector.js";

export interface PostProcessResult {
  state: GameState;
  end: EndResult;
}

export interface IPostProcessor {
  run(state: GameState): PostProcessResult;
}

export class PostProcessor implements IPostProcessor {
  constructor(
    private readonly healthManager: IHealthManager,
    private readonly endDetector: IEndDetector,
  ) {}

  run(state: GameState): PostProcessResult {
    // 1. Apply death changes
    let current = this.healthManager.applyDeaths(state);

    // 2. Check end conditions
    const end = this.endDetector.check(current);
    if (end.ended) {
      current = {
        ...current,
        phase: "result",
        endResult: {
          result: end.winnerIds.length > 0 ? "win" : "draw",
          winnerIds: end.winnerIds as import("@ab/metadata").PlayerId[],
        },
      };
    }

    return { state: current, end };
  }
}
