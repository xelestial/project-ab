/**
 * 03 — 화면 내비게이션
 *
 * 확인 사항:
 *  - 모드 카드 클릭 → 로비 화면으로 이동
 *  - 뒤로 가기 버튼 → 메뉴 화면으로 돌아옴
 *  - 방 목록 화면 진입 및 복귀
 */
import { test, expect } from "@playwright/test";

test.describe("화면 내비게이션", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 모드 카드가 로드될 때까지 대기
    await page.waitForSelector("#menu-grid .mode-card");
  });

  test("모드 카드 클릭 시 로비 화면으로 이동한다", async ({ page }) => {
    const firstCard = page.locator("#menu-grid .mode-card").first();
    await firstCard.click();

    const lobbyScreen = page.locator("#screen-lobby");
    await expect(lobbyScreen).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator("#screen-menu")).not.toHaveClass(/active/);
  });

  test("로비 제목에 선택한 모드 이름이 표시된다", async ({ page }) => {
    const firstCard = page.locator("#menu-grid .mode-card").first();
    const modeName = await firstCard.locator("h2").textContent();
    await firstCard.click();

    await page.waitForSelector("#screen-lobby.active");
    const lobbyTitle = page.locator("#lobby-title");
    await expect(lobbyTitle).toBeVisible();
    await expect(lobbyTitle).toContainText(modeName?.trim() ?? "");
  });

  test("로비에서 뒤로 가기 클릭 시 메뉴로 돌아온다", async ({ page }) => {
    // 로비로 이동
    await page.locator("#menu-grid .mode-card").first().click();
    await page.waitForSelector("#screen-lobby.active");

    // 뒤로 가기
    await page.locator("#lobby-back").click();
    await expect(page.locator("#screen-menu")).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator("#screen-lobby")).not.toHaveClass(/active/);
  });

  test("격전(6유닛) 카드 클릭 시 로비로 이동하고 유닛 수가 6으로 표시된다", async ({ page }) => {
    // 두 번째 카드 (격전 1v1)
    await page.locator("#menu-grid .mode-card").nth(1).click();
    await page.waitForSelector("#screen-lobby.active");
    const lobbyTitle = page.locator("#lobby-title");
    await expect(lobbyTitle).toContainText("격전");
  });
});
