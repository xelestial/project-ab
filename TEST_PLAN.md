# Project AB — Test Plan

> 마지막 업데이트: 2026-05-22

---

## 개요

Project AB의 테스트는 세 계층으로 구성됩니다.

| 계층 | 위치 | 도구 | 목적 |
|------|------|------|------|
| 엔진 단위 테스트 | `packages/engine/src/__tests__/` | Vitest | 순수 게임 로직 검증 |
| 서버 통합 테스트 | `packages/server/src/__tests__/` | Vitest | API 라우트, 세션, ELO, WS 검증 |
| E2E 브라우저 테스트 | `e2e/` | Playwright (Chromium) | 클라이언트-서버 전체 플로우 검증 |

---

## 1. 엔진 단위 테스트

### 실행 방법

```bash
pnpm -F @ab/engine test          # 전체
pnpm -F @ab/engine test --run    # watch 모드 없이 1회
```

### 기존 테스트 파일 (25개)

| 파일 | 주요 커버리지 |
|------|-------------|
| `action-processor.test.ts` | 액션 처리 파이프라인 |
| `attack-resolver.test.ts` | 공격 해소: 데미지, 넉백, 원소 반응 |
| `attack-validator.test.ts` | 공격 유효성: 범위, 시야, freeze/stun/confusion |
| `draft-manager.test.ts` | 드래프트 단계 관리 |
| `effect-resolver.test.ts` | 효과 틱: 데미지, 카운트다운 |
| `electric-chain.test.ts` | 전기 체인 전파 |
| `end-detector.test.ts` | 게임 종료 조건 판별 |
| `game-factory.test.ts` | 게임 상태 초기화 팩토리 |
| `managers.test.ts` | TileManager, EffectManager, TurnManager, RoundManager |
| `movement-resolver.test.ts` | 이동 해소: 경로, 타일 효과 적용 |
| `movement-validator.test.ts` | 이동 유효성: 범위, 벽, freeze/stun |
| `remaining-features.test.ts` | stun 강제, confusion 메카닉, canTargetSelf 가드 |
| `spawn-conductor.test.ts` | 배치 좌표 할당 |
| `state-applicator.test.ts` | GameChange 적용 불변성 |
| `support.test.ts` | 지원 유틸: manhattanDistance, orthogonalNeighbors 등 |
| `terrain-generator.test.ts` | 맵 지형 생성 |
| `tile-resolver.test.ts` | 타일 속성 변환 해소 |
| `integration/` | 통합 시나리오 (실제 레지스트리 로드) |

### 신규 테스트 파일 (본 플랜으로 추가됨)

| 파일 | 커버 대상 | 테스트 수 |
|------|----------|----------|
| `health-manager.test.ts` | `HealthManager` — checkDeaths, applyDeaths | 9 |
| `effect-validator.test.ts` | `EffectValidator` — canApplyEffect, canRemoveEffect | 15 |
| `tile-validator.test.ts` | `TileValidator` — canConvertTile, resolveConversion, countWaterNeighbors | 15 |
| `passive-resolver.test.ts` | `PassiveResolver` — resolveTurnStart (모든 액션 타입), resolveOnAttack | 23 |

### 핵심 테스트 시나리오

#### HealthManager
- `checkDeaths`: HP ≤ 0인 유닛 → `unit_death` 변경 생성
- `checkDeaths`: HP > 0인 유닛 → 변경 없음
- `checkDeaths`: `alive: false` 유닛 → 스킵
- `checkDeaths`: 복수 사망 감지
- `applyDeaths`: 사망 적용 후 `alive: false`
- `applyDeaths`: 사망 없으면 동일 상태 참조 반환

#### EffectValidator
- `canApplyEffect`: freeze는 언제나 적용 가능
- `canApplyEffect`: 동결 유닛에 fire/acid 등 적용 불가 → 에러
- `canApplyEffect`: 비동결 유닛에 모든 효과 적용 가능
- `canRemoveEffect`: 없는 효과 제거 → `UNKNOWN_EFFECT`
- `canRemoveEffect`: 올바른 removeCondition과 일치하는 reason → VALID
- `canRemoveEffect`: 잘못된 reason → INVALID

