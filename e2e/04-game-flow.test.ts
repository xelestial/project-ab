/**
 * 04 — 게임 생성 및 배치 단계 진입
 *
 * 확인 사항:
 *  - 로비에서 "게임 시작" 클릭 → 서버에 방 생성 → 배치 화면 진입
 *  - 배치 화면에 캔버스와 유닛 카드가 표시된다
 *  - 배치 화면에 카운터(0 / N)가 있다
 */
import { test, expect } from "@playwright/test";

test.describe("게임 생성 및 배치 단계", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#menu-grid .mode-card");
    // 일반전 (1v1 · 3유닛) 선택
    await page.locator("#menu-grid .mode-card").first().click();
    await page.waitForSelector("#screen-lobby.active");
  });

  test("로비에 시작 버튼이 있다", async ({ page }) => {
    const startBtn = page.locator("#start-btn");
    await expect(startBtn).toBeVisible();
  });

  test("로비에 좌석 그리드가 렌더링된다", async ({ page }) => {
    const seatsGrid = page.locator("#seats-grid");
    await expect(seatsGrid).toBeVisible();
  });

  test("게임 시작 후 배치 화면으로 이동한다", async ({ page }) => {
    const startBtn = page.locator("#start-btn");
    await startBtn.click();

    // 서버와 통신 후 화면 전환 대기
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });
    await expect(page.locator("#screen-lobby")).not.toHaveClass(/active/);
  });

  test("배치 화면에 캔버스가 있다", async ({ page }) => {
    await page.locator("#start-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });

    const canvas = page.locator("#placement-canvas");
    await expect(canvas).toBeVisible();
  });

  test("배치 화면에 유닛 카드 목록이 있다", async ({ page }) => {
    await page.locator("#start-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });

    const unitCards = page.locator("#unit-card-list");
    await expect(unitCards).toBeVisible();
  });

  test("배치 카운터가 0으로 시작한다", async ({ page }) => {
    await page.locator("#start-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });

    const counter = page.locator("#placement-counter");
    await expect(counter).toHaveText("0");
  });

  test("배치 최대 수가 3이다 (일반전)", async ({ page }) => {
    await page.locator("#start-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });

    const maxEl = page.locator("#placement-max");
    await expect(maxEl).toHaveText("3");
  });

  test("준비 완료 버튼은 초기에 비활성화 상태다", async ({ page }) => {
    await page.locator("#start-btn").click();
    await page.waitForSelector("#screen-placement.active", { timeout: 10000 });

    const readyBtn = page.locator("#ready-btn");
    await expect(readyBtn).toBeDisabled();
  });
});
