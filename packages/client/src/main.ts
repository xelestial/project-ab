/**
 * Main entry point — Menu → Lobby → Placement → Game
 * Renders the board in isometric (quarter-view) projection using Canvas 2D.
 */
import gameModes from "./game-modes.json";
import { ApiClient } from "./api.js";
import { WsClient } from "./ws-client.js";
import type { GameStateSnapshot } from "./ws-client.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Seat {
  index: number;
  label: string;
  defaultType: "human" | "ai";
}

interface GameMode {
  id: string;
  nameKo: string;
  nameEn: string;
  mapId: string;
  playerCount: number;
  maxUnitsPerPlayer: number;
  teamSize: number;
  seats: Seat[];
}

interface UnitMeta {
  id: string;
  nameKey: string;
  class: string;
  baseHealth: number;
  baseMovement: number;
  baseArmor: number;
}

interface PlacedUnit {
  metaId: string;
  position: { row: number; col: number };
}

// ─── State ─────────────────────────────────────────────────────────────────────

// VITE_SERVER_PORT — override backend port in dev (e.g. VITE_SERVER_PORT=3001 pnpm dev)
// Falls back to 3000 if not set.
const _serverPort = (import.meta.env["VITE_SERVER_PORT"] as string | undefined) ?? "3000";
const _serverHost = window.location.hostname;
const _proto = window.location.protocol;

const API_BASE = import.meta.env.DEV
  ? `${_proto}//${_serverHost}:${_serverPort}`
  : gameModes.serverUrl;
const WS_BASE = import.meta.env.DEV
  ? `${_proto === "https:" ? "wss" : "ws"}://${_serverHost}:${_serverPort}`
  : gameModes.wsUrl;

const api = new ApiClient(API_BASE);
const ws = new WsClient();

let currentMode: GameMode | null = null;
let seatTypes: ("human" | "ai")[] = [];
let humanPlayerId = `player_${Math.random().toString(36).slice(2, 8)}`;
let currentGameId: string | null = null;
let humanTeamIndex = 0;
let logEntries: string[] = [];
let availableUnits: UnitMeta[] = [];

// Placement state
let selectedMetaId: string | null = null;
let placedUnits: PlacedUnit[] = [];
let lastGameState: GameStateSnapshot | null = null;

// ─── Unit metadata ─────────────────────────────────────────────────────────────

const UNIT_ABBR: Record<string, string> = {
  t1: "TK", f1: "FT", r1: "RG",
  m1: "MG", k1: "KN", s1: "SP",
};

const UNIT_NAME_KO: Record<string, string> = {
  t1: "탱커", f1: "파이터", r1: "레인저",
  m1: "메이지", k1: "나이트", s1: "서포트",
};

const UNIT_COLOR: Record<string, string> = {
  tanker: "#5b8dd9", fighter: "#d95b5b", ranger: "#5bd95b",
  mage: "#9b5bd9", support: "#d9c05b",
};

// ─── Isometric Renderer ───────────────────────────────────────────────────────

const TILE_COLORS: Record<string, string> = {
  plain:    "#3a5c3e",
  road:     "#7a6448",
  sand:     "#b8953e",
  mountain: "#5a5a6a",
  river:    "#1e4fa0",
  water:    "#2d6aad",
  fire:     "#b82200",
  acid:     "#559900",
  ice:      "#7abce8",
  electric: "#d4b800",
};

const TILE_SIDE_COLORS: Record<string, string> = {
  plain:    "#2a3e2c",
  road:     "#564530",
  sand:     "#8c6c2a",
  mountain: "#3c3c48",
  river:    "#142e60",
  water:    "#1e4a78",
  fire:     "#7a1500",
  acid:     "#3a6600",
  ice:      "#4a8cb0",
  electric: "#9a8400",
};

const PLAYER_COLORS = ["#388bfd", "#f85149", "#a371f7", "#e3b341"];

function isoParams(gridSize: number): {
  TW: number; TH: number; HW: number; HH: number; DEPTH: number;
  cx: number; cy: number; canvasW: number; canvasH: number;
} {
  const TW = gridSize <= 11 ? 64 : 48;
  const TH = TW / 2;
  const HW = TW / 2;
  const HH = TH / 2;
  const DEPTH = Math.round(TH * 0.4);
  const canvasW = gridSize * TW + TW;
  const canvasH = gridSize * TH + TH + DEPTH + TH;
  const cx = canvasW / 2;
  const cy = HH + 4;
  return { TW, TH, HW, HH, DEPTH, cx, cy, canvasW, canvasH };
}

function gridToScreen(
  row: number, col: number,
  cx: number, cy: number, HW: number, HH: number,
): { sx: number; sy: number } {
  return {
    sx: cx + (col - row) * HW,
    sy: cy + (col + row) * HH,
  };
}

function screenToGrid(
  mx: number, my: number,
  cx: number, cy: number, HW: number, HH: number,
): { row: number; col: number } {
  const dx = mx - cx;
  const dy = my - (cy + HH);
  return {
    col: Math.round((dx / HW + dy / HH) / 2),
    row: Math.round((dy / HH - dx / HW) / 2),
  };
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  HW: number, HH: number, DEPTH: number,
  topColor: string, sideColor: string,
): void {
  // Top face (diamond)
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + HH * 2);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Left side face
  ctx.beginPath();
  ctx.moveTo(sx - HW, sy + HH);
  ctx.lineTo(sx, sy + HH * 2);
  ctx.lineTo(sx, sy + HH * 2 + DEPTH);
  ctx.lineTo(sx - HW, sy + HH + DEPTH);
  ctx.closePath();
  ctx.fillStyle = sideColor;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Right side face
  ctx.beginPath();
  ctx.moveTo(sx, sy + HH * 2);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx + HW, sy + HH + DEPTH);
  ctx.lineTo(sx, sy + HH * 2 + DEPTH);
  ctx.closePath();
  ctx.fillStyle = `${sideColor}cc`;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  HW: number, HH: number, DEPTH: number,
  color: string, abbr: string, dead: boolean,
): void {
  const cx = sx;
  const cy = sy + HH + DEPTH / 2;
  const r = Math.round(HW * 0.55);

  ctx.globalAlpha = dead ? 0.25 : 1;

  // Shadow
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.2, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fill();

  // Circle body
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.3, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Abbreviation
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(r * 0.75)}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, cx, cy - r * 0.3);

  ctx.globalAlpha = 1;
}

