/**
 * 13 — 전투 메카닉 검증 (헤드리스 API)
 *
 * 브라우저 없이 REST API만으로 전투 메카닉을 결정적(deterministic)으로 검증합니다.
 * 두 플레이어를 모두 API로 직접 제어하므로 MCTS 무작위성이나 타이밍 문제가 없습니다.
 *
 * Scenario A: r1 원거리 HP 감소 검증
 *   배치: r1(4,5) vs b1(8,5) — 같은 열(col=5), 거리=4, 사거리 2-4 내 → 이동 없이 즉시 공격 가능
 *   검증: r1 턴에 attack 액션 → b1 HP가 weapon.damage(3)만큼 감소
 */

import { test, expect, request } from "@playwright/test";

const SERVER = "http://localhost:3000";

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────

async function login(playerId: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SERVER}/api/v1/auth/login`, { data: { playerId } });
  expect(res.ok()).toBe(true);
  const { accessToken } = await res.json();
  return {
    ctx,
    accessToken,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  };
}

async function createRoom(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  headers: Record<string, string>,
  mapId = "map_test_01",
  playerCount = 2,
): Promise<string> {
  const res = await ctx.post(`${SERVER}/api/v1/rooms`, {
    headers,
    data: { mapId, playerCount },
  });
  expect(res.ok()).toBe(true);
  const { gameId } = await res.json();
  return gameId as string;
}

/** 게임이 battle/running 단계에 도달할 때까지 폴링 */
async function waitForBattle(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  headers: Record<string, string>,
  gameId: string,
  timeoutMs = 8000,
): Promise<{ phase: string; units: Record<string, { playerId: string; metaId: string; position: { row: number; col: number }; currentHealth: number; alive: boolean }> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await ctx.get(`${SERVER}/api/v1/rooms/${gameId}`, { headers });
    if (!res.ok()) break;
    const body = await res.json();
    const phase = body.status ?? body.state?.phase ?? "";
    const units = body.state?.units ?? {};
    if (["battle", "running"].includes(phase)) return { phase, units };
    await new Promise(r => setTimeout(r, 150));
  }
  return { phase: "timeout", units: {} };
}

/** 양쪽 플레이어의 유닛 순서를 제출 (collectUnitOrders 30초 대기 회피) */
async function submitUnitOrder(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  headers: Record<string, string>,
  gameId: string,
  playerId: string,
  unitOrder: string[],
): Promise<void> {
  await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/unit-order`, {
    headers,
    data: { playerId, unitOrder },
  });
}

/** 액션 제출 */
async function submitAction(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  headers: Record<string, string>,
  gameId: string,
  playerId: string,
  action: Record<string, unknown>,
): Promise<void> {
  await ctx.post(`${SERVER}/api/v1/rooms/${gameId}/action`, {
    headers,
    data: { playerId, action },
  });
}

// ─── Scenario A: r1 원거리 HP 감소 ──────────────────────────────────────────

