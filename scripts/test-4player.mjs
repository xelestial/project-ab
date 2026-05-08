/**
 * 4-player full gameplay test via Playwright
 * Turn structure: player-level (slot has playerId only, no unitId).
 * A player's turn lasts until they submit { type:"pass" }.
 * Each turn: move each unit toward enemy → attack if in range → pass.
 */

import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";

const BASE_URL = "http://localhost:5173";
const API_BASE = "http://localhost:3000";
const TIMEOUT  = 15_000;

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${label}] ${msg}`);
}

// ── REST helpers ──────────────────────────────────────────────────────────────

async function apiLogin(playerId) {
  const r = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return (await r.json()).accessToken;
}

async function getGameState(gameId, token) {
  const r = await fetch(`${API_BASE}/api/v1/rooms/${gameId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`getGameState HTTP ${r.status}`);
  return r.json();
}

async function getUnitOptions(gameId, playerId, unitId, token) {
  const r = await fetch(
    `${API_BASE}/api/v1/rooms/${gameId}/unit-options?playerId=${encodeURIComponent(playerId)}&unitId=${encodeURIComponent(unitId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return { error: `HTTP ${r.status}` };
  return r.json();
}

async function sendAction(gameId, playerId, action, token) {
  const r = await fetch(`${API_BASE}/api/v1/rooms/${gameId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ playerId, action }),
  });
  return r.json();
}

