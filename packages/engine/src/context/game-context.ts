/**
 * GameContext — DI container holding all module instances for a single game.
 * P-05: All dependencies injected; GameFactory is the sole assembly point.
 */
import type { IDataRegistry } from "@ab/metadata";
import type { IStateApplicator } from "../state/state-applicator.js";
import type { IMovementValidator } from "../validators/movement-validator.js";
import type { IAttackValidator } from "../validators/attack-validator.js";
import type { IEffectValidator } from "../validators/effect-validator.js";
import type { ITileValidator } from "../validators/tile-validator.js";
import type { IMovementResolver } from "../resolvers/movement-resolver.js";
import type { IAttackResolver } from "../resolvers/attack-resolver.js";
import type { IEffectResolver } from "../resolvers/effect-resolver.js";
import type { ITileResolver } from "../resolvers/tile-resolver.js";
import type { IHealthManager } from "../managers/health-manager.js";
import type { IEffectManager } from "../managers/effect-manager.js";
import type { ITileManager } from "../managers/tile-manager.js";
import type { ITurnManager } from "../managers/turn-manager.js";
import type { IDraftManager } from "../managers/draft-manager.js";
import type { IRoundManager } from "../managers/round-manager.js";
import type { IEndDetector } from "../loop/end-detector.js";
import type { IActionProcessor } from "../loop/action-processor.js";
import type { IPostProcessor } from "../loop/post-processor.js";
import type { IGameLoop } from "../loop/game-loop.js";
import type { IEventBus } from "../support/event-bus.js";
import type { IGameLogger } from "../support/game-logger.js";

export interface GameContext {
  // Metadata
  readonly registry: IDataRegistry;

  // State
  readonly applicator: IStateApplicator;

  // Validators
  readonly movementValidator: IMovementValidator;
  readonly attackValidator: IAttackValidator;
  readonly effectValidator: IEffectValidator;
  readonly tileValidator: ITileValidator;

  // Resolvers
  readonly movementResolver: IMovementResolver;
  readonly attackResolver: IAttackResolver;
  readonly effectResolver: IEffectResolver;
  readonly tileResolver: ITileResolver;

  // Managers
  readonly healthManager: IHealthManager;
  readonly effectManager: IEffectManager;
  readonly tileManager: ITileManager;
  readonly turnManager: ITurnManager;
  readonly draftManager: IDraftManager;
  readonly roundManager: IRoundManager;

  // Loop
  readonly endDetector: IEndDetector;
  readonly actionProcessor: IActionProcessor;
  readonly postProcessor: IPostProcessor;
  readonly gameLoop: IGameLoop;

  // Support
  readonly eventBus: IEventBus;
  readonly logger: IGameLogger;
}
