/**
 * JWT auth — token creation, verification, Fastify hooks.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { createToken, verifyToken } from "../auth/jwt-auth.js";

describe("JWT auth", () => {
  describe("createToken / verifyToken", () => {
    it("creates a valid token that verifies successfully", () => {
      // Use the default secret ("dev-secret-change-in-production")
      const token = createToken("player-1");
      const result = verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe("player-1");
      expect(result.payload?.iss).toBe("ab-server");
    });

    it("includes role in payload", () => {
      const token = createToken("p1", "admin");
      const result = verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.role).toBe("admin");
    });

    it("fails verification with wrong secret", () => {
      const token = createToken("p1");
      const result = verifyToken(token, "wrong-secret");

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("invalid_signature");
    });

    it("fails for malformed token (not 3 parts)", () => {
      const result = verifyToken("not.valid");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("malformed");
    });

    it("fails for expired token", () => {
      // Manually craft a token with exp in the past
      const past = Math.floor(Date.now() / 1000) - 3600;
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub: "p1", iss: "ab-server", iat: past - 100, exp: past })).toString("base64url");

      const sig = createHmac("sha256", "dev-secret-change-in-production")
        .update(`${header}.${payload}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = verifyToken(`${header}.${payload}.${sig}`);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("expired");
    });

    it("fails for wrong issuer", () => {
      const past = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub: "p1", iss: "other-server", iat: past, exp: past + 3600 })).toString("base64url");

      const sig = createHmac("sha256", "dev-secret-change-in-production")
        .update(`${header}.${payload}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = verifyToken(`${header}.${payload}.${sig}`);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("wrong_issuer");
    });

    it("fails for malformed payload JSON", () => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from("not-json").toString("base64url");

      const sig = createHmac("sha256", "dev-secret-change-in-production")
        .update(`${header}.${payload}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const result = verifyToken(`${header}.${payload}.${sig}`);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("malformed");
    });
  });
});
