/**
 * Main entry point — Menu → Lobby → Placement → Game
 * Renders the board in isometric (quarter-view) projection using Canvas 2D.
 */
import gameModes from "./game-modes.json";
import { ApiClient } from "./api.js";
import type { TileMetaClient, RoomRecord } from "./api.js";
import { WsClient } from "./ws-client.js";
import type { GameStateSnapshot } from "./ws-client.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BadgeSpec {
  cx: number;
  naturalTop: number;  // y before overlap adjustment
  label: string;
  color: string;
  dead: boolean;
  fontSize: number;
}

interface SkillInfo {
  skillId: string;
  nameKey: string;
  descKey: string;
  type: "active" | "passive" | "reactive";
  oneShot: boolean;
  weaponId?: string;
  canUse: boolean;
  skillTargets: { row: number; col: number }[];
}

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

// Player ID: per-tab (sessionStorage) so multiple browser tabs can be separate players.
// Game session ID: also per-tab so each tab tracks its own active game.
let humanPlayerId: string = sessionStorage.getItem("ab_player_id") ??
  `player_${Math.random().toString(36).slice(2, 8)}`;
sessionStorage.setItem("ab_player_id", humanPlayerId);

let currentGameId: string | null = sessionStorage.getItem("ab_game_id");
let humanTeamIndex = 0;
let logEntries: string[] = [];
let availableUnits: UnitMeta[] = [];

// Placement state
let selectedMetaId: string | null = null;
let placedUnits: PlacedUnit[] = [];
/** playerId → metaIds they currently have placed/selected (received via WS) */
let teammateSelections: Record<string, string[]> = {};
let lastGameState: GameStateSnapshot | null = null;

// Tile metadata cache — loaded once from server, keyed by tileType
let tileMetas: Map<string, TileMetaClient> = new Map();

// Rooms browser auto-refresh
let roomsRefreshInterval: ReturnType<typeof setInterval> | null = null;

// ─── Unit metadata ─────────────────────────────────────────────────────────────

const UNIT_ABBR: Record<string, string> = {
  t1: "T", t2: "T", t3: "T", t4: "T",
  f1: "F", f2: "F", f3: "F", f4: "F",
  r1: "R", r2: "R", r3: "R", r4: "R",
  b1: "B", b2: "B", b3: "B", b4: "B",
  a1: "A", a2: "A", a3: "A", a4: "A",
  u1: "U", u2: "U", u3: "U", u4: "U",
  m1: "M", k1: "K", s1: "S",
};

/** Base HP per unit type (matches metadata/data/units.json baseHealth) */
const UNIT_BASE_HEALTH: Record<string, number> = {
  t1: 6, t2: 6, f1: 4, f2: 4,
  r1: 4, r2: 4, b1: 5, b2: 5,
  m1: 3, k1: 5, s1: 4,
};

const UNIT_NAME_KO: Record<string, string> = {
  t1: "탱커1", t2: "탱커2", t3: "탱커3", t4: "탱커4",
  f1: "파이터1", f2: "파이터2", f3: "파이터3", f4: "파이터4",
  r1: "레인저1", r2: "레인저2", r3: "레인저3", r4: "레인저4",
  b1: "브루트1", b2: "브루트2", b3: "브루트3", b4: "브루트4",
  a1: "아틸러리1", a2: "아틸러리2", a3: "아틸러리3", a4: "아틸러리4",
  u1: "유틸리티1", u2: "유틸리티2", u3: "유틸리티3", u4: "유틸리티4",
  m1: "메이지", k1: "나이트", s1: "서포트",
};

const SKILL_NAME_KO: Record<string, string> = {
  skill_shield_defend: "방패 방어",
  skill_t2_pull: "철갑 끌어당기기",
};
const SKILL_DESC_KO: Record<string, string> = {
  skill_shield_defend: "패시브. 관통·광선 차단, 타일 효과 흡수.",
  skill_t2_pull: "사거리 1~3 적을 인접 칸으로 당김. 1회.",
};

const UNIT_COLOR: Record<string, string> = {
  tanker: "#5b8dd9", fighter: "#d95b5b", ranger: "#5bd95b",
  brute: "#c97a2a", artillery: "#d9c83c", utility: "#3cd9d9",
  mage: "#9b5bd9", support: "#d9c05b",
};

