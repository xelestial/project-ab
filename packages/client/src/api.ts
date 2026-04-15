/**
 * REST API client — thin wrapper over fetch.
 * Server URL is read from game-modes.json at runtime.
 */

export interface ApiLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface ApiCreateRoomResponse {
  gameId: string;
  createdBy: string;
}

export interface ApiAddAiResponse {
  aiPlayerId: string;
  gameId: string;
  started: boolean;
}

export class ApiClient {
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {}

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async login(playerId: string): Promise<ApiLoginResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = (await res.json()) as ApiLoginResponse;
    this.token = data.accessToken;
    return data;
  }

  // ─── Rooms ────────────────────────────────────────────────────────────────

  async createRoom(opts: {
    mapId: string;
    playerCount: number;
    draftPoolIds?: string[];
  }): Promise<ApiCreateRoomResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Create room failed: ${res.status}`);
    return (await res.json()) as ApiCreateRoomResponse;
  }

  async joinRoom(
    gameId: string,
    playerId: string,
  ): Promise<{ playerId: string; teamIndex: number; alreadyRegistered?: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/v1/rooms/${gameId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) throw new Error(`Join room failed: ${res.status}`);
    return (await res.json()) as { playerId: string; teamIndex: number; alreadyRegistered?: boolean };
  }

  async addAi(
    gameId: string,
    opts: { iterations?: number; timeoutMs?: number } = {},
  ): Promise<ApiAddAiResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/rooms/${gameId}/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Add AI failed: ${res.status}`);
    return (await res.json()) as ApiAddAiResponse;
  }

  getToken(): string | null {
    return this.token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
