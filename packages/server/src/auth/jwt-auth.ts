/**
 * JWT authentication middleware for Fastify.
 *
 * Phase 2: lightweight JWT verification without external library dependency.
 * Uses Node.js built-in `crypto` for HMAC-SHA256 signature validation.
 *
 * Token format: standard JWT (header.payload.signature), HS256 only.
 *
 * Configuration:
 *   JWT_SECRET  — signing secret (required in production)
 *   JWT_ISSUER  — expected issuer claim (default: "ab-server")
 *
 * Usage:
 *   fastify.addHook("preHandler", jwtAuthHook);
 *   // or selectively:
 *   fastify.post("/api/v1/rooms", { preHandler: requireAuth }, handler);
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { createHmac } from "crypto";

// ─── Config ───────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-change-in-production";
const JWT_ISSUER = process.env["JWT_ISSUER"] ?? "ab-server";
const JWT_ALGORITHM = "HS256";
/** Access token lifetime: 15 minutes (short-lived, stateless) */
const JWT_ACCESS_AGE_S = 15 * 60;
/** Keep backward-compatible alias — used by tests that don't specify */
export const JWT_MAX_AGE_S = JWT_ACCESS_AGE_S;

// ─── Token shapes ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;     // playerId
  iss: string;     // issuer
  iat: number;     // issued at (unix seconds)
  exp: number;     // expiration (unix seconds)
  role?: string;   // optional: "player" | "admin"
}

export type AuthResult =
  | { valid: true; payload: JwtPayload }
  | { valid: false; errorCode: "missing" | "malformed" | "invalid_signature" | "expired" | "wrong_issuer" };

// ─── Pure functions ───────────────────────────────────────────────────────────

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function signPayload(header: string, payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Verify a JWT token string. Returns AuthResult with valid=true and decoded payload on success.
 */
export function verifyToken(token: string, secret: string = JWT_SECRET): AuthResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, errorCode: "malformed" };
  }

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // Verify signature
  const expectedSig = signPayload(headerB64, payloadB64, secret);
  if (sigB64 !== expectedSig) {
    return { valid: false, errorCode: "invalid_signature" };
  }

  // Decode payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;
  } catch {
    return { valid: false, errorCode: "malformed" };
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    return { valid: false, errorCode: "expired" };
  }

  // Check issuer
  if (payload.iss !== JWT_ISSUER) {
    return { valid: false, errorCode: "wrong_issuer" };
  }

  return { valid: true, payload };
}

/**
 * Create a signed JWT token for a player.
 */
export function createToken(playerId: string, role: string = "player"): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: JWT_ALGORITHM, typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: playerId,
      iss: JWT_ISSUER,
      iat: now,
      exp: now + JWT_ACCESS_AGE_S,
      role,
    }),
  );
  const sig = signPayload(header, payload, JWT_SECRET);
  return `${header}.${payload}.${sig}`;
}

// ─── Fastify hooks ────────────────────────────────────────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    jwtPayload?: JwtPayload;
  }
}

/**
 * Fastify preHandler hook — validates Bearer token in Authorization header.
 * Sets req.jwtPayload on success; replies 401 on failure.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers["authorization"];
  if (auth === undefined || !auth.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "Unauthorized", code: "missing" });
    return;
  }

  const token = auth.slice(7); // Remove "Bearer "
  const result = verifyToken(token);

  if (!result.valid) {
    await reply.code(401).send({ error: "Unauthorized", code: result.errorCode });
    return;
  }

  req.jwtPayload = result.payload;
}

/**
 * Optional auth — does not block but sets jwtPayload if token is valid.
 */
export async function optionalAuth(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const auth = req.headers["authorization"];
  if (auth === undefined || !auth.startsWith("Bearer ")) return;

  const token = auth.slice(7);
  const result = verifyToken(token);
  if (result.valid) {
    req.jwtPayload = result.payload;
  }
}
