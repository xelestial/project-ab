/**
 * Visual Features Test: tile focus ring + attack particles + damage float
 *
 * Run: node scripts/test-visual-features.mjs
 */
import pkg from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
const { chromium } = pkg;

const BASE    = "http://localhost:5174";
const API     = "http://localhost:3000";
const TIMEOUT = 20_000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── helpers ────────────────────────────────────────────────────────────────────

async function getTileVP(page, canvasId, row, col) {
  return page.evaluate(({ canvasId, row, col }) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cW = canvas.width, cH = canvas.height;
    const gs = 11;
    const TW = cW / (gs + 1), HW = TW / 2, HH = TW / 4;
    const stp = Math.round(HW * 3.5);
    const cx = cW / 2, cy = HH + 4 + stp;
    const sx = cx + (col - row) * HW;
    const sy = cy + (col + row) * HH;
    return { x: rect.left + sx * (rect.width / cW), y: rect.top + sy * (rect.height / cH) };
  }, { canvasId, row, col });
}

async function clickTile(page, canvasId, row, col) {
  const vp = await getTileVP(page, canvasId, row, col);
  if (vp) await page.mouse.click(vp.x, vp.y);
  return vp;
}

async function hoverTile(page, canvasId, row, col) {
  const vp = await getTileVP(page, canvasId, row, col);
  if (vp) await page.mouse.move(vp.x, vp.y);
  return vp;
}

async function placeUnits(page) {
  const maxUnits = parseInt(await page.$eval("#placement-max", el => el.textContent ?? "3")) || 3;
  const teamIndex = await page.evaluate(() => parseInt(sessionStorage.getItem("ab_team_index") ?? "0")).catch(() => 0);
  const half = 5, gs = 11;
  const rowStart = teamIndex === 0 ? 0 : half;
  const rowEnd   = teamIndex === 0 ? half - 1 : gs - 1;
  const tiles = [];
  for (let r = rowStart; r <= rowEnd; r++)
    for (let c = 2; c < gs - 2; c++) tiles.push({ row: r, col: c });

  const preferred = ["t2", "t1"];
  let placed = 0, ti = 0;
  const placedTiles = [];

  while (placed < maxUnits && ti < tiles.length) {
    const sel = await page.locator(".unit-card.selected").count();
    if (!sel) {
      let picked = false;
      for (const m of preferred) {
        const c = page.locator(`.unit-card[data-meta-id="${m}"]:not(.used):not(.teammate-taken)`);
        if (await c.count() > 0) { await c.first().click(); await sleep(120); picked = true; break; }
      }
      if (!picked) {
        const c = page.locator(".unit-card:not(.used):not(.teammate-taken)");
        if (await c.count() === 0) break;
        await c.first().click(); await sleep(120);
      }
    }
    const tile = tiles[ti++];
    await clickTile(page, "placement-canvas", tile.row, tile.col);
    await sleep(130);
    const now = parseInt(await page.$eval("#placement-counter", el => el.textContent ?? "0"));
    if (now > placed) { placed = now; placedTiles.push(tile); }
  }

  const disabled = await page.$eval("#ready-btn", el => el.disabled);
  if (!disabled) { await page.locator("#ready-btn").click(); console.log("준비 완료 ✓"); }
  return placedTiles;
}

// ── API helpers (direct REST for attack simulation) ─────────────────────────────

async function apiLogin(playerId) {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return (await r.json()).accessToken;
}

