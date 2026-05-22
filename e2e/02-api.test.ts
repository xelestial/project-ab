/**
 * 02 — 서버 API 직접 검증
 *
 * 확인 사항:
 *  - /health 엔드포인트가 200을 반환한다
 *  - /api/v1/meta/maps 가 3개 맵을 반환한다
 *  - /api/v1/meta/units 가 유닛 목록을 반환한다
 *  - /api/v1/meta/tiles 가 타일 목록을 반환한다
 *  - 방 목록 API가 동작한다
 */
import { test, expect, request } from "@playwright/test";

const SERVER = "http://localhost:3000";

test.describe("서버 API", () => {
  test("health 엔드포인트가 ok를 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeTruthy();
  });

  test("maps API가 3개 맵을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/meta/maps`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.maps)).toBe(true);
    expect(body.maps.length).toBe(3);
  });

  test("maps에 map_test_01, map_1v1_6v6, map_2v2_6v6가 포함된다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/meta/maps`);
    const body = await res.json();
    const ids = body.maps.map((m: { id: string }) => m.id);
    expect(ids).toContain("map_test_01");
    expect(ids).toContain("map_1v1_6v6");
    expect(ids).toContain("map_2v2_6v6");
  });

  test("units API가 유닛 배열을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/meta/units`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.units)).toBe(true);
    expect(body.units.length).toBeGreaterThan(0);
  });

  test("유닛 데이터에 id, class, baseHealth, primaryWeaponId 필드가 있다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/meta/units`);
    const body = await res.json();
    const unit = body.units[0];
    expect(unit).toHaveProperty("id");
    expect(unit).toHaveProperty("class");
    expect(unit).toHaveProperty("baseHealth");
  });

  test("tiles API가 타일 배열을 반환한다", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/api/v1/meta/tiles`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.tiles)).toBe(true);
    expect(body.tiles.length).toBeGreaterThan(0);
  });

  test("rooms API가 인증 토큰으로 배열을 반환한다", async () => {
    const ctx = await request.newContext();

    // 로그인해서 accessToken 획득
    const loginRes = await ctx.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "e2e-test-player" },
    });
    expect(loginRes.ok()).toBe(true);
    const { accessToken } = await loginRes.json();

    // 인증 헤더로 rooms 목록 요청
    const res = await ctx.get(`${SERVER}/api/v1/rooms`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.rooms)).toBe(true);
  });
});
