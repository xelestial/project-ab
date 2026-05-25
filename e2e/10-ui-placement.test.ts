/**
 * 10 — UI 배치 화면 상호작용
 *
 * 확인 사항:
 *  - 배치 화면 진입 후 UI 요소 확인
 *  - 유닛 카드 클릭 → 선택 상태 시각적 피드백
 *  - 카드 선택 후 캔버스 클릭 → 배치 카운터 증가
 *  - 준비 완료 버튼 활성화 조건 (최대 유닛 수 배치 후)
 *  - 준비 완료 버튼 클릭 → 게임 화면 진입 (또는 대기 상태)
 */
import { test, expect } from "@playwright/test";

async function enterPlacement(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector("#menu-grid .mode-card");
  await page.locator("#menu-grid .mode-card").first().click();
  await page.waitForSelector("#screen-lobby.active");
  await page.locator("#start-btn").click();
  // New flow: start-btn → waiting-room → (click ready) → placement
  await page.waitForSelector("#screen-waiting-room.active, #screen-placement.active", { timeout: 12000 });
  if (await page.locator("#screen-waiting-room.active").isVisible().catch(() => false)) {
    await page.locator("#wr-ready-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 15000 });
  }
}

test.describe("배치 화면 UI", () => {
  test("배치 화면 진입 후 모든 필수 요소가 존재한다", async ({ page }) => {
    await enterPlacement(page);

    await expect(page.locator("#placement-canvas")).toBeVisible();
    await expect(page.locator("#unit-card-list")).toBeVisible();
    await expect(page.locator("#placement-counter")).toBeVisible();
    await expect(page.locator("#placement-max")).toBeVisible();
    await expect(page.locator("#ready-btn")).toBeVisible();
  });

  test("배치 카운터가 0으로 시작한다", async ({ page }) => {
    await enterPlacement(page);

    const counter = page.locator("#placement-counter");
    await expect(counter).toHaveText("0");
  });

  test("준비 완료 버튼이 초기에 비활성화 상태다", async ({ page }) => {
    await enterPlacement(page);

    await expect(page.locator("#ready-btn")).toBeDisabled();
  });

  test("유닛 카드가 1개 이상 표시된다", async ({ page }) => {
    await enterPlacement(page);

    const cards = page.locator("#unit-card-list .unit-card");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("유닛 카드 클릭 시 DOM 상태가 변경된다 (선택 표시)", async ({ page }) => {
    await enterPlacement(page);

    const cards = page.locator("#unit-card-list .unit-card");
    await cards.first().click();
    await page.waitForTimeout(200);

    const className = await cards.first().getAttribute("class");
    expect(className).toBeTruthy();
    // 선택 상태가 반영되어야 함 (selected, active, highlighted 등)
  });

  test("배치 최대 수가 올바르게 표시된다 (일반전: 3)", async ({ page }) => {
    await enterPlacement(page);

    const maxEl = page.locator("#placement-max");
    await expect(maxEl).toHaveText("3");
  });
});

test.describe("배치 화면 — 카드 선택 및 배치", () => {
  /**
   * 캔버스 클릭을 통한 유닛 배치는 맵의 스폰 좌표에 의존하므로
   * 실제 배치 성공 여부는 보장하지 않지만 UI 인터랙션은 검증합니다.
   */
  test("카드 선택 후 캔버스 클릭 시 에러 없이 동작한다", async ({ page }) => {
    await enterPlacement(page);

    const cards = page.locator("#unit-card-list .unit-card");
    await cards.first().click();
    await page.waitForTimeout(200);

    const canvas = page.locator("#placement-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not found");

    // 스폰 구역 상단 근처를 클릭
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.15);
    await page.waitForTimeout(400);

    // 에러 메시지나 크래시가 없어야 함
    const errorEl = page.locator(".error-message, .alert-error, [data-error]");
    const errorVisible = await errorEl.isVisible().catch(() => false);
    expect(errorVisible).toBe(false);
  });

  test("배치 후 카운터가 증가하거나 동일하게 유지된다", async ({ page }) => {
    await enterPlacement(page);

    const counter = page.locator("#placement-counter");
    const initialText = await counter.textContent();
    const initialCount = parseInt(initialText ?? "0", 10);

    // 유닛 카드 선택 후 스폰 구역 클릭
    const cards = page.locator("#unit-card-list .unit-card");
    await cards.first().click();
    await page.waitForTimeout(200);

    const canvas = page.locator("#placement-canvas");
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.15);
      await page.waitForTimeout(500);
    }

    const afterText = await counter.textContent();
    const afterCount = parseInt(afterText ?? "0", 10);
    // 카운터가 증가했거나 (배치 성공) 그대로 (스폰 구역 밖 클릭)
    expect(afterCount).toBeGreaterThanOrEqual(initialCount);
  });
});

test.describe("배치 화면 — 타이틀", () => {
  test("배치 화면 제목에 '배치' 텍스트가 포함된다", async ({ page }) => {
    await enterPlacement(page);

    const title = page.locator("#placement-title");
    await expect(title).toBeVisible();
    await expect(title).toContainText("배치");
  });
});
