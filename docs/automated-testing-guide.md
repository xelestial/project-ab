# AI 자동화 테스트 가이드

> 이 문서는 **인간 시트(HumanSheet)에 AI 어댑터를 주입**하여 게임을 자동 플레이시키고,
> 룰 준수 여부를 검증하는 방법을 설명합니다.

---

## 목차

1. [게임 실행 방법](#1-게임-실행-방법)
2. [게임 개요](#2-게임-개요)
3. [게임 룰 레퍼런스](#3-게임-룰-레퍼런스)
4. [아키텍처 — IPlayerAdapter](#4-아키텍처--iplayeradapter)
5. [제공 AI 어댑터](#5-제공-ai-어댑터)
6. [테스트 작성 방법](#6-테스트-작성-방법)
7. [결과 해석 및 통계](#7-결과-해석-및-통계)
8. [검증 체크리스트](#8-검증-체크리스트)
9. [실전 예시 — 4인 2v2 전체 검증](#9-실전-예시--4인-2v2-전체-검증)

---

## 1. 게임 실행 방법

### 1-1. 사전 준비

```bash
# 의존성 설치 (최초 1회)
pnpm install

# 전체 패키지 빌드 (서버 실행 전 필요)
pnpm build
```

### 1-2. 서버 실행

```bash
# 기본 실행 (포트 3000)
pnpm -F @ab/server start

# 포트 지정
node packages/server/dist/index.js --port 3001

# 호스트 + 포트 지정
node packages/server/dist/index.js --port 3001 --host 127.0.0.1

# 개발 모드 (TypeScript 직접 실행, 소스 변경 시 자동 재시작)
pnpm -F @ab/server dev
```

**환경 변수 (선택):**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket 포트 |
| `HOST` | `0.0.0.0` | 바인딩 주소 |
| `REDIS_URL` | — | Redis 연결 URL (미설정 시 인메모리 세션 사용) |
| `DATABASE_URL` | — | PostgreSQL 연결 문자열 (미설정 시 인메모리 통계 사용) |
| `REDIS_SESSION_TTL_S` | `86400` | Redis 세션 TTL (초) |
| `REFRESH_TOKEN_TTL_S` | `604800` | 리프레시 토큰 TTL (초, 7일) |
| `PG_POOL_SIZE` | `10` | PostgreSQL 커넥션 풀 크기 |

> CLI 인자가 환경 변수보다 우선합니다.

### 1-3. 클라이언트 실행

```bash
# 개발 서버 실행 (기본 포트 5173)
pnpm -F @ab/client dev

# 포트 지정
pnpm -F @ab/client dev --port 5174 --host

# 백엔드 서버 포트 지정 (기본: 3000)
VITE_SERVER_PORT=3001 pnpm -F @ab/client dev --port 5174
```

브라우저에서 `http://localhost:5174` 접속.

### 1-4. 서버 + 클라이언트 동시 실행 (권장)

터미널 2개를 사용합니다:

```bash
# 터미널 1 — 서버
pnpm build && node packages/server/dist/index.js --port 3000

# 터미널 2 — 클라이언트
VITE_SERVER_PORT=3000 pnpm -F @ab/client dev --port 5174 --host
```

### 1-5. 테스트 실행

```bash
# 전체 테스트
pnpm test

# 엔진 테스트만
pnpm -F @ab/engine test

# 특정 테스트 파일만
cd packages/engine
npx vitest run src/__tests__/integration/four-player-game.test.ts

# 커버리지 포함
pnpm -F @ab/engine test:coverage
```

### 1-6. 타입 검사 및 린트

```bash
# 전체 타입 검사
pnpm typecheck

# 전체 린트
pnpm lint

# 빌드 결과물 정리
pnpm clean
```

---

## 2. 게임 개요

| 항목 | 값 |
|---|---|
| 플레이어 수 | 2 ~ 4명 |
| 팀 구성 | 1v1 (FFA 포함) 또는 2v2 팀전 |
| 유닛 수 (플레이어당) | 3 |
| 보드 크기 | 11 × 11 |
| 최대 라운드 | 30 |
| 승리 조건 | 상대 팀(또는 플레이어) 유닛 전멸, 또는 30라운드 종료 시 잔존 유닛 수 우위 |

### 게임 진행 순서

```
[대기(waiting)] → [드래프트(draft)] → [전투(battle)] → [결과(result)]
```

---

## 3. 게임 룰 레퍼런스

### 2-1. 드래프트 페이즈

- 모든 플레이어가 **동시에** 유닛을 선택하고 스폰 포인트에 배치
- 제한 시간: **180초** (`DRAFT_TIMEOUT_MS`)
- 시간 초과 시: 나머지 슬롯이 랜덤으로 자동 채워짐 (`confirmed: false`)
- 규칙:
  - 같은 `metaId`를 동일 플레이어가 중복 드래프트 불가
  - 배치 좌표는 해당 플레이어의 스폰 포인트 내에만 가능
  - 이미 점유된 좌표에 배치 불가
  - 최대 **3개**(= `MAX_DRAFT_SLOTS`) 유닛

### 2-2. 라운드 구조

```
라운드 시작
  └─ 유닛 순서 드래프트  (모든 플레이어 동시, 30초 제한)
  └─ 턴 오더 생성        (우선권 규칙 적용)
  └─ 유닛 액션 초기화    (moved/attacked/skillUsed/extinguished → false)
  └─ 슬롯별 턴 실행
라운드 종료 → 승패 검사
```

### 2-3. 우선권(Priority)과 턴 오더

#### 1v1 / FFA 모드

1. `priority` 값이 **낮을수록** 먼저 행동
2. `priority`가 **같으면**:
   - 1라운드: 무작위 선공 결정
   - 2라운드~: 직전 라운드에 선공한 플레이어가 **후공**으로 전환 (교대)
3. 각 플레이어의 유닛 활성화 순서는 플레이어가 `requestUnitOrder`로 제출한 배열을 따름
4. 인터리빙 패턴 (플레이어A가 선공, 각 2유닛 기준):

   ```
   A-U0 → B-U0 → A-U1 → B-U1 → A-U2 → B-U2
   ```

#### 2v2 팀전 모드

1. 팀 합산 `priority`가 낮은 팀이 먼저 행동
2. 합산 동일 시: 1라운드 무작위, 이후 교대
3. 팀 내 플레이어 순서는 등록 순서 그대로
4. 인터리빙 패턴 (팀A [A1,A2], 팀B [B1,B2]):

   ```
   A1 → B1 → A2 → B2
   ```

   > 2v2 턴 슬롯은 플레이어 단위(`unitId` 없음), 각 슬롯에서 해당 플레이어가 유닛을 선택해 행동

### 2-4. 한 턴(슬롯) 내 행동 규칙

한 슬롯에서 플레이어는 **최대 2개의 부분 행동(sub-action)** 을 순서대로 수행할 수 있다.

| 순서 | 허용 여부 | 비고 |
|---|---|---|
| 이동 → 공격 | ✅ 허용 | 이동 후 공격 가능 |
| 공격 → 이동 | ❌ 불허 | 공격 시 즉시 턴 종료 |
| 이동만 | ✅ 허용 | 패스로 마감 |
| 공격만 | ✅ 허용 | 즉시 턴 종료 |
| 스킬(공격형) | ✅ 허용 | `attacked + skillUsed = true` 처리 |
| 화재 진화 | ✅ 허용 | `moved + attacked + extinguished = true` (턴 전체 소모) |
| 패스 | ✅ 허용 | 즉시 턴 종료 |

**서브 루프 자동 종료 조건:**
- `pass` 행동
- `attack` 행동 (공격 후 루프 종료)
- `moved == true && attacked == true` (두 액션 모두 소진)
- 유닛 사망

### 2-5. 사망 처리

- 유닛 HP ≤ 0 → `alive: false` 즉시 처리
- 다음 턴부터 해당 유닛의 슬롯은 **자동 스킵** (어댑터 호출 없음)
- 사망한 유닛은 `units[id].alive === false`로 최종 상태에 유지됨

### 2-6. 전투 계산

```
실제 데미지 = weapon.damage - (ARMOR_REDUCTION_FLAT × currentArmor)
            = weapon.damage - (1 × currentArmor)
```

최소 데미지는 0 (음수 불허). 아머는 피격 시에도 감소하지 않음(내구도 없음).

**범위 공격 타입:**

| rangeType | 동작 |
|---|---|
| `single` | 단일 대상 |
| `line` | 공격자~대상 직선 전체 관통 |
| `area` | 대상 기준 맨하탄 반경 `spec.radius` 이내 전체 |
| `penetrate` | 대상 이후 동일 방향으로 관통; 방어막 유닛에서 중단 |
| `beam` | 공격자~대상 직선 전체; 방어막 유닛에서 중단 |

**공격 유효 방향:** 동일 행 또는 동일 열(직교)에 한함. 대각선 불가.

### 2-7. 상태 이상 효과

| 효과 | 지속 | 행동 제한 | 제거 조건 |
|---|---|---|---|
| `freeze` | 1턴 | 이동·공격·스킬 전체 불가 | 1턴 경과 |
| `fire` | 3턴 | 없음 | 3턴 경과 / `extinguish` 행동 / 강 진입 |
| `acid` | 3턴 | 없음 | 3턴 경과 |
| `electric` | 1턴 | 없음 | 1턴 경과 |
| `water` | — | 없음 | 이동 시 제거(on_move) |
| `sand` | — | 없음 | — |

화재 상태 유닛이 강(river) 타일 진입 시 `fire` 효과 즉시 해제.

### 2-8. 이동 지형 규칙

| 타일 | 이동 비용 | 통과 | 정지 |
|---|---|---|---|
| `plain` (평지) | 1 | ✅ | ✅ |
| `sand` (모래) | 2 | ✅ | ✅ |
| `river` (강) | 2 | ✅ | ❌ |
| `mountain` (산) | — | ❌ | ❌ |

- 유닛이 점유한 타일은 **통과는 가능**하지만 **정지 불가**
- `movementPoints`는 유닛 메타 `baseMovement` 값으로 매 라운드 초기화

### 2-9. 게임 종료 조건

| 조건 | 판정 |
|---|---|
| 1v1 — 한 플레이어 유닛 전멸 | 상대 플레이어 승리 |
| 2v2 — 한 팀 유닛 **전체** 전멸 | 상대 팀 전원 승리 |
| 30라운드 종료 | 잔존 유닛 수 많은 쪽 승리; 동수면 무승부 |
| 투항(`surrender`) | 투항하지 않은 플레이어 승리 |

> **중요**: 2v2에서 한 팀원만 전멸하는 것은 종료 조건이 아님. **팀 전체**가 전멸해야 함.

---

## 4. 아키텍처 — IPlayerAdapter

엔진은 인간/AI/리플레이를 구분하지 않는다. 모두 동일한 `IPlayerAdapter` 인터페이스를 구현해야 한다.

```typescript
// packages/engine/src/loop/game-loop.ts
interface IPlayerAdapter {
  readonly playerId: string;
  readonly type: "human" | "ai" | "replay";

  /** 드래프트 페이즈: 유닛 선택 및 배치 */
  requestDraftPlacement(
    state: GameState,
    timeoutMs: number
  ): Promise<PlayerAction>;  // type: "draft_place"

  /** 전투 페이즈: 매 서브-액션마다 호출 */
  requestAction(
    state: GameState,
    timeoutMs: number
  ): Promise<PlayerAction>;

  /** 전투 페이즈: 매 라운드 시작 전에 호출 — 유닛 활성화 순서 반환 */
  requestUnitOrder(
    state: GameState,
    aliveUnitIds: UnitId[],
    timeoutMs: number
  ): Promise<UnitId[]>;

  /** 모든 어댑터에게 상태 변경 브로드캐스트 */
  onStateUpdate(state: GameState): void;
}
```

### 타임아웃 처리

| 메서드 | 제한 시간 | 초과 시 동작 |
|---|---|---|
| `requestDraftPlacement` | 180,000ms | 랜덤 자동 배치 (`confirmed: false`) |
| `requestAction` | 60,000ms | `pass` 행동으로 처리 |
| `requestUnitOrder` | 30,000ms | 현재 alive 유닛 순서 그대로 유지 |

게임 루프는 모든 어댑터 호출을 `Promise.race(adapter.method(), timeout)` 방식으로 보호한다.

---

## 5. 제공 AI 어댑터

### 4-1. RandomAdapter (`@ab/ai`)

**위치:** `packages/ai/src/random/random-adapter.ts`

| 항목 | 내용 |
|---|---|
| 용도 | 무작위 베이스라인, 룰 붕괴 검사 |
| 공격 선택 | `getAttackableTargets()` 결과 중 무작위 1개 |
| 이동 선택 | `getReachableTiles()` 결과 중 무작위 1개 |
| 유닛 순서 | 입력 순서 그대로 반환 |

```typescript
import { RandomAdapter } from "@ab/ai";
const adapter = new RandomAdapter("p1", movementValidator, attackValidator);
```

### 4-2. HeuristicAdapter (`@ab/ai`)

**위치:** `packages/ai/src/heuristic/heuristic-adapter.ts`

| 항목 | 내용 |
|---|---|
| 용도 | 일반 플레이 시뮬레이션, 평균 게임 길이 측정 |
| 우선순위 | ① 화재진화 → ② 최약체 공격 → ③ 최근접 이동 → ④ 패스 |
| 공격 타겟 선택 | `currentHealth` 가장 낮은 적 우선 |
| 이동 타겟 선택 | 맨하탄 거리 최근접 적 방향으로 최대한 접근 |
| 유닛 순서 | 입력 순서 그대로 반환 |

```typescript
import { HeuristicAdapter } from "@ab/ai";
const adapter = new HeuristicAdapter("p1", movementValidator, attackValidator);
```

### 4-3. MCTSAdapter (`@ab/ai`)

**위치:** `packages/ai/src/mcts/mcts-adapter.ts`

| 항목 | 내용 |
|---|---|
| 용도 | 강한 AI 대전, 전략적 의사결정 검증 |
| 알고리즘 | UCB1 기반 Monte Carlo Tree Search |
| iterations | 200회 (기본값) |
| rolloutDepth | 6 액션 |
| explorationC | √2 ≈ 1.414 |
| timeoutMs | 1,000ms |

```typescript
import { MCTSAdapter } from "@ab/ai";
const adapter = new MCTSAdapter(
  "p1",
  movementValidator,
  attackValidator,
  actionProcessor,     // 실제 상태 시뮬레이션 활성화 (optional)
  { iterations: 300, timeoutMs: 2000 }
);
```

**평가 함수 (0.0 ~ 1.0):**
```
score = 0.4 × (내 유닛 수 / 전체 유닛 수)
      + 0.6 × (내 HP 합 / 전체 HP 합)
```

**유닛 순서:** 현재 위치에서 공격 가능한 적 수 기준 내림차순 정렬 (가장 위협적인 유닛 먼저)

---

## 6. 테스트 작성 방법

### 5-1. 기본 구조

```typescript
import { describe, it, expect } from "vitest";
import { GameFactory } from "@ab/engine";
import { buildDataRegistry } from "@ab/metadata";
import { HeuristicAdapter } from "@ab/ai";

describe("게임 검증", () => {
  it("1v1 정상 종료", async () => {
    // 1. 레지스트리 구성
    const registry = buildDataRegistry({
      units: UNITS, weapons: WEAPONS, skills: [],
      effects: [], tiles: TILES, maps: MAPS,
    });

    // 2. 게임 컨텍스트 생성
    const factory = new GameFactory(registry);
    const context = factory.createContext();

    // 3. AI 어댑터 생성
    const p1 = new HeuristicAdapter(
      "p1",
      context.movementValidator,
      context.attackValidator,
    );
    const p2 = new HeuristicAdapter(
      "p2",
      context.movementValidator,
      context.attackValidator,
    );

    // 4. 초기 상태 빌드
    const initialState = buildInitialState(registry, "p1", "p2");

    // 5. 게임 실행
    const adapters = new Map([["p1", p1], ["p2", p2]]);
    const result = await context.gameLoop.start(initialState, adapters);

    // 6. 검증
    expect(["win", "draw"]).toContain(result.reason);
    expect(result.finalState.phase).toBe("result");
  }, 60_000);
});
```

### 5-2. 초기 상태 구성

#### 드래프트 페이즈부터 시작 (`phase: "draft"`)

드래프트 자동화가 필요할 때 사용. AI `requestDraftPlacement`가 호출됨.

```typescript
const initialState: GameState = {
  gameId: "test-01" as GameId,
  phase: "draft",
  round: 1,
  turnOrder: [],
  currentTurnIndex: 0,
  players: {
    p1: { playerId: "p1" as PlayerId, teamIndex: 0, priority: 1,
          unitIds: [], connected: true, surrendered: false },
    p2: { playerId: "p2" as PlayerId, teamIndex: 1, priority: 1,
          unitIds: [], connected: true, surrendered: false },
  },
  units: {},
  map: { mapId: "map_2p" as MetaId, gridSize: 11, tiles: {} },
  draft: {
    poolIds: ["t1", "f1", "r1", "t1", "f1", "r1"] as MetaId[],
    slots: [],
    timeoutRemainingMs: 180_000,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

#### 전투 페이즈부터 시작 (`phase: "battle"`)

유닛이 이미 배치된 상태에서 전투 자체를 검증할 때 사용. **자동화 테스트에 권장**.

```typescript
function makeUnit(
  id: string,
  metaId: string,
  playerId: PlayerId,
  row: number,
  col: number,
  hp = 4,
): UnitState {
  return {
    unitId: id as UnitId,
    metaId: metaId as MetaId,
    playerId,
    position: { row, col },
    currentHealth: hp,
    currentArmor: 0,
    movementPoints: 3,
    activeEffects: [],
    actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
    alive: true,
  };
}

const initialState: GameState = {
  gameId: "test-battle" as GameId,
  phase: "battle",
  round: 1,
  turnOrder: [],      // 게임 루프가 라운드 시작 전에 buildTurnOrder()로 채움
  currentTurnIndex: 0,
  players: {
    p1: { playerId: "p1" as PlayerId, teamIndex: 0, priority: 1,
          unitIds: ["u1a", "u1b"] as UnitId[], connected: true, surrendered: false },
    p2: { playerId: "p2" as PlayerId, teamIndex: 1, priority: 1,
          unitIds: ["u2a", "u2b"] as UnitId[], connected: true, surrendered: false },
  },
  units: {
    u1a: makeUnit("u1a", "t1", "p1" as PlayerId, 0, 0),
    u1b: makeUnit("u1b", "f1", "p1" as PlayerId, 0, 1),
    u2a: makeUnit("u2a", "t1", "p2" as PlayerId, 10, 10),
    u2b: makeUnit("u2b", "f1", "p2" as PlayerId, 10, 9),
  },
  map: { mapId: "map_2p" as MetaId, gridSize: 11, tiles: {} },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

### 5-3. VerifyingAI — 룰 검증용 커스텀 어댑터

모든 행동을 기록하고 사후에 룰 준수 여부를 분석하는 어댑터.

```typescript
interface ActionRecord {
  round: number;
  slotIndex: number;
  playerId: string;
  unitId: string | undefined;
  actionType: string;
}

class VerifyingAI implements IPlayerAdapter {
  readonly type = "ai" as const;
  readonly actionLog: ActionRecord[] = [];
  readonly unitOrderLog: Array<{ round: number; order: string[] }> = [];
  readonly moveAttackSameTurn: string[] = [];  // 이동 후 공격한 unitId 목록
  private pendingMoveUnitIds = new Set<string>();

  constructor(
    readonly playerId: string,
    private mv: IMovementValidator,
    private av: IAttackValidator,
  ) {}

  async requestUnitOrder(state: GameState, aliveUnitIds: UnitId[]): Promise<UnitId[]> {
    this.unitOrderLog.push({ round: state.round, order: [...aliveUnitIds as string[]] });
    return aliveUnitIds; // 순서 변경 없이 그대로
  }

  async requestAction(state: GameState): Promise<PlayerAction> {
    const slot = state.turnOrder[state.currentTurnIndex];
    const unit = slot?.unitId ? state.units[slot.unitId] : undefined;
    if (!unit || !unit.alive) {
      return { type: "pass", playerId: this.playerId as PlayerId, unitId: "" as UnitId };
    }

    // 공격 시도
    if (!unit.actionsUsed.attacked) {
      const targets = this.av.getAttackableTargets(unit, state);
      const enemy = targets.find(t =>
        Object.values(state.units).some(
          u => u.alive && u.playerId !== this.playerId &&
               u.position.row === t.row && u.position.col === t.col
        )
      );
      if (enemy) {
        if (this.pendingMoveUnitIds.has(unit.unitId)) {
          this.moveAttackSameTurn.push(unit.unitId);
          this.pendingMoveUnitIds.delete(unit.unitId);
        }
        this.actionLog.push({
          round: state.round, slotIndex: state.currentTurnIndex,
          playerId: this.playerId, unitId: unit.unitId, actionType: "attack",
        });
        return { type: "attack", playerId: this.playerId as PlayerId,
                 unitId: unit.unitId, target: enemy };
      }
    }

    // 이동 시도
    if (!unit.actionsUsed.moved) {
      const reachable = this.mv.getReachableTiles(unit, state);
      if (reachable.length > 0) {
        const enemies = Object.values(state.units).filter(
          u => u.alive && u.playerId !== this.playerId
        );
        const nearest = enemies.reduce((a, b) =>
          Math.abs(a.position.row - unit.position.row) + Math.abs(a.position.col - unit.position.col) <
          Math.abs(b.position.row - unit.position.row) + Math.abs(b.position.col - unit.position.col)
            ? a : b
        );
        const dest = reachable.sort((a, b) =>
          (Math.abs(a.row - nearest.position.row) + Math.abs(a.col - nearest.position.col)) -
          (Math.abs(b.row - nearest.position.row) + Math.abs(b.col - nearest.position.col))
        )[0]!;
        this.pendingMoveUnitIds.add(unit.unitId);
        this.actionLog.push({
          round: state.round, slotIndex: state.currentTurnIndex,
          playerId: this.playerId, unitId: unit.unitId, actionType: "move",
        });
        return { type: "move", playerId: this.playerId as PlayerId,
                 unitId: unit.unitId, destination: dest };
      }
    }

    this.actionLog.push({
      round: state.round, slotIndex: state.currentTurnIndex,
      playerId: this.playerId, unitId: unit.unitId, actionType: "pass",
    });
    return { type: "pass", playerId: this.playerId as PlayerId, unitId: unit.unitId };
  }

  onStateUpdate(_state: GameState): void {}
}
```

---

## 7. 결과 해석 및 통계

### 6-1. GameResult 구조

```typescript
interface GameResult {
  gameId: string;
  winnerIds: string[];        // 승자 플레이어 ID 배열 (무승부 = [])
  reason: "win" | "draw" | "all_units_dead" | "round_limit" | "surrender";
  finalState: GameState;      // 게임 종료 시점의 최종 상태 스냅샷
}
```

### 6-2. 종료 이유 해석

| `reason` | 의미 | `winnerIds` |
|---|---|---|
| `all_units_dead` | 유닛 전멸 승리 | 승리 팀/플레이어 |
| `round_limit` | 30라운드 종료, 유닛 수 우위 | 유닛 많은 쪽 |
| `round_limit` + `winnerIds: []` | 유닛 수 동점 → 무승부 | `[]` |
| `surrender` | 투항 | 비투항 플레이어 |
| `disconnect` | 연결 끊김 | 연결 유지 플레이어 |

### 6-3. 주요 통계 산출

```typescript
function analyzeResult(result: GameResult, ais: Record<string, VerifyingAI>) {
  const allActions = Object.values(ais).flatMap(ai => ai.actionLog);
  const finalState = result.finalState;

  // ── 게임 기본 통계 ──
  const rounds = finalState.round;
  const totalActions = allActions.length;

  // ── 행동 타입별 분포 ──
  const actionDist = allActions.reduce((acc, a) => {
    acc[a.actionType] = (acc[a.actionType] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ── 전투 효율 (플레이어별 공격 횟수) ──
  const attacksPerPlayer = Object.fromEntries(
    Object.keys(ais).map(pid => [
      pid,
      allActions.filter(a => a.playerId === pid && a.actionType === "attack").length,
    ])
  );

  // ── 이동 후 공격 발생률 ──
  const moveAttackCount = Object.values(ais)
    .flatMap(ai => ai.moveAttackSameTurn).length;
  const totalAttacks = actionDist["attack"] ?? 0;
  const moveAttackRate = totalAttacks > 0 ? moveAttackCount / totalAttacks : 0;

  // ── 유닛 생존 현황 ──
  const aliveUnits = Object.values(finalState.units).filter(u => u.alive);
  const deadUnits  = Object.values(finalState.units).filter(u => !u.alive);

  // ── 유닛 순서 드래프트 총 호출 횟수 ──
  const orderDraftCalls = Object.values(ais)
    .reduce((sum, ai) => sum + ai.unitOrderLog.length, 0);

  return {
    rounds,
    totalActions,
    actionDist,
    attacksPerPlayer,
    moveAttackCount,
    moveAttackRate,
    aliveCount: aliveUnits.length,
    deadCount: deadUnits.length,
    orderDraftCalls,
    reason: result.reason,
    winnerIds: result.winnerIds,
  };
}
```

### 6-4. 통계 해석 기준

| 지표 | 정상 범위 | 비정상 징후 |
|---|---|---|
| `rounds` | 1 ~ 30 | > 30 이면 종료 감지 버그 |
| `reason` | `"all_units_dead"` 또는 `"round_limit"` | `null` 이면 게임 루프 버그 |
| `orderDraftCalls` | `rounds × 플레이어 수` | 불일치 시 드래프트 누락 |
| `moveAttackRate` | > 0 (전투 충분할 때) | 0이면 이동+공격 루프 미작동 |
| `deadCount` | > 0 (전멸 종료 시) | 0이면 종료 조건 버그 가능성 |
| 패배팀 생존 유닛 | 0 | > 0이면 팀 승패 판정 버그 |

---

## 8. 검증 체크리스트

### 7-1. 필수 검증 항목

```typescript
function verifyGameResult(result: GameResult, ais: Record<string, VerifyingAI>) {
  const state = result.finalState;

  // ① 게임이 정상 종료되었는가
  expect(["win", "draw", "all_units_dead", "round_limit", "surrender"])
    .toContain(result.reason);
  expect(state.phase).toBe("result");
  expect(state.round).toBeGreaterThanOrEqual(1);
  expect(state.round).toBeLessThanOrEqual(30 + 1); // 30라운드 + 종료 라운드

  // ② 매 라운드 모든 플레이어가 유닛 순서 드래프트를 받았는가
  for (const [pid, ai] of Object.entries(ais)) {
    expect(ai.unitOrderLog.length).toBeGreaterThan(0);
  }

  // ③ 사망한 유닛이 사망 이후 행동하지 않았는가
  const allActions = Object.values(ais).flatMap(a => a.actionLog);
  const deadUnits = Object.values(state.units).filter(u => !u.alive);
  for (const dead of deadUnits) {
    const unitActions = allActions.filter(a => a.unitId === dead.unitId);
    const lastAction = unitActions.at(-1);
    if (lastAction) {
      const actionsAfterDeath = unitActions.filter(a =>
        a.round > lastAction.round ||
        (a.round === lastAction.round && a.slotIndex > lastAction.slotIndex)
      );
      expect(actionsAfterDeath).toHaveLength(0);
    }
  }

  // ④ 승자가 같은 팀에 속하는가 (2v2 팀전)
  if (result.winnerIds.length > 0) {
    const winnerTeamIndices = result.winnerIds.map(
      wid => state.players[wid]?.teamIndex
    );
    const allSameTeam = winnerTeamIndices.every(t => t === winnerTeamIndices[0]);
    expect(allSameTeam).toBe(true);
  }

  // ⑤ 패배팀 유닛이 전멸했는가
  if (result.winnerIds.length > 0) {
    const loserIds = Object.keys(state.players)
      .filter(pid => !result.winnerIds.includes(pid));
    const loserAlive = Object.values(state.units)
      .filter(u => u.alive && loserIds.includes(u.playerId));
    expect(loserAlive).toHaveLength(0);
  }
}
```

### 7-2. 선택적 검증 항목

```typescript
// ⑥ 이동 후 공격이 최소 1회 이상 발생했는가 (전투가 충분히 길었을 때)
const moveAttacks = Object.values(ais).flatMap(a => a.moveAttackSameTurn);
if (result.finalState.round >= 3) {
  expect(moveAttacks.length).toBeGreaterThan(0);
}

// ⑦ 턴 오더 인터리빙 확인 (1v1: A-B-A-B 패턴)
const turnOrder = result.finalState.turnOrder;
// 짝수 인덱스 슬롯 플레이어가 같아야 함 (선공 플레이어)
// 홀수 인덱스 슬롯 플레이어가 같아야 함 (후공 플레이어)

// ⑧ 우선권 선공 교대 확인
// 1라운드와 2라운드의 첫 번째 슬롯 playerId가 달라야 함 (같은 priority 설정 시)
```

---

## 9. 실전 예시 — 4인 2v2 전체 검증

실제 구현 파일: `packages/engine/src/__tests__/integration/four-player-game.test.ts`

### 실행 방법

```bash
# 단일 테스트 실행
cd packages/engine
npx vitest run src/__tests__/integration/four-player-game.test.ts

# 전체 엔진 테스트 실행
cd packages/engine
npx vitest run
```

### 예시 출력 해석

```
✅ 게임 종료: 라운드 6, 이유: win
   승리팀 플레이어: p2a, p2b
```
→ 6라운드에 팀B(p2a, p2b)가 팀A 전멸 승리

```
✅ 유닛 순서 드래프트: 24회 호출 (6라운드 × 4플레이어)
```
→ 6라운드 × 4명 = 24회 정확히 일치. 누락 없음.

```
✅ 이동 후 공격 발생 횟수: 5회
```
→ 같은 슬롯에서 이동 후 공격이 5회 발생. 이동+공격 룰 정상 작동.

```
✅ 죽은 유닛(7개) 스킵 검증 통과
```
→ 8유닛 중 7개 사망. 사망 이후 행동 기록 없음.

```
✅ 팀 승리 검증: 팀1 승리
✅ 패배팀 전멸 확인: p1a,p1b 유닛 0개 생존
```
→ 팀1(p2a, p2b)만 승자. 팀0(p1a, p1b)은 생존 유닛 0개.

```
📊 액션 통계:
   move: 7회
   attack: 15회
   pass: 6회
   총 액션: 28회
```
→ 공격 비율 53%, 이동 25%, 패스 21%. 전투 중심의 정상적인 분포.

### 테스트 구성 파라미터 조정

| 파라미터 | 기본값 | 변경 이유 |
|---|---|---|
| `currentHealth` | 4 | 낮추면 게임이 빨리 끝남 (빠른 검증) |
| `baseMovement` | 3 | 높이면 더 많은 이동+공격 발생 |
| `gridSize` | 11 | 줄이면 교전이 빨리 시작 |
| AI 어댑터 종류 | `VerifyingAI` (heuristic) | `MCTSAdapter`로 교체 시 더 영리한 플레이 |
| 테스트 타임아웃 | 60,000ms | `MCTSAdapter` 사용 시 증가 필요 |

---

## 부록 A — 에러 코드 레퍼런스

| 코드 | 발생 위치 | 의미 |
|---|---|---|
| `UNKNOWN_UNIT` | action-processor | 존재하지 않는 unitId |
| `MOVE_ALREADY_MOVED` | action-processor | 이미 이동한 유닛에 이동 시도 |
| `MOVE_FROZEN` | movement-validator | 빙결 상태 이동 불가 |
| `MOVE_OUT_OF_RANGE` | movement-validator | 도달 불가 목적지 |
| `MOVE_BLOCKED_UNIT` | movement-validator | 목적지 점유됨 or 강 타일 |
| `MOVE_BLOCKED_MOUNTAIN` | movement-validator | 산 타일 진입 시도 |
| `MOVE_NO_PATH` | movement-validator | 경로 없음 (BFS 실패) |
| `ATTACK_ALREADY_ATTACKED` | action-processor | 이미 공격한 유닛에 공격 시도 |
| `ATTACK_FROZEN` | attack-validator | 빙결 상태 공격 불가 |
| `ATTACK_INVALID_TARGET` | attack-validator | 맵 범위 밖 타겟 |
| `ATTACK_OUT_OF_RANGE` | attack-validator | 사거리 밖 타겟 |
| `ATTACK_NO_LOS` | attack-validator | 포격 무기 시야 확보 실패 |
| `SKILL_ALREADY_USED` | action-processor | 스킬 이미 사용됨 |
| `EXTINGUISH_ALREADY_ACTED` | action-processor | 이미 행동한 유닛에 진화 시도 |
| `EXTINGUISH_NOT_ON_FIRE` | action-processor | 화재 상태가 아닌 유닛 진화 시도 |
| `TURN_INVALID_PHASE` | action-processor | 전투 페이즈가 아닌 상태에서 전투 행동 |

---

## 부록 B — 기존 통합 테스트 파일 목록

| 파일 | 내용 |
|---|---|
| `integration/four-player-game.test.ts` | 4인 2v2 전체 플레이, 룰 종합 검증 |
| `integration/ai-vs-ai.test.ts` | 1v1 AI 대전, 기본 종료 조건 |
| `integration/mechanic-check.test.ts` | 이동·공격·효과 메카닉 단위 검증 |
| `integration/rule-scenarios.test.ts` | 특정 룰 시나리오 재현 테스트 |
