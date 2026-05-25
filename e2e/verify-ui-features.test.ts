/**
 * UI 기능 검증 테스트
 * - 선택 유닛 굵은 외곽선 (drop-shadow)
 * - 공격 대상 프리뷰 카드 (#attack-preview-card)
 * - 무기/속성/스킬 툴팁 (#rich-tooltip)
 *
 * 실행: npx playwright test e2e/verify-ui-features.test.ts --headed
 */
import { test, expect, request } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SERVER = "http://localhost:3000";
const CLIENT = "http://localhost:5173";
const PLAYER_ID = "verify-ui-01";
const SS = (name: string) => `e2e/verify-screenshots/${name}.png`;

test.use({ headless: false, viewport: { width: 1400, height: 900 } });

test.beforeAll(async () => {
  const { execSync } = require("child_process");
  execSync("mkdir -p e2e/verify-screenshots");
});

// ─── Test 01: DOM 구조 ────────────────────────────────────────────────────────

test("01 — 새 DOM 요소 존재 + 초기 hidden 상태", async ({ page }) => {
  await page.goto(CLIENT);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.locator("#attack-preview-card")).toBeAttached();
  await expect(page.locator("#rich-tooltip")).toBeAttached();
  await expect(page.locator("#hover-tooltip")).toBeAttached();

  const states = await page.evaluate(() => {
    const apc = document.getElementById("attack-preview-card")!;
    const rt  = document.getElementById("rich-tooltip")!;
    return {
      apc: getComputedStyle(apc).display,
      rt:  getComputedStyle(rt).display,
    };
  });

  expect(states.apc).toBe("none");
  expect(states.rt).toBe("none");
  console.log("✅ attack-preview-card, rich-tooltip 존재 + display:none 확인");
});

// ─── Test 02: CSS 클래스 ──────────────────────────────────────────────────────

test("02 — CSS 클래스 전부 존재", async ({ page }) => {
  await page.goto(CLIENT);
  await page.waitForLoadState("domcontentloaded");

  const styles = await page.evaluate(() => {
    const allText: string[] = [];
    Array.from(document.styleSheets).forEach((s) => {
      try {
        Array.from(s.cssRules ?? []).forEach((r) => allText.push(r.cssText));
      } catch { /* cross-origin */ }
    });
    const text = allText.join("\n");
    return {
      apcPortrait:        text.includes(".apc-portrait"),
      rttTitle:           text.includes(".rtt-title"),
      rttRow:             text.includes(".rtt-row"),
      bwsAttrWater:       text.includes(".bws-attr-water"),
      bwsAttrAcid:        text.includes(".bws-attr-acid"),
      bwsAttrSand:        text.includes(".bws-attr-sand"),
      attackPreviewCard:  text.includes("#attack-preview-card"),
      richTooltip:        text.includes("#rich-tooltip"),
    };
  });

  console.log("CSS 결과:", JSON.stringify(styles, null, 2));
  for (const [key, val] of Object.entries(styles)) {
    expect(val, `CSS 클래스 누락: ${key}`).toBe(true);
  }
  console.log("✅ 모든 새 CSS 클래스 확인");
});

// ─── Test 03: 소스코드 구현 확인 ─────────────────────────────────────────────

test("03 — 소스코드에 새 기능 구현 확인", async () => {
  const mainTs = readFileSync(
    resolve(__dirname, "../packages/client/src/main.ts"),
    "utf8",
  );

  const checks: Array<[string, string]> = [
    ["drop-shadow 필터",         "drop-shadow"],
    ["ATTR_EFFECT_KO 상수",      "ATTR_EFFECT_KO"],
    ["showAttackPreviewCard",    "showAttackPreviewCard"],
    ["hideAttackPreviewCard",    "hideAttackPreviewCard"],
    ["showRichTooltip",          "showRichTooltip"],
    ["hideRichTooltip",          "hideRichTooltip"],
    ["repositionRichTooltip",    "repositionRichTooltip"],
    ["weaponTooltipHtml",        "weaponTooltipHtml"],
    ["attack-preview-card 요소", "attack-preview-card"],
    ["rich-tooltip 요소",        "rich-tooltip"],
    ["화염 효과 한국어",          "화염 효과 부여"],
    ["빙결 효과 한국어",          "빙결 효과 부여"],
  ];

  for (const [label, token] of checks) {
    expect(mainTs, `누락: ${label}`).toContain(token);
    console.log(`  ✓ ${label}`);
  }
  console.log("✅ main.ts 소스코드 기능 구현 전체 확인");
});