interface UnitInfoData {
  unitId: string;
  metaId: string;
  nameKey: string;
  class: string;
  currentHealth: number;
  maxHealth: number;
  currentArmor: number;
  baseArmor: number;
  movementPoints: number;
  baseMovement: number;
  activeEffects: Array<{ effectType: string; turnsRemaining: number }>;
  actionsUsed: { moved: boolean; attacked: boolean; skillUsed: boolean; extinguished: boolean };
  weapon: {
    name: string;
    damage: number;
    minRange: number;
    maxRange: number;
    attackType: string;
    attribute: string;
  };
}

interface RenderOpts {
  gridSize: number;
  baseTile?: string;
  tiles?: Record<string, { attribute: string }>;
  units?: Array<{
    metaId: string;
    playerId: string;
    position: { row: number; col: number };
    alive: boolean;
  }>;
  playerIds?: string[];
  highlightHalf?: number; // teamIndex whose half to highlight (placement phase)
  placedUnits?: PlacedUnit[];
  hoveredCell?: { row: number; col: number } | null;
  moveTiles?: Array<{ row: number; col: number }>;       // blue - can move here
  attackRangeTiles?: Array<{ row: number; col: number }>; // dim red - attack range (no enemy)
  attackTargetTiles?: Array<{ row: number; col: number }>; // bright red - enemy in range
  selectedPos?: { row: number; col: number } | null;     // yellow glow - selected unit
}

function renderIso(canvas: HTMLCanvasElement, opts: RenderOpts): void {
  const { gridSize, tiles = {}, units = [], playerIds = [], highlightHalf, placedUnits: placed = [] } = opts;
  const baseTile = opts.baseTile ?? "plain";
  const p = isoParams(gridSize);

  canvas.width = p.canvasW;
  canvas.height = p.canvasH;

  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, p.canvasW, p.canvasH);

  // Build unit lookup
  const unitsByPos = new Map<string, typeof units[0]>();
  for (const u of units) {
    unitsByPos.set(`${u.position.row},${u.position.col}`, u);
  }

  // Build placed lookup for placement phase
  const placedByPos = new Map<string, string>();
  for (const pu of placed) {
    placedByPos.set(`${pu.position.row},${pu.position.col}`, pu.metaId);
  }

  // Draw order: back-to-front (row+col ascending)
  const cells: { row: number; col: number }[] = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      cells.push({ row: r, col: c });
    }
  }
  cells.sort((a, b) => (a.row + a.col) - (b.row + b.col));

  const half = Math.floor(gridSize / 2);

  for (const { row, col } of cells) {
    const key = `${row},${col}`;
    const tileAttr = tiles[key]?.attribute ?? baseTile;
    const top = TILE_COLORS[tileAttr] ?? TILE_COLORS["plain"]!;
    const side = TILE_SIDE_COLORS[tileAttr] ?? TILE_SIDE_COLORS["plain"]!;
    const { sx, sy } = gridToScreen(row, col, p.cx, p.cy, p.HW, p.HH);

    // Determine if this is the highlighted half
    let finalTop = top;
    let finalSide = side;
    if (highlightHalf !== undefined) {
      const isMyHalf = highlightHalf === 0 ? row < half : row >= half;
      if (isMyHalf) {
        // Slightly brighter
        finalTop = `${top}dd`;
      } else {
        // Dim the other half
        finalTop = `${top}66`;
        finalSide = `${side}66`;
      }
    }

    // Hovered cell highlight
    if (opts.hoveredCell?.row === row && opts.hoveredCell?.col === col) {
      finalTop = "#ffffff44";
      finalSide = side;
    }

    drawTile(ctx, sx, sy, p.HW, p.HH, p.DEPTH, finalTop, finalSide);

    // Move range highlight (blue)
    if (opts.moveTiles?.some(t => t.row === row && t.col === col)) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + p.HW, sy + p.HH);
      ctx.lineTo(sx, sy + p.HH * 2);
      ctx.lineTo(sx - p.HW, sy + p.HH);
      ctx.closePath();
      ctx.fillStyle = "rgba(80, 160, 255, 0.45)";
      ctx.fill();
      ctx.strokeStyle = "rgba(80, 160, 255, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Attack range (no enemy - dim red)
    if (opts.attackRangeTiles?.some(t => t.row === row && t.col === col)) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + p.HW, sy + p.HH);
      ctx.lineTo(sx, sy + p.HH * 2);
      ctx.lineTo(sx - p.HW, sy + p.HH);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 80, 80, 0.2)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 80, 80, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Attack target (enemy present - bright red)
    if (opts.attackTargetTiles?.some(t => t.row === row && t.col === col)) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + p.HW, sy + p.HH);
      ctx.lineTo(sx, sy + p.HH * 2);
      ctx.lineTo(sx - p.HW, sy + p.HH);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 50, 50, 0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 50, 50, 1.0)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Selected unit position (yellow glow)
    if (opts.selectedPos?.row === row && opts.selectedPos?.col === col) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + p.HW, sy + p.HH);
      ctx.lineTo(sx, sy + p.HH * 2);
      ctx.lineTo(sx - p.HW, sy + p.HH);
      ctx.closePath();
      ctx.strokeStyle = "rgba(255, 230, 50, 1.0)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Draw placed unit (placement phase)
    const placedMetaId = placedByPos.get(key);
    if (placedMetaId !== undefined) {
      drawUnit(ctx, sx, sy, p.HW, p.HH, p.DEPTH, "#888", UNIT_ABBR[placedMetaId] ?? "??", false);
    }

    // Draw actual game unit
    const unit = unitsByPos.get(key);
    if (unit !== undefined) {
      const pIdx = playerIds.indexOf(unit.playerId);
      const color = PLAYER_COLORS[pIdx >= 0 ? pIdx : 0]!;
      const abbr = UNIT_ABBR[unit.metaId] ?? unit.metaId.slice(0, 2).toUpperCase();
      drawUnit(ctx, sx, sy, p.HW, p.HH, p.DEPTH, color, abbr, !unit.alive);
    }
  }
}

// ─── Screen helpers ────────────────────────────────────────────────────────────

