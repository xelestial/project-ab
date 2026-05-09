/**
 * Debug: verify anim-canvas is positioned and rendering correctly
 * Run: node scripts/test-anim-debug.mjs
 */
import pkg from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
const { chromium } = pkg;

const BASE = "http://localhost:5174";
const API  = "http://localhost:3000";
const TIMEOUT = 20_000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dist(a, b) { return Math.abs(a.row-b.row)+Math.abs(a.col-b.col); }

async function getTileVP(page, id, row, col) {
  return page.evaluate(({ id, row, col }) => {
    const c = document.getElementById(id); if (!c) return null;
    const r = c.getBoundingClientRect();
    const cW=c.width, cH=c.height, gs=11;
    const TW=cW/(gs+1), HW=TW/2, HH=TW/4, stp=Math.round(HW*3.5);
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
  const max=parseInt(await page.$eval("#placement-max",el=>el.textContent??'3'))||3;
  const ti=await page.evaluate(()=>parseInt(sessionStorage.getItem("ab_team_index")??"0")).catch(()=>0);
  const half=5,gs=11; const rs=ti===0?0:half,re=ti===0?half-1:gs-1;
  const tiles=[]; for(let r=rs;r<=re;r++) for(let c=2;c<gs-2;c++) tiles.push({row:r,col:c});
  let placed=0,idx=0; const done=[];
  while(placed<max&&idx<tiles.length){
    const sel=await page.locator(".unit-card.selected").count();
    if(!sel){let pk=false;for(const m of["t2","t1"]){const c=page.locator(`.unit-card[data-meta-id="${m}"]:not(.used):not(.teammate-taken)`);if(await c.count()>0){await c.first().click();await sleep(120);pk=true;break;}}if(!pk){const c=page.locator(".unit-card:not(.used):not(.teammate-taken)");if(await c.count()===0)break;await c.first().click();await sleep(120);}}
    const t=tiles[idx++];
    const vp=await getTileVP(page,"placement-canvas",t.row,t.col);
    if(vp) await page.mouse.click(vp.x,vp.y); await sleep(130);
    const now=parseInt(await page.$eval("#placement-counter",el=>el.textContent??"0"));
    if(now>placed){placed=now;done.push(t);}
  }
  const dis=await page.$eval("#ready-btn",el=>el.disabled);
  if(!dis){await page.locator("#ready-btn").click();}
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

const gameId   = await page.evaluate(()=>sessionStorage.getItem("ab_game_id"));
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
await page.waitForSelector("#screen-game.active", { timeout: 40_000 });
await sleep(1000);

const token = await apiLogin(playerId);

// ── Debug: verify anim-canvas is in DOM and check its state ──────────────────
const animInfo = await page.evaluate(() => {
  const ac = document.getElementById("anim-canvas");
  const bc = document.getElementById("board-canvas");
  if (!ac || !bc) return { found: false };
  const acr = ac.getBoundingClientRect();
  const bcr = bc.getBoundingClientRect();
  return {
    found: true,
    animCanvas: { width: ac.width, height: ac.height, cssW: acr.width, cssH: acr.height, left: acr.left, top: acr.top, zIndex: window.getComputedStyle(ac).zIndex, position: window.getComputedStyle(ac).position },
    boardCanvas: { width: bc.width, height: bc.height, cssW: bcr.width, cssH: bcr.height, left: bcr.left, top: bcr.top },
    posMatch: Math.abs(acr.left-bcr.left)<2 && Math.abs(acr.top-bcr.top)<2,
  };
});
console.log("\n=== ANIM CANVAS DEBUG ===");
console.log(JSON.stringify(animInfo, null, 2));

// ── Draw test pattern on anim-canvas directly ─────────────────────────────────
await page.evaluate(() => {
  const ac = document.getElementById("anim-canvas");
  const bc = document.getElementById("board-canvas");
  if (!ac || !bc) return;
  // Sync dimensions
  ac.width = bc.width;
  ac.height = bc.height;
  const rect = bc.getBoundingClientRect();
  const wrapRect = bc.parentElement?.getBoundingClientRect() ?? rect;
  ac.style.left = `${rect.left - wrapRect.left}px`;
  ac.style.top  = `${rect.top  - wrapRect.top}px`;
  ac.style.width  = `${rect.width}px`;
  ac.style.height = `${rect.height}px`;
  // Draw a bright test pattern
  const ctx2 = ac.getContext("2d");
  ctx2.clearRect(0, 0, ac.width, ac.height);
  ctx2.fillStyle = "rgba(255, 0, 255, 0.6)";
  ctx2.fillRect(50, 50, 200, 200);
  ctx2.font = "bold 40px Arial";
  ctx2.fillStyle = "white";
  ctx2.fillText("ANIM OK", 60, 160);
});
await page.screenshot({ path: "test-out/d01-anim-canvas-test.png" });
console.log("Test pattern screenshot taken → d01-anim-canvas-test.png");

// ── Advance to attack range ───────────────────────────────────────────────────
let attackFound = false;
let prevTurnIndex = -1, sameCount = 0;

for (let iter = 0; iter < 60 && !attackFound; iter++) {
  await sleep(350);
  const res = await getState(gameId, token).catch(()=>null);
  if (!res || res.status !== "running") { console.log("Game ended:", res?.status); break; }
  const state = res.state; if (!state) break;
  const slot = state.turnOrder?.[state.currentTurnIndex];
  if (!slot) break;
  const isMyTurn = slot.playerId === playerId;
  if (state.currentTurnIndex === prevTurnIndex) { sameCount++; if (sameCount>6) break; continue; }
  sameCount = 0; prevTurnIndex = state.currentTurnIndex;

  if (isMyTurn && slot.unitId) {
    const unit = state.units[slot.unitId];
    if (!unit || !unit.alive) { await sendAction(gameId, playerId, {type:"pass", unitId:slot.unitId??""}, token); continue; }
    const opts = await getOpts(gameId, playerId, slot.unitId, token);
    console.log(`  My turn: ${unit.metaId} at (${unit.position.row},${unit.position.col}) canAttack=${opts.canAttack}`);

    if (opts.canAttack && opts.enemyPositions?.length > 0) {
      const tgt = opts.enemyPositions[0];
      console.log(`\n✓ ATTACK! attacker=(${unit.position.row},${unit.position.col}) target=(${tgt.row},${tgt.col})`);
      attackFound = true;
      await sleep(400);

      // Hover over attack target for focus ring screenshot
      const tvp = await getTileVP(page, "board-canvas", tgt.row, tgt.col);
      if (tvp) {
        await page.mouse.move(tvp.x, tvp.y);
        await sleep(700);
        await page.screenshot({ path: "test-out/d02-attack-hover.png" });
        console.log("  Hover screenshot taken → d02");
      }

      // ── DIRECT animation test: inject + call tickAnim synchronously ──────────
      console.log("  Injecting animations directly + calling tickAnim sync...");
      const injected = await page.evaluate(({ row, col }) => {
        const addP = window.__addAttackParticles;
        const addD = window.__addDamageFloat;
        const tick = window.__tickAnimNow;
        if (!addP || !addD || !tick) return { ok: false, msg: `missing: ${!addP?"addP":""} ${!addD?"addD":""} ${!tick?"tick":""}` };
        addP(row, col);
        addD(row, col, 42);
        tick(); // call synchronously so canvas is drawn before screenshot
        const ac = document.getElementById("anim-canvas");
        return {
          ok: true, msg: "injected + ticked",
          animW: ac?.width, animH: ac?.height,
          animLeft: ac?.style.left, animTop: ac?.style.top,
        };
      }, { row: tgt.row, col: tgt.col });
      console.log("  Inject result:", JSON.stringify(injected));

      // Take immediate screenshot (synchronous tickAnim just drew)
      await page.screenshot({ path: "test-out/d03-sync-draw.png" });
      console.log("  Sync-draw screenshot → d03");

      await sleep(40);  await page.screenshot({ path: "test-out/d04-inject-40ms.png" });
      await sleep(100); await page.screenshot({ path: "test-out/d05-inject-140ms.png" });
      await sleep(200); await page.screenshot({ path: "test-out/d06-inject-340ms.png" });
      await sleep(400); await page.screenshot({ path: "test-out/d07-inject-740ms.png" });

      // ── Real attack via API → triggers renderGame HP detection → anim fires ──
      console.log("  Sending attack via API...");
      const attackRes = await sendAction(gameId, playerId,
        { type: "attack", unitId: slot.unitId, targetPosition: tgt }, token);
      console.log("  Attack result:", JSON.stringify(attackRes).slice(0, 200));
      await sleep(300);
      await page.screenshot({ path: "test-out/d08-api-attack-300ms.png" });
      await sleep(500);
      await page.screenshot({ path: "test-out/d09-api-attack-800ms.png" });
      await sleep(400);
      await page.screenshot({ path: "test-out/d10-api-attack-1200ms.png" });

      break;
    }

    if (opts.canMove && opts.reachableTiles?.length > 0) {
      const enemies = Object.values(state.units).filter(u=>u.alive&&u.playerId!==playerId);
      let best=null,bestD=Infinity;
      for(const tile of opts.reachableTiles) for(const e of enemies){const d=dist(tile,e.position);if(d<bestD){bestD=d;best=tile;}}
      if(best){ console.log(`  Moving → (${best.row},${best.col})`); await sendAction(gameId,playerId,{type:"move",unitId:slot.unitId,targetPosition:best},token); await sleep(150); }
    }
    await sendAction(gameId, playerId, {type:"pass",unitId:slot.unitId}, token);
  } else {
    console.log(`  AI turn, waiting...`);
  }
}

await sleep(2000);
await browser.close();
console.log("\n✓ Debug screenshots: test-out/d*.png");
