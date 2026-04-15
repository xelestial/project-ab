/**
 * TokenStore — refresh token 관리.
 *
 * Refresh token은 불투명 랜덤 문자열로 저장.
 * Phase 3: 인메모리. Phase 4: Redis TTL 기반으로 교체.
 *
 * 보안 원칙:
 * - Access token:  short-lived (15 min), stateless JWT
 * - Refresh token: long-lived (7 days), stored server-side (revocable)
 * - 로그아웃 시 refresh token 삭제 → 즉시 무효화
 * - 토큰 재사용 감지: 동일 refresh token이 2번 이상 사용되면 해당 플레이어 모든 토큰 폐기
 */
import { randomBytes } from "crypto";

export interface RefreshRecord {
  playerId: string;
  token: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ITokenStore {
  issue(playerId: string): RefreshRecord;
  verify(token: string): Promise<RefreshRecord | undefined>;
  markUsed(token: string): void;
  revoke(token: string): void;
  revokeAll(playerId: string): void;
}

export class MemoryTokenStore implements ITokenStore {
  /** token → record */
  private readonly records = new Map<string, RefreshRecord>();
  /** playerId → Set<token> */
  private readonly byPlayer = new Map<string, Set<string>>();

  issue(playerId: string): RefreshRecord {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const record: RefreshRecord = {
      playerId,
      token,
      issuedAt: now,
      expiresAt: now + REFRESH_TTL_MS,
      used: false,
    };

    this.records.set(token, record);

    const set = this.byPlayer.get(playerId) ?? new Set();
    set.add(token);
    this.byPlayer.set(playerId, set);

    return record;
  }

  async verify(token: string): Promise<RefreshRecord | undefined> {
    const record = this.records.get(token);
    if (record === undefined) return undefined;

    // Expired
    if (record.expiresAt < Date.now()) {
      this.revoke(token);
      return undefined;
    }

    // Reuse attack detected — revoke all tokens for this player
    if (record.used) {
      this.revokeAll(record.playerId);
      return undefined;
    }

    return record;
  }

  /**
   * Mark as used (rotation: one-time use then refresh).
   * Caller must issue a new refresh token immediately after.
   */
  markUsed(token: string): void {
    const record = this.records.get(token);
    if (record !== undefined) record.used = true;
  }

  revoke(token: string): void {
    const record = this.records.get(token);
    if (record !== undefined) {
      this.byPlayer.get(record.playerId)?.delete(token);
    }
    this.records.delete(token);
  }

  revokeAll(playerId: string): void {
    const tokens = this.byPlayer.get(playerId);
    if (tokens !== undefined) {
      for (const t of tokens) {
        this.records.delete(t);
      }
    }
    this.byPlayer.delete(playerId);
  }

  /** Clean up expired tokens (call periodically or on-demand) */
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [token, record] of this.records) {
      if (record.expiresAt < now) {
        this.revoke(token);
        count++;
      }
    }
    return count;
  }
}
