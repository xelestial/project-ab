# AB — 구현 진행 현황

> 최종 업데이트: 2026-04-14  
> 상태: **Phase 7 완료** (모든 테스트 통과 + 전체 빌드 성공)

---

## Phase 7 완료 요약

| 단계 | 내용 | 상태 | 비고 |
|---|---|---|---|
| Phase 7-1 | TypeScript 빌드 검증 (엔진 소스 비테스트 오류 수정) | ✅ 완료 | 인터페이스 누락 메서드, 브랜드 타입 캐스트 |
| Phase 7-2 | i18n.ts Locale 재내보내기 충돌 수정 | ✅ 완료 | schemas/base.ts import 통일 |
| Phase 7-3 | DraftPlaceActionSchema optional unitId 추가 | ✅ 완료 | 테스트 호환성 유지 |
| Phase 7-4 | 테스트 파일 빌드 제외 (engine, ai, server tsconfig) | ✅ 완료 | `exclude: __tests__` |
| Phase 7-5 | server 패키지 빌드 오류 수정 | ✅ 완료 | jwt-auth 판별 유니온, human-adapter exactOptional, routes 누락 import |
| Phase 7-6 | 전체 빌드 성공 확인 (`pnpm -r build`) | ✅ 완료 | metadata/engine/ai/server 전부 통과 |

**총 테스트: 331개 / 331개 통과 (실패 0)**  
**전체 빌드: ✅ 4개 패키지 전부 성공**

| 패키지 | 테스트 수 | 빌드 |
|---|---|---|
| @ab/metadata | 39 | ✅ |
| @ab/engine | 178 | ✅ |
| @ab/ai | 10 | ✅ |
| @ab/server | 104 | ✅ |
| **합계** | **331** | — |

---

## Phase 6 완료 요약

| 단계 | 내용 | 상태 | 테스트 |
|---|---|---|---|
| Phase 6-1 | 매치메이킹 큐 (ELO 범위 매칭, 자동 게임 생성) | ✅ 완료 | 11 통과 |
| Phase 6-2 | 매치메이킹 HTTP API (join/leave/status) | ✅ 완료 | API 포함 |
| Phase 6-4 | ELO 레이팅 시스템 (calculateElo, K팩터, 하한선) | ✅ 완료 | 10 통과 |
| Phase 6-4b | stats-store ELO 연동 (Postgres + Memory) | ✅ 완료 | 기존 유지 |
| Phase 6-4c | 리더보드 rating DESC 정렬 + API 포함 | ✅ 완료 | 기존 유지 |

**총 테스트: 331개 / 331개 통과 (실패 0)**

| 패키지 | 테스트 수 |
|---|---|
| @ab/metadata | 39 |
| @ab/engine | 178 |
| @ab/ai | 10 |
| @ab/server | 104 |
| **합계** | **331** |

---

## Phase 5 완료 요약

| 단계 | 내용 | 상태 | 테스트 |
|---|---|---|---|
| Phase 5-1 | 관전 모드 (spectate WebSocket + spectator_joined) | ✅ 완료 | 3 통과 |
| Phase 5-2 | 리더보드 API (GET /api/v1/leaderboard) | ✅ 완료 | 2 통과 |
| Phase 5-3 | 게임 재연결 (HumanAdapter.replaceSocket) | ✅ 완료 | 기존 유지 |
| Phase 5-4 | AI 방 채우기 API (POST /api/v1/rooms/:gameId/ai) | ✅ 완료 | 3 통과 |
| Phase 5-5 | Unity 프로토콜 문서 (docs/unity-ws-protocol.md) | ✅ 완료 | — |

**총 테스트: 310개 / 310개 통과 (실패 0)**

| 패키지 | 테스트 수 |
|---|---|
| @ab/metadata | 39 |
| @ab/engine | 178 |
| @ab/ai | 10 |
| @ab/server | 83 |
| **합계** | **310** |

---

## Phase 4 완료 요약

| 단계 | 내용 | 상태 | 테스트 |
|---|---|---|---|
| Phase 4-1 | 게임 종료 시 stats 자동 기록 (ws-server 연동) | ✅ 완료 | 기존 유지 |
| Phase 4-2 | DB 마이그레이션 스크립트 (scripts/migrate.ts) | ✅ 완료 | — |
| Phase 4-3 | RedisTokenStore (토큰 분산 저장) | ✅ 완료 | 5 통과 |
| Phase 4-4 | 동시성 부하 테스트 (20/50/30/100 concurrent) | ✅ 완료 | 5 통과 |

