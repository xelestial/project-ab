/**
 * Matchmaking — simple queue-based player matching.
 *
 * Algorithm:
 *   1. Player joins queue with preferred map and player count.
 *   2. Queue groups players by (mapId, playerCount).
 *   3. When group is full, emit "match_found" with a new gameId.
 *   4. Caller creates the game session and notifies players.
 *
 * This is an in-process implementation (no Redis pub/sub).
 * For distributed matchmaking, replace with a Redis list + worker.
 *
 * ELO-aware matching: players within ±200 ELO are preferred.
 * If no ELO match found within WAIT_TIMEOUT_MS, any player is accepted.
 */

export interface MatchRequest {
  playerId: string;
  mapId: string;
  playerCount: number;
  /** ELO rating (optional; default 1000) */
  rating: number;
  /** epoch ms when request was enqueued */
  enqueuedAt: number;
}

export interface MatchResult {
  gameId: string;
  mapId: string;
  playerIds: string[];
}

type MatchListener = (result: MatchResult) => void;

const ELO_RANGE = 200;
const WAIT_TIMEOUT_MS = 30_000; // expand search after 30s

/** Key: `${mapId}:${playerCount}` */
type QueueKey = string;

export class MatchmakingQueue {
  private readonly queues = new Map<QueueKey, MatchRequest[]>();
  private readonly listeners = new Set<MatchListener>();
  private gameCounter = 0;

  /** Add a player to the matchmaking queue. Returns true if immediately matched. */
  enqueue(request: MatchRequest): boolean {
    // Remove any existing entry across all queues (player may be re-queuing)
    this.dequeue(request.playerId);

    const key: QueueKey = `${request.mapId}:${request.playerCount}`;
    const queue = this.queues.get(key) ?? [];
    queue.push(request);
    this.queues.set(key, queue);

    return this.tryMatch(key, request.playerCount);
  }

  /** Remove a player from the queue. */
  dequeue(playerId: string): void {
    for (const [key, queue] of this.queues) {
      const idx = queue.findIndex((r) => r.playerId === playerId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) this.queues.delete(key);
        return;
      }
    }
  }

  /** Listen for match results. */
  onMatch(listener: MatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Get current queue sizes (for diagnostics). */
  getQueueSizes(): Record<string, number> {
    const sizes: Record<string, number> = {};
    for (const [key, queue] of this.queues) {
      sizes[key] = queue.length;
    }
    return sizes;
  }

  /** Get a player's current queue position (1-indexed, 0 = not in queue). */
  getPosition(playerId: string): number {
    for (const queue of this.queues.values()) {
      const idx = queue.findIndex((r) => r.playerId === playerId);
      if (idx !== -1) return idx + 1;
    }
    return 0;
  }

  private tryMatch(key: QueueKey, playerCount: number): boolean {
    const queue = this.queues.get(key);
    if (queue === undefined || queue.length < playerCount) return false;

    const now = Date.now();
    let selected: MatchRequest[] | undefined;

    // Try ELO-aware matching first (group by proximity)
    for (let i = 0; i <= queue.length - playerCount; i++) {
      const anchor = queue[i]!;
      const waited = now - anchor.enqueuedAt;
      const ratingTolerance = waited >= WAIT_TIMEOUT_MS ? Infinity : ELO_RANGE;

      const group = [anchor];
      for (let j = i + 1; j < queue.length && group.length < playerCount; j++) {
        const candidate = queue[j]!;
        if (Math.abs(candidate.rating - anchor.rating) <= ratingTolerance) {
          group.push(candidate);
        }
      }

      if (group.length === playerCount) {
        selected = group;
        break;
      }
    }

    if (selected === undefined) return false;

    // Remove matched players from queue
    for (const req of selected) {
      const idx = queue.indexOf(req);
      if (idx !== -1) queue.splice(idx, 1);
    }
    if (queue.length === 0) this.queues.delete(key);

    // Generate gameId and emit
    this.gameCounter++;
    const gameId = `game_mm_${Date.now()}_${this.gameCounter}`;
    const result: MatchResult = {
      gameId,
      mapId: selected[0]!.mapId,
      playerIds: selected.map((r) => r.playerId),
    };

    for (const listener of this.listeners) {
      try { listener(result); } catch { /* ignore */ }
    }

    return true;
  }
}