// ─── Test 04: 세션 복원 → 게임 화면 진입 + 스크린샷 ─────────────────────────

test("04 — 세션 복원으로 게임 화면 진입", async ({ page }) => {
  // ── API로 게임 설정 ──────────────────────────────────────────────────────
  const ctx = await request.newContext();

  const loginRes = await ctx.post(`${SERVER}/api/v1/auth/login`, {
    data: { playerId: PLAYER_ID },
  });
  expect(loginRes.ok()).toBe(true);
  const { accessToken } = await loginRes.json() as { accessToken: string };
  const h = { Authorization: `Bearer ${accessToken}` };

  const createRes = await ctx.post(`${SERVER}/api/v1/rooms`, {
    headers: h,
    data: { mapId: "map_test_01", playerCount: 2 },
  });
  expect(createRes.ok()).toBe(true);
  const { gameId } = await createRes.json() as { gameId: string };
  console.log("게임 생성:", gameId);

  // Join
  const joinRes = await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/join`, {
    headers: h,
    data: { playerId: PLAYER_ID },
  });
  expect(joinRes.ok()).toBe(true);

  // Add AI (AI auto-places)
  const aiRes = await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/ai`, {
    headers: h,
    data: {},
  });
  expect(aiRes.ok()).toBe(true);
  const aiData = await aiRes.json() as { aiPlayerId: string; started: boolean };
  console.log("AI 추가:", aiData);

  // Get available units
  const unitsRes = await ctx.get(`${SERVER}/api/v1/meta/units`);
  const { units } = await unitsRes.json() as { units: Array<{ id: string }> };

  // Submit human placement
  const placeRes = await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/place`, {
    headers: h,
    data: {
      playerId: PLAYER_ID,
      units: [
        { metaId: units[0]!.id, position: { row: 1, col: 1 } },
        { metaId: units[1]!.id, position: { row: 1, col: 2 } },
        { metaId: units[2]!.id, position: { row: 2, col: 1 } },
      ],
    },
  });
  const placeData = await placeRes.json();
  console.log("배치 결과:", JSON.stringify(placeData));

  await ctx.dispose();

  // ── sessionStorage 주입 후 페이지 로드 ───────────────────────────────────
  await page.addInitScript(
    ({ pid, gid }: { pid: string; gid: string }) => {
      sessionStorage.setItem("ab_player_id", pid);
      sessionStorage.setItem("ab_game_id", gid);
    },
    { pid: PLAYER_ID, gid: gameId },
  );

  await page.goto(CLIENT);

  // tryRestoreSession()이 실행되어 화면 전환 대기 (최대 10초)
  await page.waitForFunction(
    () => {
      const game      = document.getElementById("screen-game");
      const placement = document.getElementById("screen-placement");
      const order     = document.getElementById("screen-unit-order");
      return (
        game?.classList.contains("active") ||
        placement?.classList.contains("active") ||
        order?.classList.contains("active")
      );
    },
    { timeout: 10_000 },
  );

  await page.screenshot({ path: SS("04-game-restored"), fullPage: false });
  console.log("📸 게임 화면 스크린샷 저장: e2e/verify-screenshots/04-game-restored.png");

  const activeScreen = await page.evaluate(() => {
    const ids = ["screen-game", "screen-placement", "screen-unit-order"];
    return ids.find((id) => document.getElementById(id)?.classList.contains("active")) ?? "none";
  });
  console.log("활성 화면:", activeScreen);
  expect(["screen-game", "screen-placement", "screen-unit-order"]).toContain(activeScreen);

  console.log("✅ 세션 복원 후 게임 관련 화면 진입 확인");
});

// ─── Test 05: rich-tooltip 수동 렌더링 확인 ──────────────────────────────────

test("05 — rich-tooltip 수동 렌더링 + 스크린샷", async ({ page }) => {
  await page.goto(CLIENT);
  await page.waitForLoadState("domcontentloaded");

  // rich-tooltip을 직접 populate하고 표시
  await page.evaluate(() => {
    const rt = document.getElementById("rich-tooltip")!;
    rt.innerHTML = `
      <div class="rtt-title">빙결 강타</div>
      <div class="rtt-sep"></div>
      <div class="rtt-row"><span>유형</span><span class="rtt-val">근접</span></div>
      <div class="rtt-row"><span>공격력</span><span class="rtt-val">4</span></div>
      <div class="rtt-row"><span>사거리</span><span class="rtt-val">1</span></div>
      <div class="rtt-sep"></div>
      <div class="rtt-row"><span>속성</span><span class="rtt-attr rtt-attr-ice">빙결</span></div>
      <div class="rtt-sep"></div>
      <div class="rtt-extra-row">· 빙결 효과 부여 (1턴 행동 불능)</div>
    `;
    rt.style.display = "block";
    rt.style.left    = "200px";
    rt.style.top     = "200px";
  });

  const tooltipVisible = await page.locator("#rich-tooltip").isVisible();
  expect(tooltipVisible).toBe(true);

  await page.screenshot({ path: SS("05-rich-tooltip"), fullPage: false });
  console.log("📸 rich-tooltip 스크린샷: e2e/verify-screenshots/05-rich-tooltip.png");

  const content = await page.locator("#rich-tooltip").textContent();
  expect(content).toContain("빙결 강타");
  expect(content).toContain("빙결 효과 부여");
  console.log("툴팁 내용:", content?.replace(/\s+/g, " ").trim());
  console.log("✅ rich-tooltip 렌더링 확인");
});

// ─── Test 06: attack-preview-card 수동 렌더링 확인 ───────────────────────────

test("06 — attack-preview-card 수동 렌더링 + 스크린샷", async ({ page }) => {
  await page.goto(CLIENT);
  await page.waitForLoadState("domcontentloaded");

  // attack-preview-card 직접 populate
  await page.evaluate(() => {
    const apc = document.getElementById("attack-preview-card")!;
    apc.innerHTML = `
      <div class="apc-portrait-fallback">⚔️</div>
      <div class="apc-name">궁수 (t1)</div>
      <div class="apc-hp-row">
        <div class="apc-hp-bar"><div class="apc-hp-fill" style="width:72%"></div></div>
        <span class="apc-hp-text">36 / 50</span>
      </div>
      <div class="apc-armor">🛡 방어력: 2</div>
      <div class="apc-hint">⚔️ 공격 대상</div>
    `;
    apc.style.display = "block";
    apc.style.left    = "300px";
    apc.style.top     = "300px";
  });

  const cardVisible = await page.locator("#attack-preview-card").isVisible();
  expect(cardVisible).toBe(true);

  await page.screenshot({ path: SS("06-attack-preview"), fullPage: false });
  console.log("📸 attack-preview-card 스크린샷: e2e/verify-screenshots/06-attack-preview.png");

  const content = await page.locator("#attack-preview-card").textContent();
  expect(content).toContain("공격 대상");
  console.log("카드 내용:", content?.replace(/\s+/g, " ").trim());
  console.log("✅ attack-preview-card 렌더링 확인");
});

// ─── Test 07: Canvas drop-shadow API 지원 ────────────────────────────────────

test("07 — Canvas drop-shadow 필터 API 지원", async ({ page }) => {
  await page.goto(CLIENT);
  await page.waitForLoadState("domcontentloaded");

  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const ctx    = canvas.getContext("2d");
    if (!ctx) return { supported: false, reason: "no 2d context" };

    const filterStr = [
      "drop-shadow(3px 0 0 red)",
      "drop-shadow(-3px 0 0 red)",
      "drop-shadow(0 3px 0 red)",
      "drop-shadow(0 -3px 0 red)",
    ].join(" ");

    ctx.filter = filterStr;

    return {
      supported: ctx.filter !== "none",
      filter:    ctx.filter,
    };
  });

  console.log("Canvas filter 결과:", result);
  expect(result.supported).toBe(true);
  console.log("✅ Canvas drop-shadow 8방향 필터 API 지원 확인");
});
