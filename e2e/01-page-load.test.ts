/**
 * 01 — 페이지 로드 & 메뉴 화면
 *
 * 확인 사항:
 *  - 클라이언트가 로드되고 제목이 보인다
 *  - 메뉴 화면(#screen-menu)이 활성 상태
 *  - 게임 모드 카드가 3개 렌더링된다
 *  - 각 카드에 이름 텍스트가 있다
 */
import { test, expect } from "@playwright/test";

test.describe("페이지 로드 & 메뉴 화면", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("페이지 타이틀이 표시된다", async ({ page }) => {
    await expect(page).toHaveTitle(/Project AB/i);
  });

  test("헤더에 Project AB 텍스트가 있다", async ({ page }) => {
    const header = page.locator("header h1");
    await expect(header).toBeVisible();
    await expect(header).toContainText("AB");
  });

  test("메뉴 화면이 active 상태다", async ({ page }) => {
    const menuScreen = page.locator("#screen-menu");
    await expect(menuScreen).toHaveClass(/active/);
  });

  test("게임 모드 카드가 3개 렌더링된다", async ({ page }) => {
    const cards = page.locator("#menu-grid .mode-card");
    await expect(cards).toHaveCount(3);
  });

  test("첫 번째 카드가 일반전(1v1)이다", async ({ page }) => {
    const firstCard = page.locator("#menu-grid .mode-card").first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toContainText("일반전");
  });

  test("세 번째 카드가 팀전(2v2)이다", async ({ page }) => {
    const lastCard = page.locator("#menu-grid .mode-card").last();
    await expect(lastCard).toContainText("팀전");
  });

  test("다른 화면들은 숨겨져 있다", async ({ page }) => {
    await expect(page.locator("#screen-rooms")).not.toHaveClass(/active/);
    await expect(page.locator("#screen-lobby")).not.toHaveClass(/active/);
    await expect(page.locator("#screen-game")).not.toHaveClass(/active/);
  });
});