test.describe("Scenario A: r1 원거리 공격 HP 감소", () => {
  /**
   * 배치 전략:
   *  - GridSize = 11 (map_test_01 기본값)
   *  - Player 0 (host) 유효 행: 0-4 (floor(11/2)-1)
   *  - Player 1 (guest) 유효 행: 5-10 (floor(11/2))
   *
   *  r1 @ (4,5)  ←→  b1 @ (8,5)
   *  → 같은 열(col=5), 직교 거리=4, wpn_ra_penetrate_absorb 사거리 2-4 내
   *  → r1이 이동 없이 즉시 공격 가능
   *
   *  r1 damage = 3, b1 armor = 0 → b1 HP: 5 → 2
   */
  test("r1이 같은 열의 적 유닛을 원거리 공격하여 HP를 3 감소시킨다", async () => {
    const HOST_ID = "hs-r1-combat-host";
    const GUEST_ID = "hs-r1-combat-guest";

    const host = await login(HOST_ID);
    const guest = await login(GUEST_ID);

    const gameId = await createRoom(host.ctx, host.headers);

    // 양쪽 참가 (teamIndex 올바른 할당을 위해)
    await host.ctx.post(`${SERVER}/api/v1/rooms/${gameId}/join`, {
      headers: host.headers,
      data: { playerId: HOST_ID },
    });
    await guest.ctx.post(`${SERVER}/api/v1/rooms/${gameId}/join`, {
      headers: guest.headers,
      data: { playerId: GUEST_ID },
    });

    // ── Host 배치: r1@(4,5), b1@(1,1), a1@(1,2) ──────────────────────────────
    // r1이 col=5, 가장 적 쪽 row=4에 배치 → b1@(8,5)까지 거리 4
    const hostPlaceRes = await host.ctx.post(`${SERVER}/api/v1/rooms/${gameId}/place`, {
      headers: host.headers,
      data: {
        playerId: HOST_ID,
        units: [
          { metaId: "r1", position: { row: 4, col: 5 } },
          { metaId: "b1", position: { row: 1, col: 1 } },
          { metaId: "a1", position: { row: 1, col: 2 } },
        ],
      },
    });
    expect([200, 201]).toContain(hostPlaceRes.status());

    // ── Guest 배치: b1@(8,5) [타겟], a1@(9,9), f1@(9,8) ──────────────────────
    // b1@(8,5): r1과 같은 열, 거리 4 — 즉시 공격 가능
    const guestPlaceRes = await guest.ctx.post(`${SERVER}/api/v1/rooms/${gameId}/place`, {
      headers: guest.headers,
      data: {
        playerId: GUEST_ID,
        units: [
          { metaId: "b1", position: { row: 8, col: 5 } },  // 타겟 유닛
          { metaId: "a1", position: { row: 9, col: 9 } },
          { metaId: "f1", position: { row: 9, col: 8 } },
        ],
      },
    });
    expect([200, 201]).toContain(guestPlaceRes.status());

    // ── Battle 단계 진입 대기 ─────────────────────────────────────────────────
    const { phase, units } = await waitForBattle(host.ctx, host.headers, gameId);
    expect(["battle", "running"]).toContain(phase);

    // ── 유닛 ID 식별 ──────────────────────────────────────────────────────────
    const unitEntries = Object.entries(units);

    const r1UnitId = unitEntries.find(
      ([, u]) => u.metaId === "r1" && u.playerId === HOST_ID,
    )?.[0];

    const targetUnitId = unitEntries.find(
      ([, u]) => u.playerId === GUEST_ID && u.position.row === 8 && u.position.col === 5,
    )?.[0];

    expect(r1UnitId).toBeTruthy();
    expect(targetUnitId).toBeTruthy();
    if (!r1UnitId || !targetUnitId) return;

    const initialHp = units[targetUnitId]!.currentHealth;

    // ── 유닛 순서 제출 (collectUnitOrders 30초 타이아웃 방지) ─────────────────
    const hostUnitIds = unitEntries
      .filter(([, u]) => u.playerId === HOST_ID && u.alive)
      .map(([id]) => id);
    const guestUnitIds = unitEntries
      .filter(([, u]) => u.playerId === GUEST_ID && u.alive)
      .map(([id]) => id);

    // 게임 루프가 requestUnitOrder를 호출할 시간을 주고 즉시 제출
    await new Promise(r => setTimeout(r, 250));
    await Promise.all([
      submitUnitOrder(host.ctx, host.headers, gameId, HOST_ID, hostUnitIds),
      submitUnitOrder(guest.ctx, guest.headers, gameId, GUEST_ID, guestUnitIds),
    ]);

    // ── 턴 루프: r1 턴을 기다려 공격, 나머지는 pass ────────────────────────────
    let r1Attacked = false;
    let lastProcessedRound = 1;

    for (let iteration = 0; iteration < 40; iteration++) {
      await new Promise(r => setTimeout(r, 200));

      const stateRes = await host.ctx.get(`${SERVER}/api/v1/rooms/${gameId}`, {
        headers: host.headers,
      });
      if (!stateRes.ok()) break;
      const body = await stateRes.json();
      const state = body.state as {
        phase: string;
        round: number;
        turnOrder: Array<{ playerId: string; unitId?: string; priority: number }>;
        currentTurnIndex: number;
        units: typeof units;
      } | undefined;

      if (!state) continue;
      if (state.phase === "result") break;
      if (!state.turnOrder || state.turnOrder.length === 0) continue;

      // 새 라운드 시작 → 유닛 순서 재제출
      if (state.round > lastProcessedRound) {
        lastProcessedRound = state.round;
        const aliveHostIds = Object.entries(state.units)
          .filter(([, u]) => u.playerId === HOST_ID && u.alive)
          .map(([id]) => id);
        const aliveGuestIds = Object.entries(state.units)
          .filter(([, u]) => u.playerId === GUEST_ID && u.alive)
          .map(([id]) => id);
        await new Promise(r => setTimeout(r, 250));
        await Promise.all([
          submitUnitOrder(host.ctx, host.headers, gameId, HOST_ID, aliveHostIds),
          submitUnitOrder(guest.ctx, guest.headers, gameId, GUEST_ID, aliveGuestIds),
        ]);
        continue;
      }

      const slot = state.turnOrder[state.currentTurnIndex];
      if (!slot) break;

      const activePlayerId = slot.playerId;
      const activeUnitId = slot.unitId;
      if (!activeUnitId) continue;

      if (activePlayerId === HOST_ID && activeUnitId === r1UnitId) {
        // r1 턴 — (8,5) 공격
        // unit-options로 공격 가능 여부 확인
        const optRes = await host.ctx.get(
          `${SERVER}/api/v1/rooms/${gameId}/unit-options?playerId=${HOST_ID}&unitId=${r1UnitId}`,
          { headers: host.headers },
        );
        let canAttack = false;
        if (optRes.ok()) {
          const opts = await optRes.json() as { canAttack: boolean; attackableTiles: Array<{ row: number; col: number }> };
          canAttack = opts.canAttack &&
            opts.attackableTiles.some((t) => t.row === 8 && t.col === 5);
        }

        if (canAttack) {
          await submitAction(host.ctx, host.headers, gameId, HOST_ID, {
            type: "attack",
            unitId: r1UnitId,
            targetPosition: { row: 8, col: 5 },
          });
          r1Attacked = true;
          break;
        } else {
          // 공격 불가 (예기치 않은 상황) — pass 후 다음 턴 대기
          await submitAction(host.ctx, host.headers, gameId, HOST_ID, {
            type: "pass",
            unitId: r1UnitId,
          });
        }
      } else if (activePlayerId === HOST_ID) {
        // 다른 Host 유닛 — pass
        await submitAction(host.ctx, host.headers, gameId, HOST_ID, {
          type: "pass",
          unitId: activeUnitId,
        });
      } else if (activePlayerId === GUEST_ID) {
        // Guest 유닛 — pass (AI 없이 직접 제어)
        await submitAction(guest.ctx, guest.headers, gameId, GUEST_ID, {
          type: "pass",
          unitId: activeUnitId,
        });
      }
    }

    // ── r1이 공격했는지 확인 ──────────────────────────────────────────────────
    expect(r1Attacked).toBe(true);

    // ── 공격 후 HP 감소 확인 ─────────────────────────────────────────────────
    // 공격 처리 후 상태 반영 대기
    await new Promise(r => setTimeout(r, 300));
    const finalStateRes = await host.ctx.get(`${SERVER}/api/v1/rooms/${gameId}`, {
      headers: host.headers,
    });
    expect(finalStateRes.ok()).toBe(true);
    const finalBody = await finalStateRes.json();
    const finalUnits = finalBody.state?.units as typeof units | undefined;
    const finalHp = finalUnits?.[targetUnitId]?.currentHealth;

    expect(finalHp).toBeDefined();
    // r1 weapon damage=3, b1 armor=0 → HP 5-3=2
    expect(finalHp).toBeLessThan(initialHp);
    expect(finalHp).toBe(initialHp - 3);
  }, 60_000);
});