const UNIT_EMOJI: Record<string, string> = {
  t1: "🛡️", t2: "🛡️", f1: "⚔️", f2: "⚔️",
  r1: "🏹", r2: "🏹", b1: "🪓", b2: "🪓",
  m1: "🔮", k1: "⚔️", s1: "💚",
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

function isoParams(
  gridSize: number,
  availW?: number,
  availH?: number,
): {
  TW: number; TH: number; HW: number; HH: number; DEPTH: number;
  cx: number; cy: number; canvasW: number; canvasH: number;
} {
  let TW: number;
  if (availW !== undefined && availH !== undefined && availW > 0 && availH > 0) {
    // 패딩(0.5rem = 8px × 2) 제외한 실제 사용 가능한 공간
    const usableW = availW - 16;
    const usableH = availH - 16;
    // canvasW = (gridSize + 1) * TW  →  TW = usableW / (gridSize + 1)
    // canvasH ≈ TW/2 * (gridSize + 2.4)  →  TW = usableH * 2 / (gridSize + 2.4)
    const twFromW = Math.floor(usableW / (gridSize + 1));
    const twFromH = Math.floor(usableH * 2 / (gridSize + 2.4));
    TW = Math.max(32, Math.min(twFromW, twFromH, 256)); // 32 ~ 256 범위 제한
  } else {
    TW = gridSize <= 11 ? 64 : 48;
  }
  const TH = TW / 2;
  const HW = TW / 2;
  const HH = TH / 2;
  const DEPTH = Math.round(TH * 0.4);
  const canvasW = gridSize * TW + TW;
  // Extra top padding so sprites at row-0 don't overflow above the canvas.
  // Sprite height = HW * 3.5; tiles at row-0 start at cy, so reserve that much.
  const spriteTopPad = Math.round(HW * 3.5);
  const canvasH = gridSize * TH + TH + DEPTH + TH + spriteTopPad;
  const cx = canvasW / 2;
  const cy = HH + 4 + spriteTopPad;
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

// ─── Tile texture renderers ───────────────────────────────────────────────────
// Each renderer draws a visual pattern ON TOP of the base fill, within the
// clipped diamond region.  Only the tile top face is clipped; context is already
// saved/restored by drawTile.  Coordinates are in canvas-space; the diamond
// top vertex is at (sx, sy) and the center is at (sx, sy+HH).
//
// Adding a new tile type: register a renderer here — no other changes needed.
// If no renderer is registered, the tile falls back to the base color only.

type TextureRenderer = (
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  HW: number, HH: number,
) => void;

const TILE_TEXTURE_RENDERERS: Record<string, TextureRenderer> = {

  plain(ctx, sx, sy, HW, HH) {
    // Subtle grass tufts — short strokes at even intervals
    ctx.strokeStyle = "rgba(100,200,80,0.45)";
    ctx.lineWidth = Math.max(1, HW * 0.06);
    const cx = sx, cy = sy + HH;
    const step = HW * 0.35;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const bx = cx + di * step;
        const by = cy + dj * (HH * 0.4);
        ctx.beginPath();
        ctx.moveTo(bx - HW * 0.06, by + HH * 0.1);
        ctx.lineTo(bx,             by - HH * 0.22);
        ctx.moveTo(bx + HW * 0.06, by + HH * 0.1);
        ctx.lineTo(bx,             by - HH * 0.22);
        ctx.stroke();
      }
    }
  },

  mountain(ctx, sx, sy, HW, HH) {
    // Rocky peak — filled dark triangle + light highlight
    const cx = sx, cy = sy + HH;
    // Dark rock body
    ctx.beginPath();
    ctx.moveTo(cx - HW * 0.55, cy + HH * 0.3);
    ctx.lineTo(cx,             cy - HH * 0.6);
    ctx.lineTo(cx + HW * 0.55, cy + HH * 0.3);
    ctx.closePath();
    ctx.fillStyle = "rgba(80,80,95,0.7)";
    ctx.fill();
    // Snow cap highlight
    ctx.beginPath();
    ctx.moveTo(cx - HW * 0.18, cy - HH * 0.28);
    ctx.lineTo(cx,             cy - HH * 0.6);
    ctx.lineTo(cx + HW * 0.18, cy - HH * 0.28);
    ctx.closePath();
    ctx.fillStyle = "rgba(235,240,255,0.75)";
    ctx.fill();
  },

  river(ctx, sx, sy, HW, HH) {
    // Three sinusoidal wave stripes
    ctx.strokeStyle = "rgba(100,180,255,0.65)";
    ctx.lineWidth = Math.max(1, HH * 0.18);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const baseY = sy + HH * (0.55 + i * 0.35);
      ctx.beginPath();
      ctx.moveTo(sx - HW * 0.85, baseY);
      ctx.bezierCurveTo(
        sx - HW * 0.4, baseY - HH * 0.18,
        sx + HW * 0.4, baseY + HH * 0.18,
        sx + HW * 0.85, baseY,
      );
      ctx.stroke();
    }
  },

  water(ctx, sx, sy, HW, HH) {
    // Concentric elliptic ripples
    const cx = sx, cy = sy + HH;
    ctx.strokeStyle = "rgba(160,220,255,0.5)";
    for (let r = 1; r <= 3; r++) {
      ctx.lineWidth = Math.max(0.5, HH * 0.1);
      ctx.beginPath();
      ctx.ellipse(cx, cy, HW * 0.25 * r, HH * 0.25 * r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  fire(ctx, sx, sy, HW, HH) {
    // Three flame arcs from the bottom center
    const cx = sx, baseY = sy + HH * 1.8;
    const flames = [
      { dx: 0,          scale: 1.0,  col: "rgba(255,200,60,0.8)"  },
      { dx: -HW * 0.28, scale: 0.7,  col: "rgba(255,130,30,0.65)" },
      { dx:  HW * 0.28, scale: 0.7,  col: "rgba(255,130,30,0.65)" },
    ];
    for (const { dx, scale, col } of flames) {
      const fx = cx + dx;
      ctx.beginPath();
      ctx.moveTo(fx, baseY);
      ctx.bezierCurveTo(
        fx - HW * 0.2 * scale, baseY - HH * 0.7 * scale,
        fx + HW * 0.2 * scale, baseY - HH * 1.2 * scale,
        fx,                    baseY - HH * 1.6 * scale,
      );
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, HW * 0.18 * scale);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  },

  sand(ctx, sx, sy, HW, HH) {
    // Small dots arranged in a loose grid
    ctx.fillStyle = "rgba(220,190,120,0.55)";
    const cx = sx, cy = sy + HH;
    const cols = 5, rows = 4;
    const r = Math.max(1, HW * 0.055);
    for (let ri = 0; ri < rows; ri++) {
      for (let ci = 0; ci < cols; ci++) {
        const ox = (ci - (cols - 1) / 2) * HW * 0.36 + (ri % 2 === 0 ? 0 : HW * 0.18);
        const oy = (ri - (rows - 1) / 2) * HH * 0.38;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  ice(ctx, sx, sy, HW, HH) {
    // Six-pointed snowflake
    const cx = sx, cy = sy + HH;
    const len = HW * 0.6;
    ctx.strokeStyle = "rgba(200,240,255,0.8)";
    ctx.lineWidth = Math.max(1, HW * 0.07);
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len * 0.5);
      ctx.stroke();
      // Small crossbar
      const bx = cx + Math.cos(angle) * len * 0.55;
      const by = cy + Math.sin(angle) * len * 0.55 * 0.5;
      const perp = angle + Math.PI / 2;
      const bl = len * 0.2;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(perp) * bl, by + Math.sin(perp) * bl * 0.5);
      ctx.lineTo(bx - Math.cos(perp) * bl, by - Math.sin(perp) * bl * 0.5);
      ctx.stroke();
    }
  },

  electric(ctx, sx, sy, HW, HH) {
    // Zigzag lightning bolt top-to-bottom
    const cx = sx;
    const top = sy + HH * 0.15, bot = sy + HH * 1.85;
    const seg = (bot - top) / 4;
    const pts = [
      [cx + HW * 0.12,  top],
      [cx - HW * 0.22,  top + seg],
      [cx + HW * 0.05,  top + seg * 2],
      [cx - HW * 0.22,  top + seg * 3],
      [cx + HW * 0.12,  bot],
    ] as const;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const pt of pts.slice(1)) ctx.lineTo(pt[0], pt[1]);
    ctx.strokeStyle = "rgba(255,240,80,0.9)";
    ctx.lineWidth = Math.max(1.5, HW * 0.1);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    // Glow pass
    ctx.strokeStyle = "rgba(255,255,200,0.4)";
    ctx.lineWidth = Math.max(3, HW * 0.22);
    ctx.stroke();
  },

  acid(ctx, sx, sy, HW, HH) {
    // Small bubbles (open circles) scattered across the tile
    ctx.strokeStyle = "rgba(180,255,80,0.7)";
    ctx.lineWidth = Math.max(0.8, HW * 0.055);
    const cx = sx, cy = sy + HH;
    const bubbles = [
      [-0.38,  0.0,  0.16],
      [ 0.30, -0.15, 0.12],
      [ 0.10,  0.32, 0.14],
      [-0.12, -0.35, 0.10],
      [ 0.38,  0.30, 0.09],
    ] as const;
    for (const [bx, by, br] of bubbles) {
      ctx.beginPath();
      ctx.arc(cx + bx * HW, cy + by * HH, br * HW, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  road(ctx, sx, sy, HW, HH) {
    // Two parallel lane markings
    ctx.strokeStyle = "rgba(200,180,140,0.5)";
    ctx.lineWidth = Math.max(1, HW * 0.07);
    ctx.setLineDash([HH * 0.3, HH * 0.2]);
    for (const dx of [-HW * 0.2, HW * 0.2]) {
      ctx.beginPath();
      ctx.moveTo(sx + dx - HW * 0.65, sy + HH * 0.55 + (dx > 0 ? HH * 0.45 : -HH * 0.45));
      ctx.lineTo(sx + dx + HW * 0.65, sy + HH * 1.45 + (dx > 0 ? HH * 0.45 : -HH * 0.45));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  },
};

/**
 * Draw one isometric tile with procedural texture + optional impassable border.
 *
 * @param tileType  - tile type key (e.g. "plain", "mountain") — drives texture
 * @param impassable - when true, draws a reddish diamond outline on top face
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  HW: number, HH: number, DEPTH: number,
  topColor: string, sideColor: string,
  tileType = "plain",
  impassable = false,
): void {
  // ── Top face: clip + base fill + procedural texture ───────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + HH * 2);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  ctx.clip();

  // Base fill
  ctx.fillStyle = topColor;
  ctx.fillRect(sx - HW, sy, HW * 2, HH * 2 + 1);

  // Procedural texture (optional per type)
  const renderer = TILE_TEXTURE_RENDERERS[tileType];
  if (renderer !== undefined) {
    renderer(ctx, sx, sy, HW, HH);
  }

  ctx.restore();

  // ── Top face outline (impassable = reddish) ───────────────────────────────
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + HH * 2);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  if (impassable) {
    ctx.strokeStyle = "rgba(220,50,50,0.75)";
    ctx.lineWidth = Math.max(1.5, HW * 0.05);
  } else {
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.5;
  }
  ctx.stroke();

  // ── Left side face ────────────────────────────────────────────────────────
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

  // ── Right side face ───────────────────────────────────────────────────────
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

// ─── Sprite image cache ────────────────────────────────────────────────────────

const _spriteCache = new Map<string, HTMLImageElement>();
let _spriteOnLoad: (() => void) | null = null;

function loadSprite(src: string): HTMLImageElement {
  let img = _spriteCache.get(src);
  if (img === undefined) {
    img = new Image();
    img.onload = () => { _spriteOnLoad?.(); };
    img.src = src;
    _spriteCache.set(src, img);
  }
  return img;
}

/** Preload all unit sprites in the background. */
function preloadSprites(): void {
  const units = ["b1","b2","r1","r2","t1","t2"];
  const dirs = ["front-left", "front-right", "back-left", "back-right"] as const;
  for (const u of units) {
    loadSprite(`/sprites/portraits/${u}.png`);
    for (const d of dirs) loadSprite(`/sprites/units/${u}-${d}.png`);
  }
}

/** Returns the sprite path for a unit+direction, or null if no sprite exists. */
function spritePath(metaId: string, direction: "front-left" | "front-right" | "back-left" | "back-right"): string | null {
  const SPRITE_UNITS = new Set([
    "t1","t2","t3","t4",
    "f1","f2","f3","f4",
    "r1","r2","r3","r4",
    "b1","b2","b3","b4",
    "a1","a2","a3","a4",
    "u1","u2","u3","u4",
    "obstacle_electric_pylon",
  ]);
  if (!SPRITE_UNITS.has(metaId)) return null;
  return `/sprites/units/${metaId}-${direction}.png`;
}

/** Portrait path for unit selection / info panel. */
function portraitPath(metaId: string): string | null {
  const PORTRAIT_UNITS = new Set([
    "t1","t2","t3","t4",
    "f1","f2","f3","f4",
    "r1","r2","r3","r4",
    "b1","b2","b3","b4",
    "a1","a2","a3","a4",
    "u1","u2","u3","u4",
    "obstacle_electric_pylon",
  ]);
  if (!PORTRAIT_UNITS.has(metaId)) return null;
  return `/sprites/portraits/${metaId}.png`;
}

function drawSingleBadge(
  ctx: CanvasRenderingContext2D,
  cx: number, topY: number,
  label: string, color: string, dead: boolean, fontSize: number,
): void {
  // 원형 배지: 지름 = fontSize * 1.6, 머릿글자 한 글자
  const r = fontSize * 0.8;
  const cy = topY + r;
  ctx.globalAlpha = dead ? 0.25 : 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = dead ? 0.25 : 1;
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
  ctx.globalAlpha = 1;
}

function drawBadges(ctx: CanvasRenderingContext2D, badges: BadgeSpec[]): void {
  if (badges.length === 0) return;

  // 원형 배지: 지름 = fontSize * 1.6
  const bwOf = (b: BadgeSpec) => b.fontSize * 1.6;
  const bhOf = (b: BadgeSpec) => b.fontSize * 1.6;

  // Build rects with adjusted top y — resolve overlaps by pushing up
  type Rect = { b: BadgeSpec; x0: number; y0: number; x1: number; y1: number };
  const placed: Rect[] = [];
  const gap = 2;

  // Sort by naturalTop ascending (badges higher on screen are anchored first)
  const sorted = [...badges].sort((a, b) => a.naturalTop - b.naturalTop);

  for (const b of sorted) {
    const bw = bwOf(b);
    const bh = bhOf(b);
    const x0 = b.cx - bw / 2;
    const x1 = b.cx + bw / 2;
    let y0 = b.naturalTop;

    // Push up until no overlap with already placed badges
    let tries = 0;
    let moved = true;
    while (moved && tries < 50) {
      moved = false;
      for (const p of placed) {
        const xOverlap = x0 < p.x1 + gap && x1 > p.x0 - gap;
        const yOverlap = y0 < p.y1 + gap && y0 + bh > p.y0 - gap;
        if (xOverlap && yOverlap) {
          y0 = p.y0 - bh - gap;
          moved = true;
        }
      }
      tries++;
    }

    placed.push({ b, x0, y0, x1, y1: y0 + bh });
  }

  // Draw all badges at resolved positions
  for (const { b, y0 } of placed) {
    drawSingleBadge(ctx, b.cx, y0, b.label, b.color, b.dead, b.fontSize);
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  HW: number, HH: number, DEPTH: number,
  color: string, abbr: string, dead: boolean,
  metaId?: string,
  direction: "front-left" | "front-right" | "back-left" | "back-right" = "front-left",
  unitName: string = "",
  badgeCollector?: BadgeSpec[],
  currentHealth?: number,
  selectionColor?: string,
): void {
  const cx = sx;
  const cy = sy + HH + DEPTH / 2;
  const r = Math.round(HW * 0.55);

  ctx.globalAlpha = dead ? 0.25 : 1;

  // Try sprite first
  const path = metaId !== undefined ? spritePath(metaId, direction) : null;
  const spriteImg = path !== null ? loadSprite(path) : null;

  // Feet anchored at front vertex of tile top face (sx, sy + HH*2)
  const feetY = sy + HH * 2;

  // ── Selection ring at feet (drawn before sprite so sprite sits on top) ───
  if (selectionColor && !dead) {
    ctx.save();
    const ringRX = r * 1.25;
    const ringRY = ringRX * 0.32;
    const ringY  = feetY - HH * 0.3;
    // Outer glow
    ctx.shadowColor = selectionColor;
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.ellipse(cx, ringY, ringRX, ringRY, 0, 0, Math.PI * 2);
    ctx.strokeStyle = selectionColor;
    ctx.lineWidth   = 2.5;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    // Inner fill pulse
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.ellipse(cx, ringY, ringRX * 0.6, ringRY * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = selectionColor;
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = dead ? 0.25 : 1;
  }

  if (spriteImg !== null && spriteImg.complete && spriteImg.naturalWidth > 0) {
    const spriteH = HW * 3.5;
    const spriteW = spriteH * (404 / 1008);
    const drawX = cx - spriteW / 2;
    const drawY = feetY - spriteH; // feet at bottom of sprite

    // Shadow ellipse at feet
    ctx.beginPath();
    ctx.ellipse(cx, feetY - HH * 0.3, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();

    // Sprite glow when selected
    if (selectionColor && !dead) {
      ctx.save();
      ctx.shadowColor = selectionColor;
      ctx.shadowBlur  = 20;
      ctx.drawImage(spriteImg, drawX, drawY, spriteW, spriteH);
      ctx.restore();
      ctx.globalAlpha = dead ? 0.25 : 1;
    }

    ctx.drawImage(spriteImg, drawX, drawY, spriteW, spriteH);

    // Collect badge for second-pass overlap-resolved rendering
    const fontSize = Math.max(9, Math.round(HW * 0.45));
    const naturalTop = drawY - 4 - (fontSize + fontSize * 0.3 * 2); // approx badge top
    if (badgeCollector) {
      badgeCollector.push({ cx, naturalTop, label: abbr, color, dead, fontSize });
    } else {
      drawSingleBadge(ctx, cx, naturalTop, abbr, color, dead, fontSize);
    }
  } else {
    // Fallback: colored circle + abbreviation
    ctx.beginPath();
    ctx.ellipse(cx, feetY - HH * 0.2, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, feetY - HH - r, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(r * 0.75)}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(abbr, cx, feetY - HH - r);
  }

  // ── HP bar above the unit (alive units only) ──────────────────────────────
  if (!dead && currentHealth !== undefined && metaId !== undefined) {
    const maxHp = UNIT_BASE_HEALTH[metaId] ?? 5;
    const hpPct = Math.max(0, Math.min(1, currentHealth / maxHp));
    const barW = Math.round(HW * 1.1);
    const barH = Math.max(3, Math.round(HH * 0.18));
    const barX = cx - barW / 2;
    // Position bar just above the sprite head (sprite top = feetY - spriteH)
    const spriteH = HW * 3.5;
    const headY = feetY - spriteH;
    const barY = headY - barH - 2;

    // Background
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(barX, barY, barW, barH);

    // HP fill
    const hpColor = hpPct > 0.6 ? "#4caf50" : hpPct > 0.3 ? "#ff9800" : "#f44336";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, Math.round(barW * hpPct), barH);

    // Border
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.globalAlpha = 1;
  }

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
  skills?: SkillInfo[];
}

interface RenderOpts {
  gridSize: number;
  baseTile?: string;
  tiles?: Record<string, { attribute: string }>;
  units?: Array<{
    unitId?: string;
    metaId: string;
    playerId: string;
    position: { row: number; col: number };
    alive: boolean;
    teamIndex?: number;
    currentHealth?: number;
  }>;
  /** unitId of the currently selected unit — draws a team-colored outline */
  selectedUnitId?: string | null;
  playerIds?: string[];
  highlightHalf?: number; // teamIndex whose half to highlight (placement phase)
  placedUnits?: PlacedUnit[];
  hoveredCell?: { row: number; col: number } | null;
  moveTiles?: Array<{ row: number; col: number }>;       // blue - can move here
  attackRangeTiles?: Array<{ row: number; col: number }>; // dim red - attack range (no enemy)
  attackTargetTiles?: Array<{ row: number; col: number }>; // bright red - enemy in range
  skillTargetTiles?: Array<{ row: number; col: number }>; // purple — skill range
  selectedPos?: { row: number; col: number } | null;     // yellow glow - selected unit
  availW?: number | undefined;   // board-wrap 가용 너비 (동적 타일 크기 계산용)
  availH?: number | undefined;   // board-wrap 가용 높이
  /** Tile metadata keyed by tileType — drives impassable border */
  tileMetas?: Map<string, TileMetaClient> | undefined;
}

// ── Direction helpers ─────────────────────────────────────────────────────────

/** Isometric screen-X value for a grid cell (determines left/right in screen space) */
function isoScreenX(pos: { row: number; col: number }): number {
  return pos.col - pos.row;
}

/**
 * Pick one of 4 isometric directions so a unit at `from` faces toward `to`.
 * In this grid: front = larger row+col (toward viewer); right = larger col-row (screen-right).
 */
function directionToward(
  from: { row: number; col: number },
  to:   { row: number; col: number },
): "front-left" | "front-right" | "back-left" | "back-right" {
  const drow = to.row - from.row;
  const dcol = to.col - from.col;
  const isFront = (drow + dcol) >= 0;
  const isRight = (dcol - drow) >= 0;
  if ( isFront &&  isRight) return "front-right";
  if ( isFront && !isRight) return "front-left";
  if (!isFront &&  isRight) return "back-right";
  return "back-left";
}

type UnitEntry = { position: { row: number; col: number }; teamIndex?: number; playerId: string; alive: boolean; currentHealth?: number };

/**
 * Find the nearest enemy to `unit` among `allUnits`.
 * Tie-break by smallest |screenX(enemy) - screenX(unit)| (X 좌표가 가까운 순).
 */
function nearestEnemy(unit: UnitEntry, allUnits: UnitEntry[]): { row: number; col: number } | null {
  const isEnemy = (u: UnitEntry) =>
    u.alive && (u.teamIndex !== undefined ? u.teamIndex !== unit.teamIndex : u.playerId !== unit.playerId);
  const enemies = allUnits.filter(isEnemy);
  if (enemies.length === 0) return null;

  const unitSX = isoScreenX(unit.position);
  let best: UnitEntry | null = null;
  let bestDist = Infinity;

  for (const e of enemies) {
    const d = Math.abs(e.position.row - unit.position.row) + Math.abs(e.position.col - unit.position.col);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    } else if (d === bestDist && best !== null) {
      // Tie: pick the enemy whose screen-X is closer to this unit's screen-X
      if (Math.abs(isoScreenX(e.position) - unitSX) < Math.abs(isoScreenX(best.position) - unitSX)) {
        best = e;
      }
    }
  }
  return best?.position ?? null;
}

function renderIso(canvas: HTMLCanvasElement, opts: RenderOpts): void {
  // Re-render this canvas when a pending sprite finishes loading
  _spriteOnLoad = () => renderIso(canvas, opts);

  const { gridSize, tiles = {}, units = [], playerIds = [], highlightHalf, placedUnits: placed = [] } = opts;
  const baseTile = opts.baseTile ?? "plain";
  const p = isoParams(gridSize, opts.availW, opts.availH);

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

  // Badge collector for second-pass overlap-resolved rendering
  const badgeList: BadgeSpec[] = [];

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
    const tileMeta = opts.tileMetas?.get(tileAttr);
    const isImpassable = tileMeta?.impassable ?? false;
    const top = TILE_COLORS[tileAttr] ?? TILE_COLORS["plain"]!;
    const side = TILE_SIDE_COLORS[tileAttr] ?? TILE_SIDE_COLORS["plain"]!;
    const { sx, sy } = gridToScreen(row, col, p.cx, p.cy, p.HW, p.HH);

    // Determine if this is the highlighted half
    let finalTop = top;
    let finalSide = side;
    if (highlightHalf !== undefined) {
      const isMyHalf = highlightHalf === 0 ? row < half : row >= half;
      if (isMyHalf) {
        finalTop = `${top}dd`;
      } else {
        finalTop = `${top}66`;
        finalSide = `${side}66`;
      }
    }

    // Hovered cell highlight
    if (opts.hoveredCell?.row === row && opts.hoveredCell?.col === col) {
      finalTop = "#ffffff44";
      finalSide = side;
    }

    drawTile(ctx, sx, sy, p.HW, p.HH, p.DEPTH, finalTop, finalSide, tileAttr, isImpassable);

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
    // Skill target (enemy in skill range — purple)
    if (opts.skillTargetTiles?.some(t => t.row === row && t.col === col)) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + p.HW, sy + p.HH);
      ctx.lineTo(sx, sy + p.HH * 2);
      ctx.lineTo(sx - p.HW, sy + p.HH);
      ctx.closePath();
      ctx.fillStyle = "rgba(160, 80, 255, 0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(180, 100, 255, 1.0)";
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

    // Draw placed unit (placement phase) — no badge collector needed (solo units)
    const placedMetaId = placedByPos.get(key);
    if (placedMetaId !== undefined) {
      drawUnit(ctx, sx, sy, p.HW, p.HH, p.DEPTH, "#888", UNIT_ABBR[placedMetaId] ?? "??", false, placedMetaId, "front-left", UNIT_NAME_KO[placedMetaId] ?? placedMetaId);
    }

    // Draw actual game unit (collect badge for second pass)
    const unit = unitsByPos.get(key);
    if (unit !== undefined) {
      const pIdx = playerIds.indexOf(unit.playerId);
      const color = PLAYER_COLORS[pIdx >= 0 ? pIdx : 0]!;
      const abbr = UNIT_ABBR[unit.metaId] ?? unit.metaId.slice(0, 2).toUpperCase();
      // Face the nearest enemy; fall back to team-based default if no enemies alive
      const enemyPos = nearestEnemy(unit, units);
      const dir = enemyPos
        ? directionToward(unit.position, enemyPos)
        : (pIdx === 0 ? "front-right" : "front-left");
      // Selection outline — team color ring+glow when this unit is selected
      const selectionColor = (opts.selectedUnitId && unit.unitId === opts.selectedUnitId)
        ? color
        : undefined;
      drawUnit(ctx, sx, sy, p.HW, p.HH, p.DEPTH, color, abbr, !unit.alive, unit.metaId, dir, UNIT_NAME_KO[unit.metaId] ?? unit.metaId, badgeList, unit.currentHealth, selectionColor);
    }
  }

  // Second pass: draw all unit badges with overlap resolution
  drawBadges(ctx, badgeList);
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
  // Online lobby banner
  const banner = document.getElementById("menu-lobby-banner");
  if (banner) {
    banner.innerHTML = `
      <div class="online-lobby-banner" id="online-lobby-btn">
        <span class="online-lobby-icon">🌐</span>
        <div class="online-lobby-text">
          <h3>온라인 로비</h3>
          <p>열린 방에 입장하거나 다른 플레이어와 함께 플레이하세요</p>
        </div>
        <span class="online-lobby-arrow">→</span>
      </div>
    `;
    document.getElementById("online-lobby-btn")?.addEventListener("click", () => {
      void openRoomsScreen();
    });
  }

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

// ─── Online rooms browser ──────────────────────────────────────────────────────

function stopRoomsRefresh(): void {
  if (roomsRefreshInterval !== null) {
    clearInterval(roomsRefreshInterval);
    roomsRefreshInterval = null;
  }
}

async function openRoomsScreen(): Promise<void> {
  try {
    await api.login(humanPlayerId);
  } catch {
    // If login fails, just show the screen — listRooms will surface the error
  }
  document.getElementById("rooms-player-id")!.textContent = humanPlayerId;
  document.getElementById("rooms-status")!.textContent = "";
  showScreen("screen-rooms");
  void refreshRooms();
  stopRoomsRefresh();
  roomsRefreshInterval = setInterval(() => void refreshRooms(), 4000);
}

async function refreshRooms(): Promise<void> {
  const refreshBtn = document.getElementById("rooms-refresh");
  refreshBtn?.classList.add("spinning");
  try {
    const rooms = await api.listRooms();
    const countEl = document.getElementById("rooms-count");
    if (countEl) countEl.textContent = `${rooms.length}개 방`;
    renderRooms(rooms);
  } catch (err) {
    const statusEl = document.getElementById("rooms-status");
    if (statusEl) {
      statusEl.textContent = `방 목록 오류: ${String(err)}`;
      statusEl.className = "status-msg err";
    }
  } finally {
    refreshBtn?.classList.remove("spinning");
  }
}

const MAP_NAME: Record<string, string> = {
  map_test_01:  "일반전 (1v1 · 3유닛)",
  map_1v1_6v6:  "격전 (1v1 · 6유닛)",
  map_2v2_6v6:  "팀전 (2v2 · 6유닛)",
};

function renderRooms(rooms: RoomRecord[]): void {
  const grid = document.getElementById("rooms-grid");
  if (!grid) return;

  if (rooms.length === 0) {
    grid.innerHTML = `
      <div class="rooms-empty">
        <div style="font-size:2.5rem">🏕️</div>
        <p>열린 방이 없습니다.</p>
        <p>새 게임을 만들어 친구를 초대해보세요!</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = "";
  for (const room of rooms) {
    const canJoin = room.status === "waiting" && room.joinedPlayerCount < room.expectedPlayerCount;
    const statusLabel = { waiting: "대기중", running: "진행중", ended: "종료" }[room.status] ?? room.status;
    const modeName = (room.mapId && MAP_NAME[room.mapId]) || room.mapId || `게임 (${room.expectedPlayerCount}P)`;
    const joinRatio = room.expectedPlayerCount > 0 ? room.joinedPlayerCount / room.expectedPlayerCount : 0;
    const placeRatio = room.joinedPlayerCount > 0
      ? room.placedPlayerCount / room.joinedPlayerCount
      : 0;
    void placeRatio; // currently not displayed
    const timeStr = new Date(room.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const shortId = room.gameId.slice(0, 20) + (room.gameId.length > 20 ? "…" : "");

    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-card-header">
        <div class="room-card-title">${modeName}</div>
        <div class="room-status-row">
          <span class="room-status-dot ${room.status}"></span>
          <span class="room-status-text">${statusLabel}</span>
        </div>
      </div>
      <div class="room-card-id">${shortId}</div>
      <div class="room-slots">
        <span>👥 <strong>${room.joinedPlayerCount}</strong>&thinsp;/&thinsp;${room.expectedPlayerCount} 명</span>
        <span>📋 배치 <strong>${room.placedPlayerCount}</strong>&thinsp;/&thinsp;${room.joinedPlayerCount}</span>
      </div>
      <div class="room-progress-wrap">
        <div class="room-progress-label">
          <span>입장</span>
          <span>${Math.round(joinRatio * 100)}%</span>
        </div>
        <div class="room-progress-bar">
          <div class="room-progress-fill" style="width:${joinRatio * 100}%"></div>
        </div>
      </div>
      <div class="room-created">생성 ${timeStr}</div>
      <button class="join-btn" ${canJoin ? "" : "disabled"}>
        ${canJoin ? "입장하기" : room.status === "running" ? "⚔️ 진행중" : "자리 없음"}
      </button>
    `;

    if (canJoin) {
      card.querySelector<HTMLButtonElement>(".join-btn")!.addEventListener("click", () => {
        void joinExistingRoom(room.gameId, room.mapId);
      });
    }

    grid.appendChild(card);
  }
}

async function joinExistingRoom(gameId: string, mapId: string): Promise<void> {
  stopRoomsRefresh();

  const statusEl = document.getElementById("rooms-status")!;
  statusEl.textContent = "방 입장 중...";
  statusEl.className = "status-msg";

  try {
    // Resolve mapId: if missing (old server format), fetch from room details
    let resolvedMapId = mapId;
    if (!resolvedMapId) {
      const token = api.getToken();
      const res = await fetch(`${API_BASE}/api/v1/rooms/${gameId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { state?: { map?: { mapId?: string } } };
        resolvedMapId = data.state?.map?.mapId ?? "";
      }
    }

    const mode = (gameModes.modes as GameMode[]).find((m) => m.mapId === resolvedMapId);
    if (!mode) throw new Error(`알 수 없는 맵: ${resolvedMapId || gameId}`);

    currentMode = mode;
    currentGameId = gameId;
    sessionStorage.setItem("ab_game_id", gameId);

    const joinRes = await api.joinRoom(gameId, humanPlayerId);
    humanTeamIndex = joinRes.teamIndex;
    addLog(`방 입장: ${gameId} (팀 ${humanTeamIndex})`);

    statusEl.textContent = "접속 중...";
    await connectHumanPlayer(gameId);
  } catch (err) {
    statusEl.textContent = `오류: ${String(err)}`;
    statusEl.className = "status-msg err";
  }
}

// ─── Lobby ─────────────────────────────────────────────────────────────────────

function openLobby(mode: GameMode): void {
  currentMode = mode;
  seatTypes = mode.seats.map((s) => s.defaultType);
  document.getElementById("lobby-title")!.textContent = mode.nameKo;
  setStatus("", "");
  // Always re-enable start button when entering the lobby
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement | null;
  if (startBtn) startBtn.disabled = false;
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
    sessionStorage.setItem("ab_game_id", room.gameId);
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
    onPlacementSelections: (selections) => {
      teammateSelections = selections;
      const maxUnits = currentMode?.maxUnitsPerPlayer ?? 3;
      renderUnitCards(maxUnits);
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
  teammateSelections = {};

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
        if (pState !== undefined) {
          humanTeamIndex = pState.teamIndex;
          sessionStorage.setItem("ab_team_index", String(humanTeamIndex));
        }
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

/** Compute which metaIds are locked by a same-team teammate (not us, not opponents). */
function getTeammateLockedMetaIds(): Set<string> {
  const locked = new Set<string>();
  for (const [pid, metaIds] of Object.entries(teammateSelections)) {
    if (pid === humanPlayerId) continue; // skip self
    // Only count players on the same team
    const pidTeam = lastGameState?.players[pid]?.teamIndex;
    if (pidTeam === undefined || pidTeam !== humanTeamIndex) continue;
    for (const mid of metaIds) locked.add(mid);
  }
  return locked;
}

/** Find which teammate playerId has locked a given metaId (for tooltip). */
function lockedByWhom(metaId: string): string | null {
  for (const [pid, metaIds] of Object.entries(teammateSelections)) {
    if (pid === humanPlayerId) continue;
    const pidTeam = lastGameState?.players[pid]?.teamIndex;
    if (pidTeam === undefined || pidTeam !== humanTeamIndex) continue;
    if (metaIds.includes(metaId)) return pid;
  }
  return null;
}

/** Broadcast current selection state to server so teammates see it. */
function broadcastPlacementUpdate(): void {
  if (!currentGameId || !ws.connected) return;
  const myMetaIds = [
    ...placedUnits.map((u) => u.metaId),
    ...(selectedMetaId ? [selectedMetaId] : []),
  ];
  ws.sendPlacementUpdate(currentGameId, humanPlayerId, myMetaIds);
}

function renderUnitCards(maxUnits: number): void {
  const list = document.getElementById("unit-card-list");
  if (!list) return;
  list.innerHTML = "<h3>유닛 선택</h3>";

  const lockedByTeammate = getTeammateLockedMetaIds();

  for (const unit of availableUnits) {
    const abbr = UNIT_ABBR[unit.id] ?? unit.id.toUpperCase().slice(0, 2);
    const name = UNIT_NAME_KO[unit.id] ?? unit.id;
    const isUsed = placedUnits.some((p) => p.metaId === unit.id);
    const isSelected = selectedMetaId === unit.id;
    const isTakenByTeammate = !isUsed && lockedByTeammate.has(unit.id);
    const color = UNIT_COLOR[unit.class] ?? "#888";

    const card = document.createElement("div");
    card.className = [
      "unit-card",
      isSelected ? "selected" : "",
      isUsed ? "used" : "",
      isTakenByTeammate ? "teammate-taken" : "",
    ].filter(Boolean).join(" ");
    card.dataset["metaId"] = unit.id;

    if (isTakenByTeammate) {
      const takenBy = lockedByWhom(unit.id);
      card.title = `팀원(${takenBy?.slice(0, 8) ?? "??"})이 선택 중`;
    }

    const portrait = portraitPath(unit.id);
    const portraitHtml = portrait !== null
      ? `<div class="unit-portrait"><img src="${portrait}" alt="${name}" /></div>`
      : `<div class="unit-abbr" style="background:${color};border-color:${color}">${abbr}</div>`;

    const takenBadge = isTakenByTeammate
      ? `<div class="teammate-taken-badge">팀원 선택 중</div>`
      : "";

    card.innerHTML = `
      ${portraitHtml}
      <div class="unit-info">
        <div class="unit-name">${name}</div>
        <div class="unit-stats">HP ${unit.baseHealth} · MOV ${unit.baseMovement} · ARM ${unit.baseArmor}</div>
        ${takenBadge}
      </div>
    `;
    card.addEventListener("click", () => {
      if (isUsed || isTakenByTeammate) return; // block selection of teammate's unit
      selectedMetaId = selectedMetaId === unit.id ? null : unit.id;
      renderUnitCards(maxUnits);
      broadcastPlacementUpdate();
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
    tileMetas,
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
    broadcastPlacementUpdate(); // notify teammates of updated selection
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

let pollTimeout: ReturnType<typeof setTimeout> | null = null;

function stopPolling(): void {
  if (pollTimeout !== null) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
}

async function pollGameState(gameId: string): Promise<void> {
  const token = api.getToken();
  if (!token) return;

  stopPolling(); // cancel any in-flight poll from a previous game

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/rooms/${gameId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        pollTimeout = setTimeout(() => void poll(), 2_000);
        return;
      }

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
        return; // stop polling — game is over
      }

      pollTimeout = setTimeout(() => void poll(), 1_000);
    } catch {
      pollTimeout = setTimeout(() => void poll(), 2_000);
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
let skillTargetingSkillId: string | null = null;
let skillTargetHighlights: { row: number; col: number }[] = [];
let lastSkillOptions: SkillInfo[] = [];

// ── Overlay animation system ──────────────────────────────────────────────────
interface AttackAnim {
  row: number; col: number;
  kind: "particles" | "damage";
  startMs: number;
  duration: number;
  damage?: number;
}
let hoveredTile: { row: number; col: number; kind: "move" | "attack" | "skill" } | null = null;
let attackAnims: AttackAnim[] = [];
let animRafId: number | null = null;
const prevUnitHp = new Map<string, number>();
const animGridParams = { gridSize: 11, availW: undefined as number | undefined, availH: undefined as number | undefined };

function addAttackParticles(row: number, col: number): void {
  attackAnims.push({ row, col, kind: "particles", startMs: Date.now(), duration: 550 });
  startAnimLoop();
}

function addDamageFloat(row: number, col: number, damage: number): void {
  attackAnims.push({ row, col, kind: "damage", startMs: Date.now(), duration: 950, damage });
  startAnimLoop();
}

// Expose for test/debug
(window as unknown as Record<string, unknown>).__addAttackParticles = addAttackParticles;
(window as unknown as Record<string, unknown>).__addDamageFloat = addDamageFloat;
(window as unknown as Record<string, unknown>).__tickAnimNow = tickAnim;

function startAnimLoop(): void {
  if (animRafId !== null) return;
  animRafId = requestAnimationFrame(tickAnim);
}

function tickAnim(): void {
  const boardCanvas = document.getElementById("board-canvas") as HTMLCanvasElement | null;
  const animCanvas  = document.getElementById("anim-canvas")  as HTMLCanvasElement | null;
  if (!boardCanvas || !animCanvas) { animRafId = null; return; }

  // Sync anim canvas size and position over board canvas
  const wrapEl = boardCanvas.parentElement;
  const boardRect = boardCanvas.getBoundingClientRect();
  const wrapRect  = wrapEl?.getBoundingClientRect() ?? boardRect;
  animCanvas.style.left   = `${boardRect.left - wrapRect.left}px`;
  animCanvas.style.top    = `${boardRect.top  - wrapRect.top}px`;
  animCanvas.style.width  = `${boardRect.width}px`;
  animCanvas.style.height = `${boardRect.height}px`;
  if (animCanvas.width !== boardCanvas.width || animCanvas.height !== boardCanvas.height) {
    animCanvas.width  = boardCanvas.width;
    animCanvas.height = boardCanvas.height;
  }

  const ctx = animCanvas.getContext("2d")!;
  ctx.clearRect(0, 0, animCanvas.width, animCanvas.height);

  // Derive grid params: prefer stored values; fall back to canvas pixel size
  const gs   = animGridParams.gridSize;
  const avW  = animGridParams.availW ?? (boardCanvas.width  + 16);
  const avH  = animGridParams.availH ?? (boardCanvas.height + 16);
  const p    = isoParams(gs, avW, avH);
  const now = Date.now();

  // ── Hover focus ring ────────────────────────────────────────────────────────
  if (hoveredTile) {
    const { row, col, kind } = hoveredTile;
    const { sx, sy } = gridToScreen(row, col, p.cx, p.cy, p.HW, p.HH);
    const pulse = (Math.sin(now / 220) + 1) / 2; // 0..1
    const alpha = 0.55 + 0.45 * pulse;
    const ringColor = kind === "attack" ? `rgba(255,100,80,${alpha})`
                    : kind === "skill"  ? `rgba(200,130,255,${alpha})`
                    :                     `rgba(110,210,255,${alpha})`;
    ctx.save();
    ctx.shadowColor = ringColor;
    ctx.shadowBlur  = p.HW * 0.7;
    ctx.beginPath();
    ctx.moveTo(sx,          sy);
    ctx.lineTo(sx + p.HW,   sy + p.HH);
    ctx.lineTo(sx,          sy + p.HH * 2);
    ctx.lineTo(sx - p.HW,   sy + p.HH);
    ctx.closePath();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth   = 3;
    ctx.stroke();
    ctx.restore();
  }

  // ── Attack animations ───────────────────────────────────────────────────────
  const now2 = Date.now();
  attackAnims = attackAnims.filter(a => now2 - a.startMs < a.duration);
  for (const anim of attackAnims) {
    const t = (now2 - anim.startMs) / anim.duration; // 0..1
    const { sx, sy } = gridToScreen(anim.row, anim.col, p.cx, p.cy, p.HW, p.HH);
    const cx2 = sx, cy2 = sy + p.HH;

    if (anim.kind === "particles") {
      const easeOut = 1 - (1 - t) * (1 - t);
      const maxLen  = p.HW * 0.9;
      // 8 radiating spark lines
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const len   = maxLen * easeOut;
        const fade  = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55;
        ctx.save();
        ctx.globalAlpha  = fade;
        ctx.strokeStyle  = i % 2 === 0 ? "#ff8844" : "#ffcc44";
        ctx.lineWidth    = 2.5;
        ctx.lineCap      = "round";
        ctx.beginPath();
        ctx.moveTo(cx2 + Math.cos(angle) * p.HW * 0.18,
                   cy2 + Math.sin(angle) * p.HH * 0.25);
        ctx.lineTo(cx2 + Math.cos(angle) * len,
                   cy2 + Math.sin(angle) * len * 0.6);
        ctx.stroke();
        ctx.restore();
      }
      // Centre flash
      const flashAlpha = t < 0.25 ? 1 - t / 0.25 * 0.5 : 0;
      if (flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        const grad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, p.HW * 0.45);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,140,60,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx2, cy2, p.HW * 0.45, p.HH * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (anim.kind === "damage" && anim.damage !== undefined) {
      const floatY  = cy2 - p.HH * 3 * t;
      const fadeIn  = Math.min(1, t / 0.12);
      const fadeOut = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const alpha   = fadeIn * fadeOut;
      const fs      = Math.max(16, Math.round(p.HW * 0.72));
      ctx.save();
      ctx.globalAlpha   = alpha;
      ctx.font          = `900 ${fs}px Arial, sans-serif`;
      ctx.textAlign     = "center";
      ctx.textBaseline  = "middle";
      // Outline
      ctx.strokeStyle   = "rgba(0,0,0,0.85)";
      ctx.lineWidth     = fs * 0.18;
      ctx.lineJoin      = "round";
      const txt = anim.damage === 0 ? "MISS" : `-${anim.damage}`;
      ctx.strokeText(txt, cx2, floatY);
      ctx.fillStyle = anim.damage === 0 ? "#aaaaaa" : "#ff3333";
      ctx.fillText(txt,   cx2, floatY);
      ctx.restore();
    }
  }

  // Keep looping while there's something to draw
  if (hoveredTile !== null || attackAnims.length > 0) {
    animRafId = requestAnimationFrame(tickAnim);
  } else {
    // Clear the canvas one final time then stop
    ctx.clearRect(0, 0, animCanvas.width, animCanvas.height);
    animRafId = null;
  }
}

function clearUnitSelection(): void {
  selectedUnitId = null;
  selectedUnitPos = null;
  selectedGameUnitPos = null;
  moveHighlights = [];
  attackRangeHighlights = [];
  attackTargetHighlights = [];
  skillTargetingSkillId = null;
  skillTargetHighlights = [];
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
        skills?: SkillInfo[];
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
      lastSkillOptions = data.skills ?? [];
    }
  } catch { /* ignore */ }

  // Re-render board with highlights
  const activeCanvas = document.getElementById("board-canvas") as HTMLCanvasElement;
  if (activeCanvas) {
    const playerIds = Object.keys(state.players);
    const unitsArr = Object.values(state.units).map((u) => ({
      unitId: u.unitId as string,
      metaId: u.metaId as string,
      playerId: u.playerId as string,
      position: u.position,
      alive: u.alive,
      teamIndex: (state.players[u.playerId as string]?.teamIndex ?? 0) as number,
      currentHealth: u.currentHealth as number,
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
      skillTargetTiles: skillTargetHighlights,
      selectedPos: selectedGameUnitPos,
      selectedUnitId,
      tileMetas,
    });
  }
}

function renderUnitInfoPanel(info: UnitInfoData | null): void {
  const panel = document.getElementById("unit-info-panel");
  if (!panel) return;
  if (info === null) {
    panel.classList.remove("visible");
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

  const panelPortrait = portraitPath(info.metaId);
  const panelIconHtml = panelPortrait !== null
    ? `<div class="unit-info-portrait"><img src="${panelPortrait}" alt="${unitName}" /></div>`
    : `<div class="unit-info-icon" style="background:${unitColor}">${UNIT_ABBR[info.metaId] ?? info.metaId.slice(0, 2).toUpperCase()}</div>`;

  panel.innerHTML = `
    <div class="unit-info-header">
      ${panelIconHtml}
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
    ${(info.skills && info.skills.length > 0) ? `
<div class="unit-info-skills">
  ${info.skills.map(s => {
    if (s.type === 'passive') {
      return `<div class="skill-row skill-passive"><span class="skill-tag-passive">패시브</span><span class="skill-name">${SKILL_NAME_KO[s.skillId] ?? s.skillId}</span><span class="skill-desc">${SKILL_DESC_KO[s.skillId] ?? ''}</span></div>`;
    }
    const canUse = s.canUse;
    return `<div class="skill-row skill-active${canUse ? '' : ' skill-used'}" data-skill-id="${s.skillId}">
      <button class="skill-btn${canUse ? '' : ' skill-btn-disabled'}" ${canUse ? '' : 'disabled'}>✨ ${SKILL_NAME_KO[s.skillId] ?? s.skillId}</button>
      <span class="skill-desc">${SKILL_DESC_KO[s.skillId] ?? ''}</span>
    </div>`;
  }).join('')}
</div>` : ''}
  `;
  panel.classList.add("visible");

  // Skill button click → enter skill targeting mode
  panel.querySelectorAll<HTMLButtonElement>(".skill-btn:not(.skill-btn-disabled)").forEach(btn => {
    const row = btn.closest(".skill-row") as HTMLElement | null;
    const skillId = row?.dataset["skillId"];
    if (!skillId) return;
    btn.addEventListener("click", () => {
      const skill = lastSkillOptions.find(s => s.skillId === skillId);
      if (!skill || !skill.canUse) return;
      skillTargetingSkillId = skillId;
      skillTargetHighlights = skill.skillTargets;
      // Re-render board with skill highlights
      const activeCanvas = document.getElementById("board-canvas") as HTMLCanvasElement;
      if (activeCanvas && lastGameState) {
        const playerIds = Object.keys(lastGameState.players);
        const unitsArr = Object.values(lastGameState.units).map((u) => ({
          unitId: u.unitId as string,
          metaId: u.metaId as string,
          playerId: u.playerId as string,
          position: u.position,
          alive: u.alive,
          teamIndex: (lastGameState!.players[u.playerId as string]?.teamIndex ?? 0) as number,
          currentHealth: u.currentHealth as number,
        }));
        const boardWrap = document.querySelector(".board-wrap") as HTMLElement | null;
        renderIso(activeCanvas, {
          gridSize: lastGameState.map.gridSize ?? 11,
          baseTile: lastGameState.map.baseTile ?? "plain",
          tiles: lastGameState.map.tiles as unknown as Record<string, { attribute: string }>,
          units: unitsArr,
          playerIds,
          moveTiles: moveHighlights,
          attackRangeTiles: attackRangeHighlights,
          attackTargetTiles: attackTargetHighlights,
          skillTargetTiles: skillTargetHighlights,
          selectedPos: selectedGameUnitPos,
          selectedUnitId,
          availW: boardWrap?.clientWidth,
          availH: boardWrap?.clientHeight,
          tileMetas,
        });
      }
      // Visual feedback in the button
      btn.textContent = "🎯 타겟 선택...";
      btn.style.background = "rgba(160,80,255,0.3)";
      btn.style.borderColor = "rgba(180,100,255,0.8)";
    });
  });
}

async function submitAction(action: {
  type: "move" | "attack" | "pass" | "skill";
  unitId?: string;
  skillId?: string;
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

  // Group slots by player team boundary to add dividers
  let lastPIdx = -1;

  turnOrder.forEach((slot, idx) => {
    const unit = slot.unitId ? state.units[slot.unitId] : undefined;
    const pIdx = playerIds.indexOf(slot.playerId);
    const color = PLAYER_COLORS[pIdx >= 0 ? pIdx : 0]!;
    const metaId = unit ? (unit.metaId as string) : "";
    const abbr = metaId ? (UNIT_ABBR[metaId] ?? metaId.slice(0, 2).toUpperCase()) : slot.playerId.slice(0, 2).toUpperCase();
    const unitName = metaId ? (UNIT_NAME_KO[metaId] ?? metaId) : slot.playerId.slice(0, 8);
    const isDead = unit ? !unit.alive : false;
    const isCurrent = idx === currentIdx;
    const isPast = idx < currentIdx;

    // Team boundary divider
    if (pIdx !== lastPIdx && idx > 0) {
      const div = document.createElement("div");
      div.className = "hud-divider";
      bar.appendChild(div);
    }
    lastPIdx = pIdx;

    // HP calculation
    const meta = availableUnits.find(m => m.id === metaId);
    const maxHp = meta?.baseHealth ?? 1;
    const curHp = unit?.currentHealth ?? 0;
    const hpPct = isDead ? 0 : Math.max(0, Math.min(100, (curHp / maxHp) * 100));
    const hpColor = hpPct > 60 ? "#4caf50" : hpPct > 30 ? "#ff9800" : "#f44336";

    // Portrait
    const portrait = metaId ? portraitPath(metaId) : null;
    const portraitHtml = portrait
      ? `<img src="${portrait}" alt="${unitName}" />`
      : `<div class="huc-portrait-fallback" style="color:${color}">${abbr}</div>`;

    // Active effects
    const effectsHtml = (unit?.actionsUsed)
      ? [
          unit.actionsUsed.moved ? `<span class="huc-effect">이동↑</span>` : "",
          unit.actionsUsed.attacked ? `<span class="huc-effect">공격↑</span>` : "",
        ].filter(Boolean).join("") || ""
      : "";

    const card = document.createElement("div");
    card.className = [
      "hud-unit-card",
      isCurrent ? "huc-active" : "",
      isPast ? "huc-past" : "",
      isDead ? "huc-dead" : "",
    ].filter(Boolean).join(" ");
    card.style.setProperty("--team-color", color);
    card.dataset["unitId"] = slot.unitId ?? "";
    card.dataset["metaId"] = metaId;
    card.dataset["playerId"] = slot.playerId;

    card.innerHTML = `
      ${isCurrent ? '<div class="huc-active-arrow">▼</div>' : ""}
      <div class="huc-portrait">${portraitHtml}</div>
      <div class="huc-body">
        <div class="huc-name">${unitName}</div>
        <div class="huc-hp-row">
          <div class="huc-hp-bar"><div class="huc-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
          <div class="huc-hp-text">${isDead ? "☠" : curHp}</div>
        </div>
        <div class="huc-effects">${effectsHtml}</div>
      </div>
    `;

    // Hover: show detail overlay
    card.addEventListener("mouseenter", (e) => showUnitHoverPanel(e, slot.unitId ?? "", state, playerIds));
    card.addEventListener("mousemove", (e) => repositionHoverPanel(e));
    card.addEventListener("mouseleave", () => hideUnitHoverPanel());

    bar.appendChild(card);
  });
}

function showUnitHoverPanel(
  e: MouseEvent,
  unitId: string,
  state: GameStateSnapshot,
  playerIds: string[],
): void {
  const panel = document.getElementById("unit-hover-panel");
  if (!panel || !unitId) return;
  const unit = state.units[unitId];
  if (!unit) return;

  const metaId = unit.metaId as string;
  const pIdx = playerIds.indexOf(unit.playerId as string);
  const color = PLAYER_COLORS[pIdx >= 0 ? pIdx : 0]!;
  const unitName = UNIT_NAME_KO[metaId] ?? metaId;
  const abbr = UNIT_ABBR[metaId] ?? metaId.slice(0, 2).toUpperCase();
  const meta = availableUnits.find(m => m.id === metaId);
  const maxHp = meta?.baseHealth ?? 1;
  const hpPct = unit.alive ? Math.max(0, Math.min(100, (unit.currentHealth / maxHp) * 100)) : 0;
  const hpColor = hpPct > 60 ? "#4caf50" : hpPct > 30 ? "#ff9800" : "#f44336";

  const portrait = portraitPath(metaId);
  const portraitHtml = portrait
    ? `<img src="${portrait}" alt="${unitName}" />`
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:${color};font-weight:700;font-size:16px">${abbr}</div>`;

  const effectsHtml = unit.actionsUsed
    ? [
        unit.actionsUsed.moved ? `<span class="uhp-effect">이동 완료</span>` : "",
        unit.actionsUsed.attacked ? `<span class="uhp-effect">공격 완료</span>` : "",
        unit.actionsUsed.skillUsed ? `<span class="uhp-effect">스킬 사용</span>` : "",
      ].filter(Boolean).join("") || `<span class="uhp-no-effects">행동 가능</span>`
    : `<span class="uhp-no-effects">—</span>`;

  panel.innerHTML = `
    <div class="uhp-header">
      <div class="uhp-portrait" style="border-left:3px solid ${color}">${portraitHtml}</div>
      <div class="uhp-title">
        <div class="uhp-name" style="color:${color}">${unitName}</div>
        <div class="uhp-class">${meta?.class ?? "—"} · ${unit.playerId.slice(0, 12)}</div>
      </div>
    </div>
    <div class="uhp-section">
      <div class="uhp-hp-row">
        <div class="uhp-hp-bar"><div class="uhp-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
        <div class="uhp-hp-text">HP ${unit.currentHealth} / ${maxHp}</div>
      </div>
      <div class="uhp-stats">
        <div class="uhp-stat"><span class="uhp-stat-label">ARM</span><span class="uhp-stat-val">${unit.currentArmor}</span></div>
        <div class="uhp-stat"><span class="uhp-stat-label">BASE</span><span class="uhp-stat-val">${meta?.baseArmor ?? "—"}</span></div>
        <div class="uhp-stat"><span class="uhp-stat-label">MOV</span><span class="uhp-stat-val">${meta?.baseMovement ?? "—"}</span></div>
        <div class="uhp-stat"><span class="uhp-stat-label">POS</span><span class="uhp-stat-val">${unit.position.row},${unit.position.col}</span></div>
      </div>
    </div>
    <div class="uhp-section">
      <div class="uhp-effects">${effectsHtml}</div>
    </div>
  `;

  repositionHoverPanel(e);
  panel.classList.add("visible");
}

function repositionHoverPanel(e: MouseEvent): void {
  const panel = document.getElementById("unit-hover-panel");
  if (!panel) return;
  const pw = panel.offsetWidth || 240;
  const ph = panel.offsetHeight || 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = e.clientX + 12;
  let top = e.clientY - ph - 8;
  if (left + pw > vw - 8) left = e.clientX - pw - 12;
  if (top < 8) top = e.clientY + 16;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function hideUnitHoverPanel(): void {
  document.getElementById("unit-hover-panel")?.classList.remove("visible");
}

// ─── Game rendering ───────────────────────────────────────────────────────────

function renderGame(state: GameStateSnapshot): void {
  const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;
  if (!canvas) return;

  const gridSize = state.map.gridSize ?? 11;
  const playerIds = Object.keys(state.players);
  const unitsArr = Object.values(state.units).map((u) => ({
    unitId: u.unitId as string,
    metaId: u.metaId as string,
    playerId: u.playerId as string,
    position: u.position,
    alive: u.alive,
    teamIndex: (state.players[u.playerId as string]?.teamIndex ?? 0) as number,
    currentHealth: u.currentHealth as number,
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

  // board-wrap 크기 기반 동적 타일 크기 계산
  const boardWrap = document.querySelector(".board-wrap") as HTMLElement | null;
  const availW = boardWrap?.clientWidth;
  const availH = boardWrap?.clientHeight;

  // Update overlay animation grid params
  animGridParams.gridSize = gridSize;
  animGridParams.availW   = availW;
  animGridParams.availH   = availH;

  // Detect HP changes → attack particles + floating damage numbers
  for (const u of unitsArr) {
    const prev = prevUnitHp.get(u.unitId);
    const curr = u.currentHealth;
    if (prev !== undefined && curr < prev) {
      addAttackParticles(u.position.row, u.position.col);
      addDamageFloat(u.position.row, u.position.col, prev - curr);
    }
    prevUnitHp.set(u.unitId, curr);
  }

  // Set up board interaction
  setupBoardClick(canvas, state, isMyTurn, gridSize, availW, availH);

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
    skillTargetTiles: skillTargetHighlights,
    selectedPos: selectedGameUnitPos,
    selectedUnitId,
    availW,
    availH,
    tileMetas,
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
  const abbr = UNIT_ABBR[unit.metaId as string] ?? (unit.metaId as string).slice(0, 2).toUpperCase();
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
  availW?: number,
  availH?: number,
): void {
  const newCanvas = canvas.cloneNode(true) as HTMLCanvasElement;
  canvas.parentNode?.replaceChild(newCanvas, canvas);

  newCanvas.style.cursor = isMyTurn ? "pointer" : "default";

  const customCursor = document.getElementById("custom-cursor");

  function setCustomCursor(x: number, y: number, mode: "move" | "attack" | "destroy" | "no-attack" | null): void {
    if (!customCursor) return;
    if (mode === null) {
      customCursor.className = "";
      return;
    }
    customCursor.style.left = `${x}px`;
    customCursor.style.top = `${y}px`;
    if (mode === "move") {
      customCursor.textContent = "👟";
      customCursor.className = "cc-move";
    } else if (mode === "attack") {
      customCursor.textContent = "⚔️";
      customCursor.className = "cc-attack";
    } else if (mode === "no-attack") {
      customCursor.textContent = "🚫";
      customCursor.className = "cc-no-attack";
    } else {
      customCursor.innerHTML = '<span class="cc-ball"></span>';
      customCursor.className = "cc-destroy";
    }
  }

  // ── Hover: tooltip + cursor feedback ────────────────────────────────────────
  newCanvas.addEventListener("mousemove", (e) => {
    const rect = newCanvas.getBoundingClientRect();
    const p = isoParams(gridSize, availW, availH);
    const mx = (e.clientX - rect.left) * (newCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (newCanvas.height / rect.height);
    const { row, col } = screenToGrid(mx, my, p.cx, p.cy, p.HW, p.HH);

    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
      hideHoverTooltip();
      setCustomCursor(0, 0, null);
      newCanvas.style.cursor = isMyTurn ? "pointer" : "default";
      return;
    }

    const hoveredUnit = Object.values(state.units).find(
      (u) => u.alive && u.position.row === row && u.position.col === col,
    );

    const isAttackable = attackTargetHighlights.some(t => t.row === row && t.col === col);
    const isMoveable = moveHighlights.some(t => t.row === row && t.col === col);
    const isSkillTarget = skillTargetingSkillId !== null && skillTargetHighlights.some(t => t.row === row && t.col === col);

    // Enemy unit hovered but not attackable (out of range or attacked already)
    const isEnemyNotAttackable = hoveredUnit !== undefined
      && hoveredUnit.playerId !== humanPlayerId
      && selectedUnitId !== null
      && !isAttackable
      && isMyTurn;

    // Hover focus tile (overlay canvas)
    let newHoverKind: "move" | "attack" | "skill" | null = null;
    if      (isSkillTarget && isMyTurn)  newHoverKind = "skill";
    else if (isAttackable  && isMyTurn)  newHoverKind = "attack";
    else if (isMoveable    && isMyTurn)  newHoverKind = "move";
    const newHover = newHoverKind ? { row, col, kind: newHoverKind } : null;
    if (!newHover !== !hoveredTile ||
        newHover?.row !== hoveredTile?.row ||
        newHover?.col !== hoveredTile?.col ||
        newHover?.kind !== hoveredTile?.kind) {
      hoveredTile = newHover;
      startAnimLoop();
    }

    if (isSkillTarget && isMyTurn) {
      if (hoveredUnit) showHoverTooltip(e.clientX, e.clientY, hoveredUnit, false, false);
      setCustomCursor(e.clientX, e.clientY, "attack"); // reuse attack cursor for skill targets
      newCanvas.style.cursor = "none";
    } else if (isAttackable && isMyTurn) {
      showHoverTooltip(e.clientX, e.clientY, hoveredUnit!, true, false);
      setCustomCursor(e.clientX, e.clientY, "attack");
      newCanvas.style.cursor = "none";
    } else if (isMoveable && isMyTurn) {
      hideHoverTooltip();
      setCustomCursor(e.clientX, e.clientY, "move");
      newCanvas.style.cursor = "none";
    } else if (isEnemyNotAttackable) {
      showHoverTooltip(e.clientX, e.clientY, hoveredUnit!, false, false);
      setCustomCursor(e.clientX, e.clientY, "no-attack");
      newCanvas.style.cursor = "none";
    } else {
      if (hoveredUnit) showHoverTooltip(e.clientX, e.clientY, hoveredUnit, false, false);
      else hideHoverTooltip();
      setCustomCursor(0, 0, null);
      newCanvas.style.cursor = hoveredUnit ? "pointer" : (isMyTurn ? "default" : "default");
    }
  });

  newCanvas.addEventListener("mouseleave", () => {
    hideHoverTooltip();
    setCustomCursor(0, 0, null);
    hoveredTile = null;
    // animLoop will stop naturally once hoveredTile is null and anims finish
  });

  newCanvas.addEventListener("click", (e) => {
    const rect = newCanvas.getBoundingClientRect();
    const p = isoParams(gridSize, availW, availH);
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

    // Check if clicking a skill target tile
    if (skillTargetingSkillId !== null && skillTargetHighlights.some(t => t.row === row && t.col === col)) {
      if (selectedUnitId !== null) {
        void submitAction({ type: "skill", unitId: selectedUnitId, skillId: skillTargetingSkillId, targetPosition: { row, col } });
        clearUnitSelection();
        return;
      }
    }

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
        // Clicked a different own unit — info already shown above; do not change selection
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
          teamIndex: (state.players[u.playerId as string]?.teamIndex ?? 0) as number,
          currentHealth: u.currentHealth as number,
        }));
        renderIso(newCanvas, {
          gridSize,
          baseTile: state.map.baseTile ?? "plain",
          tiles: state.map.tiles as unknown as Record<string, { attribute: string }>,
          units: unitsArr, playerIds,
          tileMetas,
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
        teamIndex: (state.players[u.playerId as string]?.teamIndex ?? 0) as number,
        currentHealth: u.currentHealth as number,
      }));
      renderIso(newCanvas, {
        gridSize,
        baseTile: state.map.baseTile ?? "plain",
        tiles: state.map.tiles as unknown as Record<string, { attribute: string }>,
        units: unitsArr, playerIds,
        tileMetas,
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
  stopPolling(); // game is over — no more polling needed
  ws.disconnect();

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

      // Unit display info — use the shared UNIT_NAME_KO / UNIT_ABBR maps
      const metaId = unit.metaId as string;
      const unitName = UNIT_NAME_KO[metaId] ?? UNIT_ABBR[metaId] ?? metaId;

      item.innerHTML = `
        <span class="unit-order-num">${idx + 1}</span>
        <span class="unit-order-icon">${getUnitEmoji(metaId)}</span>
        <span class="unit-order-name">${unitName}</span>
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
  // Direct metaId lookup first
  if (UNIT_EMOJI[metaId]) return UNIT_EMOJI[metaId]!;
  // Fallback: class-name substring match (future unit types)
  if (metaId.includes("fighter") || metaId.includes("knight")) return "⚔️";
  if (metaId.includes("tank")) return "🛡️";
  if (metaId.includes("ranger")) return "🏹";
  if (metaId.includes("mage")) return "🔮";
  if (metaId.includes("support") || metaId.includes("healer")) return "💚";
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

  if (!currentGameId) return;

  if (ws.connected) {
    ws.sendUnitOrder(currentGameId, orderedIds);
  } else {
    // REST fallback when WS is not connected
    const token = api.getToken();
    if (token) {
      fetch(`${API_BASE}/api/v1/rooms/${currentGameId}/unit-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ playerId: humanPlayerId, unitOrder: orderedIds }),
      }).catch(() => { /* ignore — auto-timeout will handle it */ });
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// Rooms screen
document.getElementById("rooms-back")?.addEventListener("click", () => {
  stopRoomsRefresh();
  showScreen("screen-menu");
});
document.getElementById("rooms-refresh")?.addEventListener("click", () => {
  void refreshRooms();
});
document.getElementById("rooms-create-btn")?.addEventListener("click", () => {
  stopRoomsRefresh();
  showScreen("screen-menu");
});

document.getElementById("lobby-back")?.addEventListener("click", () => {
  stopPolling();
  ws.disconnect();
  currentGameId = null;
  sessionStorage.removeItem("ab_game_id");
  // Re-enable the start button so a new game can be created next time
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement | null;
  if (startBtn) startBtn.disabled = false;
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
  stopPolling();
  ws.disconnect();
  currentGameId = null;
  sessionStorage.removeItem("ab_game_id");
  logEntries = [];
  placedUnits = [];
  renderLog();
  document.getElementById("game-over-container")?.classList.add("hidden");
  showScreen("screen-menu");
});

// ─── Session restore on page load ─────────────────────────────────────────────

async function tryRestoreSession(): Promise<void> {
  const savedGameId = sessionStorage.getItem("ab_game_id");
  if (!savedGameId) return;

  const token = api.getToken();
  // Re-authenticate with the persisted player ID to get a fresh token
  try {
    await api.login(humanPlayerId);
  } catch {
    sessionStorage.removeItem("ab_game_id");
    return;
  }

  // Check if the game still exists and is active
  try {
    const res = await fetch(`${API_BASE}/api/v1/rooms/${savedGameId}`, {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    });
    if (!res.ok) {
      sessionStorage.removeItem("ab_game_id");
      return;
    }
    const data = (await res.json()) as { status: string; state: GameStateSnapshot };
    if (data.status === "ended" || data.state?.phase === "result") {
      sessionStorage.removeItem("ab_game_id");
      return;
    }

    // Game is still active — restore
    currentGameId = savedGameId;
    const pState = data.state?.players?.[humanPlayerId];
    if (pState !== undefined) humanTeamIndex = pState.teamIndex;

    showScreen("screen-game");
    if (data.state) {
      lastGameState = data.state;
      renderGame(data.state);
    }

    // Reconnect WS then start polling
    ws.connect(WS_BASE, savedGameId, humanPlayerId, {
      token: api.getToken() ?? "",
      onJoined: () => { addLog("게임 재접속 완료"); },
      onStateUpdate: (state) => {
        lastGameState = state;
        if (state.phase === "battle" || state.phase === "result") renderGame(state);
      },
      onGameEnd: (winnerIds, reason) => { showGameOver(winnerIds, reason); },
      onUnitOrderRequest: (aliveUnitIds, timeoutMs) => { showUnitOrderDraft(aliveUnitIds, timeoutMs); },
    });
    pollGameState(savedGameId);
    addLog(`세션 복원: ${savedGameId}`);
  } catch {
    sessionStorage.removeItem("ab_game_id");
  }
}

preloadSprites();
void tryRestoreSession();

// ─── 타일 메타데이터 초기 로드 ────────────────────────────────────────────────
// 서버에서 타일 목록을 한 번만 가져와 tileMetas Map에 저장.
// impassable 판별 등 렌더링에 사용됨.
api.fetchTileMetas().then((metas) => {
  tileMetas = new Map(metas.map((m) => [m.tileType, m]));
}).catch(() => {
  // 실패해도 렌더링은 정상 동작 (impassable 테두리만 표시 안 됨)
});

// ─── 창 크기 변경 시 게임 보드 재렌더링 ───────────────────────────────────────
// ResizeObserver로 board-wrap 크기 변화를 감지해 캔버스를 즉시 재렌더링
const boardWrapEl = document.querySelector(".board-wrap");
if (boardWrapEl) {
  new ResizeObserver(() => {
    if (lastGameState && document.getElementById("screen-game")?.classList.contains("active")) {
      renderGame(lastGameState);
    }
  }).observe(boardWrapEl);
}

renderMenu();