**총 테스트: 298개 / 298개 통과 (실패 0)**

| 패키지 | 테스트 수 |
|---|---|
| @ab/metadata | 39 |
| @ab/engine | 178 |
| @ab/ai | 10 |
| @ab/server | 71 |
| **합계** | **298** |

---

## Phase 3 완료 요약

| 단계 | 내용 | 상태 | 테스트 |
|---|---|---|---|
| Phase 3-1 | Redis 연동 활성화 (ioredis, 파이프라인, 에러 복구) | ✅ 완료 | 기존 17 유지 |
| Phase 3-2 | MCTS AI 고도화 (ActionProcessor 실제 롤아웃) | ✅ 완료 | 8 통과 |
| Phase 3-3 | PostgreSQL 연동 활성화 (pg Pool, 트랜잭션) | ✅ 완료 | 기존 17 유지 |
| Phase 3-4 | 인증 강화 (refresh token, rotation, 재사용 감지) | ✅ 완료 | 9 통과 |
| Phase 3-5 | HTTP API 확장 (auth routes, 보호된 엔드포인트) | ✅ 완료 | 20 통과 |
| Phase 3-6 | 서버 엔트리포인트: 스토어 조건부 활성화 | ✅ 완료 | — |

**총 테스트: 288개 / 288개 통과 (실패 0)**

| 패키지 | 테스트 수 |
|---|---|
| @ab/metadata | 39 |
| @ab/engine | 178 |
| @ab/ai | 10 |
| @ab/server | 61 |
| **합계** | **288** |

---

## Phase 2 완료 요약

| 단계 | 내용 | 상태 | 테스트 |
|---|---|---|---|
| Phase 2-1 | 통합 테스트: AI vs AI 전체 게임 시뮬레이션 | ✅ 완료 | 2 통과 |
| Phase 2-2 | 커버리지 측정 + 격차 해소 (59% → 86%) | ✅ 완료 | +71 테스트 |
| Phase 2-3 | 드래프트 시스템 확장 (6-슬롯, 2v2, 타임아웃) | ✅ 완료 | 19 통과 |
| Phase 2-4 | Redis 세션 스토어 + PostgreSQL 통계 스텁 | ✅ 완료 | 17 통과 |
| Phase 2-5 | JWT 인증 미들웨어 | ✅ 완료 | 7 통과 |
| Phase 2-6 | MCTS AI 어댑터 스텁 | ✅ 완료 | 4 통과 |

---

## Phase 1 완료 요약 (유지)

| 단계 | 내용 | 상태 | 테스트 |
|---|---|---|---|
| Step 1 | 모노레포 + 메타데이터 패키지 | ✅ 완료 | 39 통과 |
| Step 2 | StateApplicator + 상태 헬퍼 | ✅ 완료 | 포함 |
| Step 3 | Validators (이동/공격/효과/타일) | ✅ 완료 | 포함 |
| Step 4 | Resolvers (이동/공격/효과/타일) | ✅ 완료 | 포함 |
| Step 5 | Managers + EndDetector | ✅ 완료 | 포함 |
| Step 6 | ActionProcessor + GameLoop + GameFactory | ✅ 완료 | 포함 |
| Step 7 | AI 어댑터 (Random + Heuristic) | ✅ 완료 | 포함 |
| Step 8 | 서버 (WebSocket + HTTP REST) | ✅ 완료 | 포함 |

---

## 구현된 파일 목록 (Phase 3 추가/변경분)

### packages/ai
```
src/
└── mcts/
    └── mcts-adapter.ts          # ★ Phase 3 고도화:
                                 #   - ActionProcessor 기반 실제 롤아웃
                                 #   - evaluateState: 0.4*유닛비 + 0.6*HP비
                                 #   - 즉시 승리 감지 (공격 후 전멸 체크)
                                 #   - getCandidateActionsForPlayer 분리
                                 #   - 화재 유닛 extinguish 후보 포함
```

