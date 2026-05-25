/**
 * Full 2-Human vs 2-AI game run
 *
 * 시나리오:
 *  1. API: 2인 로그인 → 방 생성(map_2v2_6v6, 4인) → 양쪽 join → AI 2명 추가
 *  2. 브라우저 2개(P1, P2): sessionStorage 주입 → 대기실 진입
 *  3. 양쪽 "준비 완료" 클릭 → 배치 화면 전환
 *  4. 유닛 카드 선택/취소/재선택 시연 (P1)
 *  5. 양쪽 REST API로 배치 제출 → 게임 시작
 *  6. 유닛 순서 지정(unit-order) → 전투 화면
 *  7. 인간 턴: pass 클릭 반복 / AI 턴: 자동 처리 대기
 *  8. 게임 종료 또는 타임아웃
 *
 * 실행: npx playwright test e2e/full-game-2h-vs-2ai.test.ts --headed
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { request } from "@playwright/test";
import { execSync } from "child_process";

const SERVER = "http://localhost:3000";
const CLIENT = "http://localhost:5173";
const P1_ID  = "full-game-h1";
const P2_ID  = "full-game-h2";
const SS     = (name: string) => `e2e/full-game-screenshots/${name}.png`;

// Spawn-point positions for map_2v2_6v6 (per slot index)
const SPAWN_POSITIONS: Record<number, Array<{ row: number; col: number }>> = {
  0: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }],
  1: [{ row: 1, col: 13 }, { row: 1, col: 14 }, { row: 2, col: 14 }],
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function apiPost(url: string, token: string | null, body: unknown) {
  const ctx = await request.newContext();
  const hdrs: Record<string, string> = { "Content-Type": "application/json" };
  if (token) hdrs["Authorization"] = `Bearer ${token}`;
  const res = await ctx.post(`${SERVER}${url}`, { headers: hdrs, data: body });
  const json = await res.json();
  await ctx.dispose();
  return { ok: res.ok(), status: res.status(), json };
}

async function apiGet(url: string, token: string | null) {
  const ctx = await request.newContext();
  const hdrs: Record<string, string> = {};
  if (token) hdrs["Authorization"] = `Bearer ${token}`;
  const res = await ctx.get(`${SERVER}${url}`, { headers: hdrs });
  const json = await res.json();
  await ctx.dispose();
  return { ok: res.ok(), status: res.status(), json };
}

/** Wait until selector is visible or timeout — no throw */
async function waitVisible(page: Page, sel: string, ms = 20_000) {
  try {
    await page.waitForSelector(sel, { state: "visible", timeout: ms });
    return true;
  } catch { return false; }
}

/** Click if the element exists and is visible */
async function safeClick(page: Page, sel: string) {
  const el = page.locator(sel);
  if (await el.isVisible().catch(() => false)) {
    await el.click().catch(() => {});
  }
}

// ─── Test setup ──────────────────────────────────────────────────────────────

test.use({ headless: false, viewport: { width: 1024, height: 768 } });

test.beforeAll(() => {
  execSync("mkdir -p e2e/full-game-screenshots");
});

// ─── MAIN TEST ───────────────────────────────────────────────────────────────

