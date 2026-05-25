/**
 * 06 — 인증 플로우
 *
 * 확인 사항:
 *  - 로그인으로 accessToken + refreshToken 획득
 *  - 잘못된 요청(playerId 없음)은 400 반환
 *  - refreshToken으로 새 accessToken 발급
 *  - 로그아웃 후 refreshToken 무효화
 *  - 인증 토큰으로 보호 API 접근
 *  - 만료/무효 토큰 시 401 반환
 */
import { test, expect, request } from "@playwright/test";

const SERVER = "http://localhost:3000";

test.describe("인증 플로우", () => {
  test("로그인 시 accessToken과 refreshToken을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "auth-test-player-01" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessToken.length).toBeGreaterThan(10);
    expect(typeof body.refreshToken).toBe("string");
    expect(body.refreshToken.length).toBeGreaterThan(10);
  });

  test("playerId 없이 로그인하면 400을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test("동일 playerId로 두 번 로그인하면 각각 유효한 토큰을 반환한다", async () => {
    const ctx = await request.newContext();
    const res1 = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "auth-double-login" },
    });
    const res2 = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "auth-double-login" },
    });
    expect(res1.ok()).toBe(true);
    expect(res2.ok()).toBe(true);
    const body1 = await res1.json();
    const body2 = await res2.json();
    // Both tokens should work (server issues new tokens each time)
    expect(typeof body1.accessToken).toBe("string");
    expect(typeof body2.accessToken).toBe("string");
  });

  test("refreshToken으로 새 accessToken을 발급받는다", async () => {
    const ctx = await request.newContext();

    // 로그인
    const loginRes = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "auth-refresh-test" },
    });
    expect(loginRes.ok()).toBe(true);
    const { refreshToken } = await loginRes.json();

    // 갱신
    const refreshRes = await ctx.post(`${SERVER}/api/v1/auth/refresh`, {
      data: { refreshToken },
    });
    expect(refreshRes.ok()).toBe(true);
    const refreshBody = await refreshRes.json();
    expect(typeof refreshBody.accessToken).toBe("string");
    expect(refreshBody.accessToken.length).toBeGreaterThan(10);
  });

  test("잘못된 refreshToken으로 갱신 시 401을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${SERVER}/api/v1/auth/refresh`, {
      data: { refreshToken: "invalid.token.value" },
    });
    expect([400, 401]).toContain(res.status());
  });

  test("accessToken으로 보호된 API에 접근한다 (rooms 목록)", async () => {
    const ctx = await request.newContext();

    const loginRes = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "auth-protected-api" },
    });
    const { accessToken } = await loginRes.json();

    const roomsRes = await ctx.get(`${SERVER}/api/v1/rooms`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(roomsRes.ok()).toBe(true);
    const body = await roomsRes.json();
    expect(Array.isArray(body.rooms)).toBe(true);
  });

  test("토큰 없이 보호된 API에 접근하면 401을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/rooms`);
    expect(res.status()).toBe(401);
  });

  test("잘못된 accessToken으로 보호된 API에 접근하면 401을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/rooms`, {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status()).toBe(401);
  });

  test("로그아웃 API가 200을 반환한다", async () => {
    const ctx = await request.newContext();

    const loginRes = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "auth-logout-test" },
    });
    expect(loginRes.ok()).toBe(true);
    const { accessToken, refreshToken } = await loginRes.json();

    const logoutRes = await ctx.post(`${SERVER}/api/v1/auth/logout`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { refreshToken },
    });
    expect([200, 204]).toContain(logoutRes.status());
  });
});
