/**
 * WebSocket server — handles game connections.
 * WebSocket URL: ws://host/ws/game/:gameId
 *
 * ⚠️ Unity clients connect to this same endpoint.
 *    Protocol is defined in ws-protocol.ts.
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { GameSessionManager } from "../session/game-session-manager.js";
import type { GameFactory, IEventBus } from "@ab/engine";
import type { IDataRegistry } from "@ab/metadata";
import type { IStatsStore } from "../session/stats-store.js";
import { MemoryStatsStore } from "../session/stats-store.js";

import { HumanAdapter } from "./human-adapter.js";
import { PassThroughAdapter } from "./passthrough-adapter.js";
import { decodeMessage, encodeMessage } from "./ws-protocol.js";
import { getText } from "@ab/metadata";
import { tryStartGame } from "../session/game-starter.js";

export async function registerWsRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: GameSessionManager;
    factory: GameFactory;
    registry: IDataRegistry;
    statsStore?: IStatsStore;
  },
): Promise<void> {
  const { sessionManager, factory, registry } = deps;
  const statsStore: IStatsStore = deps.statsStore ?? new MemoryStatsStore();

  fastify.get(
    "/ws/game/:gameId",
    { websocket: true },
    (socket: WebSocket, req) => {
      const gameId = (req.params as Record<string, string>)["gameId"] ?? "";
      let adapter: HumanAdapter | undefined;

      socket.on("message", async (raw: Buffer | string) => {
        const text = typeof raw === "string" ? raw : raw.toString();
        const msg = decodeMessage(text);
        if (msg === null) {
          socket.send(
            encodeMessage({
              type: "error",
              code: "error.internal",
              message: getText("error.internal"),
            }),
          );
          return;
        }

        if (msg.type === "ping") {
          socket.send(encodeMessage({ type: "pong" }));
          return;
        }

        if (msg.type === "join") {
          const session = sessionManager.getSession(msg.gameId);
          if (session === undefined) {
            socket.send(
              encodeMessage({
                type: "error",
                code: "error.unknown.map",
                message: `Game ${msg.gameId} not found`,
              }),
            );
            return;
          }

          // Reconnection or upgrade: if adapter already exists, swap socket
          const existingAdapter = session.adapters.get(msg.playerId);
          if (existingAdapter instanceof HumanAdapter) {
            existingAdapter.replaceSocket(socket, session.state);
            adapter = existingAdapter;
            socket.send(
              encodeMessage({ type: "joined", gameId: msg.gameId, playerId: msg.playerId }),
            );
            adapter.onStateUpdate(session.state);
          } else if (existingAdapter instanceof PassThroughAdapter) {
            // Upgrade PassThrough to real WS adapter
            adapter = new HumanAdapter(msg.playerId, socket);
            session.adapters.set(msg.playerId, adapter);
            socket.send(
              encodeMessage({ type: "joined", gameId: msg.gameId, playerId: msg.playerId }),
            );
            adapter.onStateUpdate(session.state);
          } else {
            adapter = new HumanAdapter(msg.playerId, socket);
            sessionManager.addAdapter(msg.gameId, adapter);

            // Register human as a player in game state (if not already present)
            if (session.state.players[msg.playerId] === undefined) {
              const mapMeta = registry.getMap(session.state.map.mapId);
              const teamSize = mapMeta.teamSize ?? 1;
              const slotIndex = Object.keys(session.state.players).length;
              const teamIndex = Math.floor(slotIndex / teamSize);
              session.state = {
                ...session.state,
                players: {
                  ...session.state.players,
                  [msg.playerId]: {
                    playerId: msg.playerId as import("@ab/metadata").PlayerId,
                    teamIndex,
                    priority: 1,
                    unitIds: [],
                    connected: true,
                    surrendered: false,
                  },
                },
              };
            }

            socket.send(
              encodeMessage({ type: "joined", gameId: msg.gameId, playerId: msg.playerId }),
            );
          }

          // Subscribe to game events and forward to client
          const unsub = (session.context.eventBus as IEventBus).onAny((event) => {
            if ("state" in event) {
              adapter?.sendMessage({
                type: "state_update",
                gameId: session.gameId,
                state: (event as { state: unknown }).state,
              });
            }
            if (event.type === "game.end") {
              adapter?.sendMessage({
                type: "game_end",
                gameId: session.gameId,
                winnerIds: event.winnerIds,
                reason: event.reason,
              });
            }
          });

          socket.on("close", () => {
            unsub();
          });

          // Try to start game if all placements and adapters are ready
          // (Human player's placement is submitted via POST /place; this covers
          //  the edge case where placement arrives before the WS adapter registers)
          tryStartGame(session, factory, registry, statsStore ?? new MemoryStatsStore(), fastify.log);
        }

        if (msg.type === "spectate") {
          const session = sessionManager.getSession(msg.gameId);
          if (session === undefined) {
            socket.send(
              encodeMessage({
                type: "error",
                code: "error.unknown.map",
                message: `Game ${msg.gameId} not found`,
              }),
            );
            return;
          }

          const spectatorId = `spec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          sessionManager.addSpectator(msg.gameId, spectatorId, (payload) => {
            if (socket.readyState === 1) {
              socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
            }
          });

          socket.send(
            encodeMessage({
              type: "spectator_joined",
              gameId: msg.gameId,
              spectatorCount: session.spectators.size,
            }),
          );

          // Send current state immediately
          socket.send(
            encodeMessage({ type: "state_update", gameId: msg.gameId, state: session.state }),
          );

          // Subscribe to event bus for future state updates
          const unsub = (session.context.eventBus as IEventBus).onAny((event) => {
            if ("state" in event) {
              if (socket.readyState === 1) {
                socket.send(
                  encodeMessage({
                    type: "state_update",
                    gameId: session.gameId,
                    state: (event as { state: unknown }).state,
                  }),
                );
              }
            }
            if (event.type === "game.end" && socket.readyState === 1) {
              socket.send(
                encodeMessage({
                  type: "game_end",
                  gameId: session.gameId,
                  winnerIds: event.winnerIds,
                  reason: event.reason,
                }),
              );
            }
          });

          socket.on("close", () => {
            unsub();
            sessionManager.removeSpectator(msg.gameId, spectatorId);
          });
        }

        if (msg.type === "surrender") {
          const session = sessionManager.getSession(msg.gameId);
          if (session !== undefined && session.state.players[msg.playerId] !== undefined) {
            session.state = {
              ...session.state,
              players: {
                ...session.state.players,
                [msg.playerId]: {
                  ...session.state.players[msg.playerId]!,
                  surrendered: true,
                },
              },
            };
          }
        }
      });

      socket.on("close", () => {
        if (adapter !== undefined) {
          fastify.log.info(`Player ${adapter.playerId} disconnected from game ${gameId}`);
        }
      });
    },
  );
}