function showScreen(id: string): void {
  document.querySelectorAll<HTMLElement>(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

function setStatus(msg: string, type: "ok" | "err" | "" = ""): void {
  const el = document.getElementById("lobby-status");
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

function setPlacementStatus(msg: string, type: "ok" | "err" | "" = ""): void {
  const el = document.getElementById("placement-status");
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

function addLog(msg: string): void {
  logEntries.unshift(msg);
  if (logEntries.length > 50) logEntries.pop();
  renderLog();
}

// ─── Main menu ─────────────────────────────────────────────────────────────────

function renderMenu(): void {
  const grid = document.getElementById("menu-grid");
  if (!grid) return;
  grid.innerHTML = "";

  (gameModes.modes as GameMode[]).forEach((mode) => {
    const card = document.createElement("div");
    card.className = "mode-card";
    card.innerHTML = `
      <h2>${mode.nameKo}</h2>
      <div class="meta">${mode.nameEn}</div>
      <span class="badge">${mode.playerCount}P</span>
      <span class="badge">${mode.maxUnitsPerPlayer} units/player</span>
      <span class="badge">${mode.teamSize > 1 ? `${mode.teamSize}v${mode.teamSize} team` : "1v1"}</span>
    `;
    card.addEventListener("click", () => openLobby(mode));
    grid.appendChild(card);
  });
}

// ─── Lobby ─────────────────────────────────────────────────────────────────────

function openLobby(mode: GameMode): void {
  currentMode = mode;
  seatTypes = mode.seats.map((s) => s.defaultType);
  document.getElementById("lobby-title")!.textContent = mode.nameKo;
  setStatus("", "");
  renderSeats();
  showScreen("screen-lobby");
}

function renderSeats(): void {
  const grid = document.getElementById("seats-grid");
  if (!grid || !currentMode) return;
  grid.innerHTML = "";

  currentMode.seats.forEach((seat, i) => {
    const teamClass = currentMode!.teamSize > 1
      ? seat.index < currentMode!.teamSize ? "team-a" : "team-b"
      : "";

    const card = document.createElement("div");
    card.className = `seat-card ${teamClass}`;
    card.innerHTML = `
      <div class="seat-label">${seat.label}</div>
      <div class="seat-type-toggle">
        <button class="type-btn human ${seatTypes[i] === "human" ? "active" : ""}" data-i="${i}">👤 인간</button>
        <button class="type-btn ai ${seatTypes[i] === "ai" ? "active" : ""}" data-i="${i}">🤖 AI</button>
      </div>
    `;

    card.querySelectorAll<HTMLButtonElement>(".type-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset["i"] ?? "0", 10);
        const type = btn.classList.contains("human") ? "human" : "ai";
        seatTypes[idx] = type;
        renderSeats();
      });
    });

    grid.appendChild(card);
  });
}

// ─── Game start flow ───────────────────────────────────────────────────────────

async function startGame(): Promise<void> {
  if (!currentMode) return;

  const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
  startBtn.disabled = true;
  setStatus("게임을 생성 중입니다...");

  try {
    await api.login(humanPlayerId);

    const room = await api.createRoom({
      mapId: currentMode.mapId,
      playerCount: currentMode.playerCount,
    });
    currentGameId = room.gameId;
    addLog(`게임 생성: ${room.gameId}`);

    const hasHuman = seatTypes.some((t) => t === "human");
    const aiSeats = currentMode.seats.filter((_, i) => seatTypes[i] === "ai");

    // Register human seats FIRST to ensure correct teamIndex assignment
    if (hasHuman) {
      setStatus("플레이어 등록 중...");
      const joinRes = await api.joinRoom(room.gameId, humanPlayerId);
      humanTeamIndex = joinRes.teamIndex;
      addLog(`플레이어 등록 완료 (팀 ${humanTeamIndex})`);
    }

    // Add AI players (after human is registered to preserve slot order)
    for (const seat of aiSeats) {
      setStatus(`AI 추가 중 (시트 ${seat.index + 1})...`);
      const aiRes = await api.addAi(room.gameId, { iterations: 100, timeoutMs: 500 });
      addLog(`AI 추가: ${aiRes.aiPlayerId}`);
    }

    if (hasHuman) {
      setStatus("접속 중...");
      await connectHumanPlayer(room.gameId);
    }

    if (!hasHuman) {
      setStatus("AI vs AI 게임 진행 중...", "ok");
      showScreen("screen-game");
      pollGameState(room.gameId);
    }
  } catch (err) {
    setStatus(`오류: ${String(err)}`, "err");
    startBtn.disabled = false;
  }
}

async function connectHumanPlayer(gameId: string): Promise<void> {
  // Attempt WS — if it fails/times out we still proceed (polling covers state updates)
  const timeout = setTimeout(() => {
    console.warn("[client] WS join timeout — using polling only");
  }, 3000);

  ws.connect(WS_BASE, gameId, humanPlayerId, {
    token: api.getToken() ?? "",
    onJoined: () => {
      clearTimeout(timeout);
      setStatus("WS 접속 완료!", "ok");
    },
    onStateUpdate: (state) => {
      lastGameState = state;
      if (state.phase === "battle" || state.phase === "result") {
        if (!document.getElementById("screen-game")?.classList.contains("active")) {
          showScreen("screen-game");
        }
        renderGame(state);
      }
    },
    onGameEnd: (winnerIds, reason) => {
      showGameOver(winnerIds, reason);
    },
    onUnitOrderRequest: (aliveUnitIds, timeoutMs) => {
      showUnitOrderDraft(aliveUnitIds, timeoutMs);
    },
  });

  // Open placement screen immediately (player was already pre-registered)
  setStatus("배치 단계로 진입...", "ok");
  await openPlacementScreen(gameId);
}

// ─── Placement phase ───────────────────────────────────────────────────────────

async function openPlacementScreen(gameId: string): Promise<void> {  // eslint-disable-line @typescript-eslint/require-await
  if (!currentMode) return;

  placedUnits = [];
  selectedMetaId = null;

  // Fetch game state to get map info
  let gridSize = 11;
  let baseTile = "plain";
  let tiles: Record<string, { attribute: string }> = {};

  const token = api.getToken();
  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/rooms/${gameId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { state: GameStateSnapshot };
        gridSize = data.state.map.gridSize ?? 11;
        baseTile = data.state.map.baseTile ?? "plain";
        tiles = data.state.map.tiles ?? {};
        lastGameState = data.state;

        // Determine human player's teamIndex (prefer already-known value)
        const pState = data.state.players[humanPlayerId];
        if (pState !== undefined) humanTeamIndex = pState.teamIndex;
      }
    } catch { /* fallback to defaults */ }
  }

  // Fetch unit metadata
  try {
    const res = await fetch(`${API_BASE}/api/v1/meta/units`);
    if (res.ok) {
      const data = (await res.json()) as { units: UnitMeta[] };
      availableUnits = data.units;
    }
  } catch { /* fallback */ }

  if (availableUnits.length === 0) {
    availableUnits = [
      { id: "t1", nameKey: "unit.t1.name", class: "tanker",  baseHealth: 5, baseMovement: 3, baseArmor: 1 },
      { id: "f1", nameKey: "unit.f1.name", class: "fighter", baseHealth: 4, baseMovement: 4, baseArmor: 0 },
      { id: "r1", nameKey: "unit.r1.name", class: "ranger",  baseHealth: 3, baseMovement: 4, baseArmor: 0 },
      { id: "m1", nameKey: "unit.m1.name", class: "mage",    baseHealth: 3, baseMovement: 3, baseArmor: 0 },
      { id: "k1", nameKey: "unit.k1.name", class: "tanker",  baseHealth: 5, baseMovement: 2, baseArmor: 2 },
      { id: "s1", nameKey: "unit.s1.name", class: "support", baseHealth: 3, baseMovement: 4, baseArmor: 0 },
    ];
  }

  const maxUnits = currentMode.maxUnitsPerPlayer;
  document.getElementById("placement-title")!.textContent =
    `유닛 배치 — ${currentMode.nameKo}`;
  document.getElementById("placement-max")!.textContent = String(maxUnits);
  updatePlacementCounter(maxUnits);

  renderUnitCards(maxUnits);
  renderPlacementCanvas(gridSize, baseTile, tiles);

  showScreen("screen-placement");
  pollGameState(gameId); // Start polling; once battle starts, switch to game screen
}

