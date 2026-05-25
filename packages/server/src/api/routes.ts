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
import type { IReplayStore } from "../session/replay-store.js";
import { MemoryReplayStore } from "../session/replay-store.js";
import type { ITokenStore } from "../auth/token-store.js";
import { MemoryTokenStore } from "../auth/token-store.js";
import { createToken, verifyToken, requireAuth } from "../auth/jwt-auth.js";
import { MCTSAdapter, TacticalAdapter } from "@ab/ai";
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
  /** AI difficulty: number of MCTS iterations (default: 200). MCTS 전용. */
  iterations: z.number().int().min(1).max(2000).optional(),
  /** Per-turn time budget in ms (default: 1000). MCTS 전용. */
  timeoutMs: z.number().int().min(100).max(10_000).optional(),
  /**
   * Tactical AI 가중치 프로파일.
   * 지정하면 TacticalAdapter 사용; 미지정 시 MCTSAdapter 사용.
   * 값: "aggressive" | "defensive" | "balanced" | "test"
   */
  profile: z.enum(["aggressive", "defensive", "balanced", "test"]).optional(),
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
    replayStore?: IReplayStore;
  },
): Promise<void> {
  const { sessionManager, factory, registry } = deps;
  const statsStore: IStatsStore = deps.statsStore ?? new MemoryStatsStore();
  const tokenStore: ITokenStore = deps.tokenStore ?? new MemoryTokenStore();
  const matchmaking = deps.matchmakingQueue ?? new MatchmakingQueue();
  const replayStore: IReplayStore = deps.replayStore ?? new MemoryReplayStore();

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

  fastify.get("/api/v1/meta/tiles", async () => ({
    tiles: registry.getAllTiles(),
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

      sessionManager.createSession(gameId, context, initialState, body.data.playerCount, body.data.mapId);

      return reply.code(201).send({
        gameId,
        createdBy: req.jwtPayload?.sub ?? "anonymous",
      });
    },
  );

  /** GET /api/v1/rooms — room list comes from Redis so all instances see the same data */
  fastify.get(
    "/api/v1/rooms",
    { preHandler: requireAuth },
    async () => {
      const records = await sessionManager.getStore().listActive();
      return {
        rooms: records.map((r) => ({
          gameId: r.gameId,
          status: r.status,
          mapId: r.mapId,
          expectedPlayerCount: r.expectedPlayerCount,
          joinedPlayerCount: r.playerIds.length,
          placedPlayerCount: Object.keys(r.placements).length,
          createdAt: r.createdAt,
        })),
      };
    },
  );

  fastify.get<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const gameId = req.params["gameId"];
      // Try in-memory first; fall back to store for cross-instance visibility
      const session = sessionManager.getSession(gameId);
      if (session !== undefined) {
        return { gameId: session.gameId, status: session.status, state: session.state };
      }
      const record = await sessionManager.getStore().get(gameId);
      if (record === undefined) {
        return reply.code(404).send({ error: "Game not found" });
      }
      return { gameId: record.gameId, status: record.status, state: record.state };
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

      // Persist updated player list to store so GET /rooms shows correct joinedPlayerCount
      await sessionManager.updateState(session.gameId, session.state);

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

      // profile이 지정되면 TacticalAdapter, 아니면 기존 MCTSAdapter 사용
      const adapter = body.data.profile !== undefined
        ? new TacticalAdapter(
            aiPlayerId,
            movementValidator,
            attackValidator,
            registry,
            { profile: body.data.profile },
          )
        : new MCTSAdapter(
            aiPlayerId,
            movementValidator,
            attackValidator,
            actionProcessor,
            {
              ...(body.data.iterations !== undefined ? { iterations: body.data.iterations } : {}),
              ...(body.data.timeoutMs !== undefined ? { timeoutMs: body.data.timeoutMs } : {}),
            },
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

      // Persist updated player list so GET /rooms shows correct joinedPlayerCount
      await sessionManager.updateState(req.params["gameId"], session.state);

      // Auto-generate placement for AI
      // Read occupied tiles from in-memory placements (already synced from store)
      const occupied = new Set<string>(
        [...session.placements.values()].flatMap((entries) =>
          entries.map((e) => `${e.position.row},${e.position.col}`),
        ),
      );
      const draftPool = (session.state.draft?.poolIds as string[] | undefined)
        ?? registry.getAllUnits().map((u) => u.id as string);
      const aiPlacement = generateAiPlacement(teamIndex, gridSize, maxUnits, draftPool, occupied);
      await sessionManager.savePlacement(req.params["gameId"], aiPlayerId as string, aiPlacement);
      sessionManager.addAiPlayer(req.params["gameId"], aiPlayerId as string);

      // Try to start game if all placements + adapters are ready
      const updatedSession = sessionManager.getSession(req.params["gameId"])!;
      tryStartGame(updatedSession, factory, registry, statsStore, fastify.log, replayStore);

      return reply.code(201).send({
        aiPlayerId,
        gameId: req.params["gameId"],
        started: updatedSession.status === "running",
      });
    },
  );

  // ── Pre-game placement (protected) ───────────────────────────────────────

  /**
   * Per-game placement mutex: ensures concurrent /place requests for the same
   * game are processed sequentially, preventing same-team duplicate metaId races.
   */
  const placementLocks = new Map<string, Promise<void>>();

  function withPlacementLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const current = placementLocks.get(gameId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    placementLocks.set(gameId, current.then(() => gate));
    return current.then(async () => {
      try { return await fn(); }
      finally { release(); }
    });
  }

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
      // Fast pre-checks outside the lock (session existence, parse)
      const gameId = req.params["gameId"];
      const session = sessionManager.getSession(gameId);
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

      // Serialize all placement submissions per game to prevent same-team race conditions
      return withPlacementLock(gameId, async () => {
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

        // Validate no duplicate metaIds within this player's own placement
        const metaSeen = new Set<string>();
        for (const u of units) {
          if (metaSeen.has(u.metaId)) {
            return reply.code(400).send({ error: "Duplicate metaId in placement — pick different unit types" });
          }
          metaSeen.add(u.metaId);
        }

        // Validate no metaId overlap with teammates (inside lock → placements are consistent)
        const myTeam = playerState.teamIndex;
        for (const [pid, entries] of session.placements) {
          const pState = session.state.players[pid];
          if (pState === undefined || pState.teamIndex !== myTeam) continue;
          const takenByTeammate = entries.map((e) => e.metaId);
          for (const u of units) {
            if (takenByTeammate.includes(u.metaId)) {
              return reply.code(409).send({
                error: `유닛 "${u.metaId}"은(는) 같은 팀 플레이어가 이미 선택했습니다. 다른 유닛을 선택해주세요.`,
                conflictMetaId: u.metaId,
                takenBy: pid,
              });
            }
          }
        }

        // Persist placement to memory + store (Redis)
        await sessionManager.savePlacement(session.gameId, playerId, units);

        // Register a PassThroughAdapter if this human doesn't have a WS adapter yet
        if (!session.adapters.has(playerId)) {
          const passAdapter = new PassThroughAdapter(playerId);
          sessionManager.addAdapter(session.gameId, passAdapter);
        }

        // Try to start game
        tryStartGame(session, factory, registry, statsStore, fastify.log, replayStore);

        return reply.code(200).send({
          accepted: true,
          waitingFor: session.expectedPlayerCount - session.placements.size,
          started: session.status === "running",
        });
      });
    },
  );

  // ── Human turn action (protected) ────────────────────────────────────────

  const ActionBodySchema = z.object({
    playerId: z.string().min(1),
    action: z.object({
      type: z.enum(["move", "attack", "pass", "skill"]),
      unitId: z.string().optional(),
      skillId: z.string().optional(),
      targetPosition: z.object({ row: z.number().int(), col: z.number().int() }).optional(),
      sourceTile: z.object({ row: z.number().int(), col: z.number().int() }).optional(),
      targetUnitId: z.string().optional(),
      /** Secondary weapon override for attack actions */
      weaponId: z.string().optional(),
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
        // Save pre-move state for undo
        const movingUnit = session.state.units[unitId];
        if (movingUnit !== undefined) {
          session.pendingMoveUndos.set(String(unitId), {
            from: movingUnit.position,
            movementPoints: movingUnit.movementPoints,
          });
        }
        playerAction = {
          type: "move",
          playerId: playerId as PlayerId,
          unitId,
          destination: action.targetPosition as import("@ab/metadata").Position,
        };
      } else if (action.type === "attack" && action.targetPosition !== undefined) {
        // Attacking clears the undo record for this unit
        session.pendingMoveUndos.delete(String(unitId));
        playerAction = {
          type: "attack",
          playerId: playerId as PlayerId,
          unitId,
          target: action.targetPosition as import("@ab/metadata").Position,
          sourceTile: action.sourceTile as import("@ab/metadata").Position | undefined,
          weaponId: action.weaponId as import("@ab/metadata").MetaId | undefined,
        };
      } else if (action.type === "skill" && action.skillId !== undefined && action.targetPosition !== undefined) {
        playerAction = {
          type: "skill",
          playerId: playerId as PlayerId,
          unitId,
          skillId: action.skillId as import("@ab/metadata").MetaId,
          target: action.targetPosition as import("@ab/metadata").Position,
        };
      } else {
        return reply.code(400).send({ error: "Invalid action parameters" });
      }

      // Submit to adapter — works for both PassThroughAdapter (REST-only) and HumanAdapter (WS)
      import("../ws/passthrough-adapter.js").then(({ PassThroughAdapter }) => {
        if (adapter instanceof PassThroughAdapter) {
          adapter.submitAction(playerAction);
        } else {
          import("../ws/human-adapter.js").then(({ HumanAdapter }) => {
            if (adapter instanceof HumanAdapter) {
              adapter.submitAction(playerAction);
            }
          }).catch(() => {});
        }
      }).catch(() => {});

      return reply.code(200).send({ accepted: true });
    },
  );

  // ── Unit options (protected) ─────────────────────────────────────────────

  // GET /api/v1/rooms/:gameId/unit-options?playerId=X&unitId=Y
  // Returns valid moves, attack range, and unit stats for a given unit
  fastify.get<{ Params: { gameId: string }; Querystring: { playerId: string; unitId: string; weaponId?: string } }>(
    "/api/v1/rooms/:gameId/unit-options",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) return reply.code(404).send({ error: "Game not found" });

      const { playerId, unitId, weaponId: overrideWeaponId } = req.query;
      const unit = session.state.units[unitId];
      if (unit === undefined) return reply.code(404).send({ error: "Unit not found" });

      const { movementValidator, attackValidator } = session.context;

      // Reachable movement tiles
      const reachableTiles = unit.actionsUsed.moved
        ? []
        : movementValidator.getReachableTiles(unit, session.state);

      // Attack range — uses override weapon if specified (e.g. secondary weapon)
      const attackOpts = overrideWeaponId ? { overrideWeaponId } : undefined;
      const attackableTiles = unit.actionsUsed.attacked
        ? []
        : attackValidator.getAttackableTargets(unit, session.state, attackOpts);

      // Determine if this weapon can meaningfully target empty tiles
      // (applyTileEffect, area, spawnObstacle weapons)
      const activeWeaponMeta = (() => {
        try {
          const unitMeta = registry.getUnit(unit.metaId);
          const wid = overrideWeaponId ?? unitMeta.primaryWeaponId;
          return wid !== undefined ? registry.getWeapon(wid) : undefined;
        } catch { return undefined; }
      })();
      const w = activeWeaponMeta as Record<string, unknown> | undefined;
      const canTargetEmptyTiles = w !== undefined && (
        w["applyTileEffect"] !== undefined ||
        w["area"] !== undefined ||
        w["spawnObstacle"] !== undefined
      );

      // Clickable attack targets: enemies, plus empty tiles for AoE/tile-effect weapons
      const enemyPositions = canTargetEmptyTiles
        ? attackableTiles  // all valid tiles are clickable
        : attackableTiles.filter((pos) =>
            Object.values(session.state.units).some(
              (u) => u.alive && u.playerId !== playerId && u.position.row === pos.row && u.position.col === pos.col,
            ),
          );

      // Unit metadata + weapon stats
      try {
        const unitMeta = registry.getUnit(unit.metaId);
        const weapon = unitMeta.primaryWeaponId !== undefined
          ? registry.getWeapon(unitMeta.primaryWeaponId)
          : undefined;
        const weapon2 = unitMeta.secondaryWeaponId !== undefined
          ? registry.getWeapon(unitMeta.secondaryWeaponId)
          : undefined;

        const canSkill = !unit.actionsUsed.skillUsed && !unit.actionsUsed.attacked;

        const skills = unitMeta.skillIds.map((skillId) => {
          const skill = registry.getSkill(skillId as import("@ab/metadata").MetaId);
          let skillTargets: { row: number; col: number }[] = [];
          if (skill.type === "active" && skill.weaponId !== undefined && canSkill) {
            const allSkillTiles = attackValidator.getAttackableTargets(unit, session.state, {
              overrideWeaponId: skill.weaponId as string,
            });
            skillTargets = allSkillTiles.filter((pos) =>
              Object.values(session.state.units).some(
                (u) => u.alive && u.playerId !== unit.playerId && u.position.row === pos.row && u.position.col === pos.col,
              ),
            );
          }
          return {
            skillId: skill.id,
            nameKey: skill.nameKey,
            descKey: skill.descKey,
            type: skill.type,
            oneShot: skill.oneShot,
            weaponId: skill.weaponId as string | undefined,
            canUse: canSkill && skill.type === "active",
            skillTargets,
          };
        });

        // Build passive list from passiveIds
        const passives = unitMeta.passiveIds.map((pid) => {
          try {
            const p = registry.getUnitPassive(pid as import("@ab/metadata").MetaId);
            return { passiveId: p.id, nameKey: p.nameKey, descKey: p.descKey };
          } catch { return null; }
        }).filter((p): p is NonNullable<typeof p> => p !== null);

        const weaponToObj = (w: typeof weapon) => w !== undefined ? {
          id: w.id,
          name: w.nameKey,
          damage: w.damage,
          minRange: w.minRange,
          maxRange: w.maxRange,
          attackType: w.attackType,
          attribute: w.attribute,
          knockback: (w as unknown as Record<string,unknown>)["knockback"],
          splash: (w as unknown as Record<string,unknown>)["splash"],
          rush: !!(w as unknown as Record<string,unknown>)["rush"],
          confusion: (w as unknown as Record<string,unknown>)["confusion"],
          applyTileEffect: (w as unknown as Record<string,unknown>)["applyTileEffect"],
          selfTileEffect: (w as unknown as Record<string,unknown>)["selfTileEffect"],
          penetrating: w.penetrating,
          arcing: w.arcing,
        } : null;

        return reply.code(200).send({
          reachableTiles,
          attackableTiles,
          enemyPositions,
          canTargetEmptyTiles,
          canMove: !unit.actionsUsed.moved,
          canAttack: !unit.actionsUsed.attacked,
          canUndo: session.pendingMoveUndos.has(String(unit.unitId)) && !unit.actionsUsed.attacked,
          canSkill,
          skills,
          unitInfo: {
            unitId: unit.unitId,
            metaId: unit.metaId,
            nameKey: unitMeta.nameKey,
            class: unitMeta.class,
            currentHealth: unit.currentHealth,
            maxHealth: unitMeta.baseHealth,
            currentArmor: unit.currentArmor,
            baseArmor: unitMeta.baseArmor,
            movementPoints: unit.movementPoints,
            baseMovement: unitMeta.baseMovement,
            activeEffects: unit.activeEffects,
            actionsUsed: unit.actionsUsed,
            weapon: weaponToObj(weapon),
            weapon2: weaponToObj(weapon2),
            passives,
            skills,
          },
        });
      } catch {
        return reply.code(500).send({ error: "Unit metadata not found" });
      }
    },
  );

  // ── Undo move (protected) ────────────────────────────────────────────────

  /**
   * POST /api/v1/rooms/:gameId/undo-move
   * Reverts the current unit's move action if it hasn't attacked yet.
   * Body: { playerId: string, unitId: string }
   */
  fastify.post<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId/undo-move",
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = sessionManager.getSession(req.params["gameId"]);
      if (session === undefined) return reply.code(404).send({ error: "Game not found" });

      const { playerId, unitId } = (req.body ?? {}) as { playerId?: string; unitId?: string };
      if (!unitId) return reply.code(400).send({ error: "unitId required" });

      const unit = session.state.units[unitId];
      if (unit === undefined) return reply.code(404).send({ error: "Unit not found" });
      if (unit.playerId !== playerId) return reply.code(403).send({ error: "Not your unit" });
      if (unit.actionsUsed.attacked) return reply.code(409).send({ error: "Cannot undo after attacking" });

      const undoData = session.pendingMoveUndos.get(unitId);
      if (undoData === undefined) return reply.code(409).send({ error: "No move to undo" });

      // Revert unit position and movement points, clear moved flag
      session.state = {
        ...session.state,
        units: {
          ...session.state.units,
          [unitId]: {
            ...unit,
            position: undoData.from,
            movementPoints: undoData.movementPoints,
            actionsUsed: { ...unit.actionsUsed, moved: false },
          },
        },
      };
      session.pendingMoveUndos.delete(unitId);

      // Broadcast updated state
      await sessionManager.updateState(session.gameId, session.state);
      return reply.code(200).send({ accepted: true, state: session.state });
    },
  );

  // ── Unit order draft (protected) ─────────────────────────────────────────

  /**
   * POST /api/v1/rooms/:gameId/unit-order
   * Submit this player's unit activation order for the current round draft.
   * Body: { playerId: string, unitOrder: string[] }
   */
  fastify.post<{ Params: { gameId: string } }>(
    "/api/v1/rooms/:gameId/unit-order",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { gameId } = req.params;
      const body = req.body as { playerId?: string; unitOrder?: string[] };
      if (!Array.isArray(body.unitOrder)) {
        return reply.code(400).send({ error: "unitOrder must be an array" });
      }

      const playerId = body.playerId ?? (req.jwtPayload?.sub as string) ?? "";
      const session = sessionManager.getSession(gameId);
      if (session === undefined || session.status !== "running") {
        return reply.code(404).send({ error: "Game not found or not running" });
      }

      const adapter = session.adapters.get(playerId);
      if (adapter === undefined) {
        return reply.code(403).send({ error: "Player not in this game" });
      }

      const unitOrder = body.unitOrder as import("@ab/metadata").UnitId[];
      // Works for both PassThroughAdapter and HumanAdapter
      import("../ws/passthrough-adapter.js")
        .then(({ PassThroughAdapter }) => {
          if (adapter instanceof PassThroughAdapter) {
            adapter.submitUnitOrder(unitOrder);
          } else {
            import("../ws/human-adapter.js")
              .then(({ HumanAdapter }) => {
                if (adapter instanceof HumanAdapter) {
                  adapter.submitUnitOrder(unitOrder);
                }
              })
              .catch(() => {});
          }
        })
        .catch(() => {});

      return reply.send({ ok: true });
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
        sessionManager.createSession(gameId, context, initialState, playerIds.length, mapId);

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

  // ── Replays (public) ──────────────────────────────────────────────────────

  /**
   * GET /api/v1/replays/:gameId
   * Returns the ordered action log for a completed game.
   * The log can be fed into a ReplayAdapter to reconstruct the game client-side.
   */
  fastify.get<{ Params: { gameId: string } }>(
    "/api/v1/replays/:gameId",
    async (req, reply) => {
      const { gameId } = req.params;
      const entries = await replayStore.getLog(gameId);
      if (entries === undefined) {
        return reply.code(404).send({ error: "Replay not found" });
      }
      return reply.code(200).send({ gameId, entries, entryCount: entries.length });
    },
  );
}
