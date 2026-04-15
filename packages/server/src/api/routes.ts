/**
 * HTTP REST API routes — lobby, auth, game management, stats.
 * WebSocket upgrades are handled separately in ws-server.ts.
 *
 * Base URL: /api/v1
 *
 * Public routes (no auth):
 *   GET  /health
 *   GET  /api/v1/meta/*
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/refresh
 *   GET  /api/v1/leaderboard?limit=10
 *
 * Protected routes (Bearer JWT required):
 *   POST /api/v1/rooms
 *   GET  /api/v1/rooms
 *   GET  /api/v1/rooms/:gameId
 *   POST /api/v1/rooms/:gameId/ai
 *   POST /api/v1/auth/logout
 *
 * Mixed (optional auth enhances response):
 *   GET  /api/v1/stats/:playerId
 */
import type { FastifyInstance } from "fastify";
import type { GameSessionManager } from "../session/game-session-manager.js";
import type { GameFactory } from "@ab/engine";
import type { IDataRegistry, PlayerId, UnitId } from "@ab/metadata";
import type { IStatsStore } from "../session/stats-store.js";
import { MemoryStatsStore } from "../session/stats-store.js";
import type { ITokenStore } from "../auth/token-store.js";
import { MemoryTokenStore } from "../auth/token-store.js";
import { createToken, verifyToken, requireAuth } from "../auth/jwt-auth.js";
import { MCTSAdapter } from "@ab/ai";
import { MatchmakingQueue } from "../session/matchmaking.js";
import { tryStartGame, generateAiPlacement } from "../session/game-starter.js";
import { PassThroughAdapter } from "../ws/passthrough-adapter.js";
import { z } from "zod";

// ─── Request/Response schemas ──────────────────────────────────────────────────

const CreateRoomBodySchema = z.object({
  mapId: z.string(),
  playerCount: z.number().int().min(2).max(4),
  draftPoolIds: z.array(z.string()).optional(),
});

const LoginBodySchema = z.object({
  playerId: z.string().min(1).max(64),
  /** Phase 3 placeholder: password field for future auth backends */
  password: z.string().optional(),
});

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

const AddAiBodySchema = z.object({
  /** AI difficulty: number of MCTS iterations (default: 200) */
  iterations: z.number().int().min(1).max(2000).optional(),
  /** Per-turn time budget in ms (default: 1000) */
  timeoutMs: z.number().int().min(100).max(10_000).optional(),
});