#### TileValidator
- `canConvertTile`: 모든 attackAttribute → VALID (last attack wins)
- `resolveConversion`: `none` → 현재 속성 유지
- `resolveConversion`: fire/water/ice 등 → 속성 덮어쓰기
- `countWaterNeighbors`: 직교 이웃 중 water/river 타일 카운트
- `countWaterNeighbors`: 대각선 타일은 카운트 안 됨
- `countWaterNeighbors`: 경계 위치 처리

#### PassiveResolver
- `resolveTurnStart/heal_adjacent_allies`: 반경 내 부상 아군 치료
- `resolveTurnStart/heal_adjacent_allies`: 최대 HP 도달 시 치료 안 함
- `resolveTurnStart/heal_adjacent_allies`: 적 유닛 치료 안 함
- `resolveTurnStart/heal_adjacent_allies`: 치료량 maxHP로 제한
- `resolveTurnStart/heal_self_per`: frozen 인접 적 수 × amount 자가 치료
- `resolveTurnStart/apply_tile_effect_to_adjacent_enemies`: 인접 적 타일에 fire 적용
- `resolveTurnStart/apply_tile_effect_to_adjacent_enemies`: 이미 해당 타일 속성이면 스킵
- `resolveTurnStart/remove_adjacent_tile_effect`: 반경 내 특정 타일 속성 제거
- `resolveTurnStart/remove_adjacent_unit_effect`: 반경 내 특정 유닛 효과 제거
- `resolveTurnStart` 조건 `adjacent_enemy_exists`: 적 없으면 발동 안 함
- `resolveOnAttack/bonus_move`: 공격 후 이동 포인트 복원

---

## 2. 서버 통합 테스트

### 실행 방법

```bash
pnpm -F @ab/server test
```

### 기존 테스트 파일 (11개)

| 파일 | 커버리지 |
|------|---------|
| `api-routes.test.ts` | REST API 라우트 전체 |
| `e2e-playthrough.test.ts` | 서버 내 전체 게임 진행 |
| `elo.test.ts` | ELO 점수 계산 |
| `jwt-auth.test.ts` | JWT 발급·검증·만료 |
| `load.test.ts` | 부하 테스트 |
| `matchmaking.test.ts` | 매칭메이킹 큐 |
| `redis-token-store.test.ts` | Redis 토큰 스토어 |
| `replay.test.ts` | 리플레이 저장·로드 |
| `session-store.test.ts` | 세션 스토어 |
| `token-store.test.ts` | 토큰 스토어 |
| `ws-protocol.test.ts` | WebSocket 프로토콜 |

---

## 3. E2E 브라우저 테스트

### 실행 방법

**전제 조건:**

```bash
# 서버 실행 (포트 3000)
pnpm -F @ab/server start

# 클라이언트 빌드 후 서빙 (포트 5173)
pnpm -F @ab/client build
cd packages/client/dist && python3 -m http.server 5173
```

**테스트 실행:**

```bash
npx playwright test              # 전체
npx playwright test e2e/01-*    # 특정 파일만
npx playwright test --reporter=html  # HTML 리포트
```

### E2E 테스트 파일 목록

#### 기존 파일 (01–05)

| 파일 | 설명 | 테스트 수 |
|------|------|----------|
| `01-page-load.test.ts` | 페이지 로드 & 메뉴 화면 초기 상태 | 7 |
| `02-api.test.ts` | 서버 API 직접 검증 (health, meta, rooms) | 7 |
| `03-navigation.test.ts` | 화면 내비게이션 (모드 선택, 뒤로 가기) | 4 |
| `04-game-flow.test.ts` | 게임 생성 및 배치 단계 진입 | 8 |
| `05-game-start.test.ts` | 배치 완료 → 게임 화면 진입, HUD 요소 | 5 |