async function sendUnitOrder(gameId, playerId, unitOrder, token) {
  const r = await fetch(`${API_BASE}/api/v1/rooms/${gameId}/unit-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ playerId, unitOrder }),
  });
  return r.json();
}

// ── Game logic ────────────────────────────────────────────────────────────────

function dist(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/**
 * Play a full player turn:
 *  - For each alive unit of `playerId`: attack enemy if possible, else move toward enemy
 *  - Submit pass to end turn
 * Returns true if actions were taken.
 */
async function playPlayerTurn(gameId, playerId, token, label, state) {
  const myUnits = Object.values(state.units).filter(
    (u) => u.alive && u.playerId === playerId,
  );

  if (myUnits.length === 0) {
    log(label, "No alive units — passing");
    await sendAction(gameId, playerId, { type: "pass", unitId: "" }, token);
    return;
  }

  let actionsTaken = 0;

  for (const unit of myUnits) {
    const unitId = unit.unitId;
    const opts = await getUnitOptions(gameId, playerId, unitId, token);
    if (opts.error) continue;

    // Attack enemy if in range
    if (opts.canAttack && opts.enemyPositions?.length > 0) {
      const target = opts.enemyPositions[0];
      log(label, `  ⚔️  ${unit.metaId} attacks (${target.row},${target.col})`);
      const res = await sendAction(gameId, playerId, { type: "attack", unitId, targetPosition: target }, token);
      if (res.accepted !== false) actionsTaken++;
    }

    // Move toward nearest enemy if can still move
    if (opts.canMove && opts.reachableTiles?.length > 0) {
      // Re-fetch state to get updated enemy positions
      const { state: fresh } = await getGameState(gameId, token);
      const enemies = Object.values(fresh.units).filter(
        (u) => u.alive && u.playerId !== playerId,
      );
      if (enemies.length > 0) {
        let bestTile = null;
        let bestDist = Infinity;
        for (const tile of opts.reachableTiles) {
          for (const enemy of enemies) {
            const d = dist(tile, enemy.position);
            if (d < bestDist) { bestDist = d; bestTile = tile; }
          }
        }
        if (bestTile) {
          log(label, `  🚶 ${unit.metaId} moves (${bestTile.row},${bestTile.col}) [dist=${bestDist}]`);
          const res = await sendAction(gameId, playerId, { type: "move", unitId, targetPosition: bestTile }, token);
          if (res.accepted !== false) actionsTaken++;
        }
      }
    }
  }

  // End turn with pass
  const firstUnit = myUnits[0];
  log(label, `  ⏭️  Pass (${actionsTaken} actions taken)`);
  await sendAction(gameId, playerId, { type: "pass", unitId: firstUnit.unitId }, token);
}

// ── Browser helpers ───────────────────────────────────────────────────────────

/** Auto-click 확인 when unit-order overlay appears */
function startOrderWatcher(page) {
  page.evaluate(() => {
    if (window._orderWatcher) clearInterval(window._orderWatcher);
    window._orderWatcher = setInterval(() => {
      const overlay = document.getElementById("unit-order-overlay");
      const btn = document.getElementById("unit-order-submit");
      if (overlay && !overlay.classList.contains("hidden") && btn) {
        btn.click();
      }
    }, 300);
  }).catch(() => {});
}

/** Generate canvas click targets for ONLY the given team's half. */
function computeTargetsForTeam(teamIndex) {
  return `(function() {
  const canvas = document.getElementById("placement-canvas");
  if (!canvas) return [];
  const rect = canvas.getBoundingClientRect();
  const cW = canvas.width;
  const gridSize = 11;
  const TW = cW / (gridSize + 1);
  const HW = TW / 2, HH = TW / 4;
  const spriteTopPad = Math.round(HW * 3.5);
  const cx = cW / 2, cy = HH + 4 + spriteTopPad;
  const scaleX = rect.width / cW, scaleY = rect.height / canvas.height;
  const half = Math.floor(gridSize / 2);
  const th = ${teamIndex};
  const rowStart = th === 0 ? 0 : half;
  const rowEnd   = th === 0 ? half - 1 : gridSize - 1;
  const pts = [];
  for (let row = rowStart; row <= rowEnd; row++)
    for (let col = 1; col < gridSize - 1; col++) {
      const sx = cx + (col - row) * HW, sy = cy + (col + row) * HH;
      pts.push({ x: rect.left + sx * scaleX, y: rect.top + sy * scaleY, row, col });
    }
  // Return all valid tiles (not just sampled), to ensure enough targets
  return pts;
})()`;
}

/**
 * Click the canvas at the given isometric grid (row, col).
 * Recomputes canvas rect fresh each call so layout shifts don't break targeting.
 */
async function clickGridCell(page, row, col) {
  const vp = await page.evaluate(({ row, col }) => {
    const canvas = document.getElementById("placement-canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cW = canvas.width;
    const gridSize = 11;
    const TW = cW / (gridSize + 1);
    const HW = TW / 2, HH = TW / 4;
    const spriteTopPad = Math.round(HW * 3.5);
    const cx = cW / 2, cy = HH + 4 + spriteTopPad;
    const scaleX = rect.width / cW, scaleY = rect.height / canvas.height;
    const sx = cx + (col - row) * HW;
    const sy = cy + (col + row) * HH;
    return { x: rect.left + sx * scaleX, y: rect.top + sy * scaleY };
  }, { row, col });
  if (!vp) return;
  await page.mouse.click(vp.x, vp.y);
}

async function placeUnits(page, name) {
  const maxUnits = parseInt(
    await page.$eval("#placement-max", (el) => el.textContent ?? "3"), 10,
  ) || 3;
  log(name, `Placing ${maxUnits} units`);

  // Determine this player's team half
  const teamIndex = await page.evaluate(() => {
    return parseInt(sessionStorage.getItem("ab_team_index") ?? "0", 10);
  }).catch(() => 0);

  // Build a list of (row, col) pairs for this team's half (inner columns only)
  const gridSize = 11;
  const half = Math.floor(gridSize / 2);
  const rowStart = teamIndex === 0 ? 0 : half;
  const rowEnd   = teamIndex === 0 ? half - 1 : gridSize - 1;
  const candidateTiles = [];
  for (let row = rowStart; row <= rowEnd; row++)
    for (let col = 2; col < gridSize - 2; col++) // avoid edge tiles
      candidateTiles.push({ row, col });

  let placed = 0;
  let tileIdx = 0;

  while (placed < maxUnits && tileIdx < candidateTiles.length) {
    // Select a unit card if none is selected
    const hasSelected = await page.locator(".unit-card.selected").count();
    if (!hasSelected) {
      const availableCards = page.locator(".unit-card:not(.used):not(.teammate-taken)");
      const count = await availableCards.count();
      if (count === 0) {
        const total = await page.locator(".unit-card").count();
        const used  = await page.locator(".unit-card.used").count();
        const taken = await page.locator(".unit-card.teammate-taken").count();
        log(name, `No unit cards left (total=${total} used=${used} taken=${taken})`);
        break;
      }
      await availableCards.first().click();
      await page.waitForTimeout(100);
    }

    // Click next tile
    const tile = candidateTiles[tileIdx++];
    await clickGridCell(page, tile.row, tile.col);
    await page.waitForTimeout(100);

    const now = parseInt(
      await page.$eval("#placement-counter", (el) => el.textContent ?? "0"), 10,
    );
    if (now > placed) { placed = now; log(name, `  Placed ${placed}/${maxUnits}`); }
  }

  const disabled = await page.$eval("#ready-btn", (el) => el.disabled);
  if (!disabled) {
    await page.locator("#ready-btn").click();
    log(name, "준비 완료 ✓");
  } else {
    log(name, `⚠️  ready-btn disabled (${placed}/${maxUnits})`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext({ viewport: { width: 900, height: 700 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  const [p1, p2, p3, p4] = pages;

  // ── 1. Open 4 browsers ──────────────────────────────────────────────────
  console.log("\n══ 1. Opening 4 browser windows ══");
  await Promise.all(pages.map((p) => p.goto(BASE_URL)));
  await Promise.all(pages.map((p) => p.waitForSelector(".mode-card", { timeout: TIMEOUT })));

  const playerIds = await Promise.all(
    pages.map((p) => p.evaluate(() => sessionStorage.getItem("ab_player_id"))),
  );
  playerIds.forEach((id, i) => log(`P${i + 1}`, `ID: ${id}`));
  const tokens = await Promise.all(playerIds.map(apiLogin));
  log("auth", "4 tokens minted ✓");

  // ── 2. P1 creates 팀전 room ──────────────────────────────────────────────
  console.log("\n══ 2. P1 creates 팀전 room ══");
  await p1.locator(".mode-card").filter({ hasText: "팀전" }).click();
  await p1.waitForSelector("#screen-lobby.active", { timeout: TIMEOUT });
  await p1.evaluate(() => {
    document.querySelectorAll(".type-btn.ai.active").forEach((btn) => {
      const h = document.querySelector(`.type-btn.human[data-i="${btn.dataset["i"]}"]`);
      if (h) h.click();
    });
  });
  log("P1", "All seats → 인간 ✓");
  await p1.locator("#start-btn").click();
  await p1.waitForSelector("#screen-placement.active", { timeout: TIMEOUT });
  const gameId = await p1.evaluate(() => sessionStorage.getItem("ab_game_id"));
  log("P1", `Game: ${gameId}`);

  // ── 3. P2–P4 join ────────────────────────────────────────────────────────
  console.log("\n══ 3. P2–P4 join via Online Lobby ══");
  for (const [page, name] of [[p2, "P2"], [p3, "P3"], [p4, "P4"]]) {
    await page.locator("#online-lobby-btn").click();
    await page.waitForSelector("#screen-rooms.active", { timeout: TIMEOUT });
    await page.waitForFunction(
      () => document.querySelectorAll(".join-btn:not([disabled])").length > 0,
      { timeout: TIMEOUT },
    );
    await page.locator(".join-btn:not([disabled])").first().click();
    await page.waitForSelector("#screen-placement.active", { timeout: TIMEOUT });
    log(name, "배치 화면 ✓");
  }

  // ── 4. Place units ───────────────────────────────────────────────────────
  // Teammates (P1↔P2, P3↔P4) must pick different units, so they go in order.
  // Cross-team pairs (P1↔P3, P2↔P4) can overlap freely.
  console.log("\n══ 4. Placing units ══");
  // P1 and P3 go first (one per team); wait for their WS broadcasts to settle;
  // then P2 and P4 see their teammate's locked units before selecting.
  await Promise.all([placeUnits(p1, "P1"), placeUnits(p3, "P3")]);
  await new Promise(r => setTimeout(r, 800)); // let placement_selections reach P2/P4
  await Promise.all([placeUnits(p2, "P2"), placeUnits(p4, "P4")]);

  // ── 5. Wait for battle screen ────────────────────────────────────────────
  console.log("\n══ 5. Waiting for battle ══");
  await Promise.all(
    pages.map((p, i) =>
      p.waitForSelector("#screen-game.active", { timeout: 20_000 })
        .then(() => log(`P${i + 1}`, "⚔️  Battle ✓")),
    ),
  );
  // Start overlay watchers (handles unit-order-draft modals)
  pages.forEach((p, i) => { startOrderWatcher(p); log(`P${i + 1}`, "Order watcher ✓"); });

  // Also submit unit orders via REST immediately in case WS isn't connected
  await new Promise((r) => setTimeout(r, 1000)); // let WS events settle
  const { state: initState } = await getGameState(gameId, tokens[0]);
  await Promise.all(
    playerIds.map(async (pid, idx) => {
      const aliveIds = Object.values(initState.units ?? {})
        .filter((u) => u.alive && u.playerId === pid)
        .map((u) => u.unitId);
      if (aliveIds.length > 0) {
        await sendUnitOrder(gameId, pid, aliveIds, tokens[idx]).catch(() => {});
      }
    }),
  );
  log("setup", "Initial unit orders submitted ✓");

  // ── 6. Play game ─────────────────────────────────────────────────────────
  console.log("\n══ 6. Playing game ══");
  let turnCount = 0;
  let lastRound = -1;
  const MAX_TURNS = 30;

  while (turnCount < MAX_TURNS) {
    let data;
    try { data = await getGameState(gameId, tokens[0]); }
    catch (e) { log("poll", `fetch failed: ${e.message}`); await new Promise(r => setTimeout(r, 800)); continue; }

    const { state, status } = data;

    // ── Game over? ──
    if (!state || status === "ended" || state.phase === "result") {
      const winners = state?.endResult?.winnerIds ?? [];
      console.log(`\n🏆 Game over! Round ${state?.round ?? "?"}  Winners: ${winners.join(", ") || "(none)"}`);
      break;
    }

    if (state.phase !== "battle") {
      await new Promise(r => setTimeout(r, 500)); continue;
    }

    // ── New round? Submit unit orders again ──
    if (state.round !== lastRound) {
      lastRound = state.round;
      log("round", `=== Round ${state.round} starts ===`);
      // Submit unit orders via REST for all players
      await Promise.all(
        playerIds.map(async (pid, idx) => {
          const aliveIds = Object.values(state.units)
            .filter((u) => u.alive && u.playerId === pid)
            .map((u) => u.unitId);
          if (aliveIds.length > 0) {
            await sendUnitOrder(gameId, pid, aliveIds, tokens[idx]).catch(() => {});
          }
        }),
      );
      await new Promise(r => setTimeout(r, 600)); // let ordering resolve
      continue;
    }

    // ── Get current turn slot ──
    const slot = state.turnOrder?.[state.currentTurnIndex];
    if (!slot?.playerId) { await new Promise(r => setTimeout(r, 300)); continue; }

    const actingPlayerId = slot.playerId;
    const pIdx = playerIds.indexOf(actingPlayerId);
    const label = pIdx >= 0 ? `P${pIdx + 1}` : actingPlayerId.slice(0, 8);
    const token = pIdx >= 0 ? tokens[pIdx] : tokens[0];

    log(label, `Round ${state.round}, turn ${state.currentTurnIndex}`);
    await playPlayerTurn(gameId, actingPlayerId, token, label, state);
    turnCount++;
    await new Promise(r => setTimeout(r, 300));
  }

  if (turnCount >= MAX_TURNS) log("loop", `${MAX_TURNS} turns cap reached`);

  // ── 7. Final state ────────────────────────────────────────────────────────
  console.log("\n══ 7. Final state ══");
  try {
    const { state } = await getGameState(gameId, tokens[0]);
    if (state) {
      console.log(`  Phase: ${state.phase}  Round: ${state.round}`);
      if (state.endResult) console.log(`  Result: ${JSON.stringify(state.endResult)}`);
      playerIds.forEach((pid, i) => {
        const units = Object.values(state.units).filter(u => u.playerId === pid);
        const summary = units.map(u => `${u.metaId}(${u.alive ? u.currentHealth + "hp" : "dead"})`).join(", ");
        console.log(`  P${i + 1} [team${state.players[pid]?.teamIndex}]: ${summary}`);
      });
    }
  } catch {}

  await Promise.all(pages.map((p, i) => p.screenshot({ path: `/tmp/4player_final_p${i + 1}.png` })));
  console.log("\nScreenshots → /tmp/4player_final_p{1..4}.png");

  console.log("\n🎮 Done. Keeping windows open 15 s...");
  await new Promise(r => setTimeout(r, 15_000));
  await browser.close();
}

main().catch(err => { console.error("\n❌", err.message); process.exit(1); });
