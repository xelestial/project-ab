/**
 * GameFactory — the ONLY place where all modules are assembled.
 * P-05: new Module() is only permitted here (and in tests).
 */
import type { IDataRegistry } from "@ab/metadata";
import type { GameState, PlayerId, MetaId, TurnSlot } from "@ab/metadata";
import { GRID_SIZE } from "@ab/metadata";
import { generateTerrain } from "../map/terrain-generator.js";
import type { GameContext } from "./game-context.js";

import { StateApplicator } from "../state/state-applicator.js";
import { MovementValidator } from "../validators/movement-validator.js";
import { AttackValidator } from "../validators/attack-validator.js";
import { EffectValidator } from "../validators/effect-validator.js";
import { TileValidator } from "../validators/tile-validator.js";
import { TileTransitionResolver } from "../resolvers/tile-transition-resolver.js";
import { MovementResolver } from "../resolvers/movement-resolver.js";
import { AttackResolver } from "../resolvers/attack-resolver.js";
import { EffectResolver } from "../resolvers/effect-resolver.js";
import { TileResolver } from "../resolvers/tile-resolver.js";
import { HealthManager } from "../managers/health-manager.js";
import { EffectManager } from "../managers/effect-manager.js";
import { TileManager } from "../managers/tile-manager.js";
import { TurnManager } from "../managers/turn-manager.js";
import { DraftManager } from "../managers/draft-manager.js";
import { RoundManager } from "../managers/round-manager.js";
import { EndDetector } from "../loop/end-detector.js";
import { ActionProcessor } from "../loop/action-processor.js";
import { PostProcessor } from "../loop/post-processor.js";
import { GameLoop } from "../loop/game-loop.js";
import { EventBus } from "../support/event-bus.js";
import { GameLogger } from "../support/game-logger.js";

// ─── Game options ─────────────────────────────────────────────────────────────

export interface PlayerConfig {
  playerId: PlayerId;
  teamIndex: number;
  priority?: number;
}