function renderUnitCards(maxUnits: number): void {
  const list = document.getElementById("unit-card-list");
  if (!list) return;
  list.innerHTML = "<h3>유닛 선택</h3>";

  for (const unit of availableUnits) {
    const abbr = UNIT_ABBR[unit.id] ?? unit.id.toUpperCase().slice(0, 2);
    const name = UNIT_NAME_KO[unit.id] ?? unit.id;
    const isUsed = placedUnits.some((p) => p.metaId === unit.id);
    const isSelected = selectedMetaId === unit.id;
    const color = UNIT_COLOR[unit.class] ?? "#888";

    const card = document.createElement("div");
    card.className = `unit-card ${isSelected ? "selected" : ""} ${isUsed ? "used" : ""}`;
    card.dataset["metaId"] = unit.id;
    card.innerHTML = `
      <div class="unit-abbr" style="background:${color};border-color:${color}">${abbr}</div>
      <div class="unit-info">
        <div class="unit-name">${name}</div>
        <div class="unit-stats">HP ${unit.baseHealth} · MOV ${unit.baseMovement} · ARM ${unit.baseArmor}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      if (!isUsed) {
        selectedMetaId = selectedMetaId === unit.id ? null : unit.id;
        renderUnitCards(maxUnits);
      }
    });
    list.appendChild(card);
  }
}

let placementGridSize = 11;
let placementBaseTile = "plain";
let placementTiles: Record<string, { attribute: string }> = {};
let hoveredCell: { row: number; col: number } | null = null;

function renderPlacementCanvas(
  gridSize: number,
  baseTile: string,
  tiles: Record<string, { attribute: string }>,
): void {
  placementGridSize = gridSize;
  placementBaseTile = baseTile;
  placementTiles = tiles;

  const canvas = document.getElementById("placement-canvas") as HTMLCanvasElement;
  if (!canvas) return;

  renderIso(canvas, {
    gridSize,
    baseTile,
    tiles,
    units: [],
    highlightHalf: humanTeamIndex,
    placedUnits,
    hoveredCell,
  });

  // Setup interaction (re-attach each render to avoid duplicates)
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const p = isoParams(gridSize);
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { row, col } = screenToGrid(mx, my, p.cx, p.cy, p.HW, p.HH);
    if (row >= 0 && row < gridSize && col >= 0 && col < gridSize) {
      if (!hoveredCell || hoveredCell.row !== row || hoveredCell.col !== col) {
        hoveredCell = { row, col };
        renderPlacementCanvas(gridSize, baseTile, tiles);
      }
    }
  };

  canvas.onmouseleave = () => {
    hoveredCell = null;
    renderPlacementCanvas(gridSize, baseTile, tiles);
  };

  canvas.onclick = (e) => {
    if (!selectedMetaId) return;
    const rect = canvas.getBoundingClientRect();
    const p = isoParams(gridSize);
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { row, col } = screenToGrid(mx, my, p.cx, p.cy, p.HW, p.HH);

    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return;

    // Must be on player's half
    const half = Math.floor(gridSize / 2);
    const rowStart = humanTeamIndex === 0 ? 0 : half;
    const rowEnd = humanTeamIndex === 0 ? half - 1 : gridSize - 1;
    if (row < rowStart || row > rowEnd) {
      setPlacementStatus("내 진영에만 배치할 수 있습니다.", "err");
      return;
    }

    // Must not be occupied (mountain/water tile)
    const tileAttr = tiles[`${row},${col}`]?.attribute;
    if (tileAttr === "mountain" || tileAttr === "river") {
      setPlacementStatus("이 타일에는 배치할 수 없습니다.", "err");
      return;
    }

    // Remove existing unit on this cell if any
    placedUnits = placedUnits.filter((u) => !(u.position.row === row && u.position.col === col));

    placedUnits.push({ metaId: selectedMetaId!, position: { row, col } });
    selectedMetaId = null;
    setPlacementStatus("", "");

    const maxUnits = currentMode?.maxUnitsPerPlayer ?? 3;
    updatePlacementCounter(maxUnits);
    renderUnitCards(maxUnits);
    renderPlacementCanvas(gridSize, baseTile, tiles);
  };
}

function updatePlacementCounter(maxUnits: number): void {
  const counter = document.getElementById("placement-counter");
  if (counter) counter.textContent = String(placedUnits.length);

  const btn = document.getElementById("ready-btn") as HTMLButtonElement;
  if (btn) btn.disabled = placedUnits.length < maxUnits;
}

async function submitPlacement(): Promise<void> {
  if (!currentGameId || !currentMode) return;
  const btn = document.getElementById("ready-btn") as HTMLButtonElement;
  btn.disabled = true;
  setPlacementStatus("배치 중...");

  const token = api.getToken();
  if (!token) {
    setPlacementStatus("로그인 필요", "err");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/rooms/${currentGameId}/place`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ playerId: humanPlayerId, units: placedUnits }),
    });

    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      setPlacementStatus(`오류: ${err.error ?? res.statusText}`, "err");
      btn.disabled = false;
      return;
    }

    setPlacementStatus("배치 완료! 게임 시작 대기 중...", "ok");
    // Game will start via polling
  } catch (err) {
    setPlacementStatus(`오류: ${String(err)}`, "err");
    btn.disabled = false;
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollGameState(gameId: string): Promise<void> {
  const token = api.getToken();
  if (!token) return;

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/rooms/${gameId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setTimeout(() => void poll(), 2_000); return; }

      const data = (await res.json()) as { status: string; state: GameStateSnapshot };

      if (data.state !== undefined) {
        lastGameState = data.state;

        // If battle has started, switch to game screen
        if (
          (data.state.phase === "battle" || data.state.phase === "result") &&
          document.getElementById("screen-game")?.classList.contains("active") === false
        ) {
          showScreen("screen-game");
        }

        if (document.getElementById("screen-game")?.classList.contains("active")) {
          renderGame(data.state);
        }
      }

      if (data.status === "ended" || data.state?.phase === "result") {
        const winnerIds = data.state?.endResult?.winnerIds ?? [];
        showGameOver(winnerIds, data.state?.endResult?.result ?? "ended");
        return;
      }

      setTimeout(() => void poll(), 1_000);
    } catch {
      setTimeout(() => void poll(), 2_000);
    }
  };

  void poll();
}