### packages/server
```
src/
├── auth/
│   ├── jwt-auth.ts              # ★ optionalAuth 추가, JWT_MAX_AGE_S alias
│   └── token-store.ts           # 신규: ITokenStore / MemoryTokenStore
│                                #   - issue/verify/markUsed/revoke/revokeAll/purgeExpired
│                                #   - 재사용 공격 감지 (used=true → revokeAll)
│                                #   - Refresh TTL: 7일
├── session/
│   ├── session-store.ts         # ★ RedisSessionStore 활성화:
│   │                            #   - ioredis 파이프라인 (save/end/delete)
│   │                            #   - lazyConnect + enableOfflineQueue:false
│   │                            #   - 에러 복구: 모든 메서드 try-catch
│   │                            #   - SMEMBERS + MGET (listActive)
│   │                            #   - TTL: REDIS_SESSION_TTL_S (default 24h)
│   ├── stats-store.ts           # ★ PostgresStatsStore 활성화:
│   │                            #   - pg Pool (connectionString="" → no-op)
│   │                            #   - recordResult: BEGIN/COMMIT 트랜잭션
│   │                            #   - UPSERT game_results + player_stats
│   │                            #   - getPlayerStats / getGameResult
│   │                            #   - PG_POOL_SIZE env (default 10)
│   └── game-session-manager.ts  # ★ ISessionStore 주입 완료
├── api/
│   └── routes.ts                # ★ markUsed ITokenStore 인터페이스로 이동
│                                #   POST /api/v1/auth/login
│                                #   POST /api/v1/auth/refresh (토큰 회전)
│                                #   POST /api/v1/auth/logout (보호됨)
│                                #   POST /api/v1/rooms (보호됨)
│                                #   GET  /api/v1/rooms (보호됨)
│                                #   GET  /api/v1/rooms/:gameId (보호됨)
│                                #   GET  /api/v1/stats/:playerId (공개)
│                                #   GET  /api/v1/stats/game/:gameId (공개)
├── index.ts                     # ★ 스토어 조건부 선택:
│                                #   REDIS_URL → RedisSessionStore
│                                #   DATABASE_URL → PostgresStatsStore
│                                #   onClose 훅에서 graceful shutdown
└── __tests__/
    ├── token-store.test.ts      # 신규: 9개 테스트
    ├── api-routes.test.ts       # 신규: 20개 테스트 (Fastify inject)
    ├── session-store.test.ts    # ★ 유지: 17개 테스트
    └── jwt-auth.test.ts         # 유지: 7개 테스트
```

---

## 주요 Phase 3 변경 사항

### MCTS 고도화 (Phase 3-2)
- **ActionProcessor 롤아웃**: `rollout()` — `actionProcessor.process()`로 실제 상태 전이
- **즉시 승리 감지**: 공격 후 적 전멸 → 즉시 해당 공격 반환 (탐색 생략)
- **평가 함수**: `evaluateState()` = `0.4 * (내 유닛 수 / 전체) + 0.6 * (내 HP / 전체)`
- **폴백 휴리스틱**: ActionProcessor 미주입 시 액션 타입별 고정 점수
- **후보 생성 분리**: `getCandidateActionsForPlayer()` — 롤아웃 중 임의 플레이어 액션 생성
- **화재 extinguish**: fire 효과 + 미공격 시 소화 후보 추가

### Redis 연동 활성화 (Phase 3-1)
- **`ioredis` 파이프라인**: `save`, `end`, `delete` 모두 파이프라인으로 원자적 실행
- **Active Set**: `ab:sessions:active` SADD/SREM으로 활성 게임 ID 추적
- **에러 복구**: 모든 읽기(`get`, `listActive`) → 실패 시 `undefined`/`[]` 반환
- **쓰기 에러**: `console.error`만 기록, 서버 동작 지속
- **환경변수**: `REDIS_URL`, `REDIS_SESSION_TTL_S`

### PostgreSQL 연동 활성화 (Phase 3-3)
- **`pg` Pool**: `connectionString=""` → pool=null, 모든 메서드 no-op
- **트랜잭션**: `recordResult()` — BEGIN/COMMIT, 실패 시 ROLLBACK
- **UPSERT**: `game_results` (ON CONFLICT DO NOTHING), `player_stats` (ON CONFLICT DO UPDATE)
- **환경변수**: `DATABASE_URL`, `PG_POOL_SIZE`