export interface GameOptions {
  gameId: string;
  mapId: string;
  players: PlayerConfig[];
  draftPoolIds?: string[];
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export class GameFactory {
  constructor(private readonly registry: IDataRegistry) {}

  createContext(): GameContext {
    // ── State ──────────────────────────────────────────────────────────────
    const applicator = new StateApplicator();

    // ── Validators ─────────────────────────────────────────────────────────
    const movementValidator = new MovementValidator(this.registry);
    const attackValidator = new AttackValidator(this.registry);
    const effectValidator = new EffectValidator(this.registry);
    const tileValidator = new TileValidator(this.registry);

    // ── Resolvers ──────────────────────────────────────────────────────────
    const tileTransitionResolver = new TileTransitionResolver(this.registry);
    const movementResolver = new MovementResolver(movementValidator, tileTransitionResolver);
    const attackResolver = new AttackResolver(attackValidator, this.registry, tileTransitionResolver);
    const effectResolver = new EffectResolver(effectValidator, this.registry);
    const tileResolver = new TileResolver(tileValidator, this.registry);

    // ── Managers ───────────────────────────────────────────────────────────
    const healthManager = new HealthManager(applicator);
    const effectManager = new EffectManager(effectResolver, applicator);
    const tileManager = new TileManager(tileResolver, applicator);
    const turnManager = new TurnManager(applicator);
    const draftManager = new DraftManager(this.registry, applicator);
    const roundManager = new RoundManager(applicator);

    // ── Loop ───────────────────────────────────────────────────────────────
    const endDetector = new EndDetector();
    const actionProcessor = new ActionProcessor(
      turnManager,
      movementValidator,
      attackValidator,
      movementResolver,
      attackResolver,
      effectResolver,
      applicator,
      healthManager,
      effectManager,
      tileManager,
      this.registry,
    );
    const postProcessor = new PostProcessor(healthManager, endDetector);

    // ── Support ────────────────────────────────────────────────────────────
    const eventBus = new EventBus();
    const logger = new GameLogger();

    const gameLoop = new GameLoop(
      roundManager,
      draftManager,
      turnManager,
      actionProcessor,
      postProcessor,
      endDetector,
      effectManager,
      healthManager,
      eventBus,
      logger,
    );

    return {
      registry: this.registry,
      applicator,
      movementValidator,
      attackValidator,
      effectValidator,
      tileValidator,
      tileTransitionResolver,
      movementResolver,
      attackResolver,
      effectResolver,
      tileResolver,
      healthManager,
      effectManager,
      tileManager,
      turnManager,
      draftManager,
      roundManager,
      endDetector,
      actionProcessor,
      postProcessor,
      gameLoop,
      eventBus,
      logger,
    };
  }

  /**
   * Create an initial GameState from options.
   */
  createInitialState(options: GameOptions): GameState {
    const mapMeta = this.registry.getMap(options.mapId);
    const now = new Date().toISOString();

    // Generate random terrain, then apply static map overrides on top
    const gridSize = mapMeta.gridSize ?? GRID_SIZE;
    const { tiles: generatedTiles, baseTile } = generateTerrain(gridSize, mapMeta.spawnPoints);
    const tiles: Record<string, import("@ab/metadata").TileState> = { ...generatedTiles };
    for (const override of mapMeta.tileOverrides) {
      const key = `${override.position.row},${override.position.col}`;
      tiles[key] = {
        position: override.position,
        attribute: override.tileType,
        attributeTurnsRemaining: undefined,
      };
    }

    // Build players
    const players: Record<string, import("@ab/metadata").PlayerState> = {};
    for (const pc of options.players) {
      players[pc.playerId] = {
        playerId: pc.playerId,
        teamIndex: pc.teamIndex,
        priority: pc.priority ?? 1,
        unitIds: [],
        connected: true,
        surrendered: false,
      };
    }

    return {
      gameId: options.gameId as import("@ab/metadata").GameId,
      phase: "waiting",
      round: 1,
      turnOrder: [],
      currentTurnIndex: 0,
      players,
      units: {},
      map: {
        mapId: mapMeta.id,
        gridSize,
        baseTile,
        tiles,
      },
      draft: options.draftPoolIds !== undefined
        ? {
            poolIds: options.draftPoolIds as MetaId[],
            slots: [],
            timeoutRemainingMs: 180_000,
          }
        : undefined,
      endResult: undefined,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Create a GameState already in "battle" phase with pre-placed units.
   * Used by the placement system to skip the draft phase entirely.
   */
  createBattleState(
    options: GameOptions,
    placements: Map<string, Array<{ metaId: string; position: { row: number; col: number } }>>,
  ): GameState {
    let state = this.createInitialState(options);

    // Place each player's units
    for (const [playerId, entries] of placements) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const unitMeta = this.registry.getUnit(entry.metaId);
        const unitId =
          `${playerId}_${entry.metaId}_t${Date.now()}_r${i}` as import("@ab/metadata").UnitId;

        state = {
          ...state,
          units: {
            ...state.units,
            [unitId]: {
              unitId,
              metaId: unitMeta.id,
              playerId: playerId as PlayerId,
              position: entry.position as import("@ab/metadata").Position,
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
            },
          },
          players: {
            ...state.players,
            [playerId]: {
              ...state.players[playerId]!,
              unitIds: [...(state.players[playerId]?.unitIds ?? []), unitId],
            },
          },
        };
      }
    }

    // Build turn order (by priority, randomize ties)
    const playerList = Object.values(state.players).filter((p) => !p.surrendered);
    playerList.sort((a, b) => a.priority - b.priority);
    if (Math.random() < 0.5) playerList.reverse();
    const turnOrder: TurnSlot[] = playerList.map((p) => ({
      playerId: p.playerId,
      priority: p.priority,
    }));

    return {
      ...state,
      phase: "battle",
      turnOrder,
      currentTurnIndex: 0,
      draft: undefined,
    };
  }
}