test("2인간 vs 2AI — 대기실 → 배치 → 전투 전체 1게임", async () => {
  test.setTimeout(120_000);

  // ── 1. API 게임 설정 ─────────────────────────────────────────────────────
  console.log("\n═══ STEP 1: API 게임 설정 ═══");

  const login1 = await apiPost("/api/v1/auth/login", null, { playerId: P1_ID });
  expect(login1.ok, `P1 로그인 실패: ${JSON.stringify(login1.json)}`).toBe(true);
  const t1: string = login1.json.accessToken;

  const login2 = await apiPost("/api/v1/auth/login", null, { playerId: P2_ID });
  expect(login2.ok, `P2 로그인 실패: ${JSON.stringify(login2.json)}`).toBe(true);
  const t2: string = login2.json.accessToken;

  console.log(`✅ P1(${P1_ID}) / P2(${P2_ID}) 로그인 완료`);

  const createRes = await apiPost("/api/v1/rooms", t1, { mapId: "map_2v2_6v6", playerCount: 4 });
  expect(createRes.ok, `방 생성 실패: ${JSON.stringify(createRes.json)}`).toBe(true);
  const gameId: string = createRes.json.gameId;
  console.log(`✅ 방 생성: ${gameId}`);

  // P1 join
  const join1 = await apiPost(`/api/v1/rooms/${gameId}/join`, t1, { playerId: P1_ID });
  expect([200, 201]).toContain(join1.status);
  console.log(`✅ P1 join → slotIndex/teamIndex: ${JSON.stringify(join1.json)}`);

  // P2 join
  const join2 = await apiPost(`/api/v1/rooms/${gameId}/join`, t2, { playerId: P2_ID });
  expect([200, 201]).toContain(join2.status);
  console.log(`✅ P2 join → slotIndex/teamIndex: ${JSON.stringify(join2.json)}`);

  // Get units list — P1 and P2 are on the same team, so they MUST use different units
  const unitsRes = await apiGet("/api/v1/meta/units", null);
  const nonObstacle = (unitsRes.json.units as Array<{ id: string }>).filter(u => !u.id.startsWith("obstacle"));
  const p1Units = nonObstacle.slice(0, 3).map((u) => u.id);   // e.g. t1, f1, r1
  const p2Units = nonObstacle.slice(3, 6).map((u) => u.id);   // e.g. b1, a1, u1
  console.log(`✅ P1 유닛: ${p1Units.join(", ")} | P2 유닛: ${p2Units.join(", ")}`);

  // Add AI 1
  const ai1Res = await apiPost(`/api/v1/rooms/${gameId}/ai`, t1, {});
  console.log(`AI 1 추가: ${JSON.stringify(ai1Res.json)}`);

  // Add AI 2
  const ai2Res = await apiPost(`/api/v1/rooms/${gameId}/ai`, t1, {});
  console.log(`AI 2 추가: ${JSON.stringify(ai2Res.json)}`);

  console.log(`\n방 상태: gameId=${gameId}`);

  // ── 2. 브라우저 2개 열기 ────────────────────────────────────────────────
  console.log("\n═══ STEP 2: 브라우저 열기 ═══");

  const browser = await chromium.launch({ headless: false, slowMo: 200 });

  const mkCtx = async (pid: string): Promise<[BrowserContext, Page]> => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await ctx.addInitScript(({ id, gid }: { id: string; gid: string }) => {
      sessionStorage.setItem("ab_player_id", id);
      sessionStorage.setItem("ab_game_id", gid);
    }, { id: pid, gid: gameId });
    const page = await ctx.newPage();
    return [ctx, page];
  };

  const [ctx1, p1] = await mkCtx(P1_ID);
  const [ctx2, p2] = await mkCtx(P2_ID);

  // Navigate both to the client
  await Promise.all([p1.goto(CLIENT), p2.goto(CLIENT)]);
  console.log("✅ 양쪽 페이지 로드");

  // ── 3. 대기실 진입 ───────────────────────────────────────────────────────
  console.log("\n═══ STEP 3: 대기실 진입 ═══");

  const p1WRShown = await p1.waitForFunction(
    () => document.getElementById("screen-waiting-room")?.classList.contains("active"),
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);

  const p2WRShown = await p2.waitForFunction(
    () => document.getElementById("screen-waiting-room")?.classList.contains("active"),
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);

  console.log(`P1 대기실: ${p1WRShown}, P2 대기실: ${p2WRShown}`);
  await p1.screenshot({ path: SS("01-p1-waiting-room") });
  await p2.screenshot({ path: SS("01-p2-waiting-room") });

  if (!p1WRShown || !p2WRShown) {
    // Debug: check what screen is active
    const p1Screen = await p1.evaluate(() => {
      const screens = ["screen-menu", "screen-lobby", "screen-waiting-room", "screen-placement", "screen-game"];
      return screens.find((s) => document.getElementById(s)?.classList.contains("active")) ?? "none";
    });
    const p2Screen = await p2.evaluate(() => {
      const screens = ["screen-menu", "screen-lobby", "screen-waiting-room", "screen-placement", "screen-game"];
      return screens.find((s) => document.getElementById(s)?.classList.contains("active")) ?? "none";
    });
    console.log(`디버그 — P1 활성화면: ${p1Screen}, P2 활성화면: ${p2Screen}`);
  }

  expect(p1WRShown, "P1이 대기실 화면으로 전환되지 않음").toBe(true);
  expect(p2WRShown, "P2이 대기실 화면으로 전환되지 않음").toBe(true);
  console.log("✅ 양쪽 대기실 진입 확인");

  // Wait for room_status to render player slots
  await p1.waitForTimeout(1000);
  await p2.waitForTimeout(500);

  // Check that AI players appear in room status
  const p1SlotText = await p1.locator("#wr-player-slots").textContent().catch(() => "");
  console.log(`P1 슬롯 현황: ${p1SlotText?.replace(/\s+/g, " ").trim().slice(0, 120)}`);

  // ── 4. 준비 완료 클릭 ────────────────────────────────────────────────────
  console.log("\n═══ STEP 4: 준비 완료 클릭 ═══");

  // P1 clicks ready
  await safeClick(p1, "#wr-ready-btn");
  console.log("P1 준비 클릭");
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: SS("02-p1-ready-clicked") });

  // P2 clicks ready
  await safeClick(p2, "#wr-ready-btn");
  console.log("P2 준비 클릭");
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: SS("02-p2-ready-clicked") });

  // ── 5. 배치 화면 전환 ────────────────────────────────────────────────────
  console.log("\n═══ STEP 5: 배치 화면 전환 대기 ═══");

  const waitForScreen = async (page: Page, screenId: string, label: string, ms = 20_000) => {
    const ok = await page.waitForFunction(
      (id: string) => document.getElementById(id)?.classList.contains("active"),
      screenId,
      { timeout: ms },
    ).then(() => true).catch(() => false);
    if (!ok) {
      const active = await page.evaluate(() => {
        const screens = ["screen-menu","screen-lobby","screen-waiting-room","screen-placement","screen-unit-order","screen-game"];
        return screens.find((s) => document.getElementById(s)?.classList.contains("active")) ?? "none";
      });
      console.log(`⚠️  ${label} — ${screenId} 미전환, 현재: ${active}`);
    }
    return ok;
  };

  // Either placement or unit-order screen is acceptable
  const p1InPlacement = await p1.waitForFunction(
    () =>
      document.getElementById("screen-placement")?.classList.contains("active") ||
      document.getElementById("screen-unit-order")?.classList.contains("active"),
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);

  const p2InPlacement = await p2.waitForFunction(
    () =>
      document.getElementById("screen-placement")?.classList.contains("active") ||
      document.getElementById("screen-unit-order")?.classList.contains("active"),
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);

  await p1.screenshot({ path: SS("03-p1-placement") });
  await p2.screenshot({ path: SS("03-p2-placement") });

  console.log(`P1 배치화면: ${p1InPlacement}, P2 배치화면: ${p2InPlacement}`);
  expect(p1InPlacement, "P1이 배치 화면으로 전환되지 않음").toBe(true);
  expect(p2InPlacement, "P2이 배치 화면으로 전환되지 않음").toBe(true);
  console.log("✅ 양쪽 배치 화면 진입 확인");

  // ── 6. 유닛 선택/취소/재선택 시연 (P1) ──────────────────────────────────
  console.log("\n═══ STEP 6: 유닛 선택/취소/재선택 시연 (P1) ═══");

  // Wait for unit cards to render
  await p1.waitForSelector(".unit-card", { timeout: 10_000 }).catch(() => {});

  const unitCards = await p1.locator(".unit-card").count();
  console.log(`P1 유닛 카드 수: ${unitCards}`);

  if (unitCards > 0) {
    // Select first unit
    await p1.locator(".unit-card").first().click();
    await p1.waitForTimeout(400);
    await p1.screenshot({ path: SS("04-p1-unit-selected") });
    console.log("유닛 1 선택");

    // Deselect (click again)
    await p1.locator(".unit-card").first().click();
    await p1.waitForTimeout(300);
    await p1.screenshot({ path: SS("04-p1-unit-deselected") });
    console.log("유닛 1 취소");

    // Reselect first + select second
    await p1.locator(".unit-card").first().click();
    await p1.waitForTimeout(300);
    if (unitCards > 1) {
      await p1.locator(".unit-card").nth(1).click();
      await p1.waitForTimeout(300);
    }
    if (unitCards > 2) {
      await p1.locator(".unit-card").nth(2).click();
      await p1.waitForTimeout(300);
    }
    await p1.screenshot({ path: SS("04-p1-units-selected") });
    console.log("유닛 1~3 선택 완료");
  }

  // Check P2 team bar shows P1's selection (same team)
  await p2.waitForTimeout(500);
  const teamBarVisible = await p2.locator("#placement-team-bar").isVisible().catch(() => false);
  console.log(`P2 팀 선택 바 표시: ${teamBarVisible}`);
  await p2.screenshot({ path: SS("05-p2-team-bar") });

  // ── 7. 배치 REST API 제출 ────────────────────────────────────────────────
  console.log("\n═══ STEP 7: 배치 제출 ═══");

  // P1 places their units at slot-0 spawn positions
  const place1Res = await apiPost(`/api/v1/rooms/${gameId}/place`, t1, {
    playerId: P1_ID,
    units: p1Units.map((id, i) => ({ metaId: id, position: SPAWN_POSITIONS[0]![i] })),
  });
  console.log(`P1 배치 결과: ${place1Res.status} ${JSON.stringify(place1Res.json)}`);
  expect([200, 201]).toContain(place1Res.status);

  // P2 places DIFFERENT units (same team, so must not overlap) at slot-1 spawn positions
  const place2Res = await apiPost(`/api/v1/rooms/${gameId}/place`, t2, {
    playerId: P2_ID,
    units: p2Units.map((id, i) => ({ metaId: id, position: SPAWN_POSITIONS[1]![i] })),
  });
  console.log(`P2 배치 결과: ${place2Res.status} ${JSON.stringify(place2Res.json)}`);
  expect([200, 201]).toContain(place2Res.status);

  // ── 8. 유닛 순서 화면 (또는 게임 화면) 전환 대기 ────────────────────────
  console.log("\n═══ STEP 8: 전투/유닛순서 화면 전환 대기 ═══");

  const waitForGameOrOrder = async (page: Page) =>
    page.waitForFunction(
      () =>
        document.getElementById("screen-game")?.classList.contains("active") ||
        document.getElementById("screen-unit-order")?.classList.contains("active"),
      { timeout: 20_000 },
    ).then(() => true).catch(() => false);

  const p1GameOrOrder = await waitForGameOrOrder(p1);
  const p2GameOrOrder = await waitForGameOrOrder(p2);

  console.log(`P1 전투/순서화면: ${p1GameOrOrder}, P2 전투/순서화면: ${p2GameOrOrder}`);

  await p1.screenshot({ path: SS("06-p1-game-start") });
  await p2.screenshot({ path: SS("06-p2-game-start") });

  // ── 9. 유닛 순서 지정 화면 처리 ─────────────────────────────────────────
  console.log("\n═══ STEP 9: 유닛 순서 지정 처리 ═══");

  const handleUnitOrder = async (page: Page, label: string) => {
    // 유닛 순서 전용 화면 처리
    const isOrder = await page.evaluate(
      () => document.getElementById("screen-unit-order")?.classList.contains("active"),
    );
    if (isOrder) {
      console.log(`${label} 유닛 순서 화면 표시 — 기본 순서로 제출`);
      await safeClick(page, "#unit-order-submit");
      await page.waitForTimeout(1000);
    }

    // 유닛 순서 오버레이 처리 (hidden 클래스가 없을 때 = visible)
    const overlayVisible = await page.evaluate(
      () => {
        const el = document.getElementById("unit-order-overlay");
        return el !== null && !el.classList.contains("hidden");
      },
    );
    if (overlayVisible) {
      console.log(`${label} 유닛 순서 오버레이 — 제출`);
      await safeClick(page, "#unit-order-submit");
      await page.waitForTimeout(1000);
    }
  };

  await handleUnitOrder(p1, "P1");
  await handleUnitOrder(p2, "P2");

  // Wait for game screen
  const p1InGame = await waitForScreen(p1, "screen-game", "P1", 20_000);
  const p2InGame = await waitForScreen(p2, "screen-game", "P2", 20_000);

  await p1.screenshot({ path: SS("07-p1-game-screen") });
  await p2.screenshot({ path: SS("07-p2-game-screen") });

  console.log(`P1 게임화면: ${p1InGame}, P2 게임화면: ${p2InGame}`);

  if (!p1InGame && !p2InGame) {
    console.log("⚠️  게임 화면 미전환 — 현재 상태 디버그");
    const p1s = await p1.evaluate(() => {
      const screens = ["screen-menu","screen-lobby","screen-waiting-room","screen-placement","screen-unit-order","screen-game"];
      return screens.find((s) => document.getElementById(s)?.classList.contains("active")) ?? "none";
    });
    const p2s = await p2.evaluate(() => {
      const screens = ["screen-menu","screen-lobby","screen-waiting-room","screen-placement","screen-unit-order","screen-game"];
      return screens.find((s) => document.getElementById(s)?.classList.contains("active")) ?? "none";
    });
    console.log(`P1: ${p1s}, P2: ${p2s}`);

    // Try checking game state via REST
    const state = await apiGet(`/api/v1/rooms/${gameId}`, t1);
    console.log(`서버 게임 상태: phase=${state.json.state?.phase ?? state.json.status}`);
  }

  // ── 10. 전투 진행 ────────────────────────────────────────────────────────
  console.log("\n═══ STEP 10: 전투 진행 ═══");

  // ── helper: is game over (overlay visible, not hidden) ───────────────────
  const isGameOver = async (page: Page) =>
    page.evaluate(() => {
      const ov = document.getElementById("game-over-container");
      return ov !== null && !ov.classList.contains("hidden");
    });

  // ── helper: is pass-btn visible ───────────────────────────────────────────
  const isPassVisible = async (page: Page) =>
    page.evaluate(() => {
      const btn = document.getElementById("pass-btn");
      if (!btn) return false;
      const s = getComputedStyle(btn);
      return s.display !== "none" && s.visibility !== "hidden";
    });

  // Play up to 20 iterations (2 human turns + AI turns per round)
  let gameEnded = false;
  let turnCount = 0;

  for (let iter = 1; iter <= 20 && !gameEnded; iter++) {
    // Check unit-order overlay first (may appear at round start)
    await handleUnitOrder(p1, `I${iter}-P1`);
    await handleUnitOrder(p2, `I${iter}-P2`);

    // Check game over
    if (await isGameOver(p1)) {
      console.log(`🏁 P1 게임 종료 감지 (iter ${iter})`);
      gameEnded = true;
      break;
    }
    if (await isGameOver(p2)) {
      console.log(`🏁 P2 게임 종료 감지 (iter ${iter})`);
      gameEnded = true;
      break;
    }

    // P1's turn?
    const p1Pass = await isPassVisible(p1);
    const p2Pass = await isPassVisible(p2);

    console.log(`iter ${iter}: P1 패스버튼=${p1Pass}, P2 패스버튼=${p2Pass}`);

    if (p1Pass) {
      await safeClick(p1, "#pass-btn");
      turnCount++;
      console.log(`  ▶ P1 턴 종료 (turn ${turnCount})`);
      await p1.waitForTimeout(600);
    }

    if (p2Pass) {
      await safeClick(p2, "#pass-btn");
      turnCount++;
      console.log(`  ▶ P2 턴 종료 (turn ${turnCount})`);
      await p2.waitForTimeout(600);
    }

    if (!p1Pass && !p2Pass) {
      // AI's turn — wait for it
      await p1.waitForTimeout(1500);
    }

    // Screenshot at key moments
    if (iter === 3 || iter === 6 || iter === 10) {
      await p1.screenshot({ path: SS(`08-iter${iter}-p1`) });
      await p2.screenshot({ path: SS(`08-iter${iter}-p2`) });
    }
  }

  console.log(`총 인간 턴 수행: ${turnCount}`);

  // Final game over screenshot if ended
  if (gameEnded) {
    await p1.screenshot({ path: SS("10-game-over-p1") });
    await p2.screenshot({ path: SS("10-game-over-p2") });
    console.log("📸 게임 종료 스크린샷 저장");
  }

  // Final screenshots
  await p1.screenshot({ path: SS("09-p1-final") });
  await p2.screenshot({ path: SS("09-p2-final") });

  // Check game state via API
  const finalState = await apiGet(`/api/v1/rooms/${gameId}`, t1);
  const finalPhase = finalState.json.state?.phase ?? finalState.json.status;
  console.log(`\n최종 게임 상태: ${finalPhase}`);

  // ── 11. 결과 확인 ────────────────────────────────────────────────────────
  console.log("\n═══ 결과 ═══");
  console.log(`✅ 대기실: P1=${p1WRShown}, P2=${p2WRShown}`);
  console.log(`✅ 배치화면: P1=${p1InPlacement}, P2=${p2InPlacement}`);
  console.log(`✅ 게임화면: P1=${p1InGame}, P2=${p2InGame}`);
  console.log(`✅ 최종 단계: ${finalPhase}`);
  console.log(`📸 스크린샷: e2e/full-game-screenshots/`);

  // The game must have reached at least placement phase
  expect(p1InPlacement || p1InGame, "P1이 배치/전투 화면에 도달하지 못함").toBe(true);
  expect(p2InPlacement || p2InGame, "P2이 배치/전투 화면에 도달하지 못함").toBe(true);

  // Clean up
  await browser.close();
});
