/**
 * ISessionStore — 세션 영속성 추상화.
 * - MemorySessionStore: 인메모리 (테스트/단일서버 모드)
 * - RedisSessionStore: Redis 기반 분산 세션 (프로덕션)
 *
 * Redis 와이어 형식: JSON-직렬화 SessionRecord.
 * GameContext(validators, resolvers 등)는 프로세스 로컬 — state만 Redis에 저장.
 * TTL: 24시간 (REDIS_SESSION_TTL_S 환경변수로 조정 가능)
 */
import type { GameState } from "@ab/metadata";
import type { Redis } from "ioredis";

// ─── 영속 세션 레코드 ──────────────────────────────────────────────────────────

export interface SessionRecord {
  gameId: string;
  state: GameState;
  status: "waiting" | "running" | "ended";
  playerIds: string[];
  createdAt: number;
  updatedAt: number;
}

// ─── 인터페이스 ───────────────────────────────────────────────────────────────

export interface ISessionStore {
  save(record: SessionRecord): Promise<void>;
  get(gameId: string): Promise<SessionRecord | undefined>;
  update(gameId: string, state: GameState): Promise<void>;
  end(gameId: string): Promise<void>;
  listActive(): Promise<SessionRecord[]>;
  delete(gameId: string): Promise<void>;
}

// ─── 인메모리 구현 ────────────────────────────────────────────────────────────

export class MemorySessionStore implements ISessionStore {
  private readonly store = new Map<string, SessionRecord>();

  async save(record: SessionRecord): Promise<void> {
    this.store.set(record.gameId, { ...record });
  }

  async get(gameId: string): Promise<SessionRecord | undefined> {
    const rec = this.store.get(gameId);
    return rec !== undefined ? { ...rec } : undefined;
  }

  async update(gameId: string, state: GameState): Promise<void> {
    const rec = this.store.get(gameId);
    if (rec !== undefined) {
      rec.state = state;
      rec.updatedAt = Date.now();
    }
  }

  async end(gameId: string): Promise<void> {
    const rec = this.store.get(gameId);
    if (rec !== undefined) {
      rec.status = "ended";
      rec.updatedAt = Date.now();
    }
  }

  async listActive(): Promise<SessionRecord[]> {
    return [...this.store.values()]
      .filter((r) => r.status !== "ended")
      .map((r) => ({ ...r }));
  }

  async delete(gameId: string): Promise<void> {
    this.store.delete(gameId);
  }
}

// ─── Redis 구현 ───────────────────────────────────────────────────────────────

const REDIS_SESSION_TTL_S = Number(process.env["REDIS_SESSION_TTL_S"] ?? 86_400);
const REDIS_KEY_PREFIX = "ab:session:";
const REDIS_ACTIVE_SET = "ab:sessions:active";

export class RedisSessionStore implements ISessionStore {
  private readonly redis: Redis;

  constructor(
    redisUrl: string = process.env["REDIS_URL"] ?? "redis://localhost:6379",
  ) {
    // 동적 import를 피하기 위해 require 사용 (ESM 환경에서도 동작)
    // ioredis는 CommonJS/ESM 모두 지원
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: Ioredis } = require("ioredis") as typeof import("ioredis");
    this.redis = new Ioredis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // 연결 실패 시 바로 에러 (서버 기동을 막지 않음)
      enableOfflineQueue: false,
    });

    this.redis.on("error", (err: Error) => {
      // 연결 오류는 로그만 기록 — 서버는 계속 동작 (MemorySessionStore가 폴백)
      console.error("[RedisSessionStore] connection error:", err.message);
    });
  }

  private key(gameId: string): string {
    return `${REDIS_KEY_PREFIX}${gameId}`;
  }

  async save(record: SessionRecord): Promise<void> {
    try {
      const pipe = this.redis.pipeline();
      pipe.set(this.key(record.gameId), JSON.stringify(record), "EX", REDIS_SESSION_TTL_S);
      if (record.status !== "ended") {
        pipe.sadd(REDIS_ACTIVE_SET, record.gameId);
      }
      await pipe.exec();
    } catch (err) {
      console.error("[RedisSessionStore] save error:", (err as Error).message);
    }
  }

  async get(gameId: string): Promise<SessionRecord | undefined> {
    try {
      const raw = await this.redis.get(this.key(gameId));
      if (raw === null) return undefined;
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return undefined;
    }
  }

  async update(gameId: string, state: GameState): Promise<void> {
    const rec = await this.get(gameId);
    if (rec !== undefined) {
      await this.save({ ...rec, state, updatedAt: Date.now() });
    }
  }

  async end(gameId: string): Promise<void> {
    const rec = await this.get(gameId);
    if (rec !== undefined) {
      try {
        await this.redis.pipeline()
          .set(this.key(gameId), JSON.stringify({ ...rec, status: "ended", updatedAt: Date.now() }), "EX", REDIS_SESSION_TTL_S)
          .srem(REDIS_ACTIVE_SET, gameId)
          .exec();
      } catch (err) {
        console.error("[RedisSessionStore] end error:", (err as Error).message);
      }
    }
  }

  async listActive(): Promise<SessionRecord[]> {
    try {
      const gameIds = await this.redis.smembers(REDIS_ACTIVE_SET);
      if (gameIds.length === 0) return [];

      const keys = gameIds.map((id) => this.key(id));
      const raws = await this.redis.mget(...keys);

      const results: SessionRecord[] = [];
      for (const raw of raws) {
        if (raw !== null) {
          const rec = JSON.parse(raw) as SessionRecord;
          if (rec.status !== "ended") results.push(rec);
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  async delete(gameId: string): Promise<void> {
    try {
      await this.redis.pipeline()
        .del(this.key(gameId))
        .srem(REDIS_ACTIVE_SET, gameId)
        .exec();
    } catch (err) {
      console.error("[RedisSessionStore] delete error:", (err as Error).message);
    }
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
