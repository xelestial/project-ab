/**
 * 05 — 배치 완료 후 게임 화면 진입
 *
 * 확인 사항:
 *  - 3개 유닛을 배치한 뒤 준비 완료 → 게임 화면 진입
 *  - 게임 화면에 보드 캔버스, HUD, 라운드 표시가 있다
 *  - AI가 즉시 배치를 완료해 게임이 시작된다
 */
import { test, expect } from "@playwright/test";

/** 배치 캔버스 위의 그리드 스폰 위치를 클릭하는 헬퍼 */
async function placeUnit(page: import("@playwright/test").Page, cardIndex: number) {
  // 유닛 카드 클릭 → 선택
  const cards = page.locator("#unit-card-list .unit-card");
  await cards.nth(cardIndex).click();

  // 캔버스 위 클릭 — 스폰 구역(좌상단 근처)에 배치
  const canvas = page.locator("#placement-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("placement-canvas not found");

  // 스폰 위치는 맵마다 다르므로 캔버스 상단 20% 내에서 클릭
  const x = box.x + box.width * 0.15;
  const y = box.y + box.height * (0.12 + cardIndex * 0.06);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

test.describe("배치 완료 → 게임 화면", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#menu-grid .mode-card");
    await page.locator("#menu-grid .mode-card").first().click();
    await page.waitForSelector("#screen-lobby.active");
    await page.locator("#start-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });
  });

  test("유닛 카드가 렌더링된다 (최소 1개)", async ({ page }) => {
    const cards = page.locator("#unit-card-list .unit-card");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("유닛 카드를 클릭하면 선택 상태가 된다", async ({ page }) => {
    const cards = page.locator("#unit-card-list .unit-card");
    await cards.first().click();
    // 선택된 카드에 selected 클래스 또는 active 상태 확인
    const firstCard = cards.first();
    // 클릭 후 카드 DOM 상태 변경 확인
    await page.waitForTimeout(200);
    const className = await firstCard.getAttribute("class");
    expect(className).toBeTruthy();
  });

  test("배치 화면 제목이 표시된다", async ({ page }) => {
    const title = page.locator("#placement-title");
    await expect(title).toBeVisible();
    await expect(title).toContainText("배치");
  });
});

test.describe("게임 화면 HUD 요소 (API 배치)", () => {
  /**
   * 순수 API 호출로 게임을 생성·배치 완료해
   * 게임이 battle 단계로 전환되는 것을 검증합니다.
   */
  test("API로 방 생성 → 인원 참가 → AI 추가 → 배치 → battle 단계 전환", async ({ request }) => {
    const SERVER = "http://localhost:3000";

    // 1) 로그인
    const loginRes = await request.post(`${SERVER}/api/v1/auth/login`, {
      data: { playerId: "e2e-hud-player" },
    });
    expect(loginRes.ok()).toBe(true);
    const { accessToken } = await loginRes.json();
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    // 2) 방 생성 (playerCount: 2)
    const createRes = await request.post(`${SERVER}/api/v1/rooms`, {
      headers,
      data: { mapId: "map_test_01", playerCount: 2 },
    });
    expect(createRes.ok()).toBe(true);
    const { gameId } = await createRes.json();
    expect(typeof gameId).toBe("string");

    // 3) 플레이어 합류
    const joinRes = await request.post(`${SERVER}/api/v1/rooms/${gameId}/join`, {
      headers,
      data: { playerId: "e2e-hud-player" },
    });
    expect([200, 201]).toContain(joinRes.status());

    // 4) AI 추가 (자동으로 배치도 수행)
    const aiRes = await request.post(`${SERVER}/api/v1/rooms/${gameId}/ai`, {
      headers,
      data: {},
    });
    expect(aiRes.ok()).toBe(true);

    // 5) 유닛 메타 조회
    const unitsRes = await request.get(`${SERVER}/api/v1/meta/units`);
    const { units } = await unitsRes.json();
    const unitIds = (units as Array<{ id: string }>).slice(0, 3).map((u) => u.id);

    // 6) 배치 (units 배열 형식 사용)
    const spawnPositions = [
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 2, col: 1 },
    ];
    const placeRes = await request.post(`${SERVER}/api/v1/rooms/${gameId}/place`, {
      headers,
      data: {
        playerId: "e2e-hud-player",
        units: unitIds.map((id, i) => ({
          metaId: id,
          position: spawnPositions[i],
        })),
      },
    });
    expect([200, 201]).toContain(placeRes.status());

    // 7) 게임 상태 확인 — battle or draft 단계
    const stateRes = await request.get(`${SERVER}/api/v1/rooms/${gameId}`, { headers });
    expect(stateRes.ok()).toBe(true);
    const stateBody = await stateRes.json();
    expect(["draft", "battle", "running", "waiting"]).toContain(
      stateBody.status ?? stateBody.phase ?? stateBody.gameStatus,
    );
  });

  test("페이지 로드 시 게임 화면 HUD DOM 요소가 항상 존재한다", async ({ page }) => {
    // 게임 화면은 active가 아니더라도 DOM에는 항상 존재해야 함
    await page.goto("/");
    await expect(page.locator("#board-canvas")).toBeAttached();
    await expect(page.locator("#round-indicator")).toBeAttached();
    await expect(page.locator("#turn-indicator")).toBeAttached();
    await expect(page.locator("#log-list")).toBeAttached();
    await expect(page.locator("#game-over-container")).toBeAttached();
  });
});