### 인증 강화 (Phase 3-4)
- **Refresh Token**: `MemoryTokenStore` — randomBytes(32) opaque token, 7일 TTL
- **토큰 회전**: `markUsed()` → 구 토큰 무효화 → 신 토큰 발급
- **재사용 공격 감지**: `verify()` 시 `used=true` → `revokeAll(playerId)`
- **`markUsed` 인터페이스화**: `ITokenStore`에 포함 (캐스팅 제거)

### 서버 조건부 스토어 선택 (Phase 3-6)
```typescript
// REDIS_URL 존재 → RedisSessionStore, 없으면 MemorySessionStore
// DATABASE_URL 존재 → PostgresStatsStore, 없으면 MemoryStatsStore
// onClose 훅: RedisSessionStore.quit() / PostgresStatsStore.end() 호출
```

---

## 커버리지 달성 현황 (engine 패키지)

| 파일 | Phase 1 | Phase 2 |
|---|---|---|
| tile-resolver.ts | 10.58% | 98.82% |
| attack-resolver.ts | 25% | 94.82% |
| action-processor.ts | 31.28% | 94.97% |
| tile-manager.ts | 30.43% | 100% |
| effect-manager.ts | 50% | 100% |
| event-bus.ts | 46.15% | 100% |
| game-logger.ts | 47.16% | 100% |
| round-manager.ts | 92.85% | 100% |
| **전체** | **59.89%** | **85.86%** |

---

## 주요 구현 원칙 준수 현황

| 원칙 | 준수 |
|---|---|
| P-01 하드코딩 금지 | ✅ MAX_DRAFT_SLOTS, REDIS_SESSION_TTL_S, PG_POOL_SIZE 환경변수 |
| P-02 인터페이스 우선 | ✅ ISessionStore, IStatsStore, ITokenStore |
| P-03 순수 함수/불변 상태 | ✅ JWT 검증, evaluateState 순수 함수 |
| P-04 단일 책임 | ✅ 스토어 계층 완전 분리 |
| P-05 의존성 주입 | ✅ SessionManager, routes 모두 DI |
| P-06 공통 플레이어 API | ✅ MCTSAdapter = IPlayerAdapter |
| P-07 i18n 경유 텍스트 | ✅ |
| P-08 이벤트 기반 전파 | ✅ |
| P-09 단위 테스트 필수 | ✅ 288개 통과 |
| P-10 ID 기반 참조 | ✅ |

---

## 프론트엔드 전환 계획 (유지)

| 현재 | 향후 |
|---|---|
| packages/client (React + Pixi.js 프로토타입) | Unity 기반 클라이언트로 교체 |
| WebSocket 프로토콜 (ws-protocol.ts) | **변경 없음** — Unity도 동일 프로토콜 사용 |
| 렌더링 레이어 (Pixi.js) | Unity 렌더러로 교체 |
| 엔진/서버/AI 패키지 | **변경 없음** |

---

## Phase 5 구현 파일 목록

### docs/
```
docs/
└── unity-ws-protocol.md     # 신규: Unity C# WebSocket 연동 가이드
                             #   - 모든 ClientMessage / ServerMessage 타입 설명
                             #   - Unity NativeWebSocket 예시 코드
                             #   - HTTP REST API (로그인/방생성/AI추가/리더보드)
                             #   - 재연결 처리 예시
```

### packages/server
```
src/
├── ws/
│   ├── ws-protocol.ts       # ★ spectate / spectator_joined 메시지 추가
│   ├── ws-server.ts         # ★ spectate 핸들러 + IEventBus 구독
│   │                        #   - spectate: addSpectator + 현재 상태 즉시 전송
│   │                        #   - join: replaceSocket 재연결 처리 분기
│   └── human-adapter.ts     # ★ replaceSocket(newSocket, currentState?) 추가
│                            #   - makeMessageHandler() 분리 (재사용)
│                            #   - connected getter (readyState === 1)
├── session/
│   └── game-session-manager.ts # ★ SpectatorSend 타입, spectators Map 추가
│                               #   - addSpectator / removeSpectator / broadcastToSpectators
└── api/
    └── routes.ts            # ★ 리더보드 + AI 방 채우기 라우트
                             #   GET  /api/v1/leaderboard?limit=10
                             #   POST /api/v1/rooms/:gameId/ai (보호됨)
                             #   AddAiBodySchema (iterations, timeoutMs)
```