// ─── Game action state ────────────────────────────────────────────────────────

let selectedUnitId: string | null = null;
let selectedUnitPos: { row: number; col: number } | null = null;
let moveHighlights: { row: number; col: number }[] = [];
let attackRangeHighlights: { row: number; col: number }[] = [];
let attackTargetHighlights: { row: number; col: number }[] = [];
let selectedGameUnitPos: { row: number; col: number } | null = null;

function clearUnitSelection(): void {
  selectedUnitId = null;
  selectedUnitPos = null;
  selectedGameUnitPos = null;
  moveHighlights = [];
  attackRangeHighlights = [];
  attackTargetHighlights = [];
}

async function fetchAndShowUnitOptions(
  unitId: string,
  pos: { row: number; col: number },
  state: GameStateSnapshot,
  gridSize: number,
): Promise<void> {
  const token = api.getToken();
  if (!token || !currentGameId) return;

  selectedUnitId = unitId;
  selectedGameUnitPos = pos;
  moveHighlights = [];
  attackRangeHighlights = [];
  attackTargetHighlights = [];

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/rooms/${currentGameId}/unit-options?playerId=${humanPlayerId}&unitId=${encodeURIComponent(unitId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const data = await res.json() as {
        reachableTiles: Array<{ row: number; col: number }>;
        attackableTiles: Array<{ row: number; col: number }>;
        enemyPositions: Array<{ row: number; col: number }>;
        canMove: boolean;
        canAttack: boolean;
        unitInfo: UnitInfoData;
      };
      moveHighlights = data.canMove ? data.reachableTiles : [];
      // Attack range = tiles in range WITHOUT enemy (dim)
      const enemySet = new Set(data.enemyPositions.map(p => `${p.row},${p.col}`));
      attackRangeHighlights = data.canAttack
        ? data.attackableTiles.filter(p => !enemySet.has(`${p.row},${p.col}`))
        : [];
      attackTargetHighlights = data.canAttack ? data.enemyPositions : [];
      renderUnitInfoPanel(data.unitInfo);
    }
  } catch { /* ignore */ }

  // Re-render board with highlights
  const activeCanvas = document.getElementById("board-canvas") as HTMLCanvasElement;
  if (activeCanvas) {
    const playerIds = Object.keys(state.players);
    const unitsArr = Object.values(state.units).map((u) => ({
      metaId: u.metaId as string,
      playerId: u.playerId as string,
      position: u.position,
      alive: u.alive,
    }));
    renderIso(activeCanvas, {
      gridSize,
      baseTile: state.map.baseTile ?? "plain",
      tiles: state.map.tiles as unknown as Record<string, { attribute: string }>,
      units: unitsArr,
      playerIds,
      moveTiles: moveHighlights,
      attackRangeTiles: attackRangeHighlights,
      attackTargetTiles: attackTargetHighlights,
      selectedPos: selectedGameUnitPos,
    });
  }
}

function renderUnitInfoPanel(info: UnitInfoData | null): void {
  const panel = document.getElementById("unit-info-panel");
  if (!panel) return;
  if (info === null) {
    panel.innerHTML = '<div class="unit-info-empty">유닛을 클릭하면 정보가 표시됩니다</div>';
    return;
  }

  const hpPct = Math.max(0, Math.min(100, (info.currentHealth / info.maxHealth) * 100));
  const hpColor = hpPct > 60 ? "#4caf50" : hpPct > 30 ? "#ff9800" : "#f44336";

  const effectsHtml = info.activeEffects.length > 0
    ? info.activeEffects.map(e =>
        `<span class="effect-badge effect-${e.effectType}">${e.effectType} ${e.turnsRemaining}턴</span>`
      ).join("")
    : '<span class="effect-none">상태 이상 없음</span>';

  const rangeText = info.weapon.minRange === info.weapon.maxRange
    ? `${info.weapon.maxRange}`
    : `${info.weapon.minRange}–${info.weapon.maxRange}`;

  const actionsHtml = [
    info.actionsUsed.moved ? '<span class="action-used">이동 완료</span>' : '',
    info.actionsUsed.attacked ? '<span class="action-used">공격 완료</span>' : '',
  ].filter(Boolean).join('') || '<span class="action-avail">행동 가능</span>';

  const unitName = UNIT_NAME_KO[info.metaId] ?? info.metaId;
  const unitColor = UNIT_COLOR[info.class] ?? "#888";

  panel.innerHTML = `
    <div class="unit-info-header">
      <div class="unit-info-icon" style="background:${unitColor}">${UNIT_ABBR[info.metaId] ?? "?"}</div>
      <div class="unit-info-title">
        <div class="unit-info-name">${unitName}</div>
        <div class="unit-info-class">${info.class}</div>
      </div>
    </div>
    <div class="unit-info-hp">
      <div class="unit-info-label">HP</div>
      <div class="unit-info-hp-bar">
        <div class="unit-info-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div>
      </div>
      <div class="unit-info-hp-text">${info.currentHealth} / ${info.maxHealth}</div>
    </div>
    <div class="unit-info-stats">
      <div class="stat-row"><span class="stat-label">ATK</span><span class="stat-val">${info.weapon.damage}</span></div>
      <div class="stat-row"><span class="stat-label">RNG</span><span class="stat-val">${rangeText}</span></div>
      <div class="stat-row"><span class="stat-label">MOV</span><span class="stat-val">${info.movementPoints}/${info.baseMovement}</span></div>
      <div class="stat-row"><span class="stat-label">ARM</span><span class="stat-val">${info.currentArmor}</span></div>
    </div>
    <div class="unit-info-weapon">
      <span class="weapon-type weapon-${info.weapon.attackType}">${info.weapon.attackType}</span>
      <span class="weapon-attr">${info.weapon.attribute}</span>
    </div>
    <div class="unit-info-effects">${effectsHtml}</div>
    <div class="unit-info-actions">${actionsHtml}</div>
  `;
}

