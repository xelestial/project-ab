/**
 * MemoryTokenStore — refresh token 발급/검증/폐기/재사용 감지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryTokenStore } from "../auth/token-store.js";

describe("MemoryTokenStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("issue: 고유 토큰을 발급하고 playerId를 포함한다", () => {
    const store = new MemoryTokenStore();
    const rec = store.issue("p1");
    expect(rec.token).toBeTruthy();
    expect(rec.token.length).toBeGreaterThan(20);
    expect(rec.playerId).toBe("p1");
    expect(rec.used).toBe(false);
  });

  it("verify: 유효한 토큰이면 record를 반환한다", async () => {
    const store = new MemoryTokenStore();
    const rec = store.issue("p1");
    const result = await store.verify(rec.token);
    expect(result).toBeDefined();
    expect(result!.playerId).toBe("p1");
  });

  it("verify: 알 수 없는 토큰이면 undefined", async () => {
    const store = new MemoryTokenStore();
    expect(await store.verify("nonexistent")).toBeUndefined();
  });

  it("verify: 만료된 토큰이면 undefined 반환 후 자동 삭제", async () => {
    vi.useFakeTimers();
    const store = new MemoryTokenStore();
    const rec = store.issue("p1");

    // 8일 경과 (TTL 7일 초과)
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

    expect(await store.verify(rec.token)).toBeUndefined();
  });

  it("verify: markUsed 후 재사용 시 모든 토큰 폐기 (재사용 공격 감지)", async () => {
    const store = new MemoryTokenStore();
    const rec1 = store.issue("p1");
    const rec2 = store.issue("p1");

    store.markUsed(rec1.token);

    // 같은 토큰 재사용 → 플레이어의 모든 토큰 폐기
    expect(await store.verify(rec1.token)).toBeUndefined();
    // rec2도 폐기됨
    expect(await store.verify(rec2.token)).toBeUndefined();
  });

  it("revoke: 특정 토큰을 폐기한다", async () => {
    const store = new MemoryTokenStore();
    const rec = store.issue("p1");
    store.revoke(rec.token);
    expect(await store.verify(rec.token)).toBeUndefined();
  });

  it("revokeAll: 플레이어의 모든 토큰을 폐기한다", async () => {
    const store = new MemoryTokenStore();
    const a = store.issue("p1");
    const b = store.issue("p1");
    const c = store.issue("p2");

    store.revokeAll("p1");

    expect(await store.verify(a.token)).toBeUndefined();
    expect(await store.verify(b.token)).toBeUndefined();
    // p2 토큰은 유지
    expect(await store.verify(c.token)).toBeDefined();
  });

  it("purgeExpired: 만료 토큰 정리 후 삭제 수를 반환한다", () => {
    vi.useFakeTimers();
    const store = new MemoryTokenStore();
    store.issue("p1");
    store.issue("p2");

    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    const count = store.purgeExpired();
    expect(count).toBe(2);
  });

  it("동일 플레이어가 여러 번 issue 해도 서로 독립적인 토큰 발급", async () => {
    const store = new MemoryTokenStore();
    const a = store.issue("p1");
    const b = store.issue("p1");
    expect(a.token).not.toBe(b.token);
    expect(await store.verify(a.token)).toBeDefined();
    expect(await store.verify(b.token)).toBeDefined();
  });
});