const MatchmakingJoinSchema = z.object({
  mapId: z.string().min(1),
  playerCount: z.number().int().min(2).max(4),
  /** ELO rating (default: 1000) */
  rating: z.number().int().min(0).max(10_000).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function registerRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: GameSessionManager;
    factory: GameFactory;
    registry: IDataRegistry;
    statsStore?: IStatsStore;
    tokenStore?: ITokenStore;
    matchmakingQueue?: MatchmakingQueue;
  },
): Promise<void> {
  const { sessionManager, factory, registry } = deps;
  const statsStore: IStatsStore = deps.statsStore ?? new MemoryStatsStore();
  const tokenStore: ITokenStore = deps.tokenStore ?? new MemoryTokenStore();
  const matchmaking = deps.matchmakingQueue ?? new MatchmakingQueue();

  // ── Health ────────────────────────────────────────────────────────────────
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: Date.now(),
    version: "2.0.0",
  }));

  // ── Metadata (public) ─────────────────────────────────────────────────────
  fastify.get("/api/v1/meta/units", async () => ({
    units: registry.getAllUnits(),
  }));

  fastify.get("/api/v1/meta/maps", async () => ({
    maps: registry.getAllMaps(),
  }));

  fastify.get<{ Params: { id: string } }>("/api/v1/meta/units/:id", async (req, reply) => {
    try {
      return registry.getUnit(req.params["id"]);
    } catch {
      return reply.code(404).send({ error: "Unit not found" });
    }
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  /** POST /api/v1/auth/login — issue access + refresh tokens */
  fastify.post("/api/v1/auth/login", async (req, reply) => {
    const body = LoginBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
    }

    // Phase 3: no password DB yet — any playerId is accepted
    // Phase 4: validate against user table
    const { playerId } = body.data;
    const accessToken = createToken(playerId, "player");
    const refreshRecord = tokenStore.issue(playerId);

    return reply.code(200).send({
      accessToken,
      refreshToken: refreshRecord.token,
      expiresIn: 15 * 60, // seconds
      tokenType: "Bearer",
    });
  });

  /** POST /api/v1/auth/refresh — rotate refresh token and issue new access token */
  fastify.post("/api/v1/auth/refresh", async (req, reply) => {
    const body = RefreshBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid request" });
    }

    const record = await tokenStore.verify(body.data.refreshToken);
    if (record === undefined) {
      return reply.code(401).send({ error: "Invalid or expired refresh token" });
    }

    // Rotate: mark old token as used, issue new tokens
    tokenStore.markUsed(body.data.refreshToken);
    const newAccessToken = createToken(record.playerId, "player");
    const newRefresh = tokenStore.issue(record.playerId);

    return reply.code(200).send({
      accessToken: newAccessToken,
      refreshToken: newRefresh.token,
      expiresIn: 15 * 60,
      tokenType: "Bearer",
    });
  });

  /** POST /api/v1/auth/logout — revoke refresh token */
  fastify.post(
    "/api/v1/auth/logout",
    { preHandler: requireAuth },
    async (req, reply) => {
      const body = RefreshBodySchema.safeParse(req.body);
      if (body.success) {
        tokenStore.revoke(body.data.refreshToken);
      }
      return reply.code(204).send();
    },
  );

  // ── Rooms (protected) ─────────────────────────────────────────────────────

  fastify.post(
    "/api/v1/rooms",
    { preHandler: requireAuth },
    async (req, reply) => {
      const body = CreateRoomBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
      }

      const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const context = factory.createContext();
      // Default pool = all unit IDs from registry (if not specified)
      const defaultPool = registry.getAllUnits().map((u) => u.id);
      const gameOptions = {
        gameId,
        mapId: body.data.mapId,
        players: [] as never[],
        draftPoolIds: body.data.draftPoolIds ?? defaultPool,
      };
      const initialState = factory.createInitialState(gameOptions);

      sessionManager.createSession(gameId, context, initialState, body.data.playerCount);

      return reply.code(201).send({
        gameId,
        createdBy: req.jwtPayload?.sub ?? "anonymous",
      });
    },
  );

  fastify.get(
    "/api/v1/rooms",
    { preHandler: requireAuth },
    async () => ({
      rooms: sessionManager.listActiveSessions().map((s) => ({
        gameId: s.gameId,
        status: s.status,
        playerCount: s.adapters.size,
        createdAt: s.createdAt,
      })),
    }),
  );

  fastify.get<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) {
        return reply.code(404).send({ error: "Game not found" });
      }
      return {
        gameId: session.gameId,
        status: session.status,
        state: session.state,
      };
    },
  );

  // ── Stats (public) ────────────────────────────────────────────────────────

  fastify.get<{ Params: { playerId: string } }>(
    "/api/v1/stats/:playerId",
    async (req, reply) => {
      const stats = await statsStore.getPlayerStats(req.params["playerId"]);
      return reply.code(200).send({
        playerId: stats.playerId,
        wins: stats.wins,
        losses: stats.losses,
        draws: stats.draws,
        gamesPlayed: stats.wins + stats.losses + stats.draws,
        rating: stats.rating,
      });
    },
  );

  fastify.get<{ Params: { gameId: string } }>(
    "/api/v1/stats/game/:gameId",
    async (req, reply) => {
      const result = await statsStore.getGameResult(req.params["gameId"]);
      if (result === undefined) {
        return reply.code(404).send({ error: "Game result not found" });
      }
      return reply.code(200).send(result);
    },
  );

  // ── Leaderboard (public) ───────────────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>(
    "/api/v1/leaderboard",
    async (req, reply) => {
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 10)));
      const board = await statsStore.getLeaderboard(limit);
      return reply.code(200).send({
        leaderboard: board.map((s, idx) => ({
          rank: idx + 1,
          playerId: s.playerId,
          wins: s.wins,
          losses: s.losses,
          draws: s.draws,
          gamesPlayed: s.wins + s.losses + s.draws,
          winRate: s.wins + s.losses + s.draws > 0
            ? Math.round((s.wins / (s.wins + s.losses + s.draws)) * 1000) / 10
            : 0,
          rating: s.rating,
        })),
      });
    },
  );

  // ── Human player pre-registration (protected) ────────────────────────────

  const JoinBodySchema = z.object({
    playerId: z.string().min(1).max(64),
  });

  /**
   * POST /api/v1/rooms/:gameId/join — register a human player slot in a waiting room.
   * Must be called before /ai additions to ensure correct teamIndex assignment.
   */
  fastify.post<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId/join",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) {
        return reply.code(404).send({ error: "Game not found" });
      }
      if (session.status === "ended") {
        return reply.code(409).send({ error: "Game already ended" });
      }

      const body = JoinBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
      }

      const { playerId } = body.data;

      // Already registered
      if (session.state.players[playerId] !== undefined) {
        return reply.code(200).send({
          playerId,
          teamIndex: session.state.players[playerId]!.teamIndex,
          alreadyRegistered: true,
        });
      }

      const mapMeta = registry.getMap(session.state.map.mapId);
      const teamSize = mapMeta.teamSize ?? 1;
      const slotIndex = Object.keys(session.state.players).length;
      const teamIndex = Math.floor(slotIndex / teamSize);

      session.state = {
        ...session.state,
        players: {
          ...session.state.players,
          [playerId]: {
            playerId: playerId as PlayerId,
            teamIndex,
            priority: 1,
            unitIds: [] as UnitId[],
            connected: true,
            surrendered: false,
          },
        },
      };

      return reply.code(201).send({ playerId, teamIndex });
    },
  );

  // ── AI player injection (protected) ──────────────────────────────────────

  /** POST /api/v1/rooms/:gameId/ai — add an AI player to a waiting room */
  fastify.post<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId/ai",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) {
        return reply.code(404).send({ error: "Game not found" });
      }
      if (session.status !== "waiting") {
        return reply.code(409).send({ error: "Game already started or ended" });
      }

      const body = AddAiBodySchema.safeParse(req.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
      }

      const aiPlayerId = `ai_${Date.now()}` as PlayerId;
      const { movementValidator, attackValidator, actionProcessor } = session.context;

      const mctsOptions = {
        ...(body.data.iterations !== undefined ? { iterations: body.data.iterations } : {}),
        ...(body.data.timeoutMs !== undefined ? { timeoutMs: body.data.timeoutMs } : {}),
      };
      const adapter = new MCTSAdapter(
        aiPlayerId,
        movementValidator,
        attackValidator,
        actionProcessor,
        mctsOptions,
      );

      // Determine teamIndex: use map's teamSize to assign teams correctly
      const mapMeta = registry.getMap(session.state.map.mapId);
      const teamSize = mapMeta.teamSize ?? 1;
      const slotIndex = Object.keys(session.state.players).length; // 0-based slot
      const teamIndex = Math.floor(slotIndex / teamSize);
      const gridSize = session.state.map.gridSize;
      const maxUnits = mapMeta.maxUnitsPerPlayer ?? 3;

      // Register AI as a player in game state
      session.state = {
        ...session.state,
        players: {
          ...session.state.players,
          [aiPlayerId]: {
            playerId: aiPlayerId,
            teamIndex,
            priority: 1,
            unitIds: [] as UnitId[],
            connected: true,
            surrendered: false,
          },
        },
      };

      sessionManager.addAdapter(req.params["gameId"], adapter);

      // Auto-generate placement for AI
      const occupied = new Set<string>(
        [...session.placements.values()].flatMap((entries) =>
          entries.map((e) => `${e.position.row},${e.position.col}`),
        ),
      );
      const draftPool = (session.state.draft?.poolIds as string[] | undefined)
        ?? registry.getAllUnits().map((u) => u.id as string);
      const aiPlacement = generateAiPlacement(teamIndex, gridSize, maxUnits, draftPool, occupied);
      session.placements.set(aiPlayerId as string, aiPlacement);

      // Try to start game if all placements + adapters are ready
      const updatedSession = sessionManager.getSession(req.params["gameId"])!;
      tryStartGame(updatedSession, factory, registry, statsStore, fastify.log);

      return reply.code(201).send({
        aiPlayerId,
        gameId: req.params["gameId"],
        started: updatedSession.status === "running",
      });
    },
  );

  // ── Pre-game placement (protected) ───────────────────────────────────────

  const PlacementBodySchema = z.object({
    playerId: z.string().min(1),
    units: z.array(
      z.object({
        metaId: z.string().min(1),
        position: z.object({ row: z.number().int().min(0), col: z.number().int().min(0) }),
      }),
    ).min(1),
  });

  /**
   * POST /api/v1/rooms/:gameId/place — submit unit placement for a player.
   * Validates that all positions are on the player's half and no duplicates.
   */
  fastify.post<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId/place",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) {
        return reply.code(404).send({ error: "Game not found" });
      }
      if (session.status === "ended") {
        return reply.code(409).send({ error: "Game already ended" });
      }

      const body = PlacementBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
      }

      const { playerId, units } = body.data;

      const { gridSize } = session.state.map;
      const mapMeta = registry.getMap(session.state.map.mapId);

      // Auto-register human player if not yet in game (e.g. WS join timed out)
      if (session.state.players[playerId] === undefined) {
        const teamSize = mapMeta.teamSize ?? 1;
        const slotIndex = Object.keys(session.state.players).length;
        const teamIndex = Math.floor(slotIndex / teamSize);
        session.state = {
          ...session.state,
          players: {
            ...session.state.players,
            [playerId]: {
              playerId: playerId as PlayerId,
              teamIndex,
              priority: 1,
              unitIds: [] as UnitId[],
              connected: true,
              surrendered: false,
            },
          },
        };
      }

      const playerState = session.state.players[playerId]!;
      const maxUnits = mapMeta.maxUnitsPerPlayer ?? 3;

      if (units.length !== maxUnits) {
        return reply.code(400).send({ error: `Must place exactly ${maxUnits} units` });
      }

      // Validate positions are on player's half
      const half = Math.floor(gridSize / 2);
      const rowStart = playerState.teamIndex === 0 ? 0 : half;
      const rowEnd = playerState.teamIndex === 0 ? half - 1 : gridSize - 1;

      for (const u of units) {
        if (u.position.row < rowStart || u.position.row > rowEnd || u.position.col < 0 || u.position.col >= gridSize) {
          return reply.code(400).send({
            error: `Position (${u.position.row},${u.position.col}) is not on player's half`,
          });
        }
      }

      // Validate no duplicate positions in this placement
      const posSeen = new Set<string>();
      for (const u of units) {
        const k = `${u.position.row},${u.position.col}`;
        if (posSeen.has(k)) {
          return reply.code(400).send({ error: "Duplicate position in placement" });
        }
        posSeen.add(k);
      }

      // Validate no duplicate metaIds (same player can't pick same unit twice)
      const metaSeen = new Set<string>();
      for (const u of units) {
        if (metaSeen.has(u.metaId)) {
          return reply.code(400).send({ error: "Duplicate metaId in placement — pick different unit types" });
        }
        metaSeen.add(u.metaId);
      }

      // Store placement
      session.placements.set(playerId, units);

      // Register a PassThroughAdapter if this human doesn't have a WS adapter yet
      if (!session.adapters.has(playerId)) {
        const passAdapter = new PassThroughAdapter(playerId);
        sessionManager.addAdapter(session.gameId, passAdapter);
      }

      // Try to start game
      tryStartGame(session, factory, registry, statsStore, fastify.log);

      return reply.code(200).send({
        accepted: true,
        waitingFor: session.expectedPlayerCount - session.placements.size,
        started: session.status === "running",
      });
    },
  );

  // ── Human turn action (protected) ────────────────────────────────────────

  const ActionBodySchema = z.object({
    playerId: z.string().min(1),
    action: z.object({
      type: z.enum(["move", "attack", "pass"]),
      unitId: z.string().optional(),
      targetPosition: z.object({ row: z.number().int(), col: z.number().int() }).optional(),
      targetUnitId: z.string().optional(),
    }),
  });

  /**
   * POST /api/v1/rooms/:gameId/action — submit a human player action during their turn.
   * The PassThroughAdapter receives the action and resolves the pending requestAction promise.
   */
  fastify.post<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId/action",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) {
        return reply.code(404).send({ error: "Game not found" });
      }

      const body = ActionBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
      }

      const { playerId, action } = body.data;
      const adapter = session.adapters.get(playerId);

      if (adapter === undefined) {
        return reply.code(404).send({ error: "Player adapter not found" });
      }

      if (adapter.type !== "human") {
        return reply.code(409).send({ error: "Player is not human-controlled" });
      }

      // Build a proper PlayerAction
      const firstUnit = Object.values(session.state.units).find(
        (u) => u.alive && u.playerId === playerId,
      );
      const unitId = (action.unitId ?? firstUnit?.unitId ?? "") as import("@ab/metadata").UnitId;

      let playerAction: import("@ab/metadata").PlayerAction;

      if (action.type === "pass") {
        playerAction = {
          type: "pass",
          playerId: playerId as PlayerId,
          unitId,
        };
      } else if (action.type === "move" && action.targetPosition !== undefined) {
        playerAction = {
          type: "move",
          playerId: playerId as PlayerId,
          unitId,
          destination: action.targetPosition as import("@ab/metadata").Position,
        };
      } else if (action.type === "attack" && action.targetPosition !== undefined) {
        playerAction = {
          type: "attack",
          playerId: playerId as PlayerId,
          unitId,
          target: action.targetPosition as import("@ab/metadata").Position,
        };
      } else {
        return reply.code(400).send({ error: "Invalid action parameters" });
      }

      // Submit to PassThroughAdapter (or HumanAdapter via queue)
      import("../ws/passthrough-adapter.js").then(({ PassThroughAdapter }) => {
        if (adapter instanceof PassThroughAdapter) {
          adapter.submitAction(playerAction);
        }
      }).catch(() => {});

      return reply.code(200).send({ accepted: true });
    },
  );

  // ── Matchmaking (protected) ───────────────────────────────────────────────

  /**
   * POST /api/v1/matchmaking/join — enter the matchmaking queue.
   * When a full group is found, a game is created automatically.
   */
  fastify.post(
    "/api/v1/matchmaking/join",
    { preHandler: requireAuth },
    async (req, reply) => {
      const body = MatchmakingJoinSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid request", details: body.error.flatten() });
      }

      const playerId = req.jwtPayload?.sub ?? "anonymous";
      let matchResult: import("../session/matchmaking.js").MatchResult | undefined;

      // One-shot listener for immediate match
      const unsub = matchmaking.onMatch((result) => {
        if (result.playerIds.includes(playerId)) {
          matchResult = result;
        }
      });

      const matched = matchmaking.enqueue({
        playerId,
        mapId: body.data.mapId,
        playerCount: body.data.playerCount,
        rating: body.data.rating ?? 1000,
        enqueuedAt: Date.now(),
      });

      unsub();

      if (matched && matchResult !== undefined) {
        // Auto-create the game session
        const { gameId, mapId, playerIds } = matchResult;
        const context = factory.createContext();
        const initialState = factory.createInitialState({ gameId, mapId, players: [] });
        sessionManager.createSession(gameId, context, initialState, playerIds.length);

        return reply.code(201).send({
          status: "matched",
          gameId,
          playerIds,
        });
      }

      const position = matchmaking.getPosition(playerId);
      return reply.code(202).send({
        status: "queued",
        position,
        mapId: body.data.mapId,
        playerCount: body.data.playerCount,
      });
    },
  );

  /** DELETE /api/v1/matchmaking/leave — leave the matchmaking queue */
  fastify.delete(
    "/api/v1/matchmaking/leave",
    { preHandler: requireAuth },
    async (req, reply) => {
      const playerId = req.jwtPayload?.sub ?? "anonymous";
      matchmaking.dequeue(playerId);
      return reply.code(204).send();
    },
  );

  /** GET /api/v1/matchmaking/status — queue position and sizes */
  fastify.get(
    "/api/v1/matchmaking/status",
    { preHandler: requireAuth },
    async (req, reply) => {
      const playerId = req.jwtPayload?.sub ?? "anonymous";
      const position = matchmaking.getPosition(playerId);
      const sizes = matchmaking.getQueueSizes();
      return reply.code(200).send({ position, queues: sizes });
    },
  );
}
