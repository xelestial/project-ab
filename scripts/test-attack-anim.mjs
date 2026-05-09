/**
 * Attack animation test — advances game via API until units can attack
 * then triggers from browser to show particles + damage float
 *
 * Run: node scripts/test-attack-anim.mjs
 */
import pkg from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
const { chromium } = pkg;

const BASE = "http://localhost:5174";
const API  = "http://localhost:3000";
const TIMEOUT = 20_000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dist(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }

async function getTileVP(page, id, row, col) {
  return page.evaluate(({ id, row, col }) => {
    const c = document.getElementById(id); if (!c) return null;
    const r = c.getBoundingClientRect();
    const cW = c.width, cH = c.height, gs = 11;
    const TW = cW/(gs+1), HW=TW/2, HH=TW/4, stp=Math.round(HW*3.5);
    const cx=cW/2, cy=HH+4+stp;
    const sx=cx+(col-row)*HW, sy=cy+(col+row)*HH;
    return { x: r.left+sx*(r.width/cW), y: r.top+sy*(r.height/cH) };
  }, { id, row, col });
}

async function apiLogin(pid) {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({playerId:pid}),
  });
  return (await r.json()).accessToken;
}
async function getState(gid, tok) {
  const r = await fetch(`${API}/api/v1/rooms/${gid}`, { headers:{Authorization:`Bearer ${tok}`} });
  return r.json();
}
async function getOpts(gid, pid, uid, tok) {
  const r = await fetch(`${API}/api/v1/rooms/${gid}/unit-options?playerId=${pid}&unitId=${encodeURIComponent(uid)}`,
    { headers:{Authorization:`Bearer ${tok}`} });
  if (!r.ok) return {};
  return r.json();
}
async function sendAction(gid, pid, action, tok) {
  const r = await fetch(`${API}/api/v1/rooms/${gid}/action`, {
    method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${tok}`},
    body: JSON.stringify({playerId:pid, action}),
  });
  return r.json();
}

async function placeUnits(page) {
  const max = parseInt(await page.$eval("#placement-max", el=>el.textContent??'3'))||3;
  const ti  = await page.evaluate(()=>parseInt(sessionStorage.getItem("ab_team_index")??"0")).catch(()=>0);
  const half=5, gs=11;
  const rs=ti===0?0:half, re=ti===0?half-1:gs-1;
  const tiles=[];
  for(let r=rs;r<=re;r++) for(let c=2;c<gs-2;c++) tiles.push({row:r,col:c});

  let placed=0, idx=0; const done=[];
  while(placed<max && idx<tiles.length){
    const sel=await page.locator(".unit-card.selected").count();
    if(!sel){
      let pk=false;
      for(const m of ["t2","t1"]){
        const c=page.locator(`.unit-card[data-meta-id="${m}"]:not(.used):not(.teammate-taken)`);
        if(await c.count()>0){await c.first().click();await sleep(120);pk=true;break;}
      }
      if(!pk){const c=page.locator(".unit-card:not(.used):not(.teammate-taken)");if(await c.count()===0)break;await c.first().click();await sleep(120);}
    }
    const t=tiles[idx++];
    const vp=await getTileVP(page,"placement-canvas",t.row,t.col);
    if(vp) await page.mouse.click(vp.x,vp.y);
    await sleep(130);
    const now=parseInt(await page.$eval("#placement-counter",el=>el.textContent??"0"));
    if(now>placed){placed=now;done.push(t);}
  }
  const dis=await page.$eval("#ready-btn",el=>el.disabled);
  if(!dis){await page.locator("#ready-btn").click(); console.log("준비 완료 ✓");}
  return done;
}

const { mkdirSync } = await import("fs");
mkdirSync("test-out", { recursive: true });

const browser = await chromium.launch({ headless: false, slowMo: 50 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("[ERR]", e.message));

await page.goto(BASE);
await page.waitForSelector(".mode-card", { timeout: TIMEOUT });
await page.locator(".mode-card").first().click();
await page.waitForSelector("#screen-lobby.active", { timeout: TIMEOUT });
await page.click("#start-btn");
await page.waitForSelector("#screen-placement.active", { timeout: TIMEOUT });

const gameId  = await page.evaluate(()=>sessionStorage.getItem("ab_game_id"));
const playerId = await page.evaluate(()=>sessionStorage.getItem("ab_player_id"));
console.log(`Game: ${gameId}  Player: ${playerId}`);

await page.evaluate(()=>{
  window._orderWatcher = setInterval(()=>{
    const b=document.getElementById("unit-order-submit");
    const o=document.getElementById("unit-order-overlay");
    if(b&&o&&!o.classList.contains("hidden"))b.click();
  }, 300);
});

const placed = await placeUnits(page);
console.log("Placed:", placed.map(t=>`(${t.row},${t.col})`).join(", "));

await page.waitForSelector("#screen-game.active", { timeout: 40_000 });
await sleep(1200);
console.log("Battle ✓");

const token = await apiLogin(playerId);

// ── Advance game via API until units can attack each other ─────────────────────
console.log("Advancing game until attack range...");
let attackFound = false;
let prevTurnIndex = -1;
let sameCount = 0;

for (let iter = 0; iter < 60 && !attackFound; iter++) {
  await sleep(400);
  const res = await getState(gameId, token).catch(() => null);
  if (!res) break;
  if (res.status !== "running") { console.log("Game ended:", res.status); break; }
  const state = res.state;
  if (!state) break;

  const slot = state.turnOrder?.[state.currentTurnIndex];
  if (!slot) break;
  const isMyTurn = slot.playerId === playerId;

  // Detect stuck (same turn index for too long)
  if (state.currentTurnIndex === prevTurnIndex) {
    sameCount++;
    if (sameCount > 6) { console.log("Stuck on same turn — breaking"); break; }
    continue;
  }
  sameCount = 0;
  prevTurnIndex = state.currentTurnIndex;

  if (isMyTurn && slot.unitId) {
    const unit = state.units[slot.unitId];
    if (!unit || !unit.alive) {
      await sendAction(gameId, playerId, { type: "pass", unitId: slot.unitId ?? "" }, token);
      continue;
    }

    const opts = await getOpts(gameId, playerId, slot.unitId, token);
    console.log(`  My turn: ${unit.metaId} at (${unit.position.row},${unit.position.col}) canMove=${opts.canMove} canAttack=${opts.canAttack}`);

    // Can attack?
    if (opts.canAttack && opts.enemyPositions?.length > 0) {
      console.log(`\n✓ Attack opportunity! Round ${state.round}`);
      attackFound = true;

      await sleep(600);

      // Select attacking unit in browser (by clicking its tile)
      const vp = await getTileVP(page, "board-canvas", unit.position.row, unit.position.col);
      if (vp) { await page.mouse.click(vp.x, vp.y); await sleep(800); }
      await page.screenshot({ path: "test-out/w01-pre-attack.png" });

      // Hover attack target → attack focus ring
      const tgt = opts.enemyPositions[0];
      const tvp = await getTileVP(page, "board-canvas", tgt.row, tgt.col);
      if (tvp) {
        await page.mouse.move(tvp.x, tvp.y);
        await sleep(700);
        console.log(`Hovering attack target (${tgt.row},${tgt.col}) → red focus ring`);
        await page.screenshot({ path: "test-out/w02-attack-focus-ring.png" });

        // Click → particles burst
        await page.mouse.click(tvp.x, tvp.y);
        await sleep(60);
        await page.screenshot({ path: "test-out/w03-particles-burst.png" });
        await sleep(250);
        await page.screenshot({ path: "test-out/w04-particles-mid.png" });
        await sleep(500);
        await page.screenshot({ path: "test-out/w05-damage-float.png" });
        await sleep(600);
        await page.screenshot({ path: "test-out/w06-post-attack.png" });
      }
      break;
    }

    // Move toward nearest enemy
    if (opts.canMove && opts.reachableTiles?.length > 0) {
      const enemies = Object.values(state.units).filter(u => u.alive && u.playerId !== playerId);
      let best = null, bestD = Infinity;
      for (const tile of opts.reachableTiles)
        for (const e of enemies) { const d = dist(tile, e.position); if (d < bestD) { bestD = d; best = tile; } }
      if (best) {
        console.log(`  Moving ${unit.metaId} → (${best.row},${best.col}) dist=${bestD}`);
        await sendAction(gameId, playerId, { type: "move", unitId: slot.unitId, targetPosition: best }, token);
        await sleep(200);
      }
    }
    await sendAction(gameId, playerId, { type: "pass", unitId: slot.unitId }, token);
  } else {
    console.log(`  AI turn (${slot.playerId?.slice(0,8)}), waiting...`);
  }
}

if (!attackFound) {
  console.log("Attack range not reached — showing move focus ring instead");
  const { state } = await getState(gameId, token);
  if (state) {
    const myUnit = Object.values(state.units).find(u => u.alive && u.playerId === playerId);
    if (myUnit) {
      await getTileVP(page, "board-canvas", myUnit.position.row, myUnit.position.col)
        .then(vp => vp && page.mouse.click(vp.x, vp.y));
      await sleep(700);
    }
  }
}

await sleep(1500);

// ── Final: screenshot with focus ring on move tile ─────────────────────────────
const { state: finalState } = await getState(gameId, token);
if (finalState?.status === "running") {
  const slot = finalState.turnOrder[finalState.currentTurnIndex];
  if (slot?.playerId === playerId && slot.unitId) {
    const unit = finalState.units[slot.unitId];
    if (unit) {
      await getTileVP(page, "board-canvas", unit.position.row, unit.position.col)
        .then(vp => vp && page.mouse.click(vp.x, vp.y));
      await sleep(600);
      // Hover over a nearby tile
      for (const [dr, dc] of [[0,1],[1,0],[-1,0],[0,-1],[1,1]]) {
        const r = unit.position.row + dr, c = unit.position.col + dc;
        if (r < 0 || r >= 11 || c < 0 || c >= 11) continue;
        const vp2 = await getTileVP(page, "board-canvas", r, c);
        if (!vp2) continue;
        await page.mouse.move(vp2.x, vp2.y);
        await sleep(450);
        const cur = await page.evaluate(()=>{
          const el=document.getElementById("custom-cursor"); if(!el) return null;
          return window.getComputedStyle(el).display!=="none"?el.className:null;
        });
        if (cur === "cc-move") {
          await page.screenshot({ path: "test-out/w07-move-focus-final.png" });
          console.log(`Move focus ring at (${r},${c}) ✓`);
          break;
        }
      }
    }
  }
}

await sleep(2000);
await browser.close();
console.log("\n✓ Done. Screenshots: test-out/w*.png + test-out/v*.png");
