/**
 * RedisTokenStore — graceful degradation tests (no running Redis required).
 *
 * These tests verify that the store:
 * 1. Issues tokens synchronously (optimistic, fire-and-forget to Redis)
 * 2. Returns undefined from verify() when Redis is unavailable
 * 3. Does not throw on revoke/revokeAll when Redis is unavailable
 */
import { describe, it, expect } from "vitest";
import { RedisTokenStore } from "../auth/redis-token-store.js";

describe("RedisTokenStore (no Redis)", () => {
  it("issue: 토큰을 즉시 반환한다 (비동기 저장)", () => {
    const store = new RedisTokenStore("redis://localhost:19999"); // unused port
    const rec = store.issue("p1");
    expect(rec.token).toBeTruthy();
    expect(rec.token.length).toBeGreaterThan(20);
    expect(rec.playerId).toBe("p1");
    expect(rec.used).toBe(false);
  });

  it("verify: Redis 연결 불가 시 undefined 반환 (에러 없음)", async () => {
    const store = new RedisTokenStore("redis://localhost:19999");
    const rec = store.issue("p1");
    // Redis is unavailable — verify returns undefined gracefully
    const result = await store.verify(rec.token);
    expect(result).toBeUndefined();
  });

  it("markUsed: Redis 연결 불가 시 에러 없이 실행", () => {
    const store = new RedisTokenStore("redis://localhost:19999");
    const rec = store.issue("p1");
    expect(() => store.markUsed(rec.token)).not.toThrow();
  });

  it("revoke: Redis 연결 불가 시 에러 없이 실행", () => {
    const store = new RedisTokenStore("redis://localhost:19999");
    const rec = store.issue("p1");
    expect(() => store.revoke(rec.token)).not.toThrow();
  });

  it("revokeAll: Redis 연결 불가 시 에러 없이 실행", () => {
    const store = new RedisTokenStore("redis://localhost:19999");
    store.issue("p1");
    expect(() => store.revokeAll("p1")).not.toThrow();
  });
});
