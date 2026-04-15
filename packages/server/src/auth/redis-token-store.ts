/**
 * RedisTokenStore — Redis-backed refresh token storage.
 *
 * Wire format (Redis keys):
 *   ab:rt:<token>       → JSON RefreshRecord   (TTL: REFRESH_TTL_S)
 *   ab:rt:player:<pid>  → Set<token>            (TTL: REFRESH_TTL_S)
 *
 * Graceful degradation: if Redis is unavailable, operations are no-ops
 * (tokens fail to verify → user must re-login). No silent data loss.
 *
 * Environment:
 *   REDIS_URL          — Redis connection URL (default: redis://localhost:6379)
 *   REFRESH_TOKEN_TTL_S — Refresh token TTL in seconds (default: 604800 = 7 days)
 */
import type { Redis } from "ioredis";
import type { ITokenStore, RefreshRecord } from "./token-store.js";
import { randomBytes } from "crypto";

const REFRESH_TTL_S = Number(process.env["REFRESH_TOKEN_TTL_S"] ?? 7 * 24 * 60 * 60);
const KEY_PREFIX = "ab:rt:";
const PLAYER_PREFIX = "ab:rt:player:";

export class RedisTokenStore implements ITokenStore {
  private readonly redis: Redis;

  constructor(
    redisUrl: string = process.env["REDIS_URL"] ?? "redis://localhost:6379",
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: Ioredis } = require("ioredis") as typeof import("ioredis");
    this.redis = new Ioredis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.redis.on("error", (err: Error) => {
      console.error("[RedisTokenStore] connection error:", err.message);
    });
  }

  private tokenKey(token: string): string {
    return `${KEY_PREFIX}${token}`;
  }

  private playerKey(playerId: string): string {
    return `${PLAYER_PREFIX}${playerId}`;
  }

  issue(playerId: string): RefreshRecord {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const record: RefreshRecord = {
      playerId,
      token,
      issuedAt: now,
      expiresAt: now + REFRESH_TTL_S * 1000,
      used: false,
    };

    // Async write — fire-and-forget; if Redis is down, the token won't verify
    void this.persist(record).catch((err: Error) => {
      console.error("[RedisTokenStore] issue error:", err.message);
    });

    return record;
  }

  private async persist(record: RefreshRecord): Promise<void> {
    const pipe = this.redis.pipeline();
    pipe.set(this.tokenKey(record.token), JSON.stringify(record), "EX", REFRESH_TTL_S);
    pipe.sadd(this.playerKey(record.playerId), record.token);
    pipe.expire(this.playerKey(record.playerId), REFRESH_TTL_S);
    await pipe.exec();
  }

  async verify(token: string): Promise<RefreshRecord | undefined> {
    try {
      const raw = await this.redis.get(this.tokenKey(token));
      if (raw === null) return undefined;

      const record = JSON.parse(raw) as RefreshRecord;

      if (record.expiresAt < Date.now()) {
        this.revoke(token);
        return undefined;
      }

      if (record.used) {
        this.revokeAll(record.playerId);
        return undefined;
      }

      return record;
    } catch {
      return undefined;
    }
  }

  markUsed(token: string): void {
    void this.markUsedAsync(token).catch((err: Error) => {
      console.error("[RedisTokenStore] markUsed error:", err.message);
    });
  }

  async markUsedAsync(token: string): Promise<void> {
    try {
      const raw = await this.redis.get(this.tokenKey(token));
      if (raw === null) return;
      const record = JSON.parse(raw) as RefreshRecord;
      record.used = true;
      await this.redis.set(
        this.tokenKey(token),
        JSON.stringify(record),
        "KEEPTTL",
      );
    } catch {
      // ignore Redis errors during markUsed
    }
  }

  revoke(token: string): void {
    void this.revokeAsync(token).catch((err: Error) => {
      console.error("[RedisTokenStore] revoke error:", err.message);
    });
  }

  private async revokeAsync(token: string): Promise<void> {
    try {
      const raw = await this.redis.get(this.tokenKey(token));
      if (raw !== null) {
        const record = JSON.parse(raw) as RefreshRecord;
        await this.redis.pipeline()
          .del(this.tokenKey(token))
          .srem(this.playerKey(record.playerId), token)
          .exec();
      }
    } catch {
      // ignore
    }
  }

  revokeAll(playerId: string): void {
    void this.revokeAllAsync(playerId).catch((err: Error) => {
      console.error("[RedisTokenStore] revokeAll error:", err.message);
    });
  }

  async revokeAllAsync(playerId: string): Promise<void> {
    try {
      const tokens = await this.redis.smembers(this.playerKey(playerId));
      if (tokens.length === 0) return;

      const pipe = this.redis.pipeline();
      for (const t of tokens) pipe.del(this.tokenKey(t));
      pipe.del(this.playerKey(playerId));
      await pipe.exec();
    } catch {
      // ignore
    }
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