---

## Phase 4 구현 파일 목록

### scripts/
```
scripts/
└── migrate.ts               # 신규: DB 마이그레이션 스크립트
                             #   migrations / game_results / player_stats 테이블 생성
                             #   GIN 인덱스 (player_ids), wins DESC 인덱스
                             #   멱등성 보장 (IF NOT EXISTS / ON CONFLICT)
```

### packages/server
```
src/
├── auth/
│   └── redis-token-store.ts # 신규: RedisTokenStore
│                            #   - issue: 동기 발급 + 비동기 Redis 저장
│                            #   - verify: 비동기 Redis 조회 (에러 시 undefined)
│                            #   - markUsed/revoke/revokeAll: fire-and-forget
│                            #   - graceful degradation (연결 불가 시 에러 없음)
├── ws/
│   └── ws-server.ts         # ★ stats 자동 기록:
│                            #   - IStatsStore 주입 (statsStore? 파라미터)
│                            #   - 게임 루프 완료 시 statsStore.recordResult() 호출
│                            #   - startedAt, loserIds, rounds, playerIds 계산
├── index.ts                 # ★ RedisTokenStore 조건부 선택 추가
│                            #   - REDIS_URL 존재 → RedisTokenStore
│                            #   - createTokenStore() 팩토리 함수
│                            #   - onClose: RedisTokenStore.quit() 포함
└── __tests__/
    ├── redis-token-store.test.ts # 신규: 5개 테스트 (graceful degradation)
    └── load.test.ts              # 신규: 5개 동시성 테스트
                                  #   동시 방 생성 20개, 통계 조회 50개
                                  #   방 조회 30개 동시, stats 100개 동시
                                  #   로그인 10명 동시 → 고유 refresh token
```

---

## Phase 6 구현 파일 목록

### packages/server
```
src/
├── session/
│   ├── matchmaking.ts       # 신규: MatchmakingQueue
│   │                        #   - enqueue/dequeue, onMatch 구독
│   │                        #   - ELO ±200 범위 매칭 (30초 후 any 허용)
│   │                        #   - getPosition / getQueueSizes
│   │                        #   - tryMatch: 앵커 기반 ELO 그룹핑
│   ├── elo.ts               # 신규: ELO 계산
│   │                        #   - calculateElo: K팩터(40/20/10), expectedScore
│   │                        #   - 다인전 지원 (쌍별 비교 평균)
│   │                        #   - ELO_INITIAL=1000, ELO_FLOOR=100
│   └── stats-store.ts       # ★ PlayerStats에 rating 추가
│                            #   - MemoryStatsStore: ELO 자동 계산 + 저장
│                            #   - PostgresStatsStore: rating 컬럼 쿼리 추가
│                            #   - getLeaderboard: rating DESC 정렬
├── api/
│   └── routes.ts            # ★ 매치메이킹 라우트 추가
│                            #   POST /api/v1/matchmaking/join (202 queued / 201 matched)
│                            #   DELETE /api/v1/matchmaking/leave
│                            #   GET  /api/v1/matchmaking/status
│                            #   stats/leaderboard에 rating 필드 포함
└── __tests__/
    ├── matchmaking.test.ts  # 신규: 11개 테스트
    └── elo.test.ts          # 신규: 10개 테스트
```

### scripts/
```
scripts/
└── migrate.ts               # ★ player_stats에 rating INT DEFAULT 1000 추가
```

---

## Phase 7 예정 작업

1. **게임 리플레이**: ActionLog 저장 → WebSocket 재생 (`GET /api/v1/replays/:gameId`)
2. **토너먼트 모드**: 대진표 관리, 자동 라운드 로빈/단일 탈락
3. **관전자 채팅**: 관전 채널 spectator_chat 메시지
4. **알림/푸시**: 매칭 완료 시 HTTP long-poll 또는 SSE 알림
5. **패키지 빌드 검증**: `pnpm -r build` 전체 빌드 + tsc typecheck 통과