async function submitAction(action: {
  type: "move" | "attack" | "pass";
  unitId?: string;
  targetPosition?: { row: number; col: number };
}): Promise<void> {
  if (!currentGameId) return;
  const token = api.getToken();
  if (!token) return;

  try {
    await fetch(`${API_BASE}/api/v1/rooms/${currentGameId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ playerId: humanPlayerId, action }),
    });
  } catch { /* ignore */ }
}

// ─── Turn order bar (DOS2-style) ──────────────────────────────────────────────

function renderTurnOrder(state: GameStateSnapshot, playerIds: string[]): void {
  const bar = document.getElementById("turn-order-bar");
  if (!bar) return;
  bar.innerHTML = "";

  const turnOrder = state.turnOrder;
  const currentIdx = state.currentTurnIndex;

  turnOrder.forEach((slot, idx) => {
    const unit = slot.unitId ? state.units[slot.unitId] : undefined;
    const pIdx = playerIds.indexOf(slot.playerId);
    const color = PLAYER_COLORS[pIdx >= 0 ? pIdx : 0]!;
    const abbr = unit ? (UNIT_ABBR[unit.metaId as string] ?? "?") : slot.playerId.slice(0, 2).toUpperCase();
    const isDead = unit ? !unit.alive : false;
    const isCurrent = idx === currentIdx;
    const isPast = idx < currentIdx;

    const item = document.createElement("div");
    item.className = `turn-slot ${isCurrent ? "turn-slot-active" : ""} ${isPast ? "turn-slot-past" : ""} ${isDead ? "turn-slot-dead" : ""}`;
    item.style.borderColor = color;
    item.style.backgroundColor = isCurrent ? color : "transparent";
    item.innerHTML = `
      <div class="turn-slot-abbr" style="color:${isCurrent ? "#fff" : color}">${abbr}</div>
      ${isCurrent ? '<div class="turn-slot-arrow">&#9660;</div>' : ""}
    `;

    // Tooltip
    item.title = `${slot.playerId.slice(0, 12)}${unit ? ` — ${UNIT_NAME_KO[unit.metaId as string] ?? unit.metaId}` : ""}`;

    bar.appendChild(item);
  });
}

// ─── Game rendering ───────────────────────────────────────────────────────────

function renderGame(state: GameStateSnapshot): void {
  const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;
  if (!canvas) return;

  const gridSize = state.map.gridSize ?? 11;
  const playerIds = Object.keys(state.players);
  const unitsArr = Object.values(state.units).map((u) => ({
    metaId: u.metaId as string,
    playerId: u.playerId as string,
    position: u.position,
    alive: u.alive,
  }));

  const slot = state.turnOrder[state.currentTurnIndex];
  const isMyTurn = slot?.playerId === humanPlayerId;

  // Clear selection when turn changes
  if (!isMyTurn && selectedUnitId !== null) {
    clearUnitSelection();
  }

  // Turn indicator
  const turnEl = document.getElementById("turn-indicator");
  if (turnEl) {
    if (isMyTurn) {
      turnEl.textContent = "🟢 내 차례!";
      turnEl.style.color = "var(--success)";
    } else {
      turnEl.textContent = slot !== undefined
        ? `${slot.playerId.length > 14 ? slot.playerId.slice(0, 12) + "…" : slot.playerId}`
        : "—";
      turnEl.style.color = "var(--accent)";
    }
  }
  const roundEl = document.getElementById("round-indicator");
  if (roundEl) roundEl.textContent = `Round ${state.round}`;

  const passBtn = document.getElementById("pass-btn") as HTMLButtonElement | null;
  if (passBtn) passBtn.style.display = isMyTurn ? "block" : "none";

  // Auto-select and fetch options for current unit when it's my turn
  if (isMyTurn && slot?.unitId) {
    const currentUnit = state.units[slot.unitId];
    if (currentUnit && currentUnit.alive) {
      const newSelectedId = slot.unitId;
      if (selectedUnitId !== newSelectedId) {
        void fetchAndShowUnitOptions(newSelectedId, currentUnit.position, state, gridSize);
      }
    }
  }

  // Set up board interaction
  setupBoardClick(canvas, state, isMyTurn, gridSize);

  // Render on the active canvas
  const activeCanvas = (document.getElementById("board-canvas") as HTMLCanvasElement) ?? canvas;
  renderIso(activeCanvas, {
    gridSize,
    baseTile: state.map.baseTile ?? "plain",
    tiles: state.map.tiles as unknown as Record<string, { attribute: string }>,
    units: unitsArr,
    playerIds,
    moveTiles: moveHighlights,
    attackRangeTiles: attackRangeHighlights,
    attackTargetTiles: attackTargetHighlights,
    selectedPos: selectedGameUnitPos,
  });

  renderTurnOrder(state, playerIds);
  renderPlayersList(state, playerIds, slot?.playerId);
}

// ─── Hover tooltip ────────────────────────────────────────────────────────────

function showHoverTooltip(
  x: number, y: number,
  unit: GameStateSnapshot["units"][string],
  isAttackable: boolean,
  isMoveable: boolean,
): void {
  const tip = document.getElementById("hover-tooltip");
  if (!tip) return;
  const name = UNIT_NAME_KO[unit.metaId as string] ?? (unit.metaId as string);
  const abbr = UNIT_ABBR[unit.metaId as string] ?? "?";
  const hpPct = Math.max(0, Math.min(100, (unit.currentHealth / 1) * 100)); // approx
  const hpColor = unit.currentHealth > 3 ? "#4caf50" : unit.currentHealth > 1 ? "#ff9800" : "#f44336";
  const actionHint = isAttackable
    ? `<div class="tip-attack">⚔️ 클릭하여 공격</div>`
    : isMoveable
    ? `<div class="tip-move">👟 클릭하여 이동</div>`
    : "";
  tip.innerHTML = `
    <div class="tip-header">
      <span class="tip-abbr">${abbr}</span>
      <span class="tip-name">${name}</span>
    </div>
    <div class="tip-hp">
      <span style="color:${hpColor}">HP ${unit.currentHealth}</span>
      <span class="tip-armor">ARM ${unit.currentArmor}</span>
    </div>
    ${actionHint}
  `;
  tip.style.display = "block";
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y - 10}px`;
}

function hideHoverTooltip(): void {
  const tip = document.getElementById("hover-tooltip");
  if (tip) tip.style.display = "none";
}

function setupBoardClick(
  canvas: HTMLCanvasElement,
  state: GameStateSnapshot,
  isMyTurn: boolean,
  gridSize: number,
): void {
  const newCanvas = canvas.cloneNode(true) as HTMLCanvasElement;
  canvas.parentNode?.replaceChild(newCanvas, canvas);

  newCanvas.style.cursor = isMyTurn ? "pointer" : "default";

  // ── Hover: tooltip + cursor feedback ────────────────────────────────────────
  newCanvas.addEventListener("mousemove", (e) => {
    const rect = newCanvas.getBoundingClientRect();
    const p = isoParams(gridSize);
    const mx = (e.clientX - rect.left) * (newCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (newCanvas.height / rect.height);
    const { row, col } = screenToGrid(mx, my, p.cx, p.cy, p.HW, p.HH);

    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
      hideHoverTooltip();
      newCanvas.style.cursor = isMyTurn ? "pointer" : "default";
      return;
    }

    const hoveredUnit = Object.values(state.units).find(
      (u) => u.alive && u.position.row === row && u.position.col === col,
    );

    const isAttackable = attackTargetHighlights.some(t => t.row === row && t.col === col);
    const isMoveable = moveHighlights.some(t => t.row === row && t.col === col);

    if (hoveredUnit) {
      showHoverTooltip(e.clientX, e.clientY, hoveredUnit, isAttackable && isMyTurn, false);
      newCanvas.style.cursor = isAttackable && isMyTurn ? "crosshair" : "pointer";
    } else if (isMoveable && isMyTurn) {
      hideHoverTooltip();
      newCanvas.style.cursor = "pointer";
    } else {
      hideHoverTooltip();
      newCanvas.style.cursor = isMyTurn ? "default" : "default";
    }
  });

  newCanvas.addEventListener("mouseleave", () => {
    hideHoverTooltip();
  });

  newCanvas.addEventListener("click", (e) => {
    const rect = newCanvas.getBoundingClientRect();
    const p = isoParams(gridSize);
    const mx = (e.clientX - rect.left) * (newCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (newCanvas.height / rect.height);
    const { row, col } = screenToGrid(mx, my, p.cx, p.cy, p.HW, p.HH);
    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return;

    const clickedUnit = Object.values(state.units).find(
      (u) => u.alive && u.position.row === row && u.position.col === col,
    );

    // Always show stats for any clicked unit
    if (clickedUnit) {
      const token = api.getToken();
      if (token && currentGameId) {
        void fetch(
          `${API_BASE}/api/v1/rooms/${currentGameId}/unit-options?playerId=${humanPlayerId}&unitId=${encodeURIComponent(clickedUnit.unitId as string)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ).then(r => r.ok ? r.json() : null)
          .then((data: { unitInfo?: UnitInfoData } | null) => {
            if (data?.unitInfo) renderUnitInfoPanel(data.unitInfo);
          })
          .catch(() => {});
      }
    }

    if (!isMyTurn) return;

    // Check if clicking a highlighted attack target
    if (attackTargetHighlights.some(t => t.row === row && t.col === col)) {
      if (selectedUnitId !== null) {
        void submitAction({ type: "attack", unitId: selectedUnitId, targetPosition: { row, col } });
        clearUnitSelection();
        return;
      }
    }

    // Check if clicking a highlighted move tile
    if (moveHighlights.some(t => t.row === row && t.col === col)) {
      if (selectedUnitId !== null) {
        void submitAction({ type: "move", unitId: selectedUnitId, targetPosition: { row, col } });
        clearUnitSelection();
        return;
      }
    }

    // Click own unit: select it (only current turn's unit can act)
    if (clickedUnit && clickedUnit.playerId === humanPlayerId) {
      const currentSlot = state.turnOrder[state.currentTurnIndex];
      if (currentSlot?.unitId && clickedUnit.unitId !== currentSlot.unitId) {
        // Clicked a different own unit — show info only, no action
        void fetchAndShowUnitOptions(clickedUnit.unitId as string, { row, col }, state, gridSize);
        return;
      }
      if (selectedUnitId === clickedUnit.unitId) {
        // Click same unit again: deselect
        clearUnitSelection();
        // Re-render without highlights
        const playerIds = Object.keys(state.players);
        const unitsArr = Object.values(state.units).map((u) => ({
          metaId: u.metaId as string, playerId: u.playerId as string,
          position: u.position, alive: u.alive,
        }));
        renderIso(newCanvas, {
          gridSize,
          baseTile: state.map.baseTile ?? "plain",
          tiles: state.map.tiles as unknown as Record<string, { attribute: string }>,
          units: unitsArr, playerIds,
        });
      } else {
        void fetchAndShowUnitOptions(clickedUnit.unitId as string, { row, col }, state, gridSize);
      }
      return;
    }

    // Click enemy or empty tile with no selection: deselect
    if (selectedUnitId !== null) {
      clearUnitSelection();
      // Re-render without highlights
      const playerIds = Object.keys(state.players);
      const unitsArr = Object.values(state.units).map((u) => ({
        metaId: u.metaId as string, playerId: u.playerId as string,
        position: u.position, alive: u.alive,
      }));
      renderIso(newCanvas, {
        gridSize,
        baseTile: state.map.baseTile ?? "plain",
        tiles: state.map.tiles as unknown as Record<string, { attribute: string }>,
        units: unitsArr, playerIds,
      });
    }
  });
}

function renderPlayersList(
  state: GameStateSnapshot,
  playerIds: string[],
  activeId: string | undefined,
): void {
  const list = document.getElementById("players-list");
  if (!list) return;
  list.innerHTML = "";

  playerIds.forEach((pid, idx) => {
    const p = state.players[pid];
    if (!p) return;
    const aliveUnits = Object.values(state.units).filter((u) => u.alive && u.playerId === pid).length;

    const row = document.createElement("div");
    row.className = `player-row ${pid === activeId ? "active" : ""}`;
    row.innerHTML = `
      <div class="player-dot p${idx}"></div>
      <span style="flex:1">${pid.length > 16 ? pid.slice(0, 14) + "…" : pid}</span>
      <span class="tag">${aliveUnits} units</span>
    `;
    list.appendChild(row);
  });
}

function renderLog(): void {
  const list = document.getElementById("log-list");
  if (!list) return;
  list.innerHTML = logEntries.map((e) => `<div class="log-entry">${e}</div>`).join("");
}

function showGameOver(winnerIds: string[], reason: string): void {
  const container = document.getElementById("game-over-container");
  const msg = document.getElementById("game-over-msg");
  if (!container || !msg) return;

  container.classList.remove("hidden");
  if (winnerIds.length > 0) {
    msg.textContent = `승리: ${winnerIds.join(", ")} (${reason})`;
  } else {
    msg.textContent = `무승부 (${reason})`;
  }
  addLog(`게임 종료: ${winnerIds.length > 0 ? winnerIds.join(",") + " 승리" : "무승부"}`);
}

// ─── Unit Order Draft ─────────────────────────────────────────────────────────

let unitOrderDraftTimer: ReturnType<typeof setInterval> | null = null;

function showUnitOrderDraft(aliveUnitIds: string[], timeoutMs: number): void {
  const overlay = document.getElementById("unit-order-overlay");
  const listEl = document.getElementById("unit-order-list");
  const timerEl = document.getElementById("unit-order-timer");
  if (!overlay || !listEl || !timerEl) return;

  // Use latest game state to get unit info
  const state = lastGameState;

  // Build draggable ordered list from aliveUnitIds (only player's own units)
  const myUnitIds = aliveUnitIds.filter((uid) => state?.units[uid]?.playerId === humanPlayerId);
  // If no units for this player (e.g., spectating), skip
  if (myUnitIds.length === 0) return;

  let orderedIds = [...myUnitIds];
  listEl.innerHTML = "";

  const renderList = () => {
    listEl.innerHTML = "";
    orderedIds.forEach((uid, idx) => {
      const unit = state?.units[uid];
      if (!unit) return;

      const item = document.createElement("div");
      item.className = "unit-order-item";
      item.dataset["uid"] = uid;
      item.draggable = true;

      // Unit display info
      const metaId = unit.metaId.replace("unit_", "");
      const classMap: Record<string, string> = {
        fighter: "전사", tank: "탱커", ranger: "레인저",
        mage: "마법사", healer: "힐러", assassin: "암살자",
      };
      const className = Object.keys(classMap).find(k => metaId.includes(k));
      const unitClass = className ? classMap[className] : metaId;

      item.innerHTML = `
        <span class="unit-order-num">${idx + 1}</span>
        <span class="unit-order-icon">${getUnitEmoji(unit.metaId)}</span>
        <span class="unit-order-name">${unitClass ?? metaId}</span>
        <span class="unit-order-hp">HP ${unit.currentHealth}</span>
        <span class="unit-order-drag">⠿</span>
      `;

      // Drag handlers
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", uid);
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("drag-over");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        const draggedUid = e.dataTransfer?.getData("text/plain");
        if (draggedUid === undefined || draggedUid === uid) return;
        const fromIdx = orderedIds.indexOf(draggedUid);
        const toIdx = orderedIds.indexOf(uid);
        if (fromIdx === -1 || toIdx === -1) return;
        orderedIds.splice(fromIdx, 1);
        orderedIds.splice(toIdx, 0, draggedUid);
        renderList();
      });

      listEl.appendChild(item);
    });
  };
  renderList();

  // Countdown timer
  let remaining = Math.ceil(timeoutMs / 1000);
  timerEl.textContent = `${remaining}초`;
  if (unitOrderDraftTimer !== null) clearInterval(unitOrderDraftTimer);
  unitOrderDraftTimer = setInterval(() => {
    remaining -= 1;
    timerEl.textContent = `${remaining}초`;
    if (remaining <= 0) {
      submitUnitOrder(orderedIds);
    }
  }, 1000);

  overlay.classList.remove("hidden");

  // Submit button
  const submitBtn = document.getElementById("unit-order-submit");
  if (submitBtn) {
    const handler = () => submitUnitOrder(orderedIds);
    submitBtn.replaceWith(submitBtn.cloneNode(true)); // remove old listeners
    document.getElementById("unit-order-submit")?.addEventListener("click", handler);
  }
}

function getUnitEmoji(metaId: string): string {
  if (metaId.includes("fighter")) return "⚔️";
  if (metaId.includes("tank")) return "🛡️";
  if (metaId.includes("ranger")) return "🏹";
  if (metaId.includes("mage")) return "🔮";
  if (metaId.includes("healer")) return "💚";
  if (metaId.includes("assassin")) return "🗡️";
  return "🧙";
}

function submitUnitOrder(orderedIds: string[]): void {
  if (unitOrderDraftTimer !== null) {
    clearInterval(unitOrderDraftTimer);
    unitOrderDraftTimer = null;
  }
  const overlay = document.getElementById("unit-order-overlay");
  overlay?.classList.add("hidden");

  if (currentGameId) {
    ws.sendUnitOrder(currentGameId, orderedIds);
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.getElementById("lobby-back")?.addEventListener("click", () => {
  ws.disconnect();
  showScreen("screen-menu");
});

document.getElementById("start-btn")?.addEventListener("click", () => {
  void startGame();
});

document.getElementById("ready-btn")?.addEventListener("click", () => {
  void submitPlacement();
});

document.getElementById("pass-btn")?.addEventListener("click", () => {
  clearUnitSelection();
  void submitAction({ type: "pass" });
});

document.getElementById("back-to-menu-btn")?.addEventListener("click", () => {
  ws.disconnect();
  currentGameId = null;
  logEntries = [];
  placedUnits = [];
  renderLog();
  document.getElementById("game-over-container")?.classList.add("hidden");
  showScreen("screen-menu");
});

renderMenu();
