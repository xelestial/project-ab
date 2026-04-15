/**
 * tryStartGame — shared logic called from both REST routes and WS handler.
 * Fires when all players have submitted their pre-game placement.
 */
import type { GameFactory, IEventBus } from "@ab/engine";
import type { IDataRegistry, PlayerId, GameState } from "@ab/metadata";
import type { PlayerConfig } from "@ab/engine";
import type { FastifyBaseLogger } from "fastify";
import type { GameSession } from "./game-session-manager.js";
import type { IStatsStore } from "./stats-store.js";

export function tryStartGame(
  session: GameSession,
  factory: GameFactory,
  registry: IDataRegistry,
  statsStore: IStatsStore,
  log: FastifyBaseLogger,
): void {
  if (session.status !== "waiting") return;

  const allPlacementsReady = session.placements.size >= session.expectedPlayerCount;
  const allAdaptersReady = session.adapters.size >= session.expectedPlayerCount;
  if (!allPlacementsReady || !allAdaptersReady) return;

  session.status = "running";
  const startedAt = Date.now();
  const gameId = session.gameId;

  // Build placements map
  const placementsMap = new Map<
    string,
    Array<{ metaId: string; position: { row: number; col: number } }>
  >();
  for (const [pid, entries] of session.placements) {
    placementsMap.set(pid, entries);
  }

  // Build GameOptions from current session state
  const draftPoolIds = session.state.draft?.poolIds as string[] | undefined;
  const gameOptions = {
    gameId: session.state.gameId as string,
    mapId: session.state.map.mapId as string,
    players: Object.values(session.state.players).map((p) => ({
      playerId: p.playerId as PlayerId,
      teamIndex: p.teamIndex,
      priority: p.priority,
    })) as PlayerConfig[],
    ...(draftPoolIds !== undefined ? { draftPoolIds } : {}),
  };

  // Build a pre-placed battle state and replace session state
  const battleState = factory.createBattleState(gameOptions, placementsMap);
  session.state = battleState;

  // Keep session.state in sync with the live game state for REST polling
  (session.context.eventBus as IEventBus).onAny((event) => {
    if ("state" in event) {
      session.state = (event as { state: GameState }).state;
    }
  });

  // Start game loop
  session.context.gameLoop
    .start(session.state, session.adapters)
    .then((result) => {
      session.state = result.finalState;
      session.status = "ended";

      const allPlayerIds = Object.keys(result.finalState.players);
      const loserIds = allPlayerIds.filter((id) => !result.winnerIds.includes(id));
      void statsStore
        .recordResult({
          gameId: result.gameId,
          winnerIds: result.winnerIds,
          loserIds,
          reason: result.reason,
          rounds: result.finalState.round,
          playerIds: allPlayerIds,
          startedAt,
          endedAt: Date.now(),
        })
        .catch((err: unknown) => {
          log.error(err, "[game-starter] stats recordResult failed");
        });
      log.info(
        `[game-starter] Game ${gameId} ended — winner: ${result.winnerIds.join(",") || "draw"}`,
      );
    })
    .catch((err: unknown) => {
      log.error(err, "[game-starter] game loop error");
      session.status = "ended";
    });
}

/**
 * Generate a random placement for an AI player on their half of the map.
 */
export function generateAiPlacement(
  teamIndex: number,
  gridSize: number,
  maxUnits: number,
  draftPool: string[],
  occupiedPositions: Set<string>,
): Array<{ metaId: string; position: { row: number; col: number } }> {
  const half = Math.floor(gridSize / 2);
  const rowStart = teamIndex === 0 ? 0 : half;
  const rowEnd = teamIndex === 0 ? half - 1 : gridSize - 1;

  // Collect free cells on this player's half
  const available: { row: number; col: number }[] = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (!occupiedPositions.has(`${r},${c}`)) {
        available.push({ row: r, col: c });
      }
    }
  }

  // Fisher-Yates shuffle
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j]!, available[i]!];
  }

  const placements: Array<{ metaId: string; position: { row: number; col: number } }> = [];
  const usedMetaIds = new Set<string>();

  for (let i = 0; i < maxUnits && i < available.length; i++) {
    // Pick a metaId not already used by this player
    const availableMeta = draftPool.filter((id) => !usedMetaIds.has(id));
    if (availableMeta.length === 0) break;
    const metaId = availableMeta[i % availableMeta.length]!;
    usedMetaIds.add(metaId);
    placements.push({ metaId, position: available[i]! });
    occupiedPositions.add(`${available[i]!.row},${available[i]!.col}`);
  }

  return placements;
}
