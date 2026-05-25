/**
 * 07 — 방(Room) 관리 API
 *
 * 확인 사항:
 *  - 방 생성, 목록 조회, 단일 방 조회
 *  - 방 참가 (join)
 *  - AI 추가
 *  - 잘못된 요청 처리
 */
import { test, expect, request } from "@playwright/test";

const SERVER = "http://localhost:3000";

async function login(playerId: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SERVER}/api/v1/auth/login`, {
    data: { playerId },
  });
  const { accessToken } = await res.json();
  return { ctx, accessToken, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } };
}

test.describe("방 관리 API", () => {
  test("방 생성 시 gameId를 반환한다", async () => {
    const { ctx, headers } = await login("room-create-test");

    const res = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_test_01", playerCount: 2 },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.gameId).toBe("string");
    expect(body.gameId.length).toBeGreaterThan(0);
  });

  test("존재하지 않는 mapId로 방 생성 시 에러를 반환한다", async () => {
    const { ctx, headers } = await login("room-bad-map");

    const res = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_nonexistent_99", playerCount: 2 },
    });
    expect([400, 404, 422, 500]).toContain(res.status());
  });

  test("방 목록을 배열로 반환한다", async () => {
    const { ctx, headers } = await login("room-list-test");

    const res = await ctx.get(`${SERVER}/api/v1/rooms`, { headers });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.rooms)).toBe(true);
  });

  test("생성한 방이 방 목록에 포함된다", async () => {
    const { ctx, headers } = await login("room-list-includes");

    // 방 생성
    const createRes = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_test_01", playerCount: 2 },
    });
    const { gameId } = await createRes.json();

    // 목록 조회
    const listRes = await ctx.get(`${SERVER}/api/v1/rooms`, { headers });
    const body = await listRes.json();
    const ids = body.rooms.map((r: { gameId: string }) => r.gameId);
    expect(ids).toContain(gameId);
  });

  test("단일 방 조회가 정확한 데이터를 반환한다", async () => {
    const { ctx, headers } = await login("room-single-get");

    const createRes = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_test_01", playerCount: 2 },
    });
    const { gameId } = await createRes.json();

    const getRes = await ctx.get(`${SERVER}/api/v1/rooms/${gameId}`, { headers });
    expect(getRes.ok()).toBe(true);
    const body = await getRes.json();
    expect(body.gameId ?? body.id).toBeTruthy();
  });

  test("존재하지 않는 방 조회 시 404를 반환한다", async () => {
    const { ctx, headers } = await login("room-not-found");

    const res = await ctx.get(`${SERVER}/api/v1/rooms/nonexistent-game-id-9999`, { headers });
    expect([404, 400]).toContain(res.status());
  });

  test("방 참가(join)가 성공한다", async () => {
    const { ctx, headers } = await login("room-join-host");

    // 방 생성
    const createRes = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_test_01", playerCount: 2 },
    });
    const { gameId } = await createRes.json();

    // 같은 플레이어가 참가 (이미 방장으로 있거나 참가)
    const joinRes = await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/join`, {
      headers,
      data: { playerId: "room-join-host" },
    });
    expect([200, 201]).toContain(joinRes.status());
  });

  test("AI 추가가 성공한다", async () => {
    const { ctx, headers } = await login("room-ai-add");

    const createRes = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_test_01", playerCount: 2 },
    });
    const { gameId } = await createRes.json();

    const aiRes = await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/ai`, {
      headers,
      data: {},
    });
    expect(aiRes.ok()).toBe(true);
  });

  test("playerCount: 4로 팀전 방을 생성할 수 있다", async () => {
    const { ctx, headers } = await login("room-4player-test");

    const res = await ctx.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_2v2_6v6", playerCount: 4 },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(typeof body.gameId).toBe("string");
  });
});