#### 신규 파일 (06–11)

| 파일 | 설명 | 테스트 수 |
|------|------|----------|
| `06-auth-flow.test.ts` | 로그인/리프레시/로그아웃/토큰 검증 | 9 |
| `07-room-management.test.ts` | 방 CRUD, 목록, 참가, AI 추가 | 9 |
| `08-full-game-1v1.test.ts` | 1v1 전체 게임 API 생명주기 | 7 |
| `09-game-actions.test.ts` | 게임 액션 API (pass, move, 인증) | 5 |
| `10-ui-placement.test.ts` | 배치 화면 UI 상호작용 | 8 |
| `11-team-game.test.ts` | 팀전(2v2) 방 생성 및 게임 플로우 | 6 |

### E2E 테스트 커버리지 요약

| 영역 | 커버됨 | 파일 |
|------|-------|------|
| 페이지 로드 및 DOM 구조 | ✅ | 01 |
| REST API 메타 엔드포인트 | ✅ | 02 |
| 화면 전환 내비게이션 | ✅ | 03 |
| 게임 생성 및 배치 단계 | ✅ | 04 |
| 배치 완료 → 게임 시작 | ✅ | 05 |
| 인증 플로우 (로그인/리프레시/로그아웃) | ✅ | 06 |
| 방 관리 CRUD | ✅ | 07 |
| 1v1 전체 게임 생명주기 | ✅ | 08 |
| 게임 액션 API (move/pass) | ✅ | 09 |
| 배치 화면 UI 인터랙션 | ✅ | 10 |
| 팀전(2v2) 게임 플로우 | ✅ | 11 |
| WebSocket 실시간 통신 | ❌ | 미구현 (향후 과제) |
| 매칭메이킹 UI | ❌ | 미구현 (향후 과제) |
| 게임 오버 화면 | ❌ | 미구현 (향후 과제) |
| 리플레이 조회 | ❌ | 미구현 (향후 과제) |

---

## 4. 미커버 엔진 파일 (향후 과제)

아래 파일들은 현재 테스트 커버리지가 없거나 제한적입니다:

| 파일 | 이유 | 우선순위 |
|------|------|---------|
| `game-loop.ts` | 복잡한 통합 오케스트레이터 — 통합 테스트가 간접 커버 | 중 |
| `post-processor.ts` | 게임 오버 후처리 — 통합 테스트로 커버 가능 | 중 |
| `game-context.ts` | 경량 컨테이너 — 팩토리 테스트로 간접 커버 | 낮음 |
| `game-state-utils.ts` | 헬퍼 유틸 — support.test.ts로 부분 커버 | 낮음 |
| `event-bus.ts` | 이벤트 버스 — 통합 테스트로 간접 커버 | 낮음 |
| `game-logger.ts` | 로깅 — 기능적 영향 없음 | 낮음 |
| `rng.ts` | 난수 생성 — 간단한 순수 함수 | 낮음 |

---

## 5. CI 파이프라인 권장 순서

```
1. pnpm build (모든 패키지)
2. pnpm -F @ab/engine test --run
3. pnpm -F @ab/server test --run
4. [서버 + 클라이언트 기동]
5. npx playwright test --reporter=github
```

---

## 6. 알려진 제약사항

- **Playwright E2E**: 서버(`:3000`)와 클라이언트(`:5173`)가 모두 실행 중이어야 함
- **캔버스 클릭 테스트**: 스폰 구역 좌표는 맵 설정에 의존하므로 클릭이 유효 타일에 닿지 않을 수 있음 — 배치 카운터 불변 허용
- **AI 자동 배치**: AI 추가 즉시 배치가 완료되므로 race condition 방지를 위해 배치 API 호출 전 짧은 대기 불필요 (서버가 동기적으로 처리)
- **Redis 연결**: 없으면 MemorySessionStore로 폴백 — E2E 및 서버 테스트 모두 정상 동작