async function getState(gameId, token) {
  const r = await fetch(`${API}/api/v1/rooms/${gameId}`, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}

// ── Main ───────────────────────────────────────────────────────────────────────

const { mkdirSync } = await import("fs");
mkdirSync("test-out", { recursive: true });

const browser = await chromium.launch({ headless: false, slowMo: 60 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("[ERR]", e.message));

await page.goto(BASE);
await page.waitForSelector(".mode-card", { timeout: TIMEOUT });
await page.locator(".mode-card").first().click();
await page.waitForSelector("#screen-lobby.active", { timeout: TIMEOUT });
await page.click("#start-btn");
await page.waitForSelector("#screen-placement.active", { timeout: TIMEOUT });

const gameId  = await page.evaluate(() => sessionStorage.getItem("ab_game_id"));
const playerId = await page.evaluate(() => sessionStorage.getItem("ab_player_id"));
console.log(`Game: ${gameId}  Player: ${playerId}`);

// Auto-dismiss unit-order overlay
await page.evaluate(() => {
  window._orderWatcher = setInterval(() => {
    const b = document.getElementById("unit-order-submit");
    const o = document.getElementById("unit-order-overlay");
    if (b && o && !o.classList.contains("hidden")) b.click();
  }, 300);
});

const placedTiles = await placeUnits(page);
console.log("Placed at:", placedTiles.map(t => `(${t.row},${t.col})`).join(", "));

await page.waitForSelector("#screen-game.active", { timeout: 40_000 });
await sleep(1200);
console.log("Battle screen ✓");
await page.screenshot({ path: "test-out/v01-battle-start.png" });

// ── Select the first unit (t2) ─────────────────────────────────────────────────
const unitTile = placedTiles[0] ?? { row: 1, col: 2 };
await clickTile(page, "board-canvas", unitTile.row, unitTile.col);
await sleep(700);
console.log(`Clicked unit at (${unitTile.row},${unitTile.col})`);

// Confirm selection (look for move highlights)
const moveCount = await page.evaluate(() => window._dbgMoveHighlights?.length ?? -1);
await page.screenshot({ path: "test-out/v02-unit-selected.png" });

// ── TEST 1: Move tile hover focus ring ─────────────────────────────────────────
console.log("\n=== TEST 1: Move tile hover focus ring ===");
// Try nearby tiles (team 0 starts in rows 0-4)
const moveCandidates = [
  { row: unitTile.row - 1, col: unitTile.col },
  { row: unitTile.row,     col: unitTile.col + 1 },
  { row: unitTile.row + 1, col: unitTile.col },
  { row: unitTile.row,     col: unitTile.col - 1 },
  { row: unitTile.row - 1, col: unitTile.col + 1 },
  { row: unitTile.row + 1, col: unitTile.col + 1 },
  { row: unitTile.row - 1, col: unitTile.col - 1 },
];
for (const t of moveCandidates) {
  if (t.row < 0 || t.col < 0 || t.row >= 11 || t.col >= 11) continue;
  await hoverTile(page, "board-canvas", t.row, t.col);
  await sleep(350); // let RAF pulse a bit
  const cursor = await page.evaluate(() => {
    const el = document.getElementById("custom-cursor");
    if (!el) return null;
    return window.getComputedStyle(el).display !== "none" ? el.className : null;
  });
  if (cursor === "cc-move") {
    console.log(`Move cursor + focus ring at (${t.row},${t.col}) ✓`);
    await sleep(400);
    await page.screenshot({ path: "test-out/v03-move-focus.png" });
    break;
  }
}

// ── TEST 2: Skill targeting → hover skill target focus ring ────────────────────
console.log("\n=== TEST 2: Skill target focus ring ===");
const skillBtn = page.locator(".skill-btn:not(.skill-btn-disabled)").first();
if (await skillBtn.isVisible().catch(() => false)) {
  await skillBtn.click();
  await sleep(600);
  console.log("Skill targeting mode active");

  // Get skill target tiles from DOM — the purple targets are rendered on canvas
  // Try hovering enemy positions (rows 6-10 for the AI)
  const skillTargets = [
    { row: 6, col: 4 }, { row: 6, col: 5 }, { row: 7, col: 4 }, { row: 7, col: 5 },
    { row: 8, col: 4 }, { row: 8, col: 5 }, { row: 9, col: 4 }, { row: 9, col: 5 },
  ];
  for (const t of skillTargets) {
    await hoverTile(page, "board-canvas", t.row, t.col);
    await sleep(280);
    const cursor = await page.evaluate(() => {
      const el = document.getElementById("custom-cursor");
      if (!el) return null;
      return window.getComputedStyle(el).display !== "none" ? { cls: el.className, txt: el.textContent } : null;
    });
    if (cursor?.cls === "cc-attack") {
      console.log(`Skill target + focus ring at (${t.row},${t.col}) ✓`);
      await sleep(400);
      await page.screenshot({ path: "test-out/v04-skill-focus.png" });
      break;
    }
  }
  await page.screenshot({ path: "test-out/v04b-skill-targeting.png" });

  // Escape skill mode
  await page.keyboard.press("Escape");
  await sleep(200);
  // Re-select unit
  await clickTile(page, "board-canvas", unitTile.row, unitTile.col);
  await sleep(600);
}

// ── TEST 3: Attack target hover (if any enemy in range) ────────────────────────
console.log("\n=== TEST 3: Attack focus ring ===");
const attackTargets = [
  { row: 4, col: 4 }, { row: 4, col: 5 }, { row: 5, col: 4 }, { row: 5, col: 5 },
  { row: 6, col: 4 }, { row: 6, col: 5 }, { row: 7, col: 4 }, { row: 7, col: 5 },
];
for (const t of attackTargets) {
  await hoverTile(page, "board-canvas", t.row, t.col);
  await sleep(250);
  const cursor = await page.evaluate(() => {
    const el = document.getElementById("custom-cursor");
    if (!el) return null;
    return window.getComputedStyle(el).display !== "none" ? { cls: el.className } : null;
  });
  if (cursor?.cls === "cc-attack") {
    console.log(`Attack cursor + focus ring at (${t.row},${t.col}) ✓`);
    await sleep(450);
    await page.screenshot({ path: "test-out/v05-attack-focus.png" });

    // ── TEST 4: Click attack → particles + damage float ──────────────────────
    console.log("\n=== TEST 4: Attack particles + damage float ===");
    await page.mouse.click((await getTileVP(page, "board-canvas", t.row, t.col)).x,
                           (await getTileVP(page, "board-canvas", t.row, t.col)).y);
    await sleep(100);
    await page.screenshot({ path: "test-out/v06-attack-particles.png" });
    await sleep(300);
    await page.screenshot({ path: "test-out/v07-attack-particles-mid.png" });
    await sleep(600);
    await page.screenshot({ path: "test-out/v08-damage-float.png" });
    await sleep(500);
    break;
  }
}

// ── TEST 5: No-attack cursor on distant enemy ──────────────────────────────────
console.log("\n=== TEST 5: No-attack cursor ===");
// Re-select unit
await clickTile(page, "board-canvas", unitTile.row, unitTile.col);
await sleep(700);
const enemyDistant = [{ row: 9, col: 5 }, { row: 9, col: 6 }, { row: 10, col: 5 }];
for (const t of enemyDistant) {
  await hoverTile(page, "board-canvas", t.row, t.col);
  await sleep(350);
  const cursor = await page.evaluate(() => {
    const el = document.getElementById("custom-cursor");
    if (!el) return null;
    return window.getComputedStyle(el).display !== "none" ? { cls: el.className, txt: el.textContent } : null;
  });
  if (cursor?.cls === "cc-no-attack") {
    console.log(`No-attack cursor at (${t.row},${t.col}) ✓`);
    await sleep(400);
    await page.screenshot({ path: "test-out/v09-no-attack-cursor.png" });
    break;
  }
}

await sleep(2000);
await browser.close();
console.log("\n✓ All visual feature screenshots saved to test-out/v*.png");
