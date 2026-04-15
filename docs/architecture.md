# AB — 전체 아키텍처 설계 및 구현 계획

> 작성일: 2026-04-13
> 상태: 설계 확정 (구현 전)
> 목적: 구현 시작 전 전체 모듈 구조, 의존성, 원칙을 문서화

---

## 1. 구현 원칙

### 1-1. 핵심 원칙 (모든 코드에 적용)

#### [P-01] 하드코딩 금지
- 모든 수치, 텍스트, 식별자는 메타데이터 파일 또는 상수 파일에서 참조
- 예: 이동력 비용 `2`를 코드에 직접 쓰지 않는다 → `TILE_COST.WATER` 상수 사용

#### [P-02] 인터페이스 우선 설계
- 모든 서비스/관리자/판정자는 인터페이스를 먼저 정의한다
- 구현체는 인터페이스를 만족해야 하며, 의존하는 곳은 인터페이스만 바라본다
- 테스트 시 Mock 구현체로 교체 가능해야 한다

#### [P-03] 순수 함수 / 불변 상태
- **판정자(Validator)**: 반드시 순수 함수 — 같은 입력에 같은 출력, 부수효과 없음
- **게임 상태(GameState)**: 직접 변경하지 않는다. 항상 새 상태 객체를 반환한다
- 상태 변경은 오직 `StateApplicator`를 통해서만 이루어진다

#### [P-04] 단일 책임
- 하나의 클래스/함수는 하나의 일만 한다
- `AttackResolver`는 공격 결과만 계산하고, 상태 적용은 `StateApplicator`가 한다
- 예: `MovementValidator.validate()`는 이동 가능 여부만 판단하고 이동시키지 않는다

#### [P-05] 의존성 주입 (DI)
- 모든 서비스는 생성자 주입(Constructor Injection)으로 의존성을 받는다
- `new Service()` 형태의 직접 생성은 `GameFactory`와 테스트 픽스처에서만 허용
- `GameContext`가 DI 컨테이너 역할을 한다

#### [P-06] 공통 플레이어 API
- 인간 플레이어와 AI 플레이어는 **동일한 `IPlayerAdapter` 인터페이스**로 동작한다
- 게임 엔진은 플레이어가 인간인지 AI인지 알지 못한다

#### [P-07] 모든 텍스트는 i18n 헬퍼 경유
```ts
// ❌ 금지
throw new Error("이동할 수 없습니다");

// ✅ 올바른 방법
throw new GameError(getText("error.movement.blocked"));
```

#### [P-08] 이벤트 기반 상태 전파
- 상태 변화는 `EventBus`를 통해 발행된다
- 프론트엔드와 Logger는 이벤트를 구독하여 처리한다
- 게임 엔진 내부는 이벤트 구독자를 알지 못한다

#### [P-09] 유닛 테스트 필수
- 모든 `Validator`, `Resolver`, `Manager`는 단위 테스트를 보유한다
- 테스트 커버리지 목표: Validator 100%, Resolver 100%, Manager 90%+
- 테스트는 실제 구현보다 먼저 작성한다 (TDD 권장)

#### [P-10] ID 기반 참조
- 유닛, 스킬, 효과, 타일 속성 등 모든 게임 데이터는 문자열 ID로 참조한다
- 예: `unit.applyEffect("effect.freeze")`, `tile.setAttribute("tile.fire")`

---

## 2. 전체 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                         메타데이터 레이어                              │
│                                                                     │
│  units.json  weapons.json  skills.json  effects.json  tiles.json    │
│  maps.json   text.json(i18n)   config.json                          │
│                       │                                             │
│                  DataRegistry                                       │
│              (ID → GameData 매핑 테이블)                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ 읽기 전용 참조
┌──────────────────────────▼──────────────────────────────────────────┐
│                      GameContext (DI 컨테이너)                        │
│                                                                     │
│   Validators      Resolvers      Managers      Support              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐  ┌──────────┐          │
│  │Movement  │   │Movement  │   │Health    │  │Logger    │          │
│  │Validator │   │Resolver  │   │Manager   │  │          │          │
│  ├──────────┤   ├──────────┤   ├──────────┤  ├──────────┤          │
│  │Attack    │   │Attack    │   │Effect    │  │Analyzer  │          │
│  │Validator │   │Resolver  │   │Manager   │  │          │          │
│  ├──────────┤   ├──────────┤   ├──────────┤  ├──────────┤          │
│  │Effect    │   │Effect    │   │Tile      │  │EventBus  │          │
│  │Validator │   │Resolver  │   │Manager   │  │          │          │
│  ├──────────┤   ├──────────┤   ├──────────┤  └──────────┘          │
│  │Tile      │   │Tile      │   │Turn      │                         │
│  │Validator │   │Resolver  │   │Manager   │                         │
│  └──────────┘   └──────────┘   ├──────────┤                         │
│                                │Round     │                         │
│                                │Manager   │                         │
│                                ├──────────┤                         │
│                                │Draft     │                         │
│                                │Manager   │                         │
│                                └──────────┘                         │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                      GameLoop                               │   │
│   │  (RoundManager → DraftManager → TurnManager → Action)      │   │
│   └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ IPlayerAdapter (공통 인터페이스)
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    HumanAdapter      AIAdapter       ReplayAdapter
    (WebSocket)    (HeuristicAI)    (로그 재생)
           │               │
           ▼               ▼
    브라우저 클라이언트    AI 로직
    (React 프로토타입 → Unity 교체 예정)
    ※ WebSocket 프로토콜은 Unity/React 공통, 렌더링 레이어만 교체
```

---

## 3. 레이어 구조

```
src/
├── metadata/          # 메타데이터 레이어 (JSON + 생성자)
├── core/              # 게임 엔진 코어
│   ├── context/       # DI 컨테이너 (GameContext, GameFactory)
│   ├── state/         # 게임 상태 모델 (불변)
│   ├── validators/    # 판정자 (순수 함수)
│   ├── resolvers/     # 처리기 (변화 계산)
│   ├── managers/      # 관리자 (상태 적용)
│   ├── loop/          # 게임 루프 (라운드/턴/드래프트)
│   └── support/       # 부속 (Logger, EventBus, i18n)
├── players/           # 플레이어 어댑터
│   ├── human/         # 인간 플레이어 (WebSocket 수신)
│   └── ai/            # AI 플레이어
├── network/           # 네트워크 레이어 (WebSocket 서버, HTTP API)
├── analytics/         # 통계 및 분석
└── shared/            # 공유 타입, 상수, 유틸
```

---

## 4. 모듈 상세 설계

### 4-1. 메타데이터 레이어

#### DataRegistry
```
역할: 모든 메타데이터를 로드하고 ID로 빠르게 조회하는 읽기 전용 저장소
의존성: 없음 (가장 하위 레이어)
```

```ts
interface IDataRegistry {
  getUnit(id: string): UnitMeta
  getWeapon(id: string): WeaponMeta
  getSkill(id: string): SkillMeta
  getEffect(id: string): EffectMeta
  getTileAttribute(id: string): TileAttributeMeta
  getText(id: string, locale?: Locale): string
  getConfig(key: string): ConfigValue
}
```

**주요 메타데이터 스키마**
```ts
UnitMeta {
  id: string
  nameKey: string           // i18n key
  class: UnitClass          // tanker | fighter | ranger | ...
  movement: number
  health: number
  armor: number
  attributes: string[]      // ["attr.shield", "attr.heavy-armor", ...]
  weaponId: string
  resistance: number        // 저항력 회수
  priority: number          // 기본값 1
}

WeaponMeta {
  id: string
  attackType: AttackType    // melee | ranged | artillery
  range: number
  damage: number
  attackAttribute: AttackAttribute | null  // fire | water | electric | acid | ice | null
  rangeType: RangeType[]    // normal | penetration | beam | rush | area
  effects: string[]         // 적용하는 효과 ID 목록
}

EffectMeta {
  id: string
  nameKey: string
  type: EffectBase          // unit | tile | both
  damagePerTurn: number
  removedBy: string[]       // 제거 조건 effect/tile ID 목록
  actionsBlocked: ActionType[]  // freeze는 모두, fire는 없음
  selfRemovable: boolean    // 턴 소비로 직접 해제 가능 여부 (화염만 true)
}
```

---

### 4-2. 게임 상태 (State)

게임 상태는 **불변(Immutable)** 객체다. 모든 변경은 새 객체를 반환한다.

```ts
interface GameState {
  readonly gameId: string
  readonly round: number
  readonly phase: GamePhase          // draft | turn | ended
  readonly currentTurnIndex: number  // turnOrder 배열 내 인덱스
  readonly turnOrder: TurnSlot[]     // 이번 라운드 확정된 턴 순서
  readonly players: ReadonlyMap<PlayerId, PlayerState>
  readonly units: ReadonlyMap<UnitId, UnitState>
  readonly map: MapState
  readonly winner: PlayerId | null
}

interface UnitState {
  readonly id: UnitId
  readonly ownerId: PlayerId
  readonly position: Position
  readonly currentHp: number
  readonly effects: ReadonlyMap<EffectId, EffectState>
  readonly activeAttributes: string[]  // 강에 빠지면 비어짐
  readonly actionsUsed: ActionUsed     // { moved, attacked }
  readonly isAlive: boolean
}

interface TileState {
  readonly position: Position
  readonly baseType: BaseTileType      // road | plain | mountain
  readonly attribute: TileAttribute | null  // fire | water | river | acid | ...
  readonly occupant: UnitId | ObjectId | null
}
```

---

### 4-3. 판정자 (Validators) — 순수 함수

판정자는 **부수효과가 없는 순수 함수**다. 게임 상태를 읽고 판정 결과만 반환한다.

#### MovementValidator
```
역할: 특정 유닛이 특정 위치로 이동 가능한지 판정
의존성: IDataRegistry (이동력 비용 조회)
```

```ts
interface IMovementValidator {
  // 단일 타일 진입 가능 여부
  canEnterTile(unit: UnitState, target: Position, state: GameState): ValidationResult

  // 목적지까지의 이동 가능 여부 + 경로 계산 (BFS)
  validateMove(unit: UnitState, destination: Position, state: GameState): MoveValidation
  // MoveValidation = { valid, reason?, path?, cost? }

  // 이동 가능한 모든 위치 반환 (범위 하이라이트용)
  getReachableTiles(unit: UnitState, state: GameState): Position[]
}
```

**판정 로직 (순서대로):**
1. 유닛이 이번 턴 이동 가능 상태인가? (빙결, 이동 불가 효과 체크)
2. 이미 이동을 사용했는가? (actionsUsed.moved)
3. BFS로 이동력 범위 계산
   - 물 타일: 이동력 2 소모 (진입 가능)
   - 강 타일: 이동력 2 소모, 단 **멈출 수 없음** (통과만 가능)
   - 나무/바위: 비행 속성 없으면 이동 불가
   - 유닛이 있는 타일: **경유 가능, 목적지 불가**
4. 목적지가 빈 타일인가?

---

#### AttackValidator
```
역할: 특정 유닛이 특정 타겟을 특정 공격 타입으로 공격 가능한지 판정
의존성: IDataRegistry
```

```ts
interface IAttackValidator {
  validateAttack(unit: UnitState, target: Position, state: GameState): AttackValidation
  // AttackValidation = { valid, reason?, affectedPositions? }

  getAttackableTargets(unit: UnitState, state: GameState): Position[]
}
```

**판정 로직:**
1. 유닛이 이번 턴 공격 가능 상태인가? (빙결 체크)
2. 이미 공격을 사용했는가? (actionsUsed.attacked)
   - 단, 유격대원 속성은 이동 전 공격 후 이동 허용
3. 타겟이 공격 범위 내인가? (직선 거리)
4. 공격 타입별 추가 체크:
   - **근거리**: 사거리 내 타겟 존재
   - **원거리**: 최소 2칸 이상, LOS 없음 (자유 타겟)
   - **포격**: 자신과 타겟 사이 경로에 유닛/물체 1개 이상 존재

---

#### EffectValidator
```
역할: 특정 효과가 특정 유닛/타일에 적용 가능한지 판정
의존성: IDataRegistry
```

```ts
interface IEffectValidator {
  canApplyEffect(effectId: EffectId, target: UnitState | TileState, state: GameState): ValidationResult
  canRemoveEffect(effectId: EffectId, unit: UnitState, reason: RemoveReason): ValidationResult
}
```

**판정 로직:**
- 빙결 → 적용 시 기존 모든 효과(화염/산성/독) 제거 후 적용
- 물 타일 진입 → 화염/산성/독 자동 제거 가능 여부 체크
- 저항력(Resistance) 보유 시 → 효과 적용 전 저항력 차감으로 무효화 가능

---

#### TileValidator
```
역할: 타일 속성 변환 가능 여부, 강 타일 생성 조건 판정
의존성: IDataRegistry
```

```ts
interface ITileValidator {
  // 강 생성 조건 (물 3개 이상 인접) 충족 여부
  shouldFormRiver(position: Position, state: GameState): boolean

  // 타일 속성 변환 가능 여부
  canConvertTile(position: Position, newAttribute: TileAttribute, state: GameState): ValidationResult
}
```

---

### 4-4. 처리기 (Resolvers) — 변화 계산

처리기는 **변화(Change) 목록을 계산**한다. 실제 상태 적용은 하지 않는다.

모든 Resolver는 `GameChange[]`를 반환한다.

```ts
// 모든 변화는 이 타입의 유니온으로 표현
type GameChange =
  | UnitMoveChange        // 유닛 위치 변경
  | UnitDamageChange      // 유닛 체력 감소
  | UnitHealChange        // 유닛 체력 증가
  | UnitEffectAddChange   // 유닛 효과 추가
  | UnitEffectRemoveChange// 유닛 효과 제거
  | UnitDeathChange       // 유닛 사망
  | UnitAttributeChange   // 유닛 속성 변경 (강에 빠짐/탈출)
  | TileAttributeChange   // 타일 속성 변환
  | TileFormRiverChange   // 강 타일 생성
  | TileBreakRiverChange  // 강 타일 해제
```

#### MovementResolver
```
역할: 이동 명령의 결과 변화 목록 계산
의존성: IMovementValidator, IDataRegistry
```

```ts
interface IMovementResolver {
  resolve(unit: UnitState, destination: Position, state: GameState): GameChange[]
}
```

**처리 순서:**
1. 경로 상 타일 효과 수령 계산 (화염/전기 타일 경유 시)
2. 목적지 도착
3. 목적지 타일 효과 수령 (물 타일 → 화염/산성/독 제거)
4. 강 타일 통과 처리 (멈출 수 없음)
5. 강으로 **밀려** 들어가는 경우: 모든 효과/속성 상실 변화 추가
6. 물 타일 이동력 2 소모 → 이동 취소 판정 (이동력 부족)

---

#### AttackResolver
```
역할: 공격 명령의 결과 변화 목록 계산 (데미지, 효과, 밀어냄, 타일 변환)
의존성: IAttackValidator, IDataRegistry
```

```ts
interface IAttackResolver {
  resolve(attacker: UnitState, target: Position, state: GameState): GameChange[]
}
```

**처리 순서:**
1. 기본 데미지 계산: `weapon.damage - target.armor` (최소 0)
2. 공격 범위 타입 처리:
   - **관통**: 타겟 + 뒤 1칸 대상 추가 / 방패 유닛 타겟 시 뒤 1칸 차단
   - **광선**: 직선 전체 대상 / 방패 유닛에서 전파 차단
   - **범위**: 중심 + 상하좌우 대상
3. 방패 차단 체크: 타겟 위치에 방패 유닛이 있으면 뒤 전파 차단
4. 산성 효과 중 피격: 데미지 2배
5. 밀어냄/끌어옴 처리:
   - 대상 방향에 유닛/물체 있음 → 이동 없이 충돌 1 데미지
   - 대상 방향이 비어있음 → 이동만 (데미지 없음)
   - 충돌 대상이 빙결 유닛 → 빙결 해제 + 충돌 유닛 1 데미지 + 빙결 유닛 0 데미지
   - 맵 경계 → 이동 없음 + 데미지 없음
6. 공격 속성(`attackAttribute`) 처리:
   - 타겟 유닛에 해당 효과 적용
   - 타겟 타일 속성 변환 (마지막 공격 속성 → 타일 속성 덮어씀)
7. 타일 변환으로 인한 유닛 효과 즉시 적용/제거 (예: 불 타일 → 물 타일 → 화염 효과 제거)

---

#### EffectResolver
```
역할: 효과 적용/제거의 변화 계산 (매 턴 틱 포함)
의존성: IEffectValidator, IDataRegistry
```

```ts
interface IEffectResolver {
  // 매 턴 시작 시 효과 틱 처리
  resolveTurnTick(unit: UnitState, state: GameState): GameChange[]

  // 특정 효과 적용
  resolveApply(effectId: EffectId, target: UnitState | TileState): GameChange[]

  // 특정 효과 제거
  resolveRemove(effectId: EffectId, unit: UnitState, reason: RemoveReason): GameChange[]
}
```

**틱 처리 순서:**
1. 화염 효과 → `UnitDamageChange` 1 데미지
2. 독 효과 → `UnitDamageChange` 1 데미지
3. 전기 타일 위에 있는 경우 → `UnitDamageChange` 1 데미지
4. 빙결 해제 타이밍 체크 (자신의 턴 시작 시)

---

#### TileResolver
```
역할: 타일 속성 변환, 강 생성/소멸 변화 계산
의존성: ITileValidator, IDataRegistry
```

```ts
interface ITileResolver {
  // 타일에 공격 속성 적용 (타일 변환)
  resolveAttributeConversion(position: Position, attackAttribute: AttackAttribute, state: GameState): GameChange[]

  // 물 타일 추가/제거 후 강 생성/소멸 체크
  resolveRiverFormation(positions: Position[], state: GameState): GameChange[]
}
```

---

### 4-5. 관리자 (Managers) — 상태 적용 및 흐름 제어

#### StateApplicator
```
역할: GameChange[] 를 받아 GameState에 적용하고 새 GameState 반환
의존성: 없음 (순수 함수적 동작)
```

```ts
interface IStateApplicator {
  apply(changes: GameChange[], state: GameState): GameState
}
```

이 모듈이 유일하게 상태를 변경하는 지점이다.

---

#### HealthManager
```
역할: 사망 감지 및 사망 후처리
의존성: IStateApplicator, IEventBus
```

```ts
interface IHealthManager {
  // 데미지 적용 후 사망 유닛 감지
  checkDeaths(state: GameState): GameChange[]  // UnitDeathChange 목록

  // 사망한 유닛의 타일 정리
  resolveDeathCleanup(unitId: UnitId, state: GameState): GameChange[]
}
```

---

#### EffectManager
```
역할: 매 턴 효과 틱, 이동/공격 시 자동 효과 처리
의존성: IEffectResolver, IStateApplicator
```

```ts
interface IEffectManager {
  // 턴 시작 시 모든 효과 틱
  processTurnStart(unitId: UnitId, state: GameState): GameState

  // 이동 후 타일 효과 자동 처리
  processTileEntry(unitId: UnitId, position: Position, state: GameState): GameState
}
```

---

#### TileManager
```
역할: 타일 속성 변환, 강 생성/소멸, 모래→모래폭풍 변환
의존성: ITileResolver, IStateApplicator
```

```ts
interface ITileManager {
  // 공격 후 타일 속성 변환 처리
  processAttackOnTile(position: Position, attackAttribute: AttackAttribute, state: GameState): GameState

  // 물 타일 변경 후 강 조건 체크
  checkRiverConditions(state: GameState): GameState

  // 모래 타일 공격받음 → 모래폭풍으로 변환
  processSandAttack(position: Position, state: GameState): GameState
}
```

---

#### TurnManager
```
역할: 현재 턴 유닛 관리, 턴 종료/전환
의존성: IEventBus
```

```ts
interface ITurnManager {
  getCurrentTurnUnit(state: GameState): UnitState
  endTurn(state: GameState): GameState          // 다음 턴으로 전환
  isActionAllowed(unit: UnitState, action: ActionType, state: GameState): boolean
}
```

---

#### DraftManager
```
역할: 드래프트 페이즈 처리 (슬롯 배치, 타임아웃, 턴 순서 생성)
의존성: IEventBus, IDataRegistry
```

```ts
interface IDraftManager {
  // 드래프트 시작, 180초 타이머 시작
  startDraft(state: GameState): GameState

  // 플레이어가 슬롯에 유닛 배치
  placeUnit(playerId: PlayerId, slotIndex: number, unitId: UnitId, state: GameState): GameState

  // 타임아웃 or 전원 완료 → 턴 순서 확정
  finalizeDraft(state: GameState): GameState
  // 2인: A1,B1,A2,B2,A3,B3
  // 4인(팀전): 팀A슬롯1,팀B슬롯1 ... 팀A슬롯6,팀B슬롯6
}
```

---

#### RoundManager
```
역할: 라운드 시작/종료, 30라운드 초과 처리
의존성: IDraftManager, ITurnManager, IEndDetector
```

```ts
interface IRoundManager {
  startRound(state: GameState): GameState
  endRound(state: GameState): GameState
  isLastRound(state: GameState): boolean  // round >= 30
}
```

---

#### EndDetector
```
역할: 게임 종료 조건 감지
의존성: 없음 (순수 함수)
```

```ts
interface IEndDetector {
  check(state: GameState): EndResult | null
  // EndResult = { winner: PlayerId | null (무승부), reason: EndReason }
}
```

**종료 조건:**
1. 한 플레이어의 모든 유닛 사망 → 상대 승리
2. 30라운드 종료 → 살아남은 유닛 수 비교, 동수면 무승부

---

### 4-6. 게임 루프 (GameLoop)

```
역할: 전체 게임 흐름 오케스트레이션
의존성: RoundManager, DraftManager, TurnManager, EndDetector,
        모든 Manager, EventBus
```

```ts
interface IGameLoop {
  start(initialState: GameState): Promise<GameResult>
}
```

**실행 흐름:**
```
GameLoop.start()
  └─ while (!gameEnded)
       └─ RoundManager.startRound()
            └─ DraftManager.startDraft() → await player inputs (180s)
            └─ DraftManager.finalizeDraft() → turnOrder 확정
            └─ for each turn in turnOrder:
                 └─ EffectManager.processTurnStart()  // 효과 틱
                 └─ EventBus.emit("turn.start", unit) // 플레이어에게 알림
                 └─ await PlayerAdapter.requestAction() // 행동 요청
                 └─ ActionProcessor.process(action)    // 판정 → 처리 → 적용
                 └─ PostProcessor.run()                // 사망 체크, 타일 체크
                 └─ EndDetector.check()
                 └─ Logger.logTurn()
            └─ RoundManager.endRound()
```

---

### 4-7. 액션 처리 흐름 (ActionProcessor)

```
역할: 플레이어 액션을 검증하고 결과를 게임 상태에 반영하는 파이프라인
```

```
PlayerAction 수신
    │
    ├─ TurnManager.isActionAllowed()  → 이 턴에 이 액션 가능한가?
    │   실패 → ActionRejected 이벤트 발행
    │
    ├─ [Validator].validate()         → 게임 룰 상 가능한가?
    │   실패 → ActionRejected 이벤트 발행
    │
    ├─ [Resolver].resolve()           → GameChange[] 계산
    │
    ├─ StateApplicator.apply()        → 새 GameState 생성
    │
    ├─ PostProcessor.run()            → 사망/타일/강/종료 체크
    │
    ├─ Logger.log()                   → 이벤트 로그 저장
    │
    └─ EventBus.emit("state.update")  → 모든 클라이언트에 브로드캐스트
```

---

### 4-8. 플레이어 어댑터 (Player Adapters)

```ts
// 게임 엔진이 바라보는 단일 인터페이스
interface IPlayerAdapter {
  readonly playerId: PlayerId
  readonly type: "human" | "ai" | "replay"

  // 드래프트 단계: 슬롯 배치 요청
  requestDraftPlacement(draftState: DraftState, timeout: number): Promise<DraftAction>

  // 턴 단계: 행동 요청
  requestAction(turnState: TurnState, timeout: number): Promise<GameAction>

  // 상태 업데이트 알림 (이벤트 수신용)
  onStateUpdate(state: GameState): void
}
```

**HumanAdapter**: WebSocket 메시지를 `IPlayerAdapter` 인터페이스로 변환  
**AIAdapter**: AI 로직의 출력을 `IPlayerAdapter` 인터페이스로 변환  
**ReplayAdapter**: 저장된 로그를 재생하는 어댑터

---

### 4-9. 지원 모듈 (Support)

#### EventBus
```ts
interface IEventBus {
  emit<T>(event: GameEventType, payload: T): void
  on<T>(event: GameEventType, handler: (payload: T) => void): Unsubscribe
}
```

주요 이벤트 타입:
```ts
type GameEventType =
  | "game.start" | "game.end"
  | "round.start" | "round.end"
  | "draft.start" | "draft.end" | "draft.timeout"
  | "turn.start" | "turn.end"
  | "action.accepted" | "action.rejected"
  | "unit.moved" | "unit.attacked" | "unit.died"
  | "effect.applied" | "effect.removed"
  | "tile.changed"
  | "state.update"
```

#### GameLogger
```ts
interface IGameLogger {
  logAction(action: GameAction, changes: GameChange[], state: GameState): void
  logEvent(event: GameEventType, payload: unknown): void
  getGameLog(gameId: string): GameLog
}
```

로그 엔트리 스키마:
```ts
interface LogEntry {
  gameId: string
  timestamp: number
  round: number
  turnIndex: number
  playerId: PlayerId
  unitId: UnitId
  actionType: ActionType
  positionBefore?: Position
  positionAfter?: Position
  damage?: number
  effectsApplied?: EffectId[]
  effectsRemoved?: EffectId[]
  tilesChanged?: TileChangeRecord[]
}
```

#### i18n 헬퍼
```ts
function getText(key: string, params?: Record<string, string>): string
// 예: getText("error.movement.frozen") → "빙결 상태에서는 행동할 수 없습니다"
```

---

## 5. 의존성 그래프

```
DataRegistry          (의존성 없음, 최하위)
    ↑
TileValidator         (DataRegistry)
MovementValidator     (DataRegistry)
AttackValidator       (DataRegistry)
EffectValidator       (DataRegistry)
EndDetector           (의존성 없음, 순수 함수)
    ↑
TileResolver          (TileValidator, DataRegistry)
MovementResolver      (MovementValidator, DataRegistry)
AttackResolver        (AttackValidator, DataRegistry)
EffectResolver        (EffectValidator, DataRegistry)
StateApplicator       (의존성 없음, 순수 함수)
    ↑
HealthManager         (StateApplicator, EventBus)
EffectManager         (EffectResolver, StateApplicator)
TileManager           (TileResolver, StateApplicator)
TurnManager           (EventBus)
DraftManager          (EventBus, DataRegistry)
RoundManager          (DraftManager, TurnManager, EndDetector)
    ↑
ActionProcessor       (모든 Validator, 모든 Resolver, StateApplicator,
                       HealthManager, EffectManager, TileManager, Logger)
    ↑
GameLoop              (RoundManager, DraftManager, TurnManager,
                       ActionProcessor, EndDetector, EventBus, Logger)
    ↑
GameFactory           (GameLoop + 모든 모듈 조립)
```

**GameContext** = 위 모든 인스턴스를 보유하는 DI 컨테이너  
**GameFactory** = GameContext를 조립하는 유일한 장소

---

## 6. 디렉토리 구조 (전체)

```
project-ab/
├── docs/
│   ├── AB.md                    # 게임 설계 원본
│   ├── DESIGN.md                # 디자인 시스템
│   ├── architecture.md          # 이 문서
│   └── implementation-review.md # 룰 검토 문서
│
├── packages/
│   ├── metadata/                # 메타데이터 JSON + 스키마
│   │   ├── units.json
│   │   ├── weapons.json
│   │   ├── skills.json
│   │   ├── effects.json
│   │   ├── tiles.json
│   │   ├── maps/
│   │   │   └── test-map-01.json
│   │   ├── text/
│   │   │   ├── ko.json
│   │   │   └── en.json
│   │   └── schemas/             # Zod 스키마 (공유됨)
│   │
│   ├── engine/                  # 게임 엔진 (백앤드 + 공유)
│   │   ├── src/
│   │   │   ├── state/
│   │   │   │   ├── GameState.ts
│   │   │   │   ├── UnitState.ts
│   │   │   │   ├── TileState.ts
│   │   │   │   └── GameChange.ts
│   │   │   ├── validators/
│   │   │   │   ├── IMovementValidator.ts
│   │   │   │   ├── MovementValidator.ts
│   │   │   │   ├── IAttackValidator.ts
│   │   │   │   ├── AttackValidator.ts
│   │   │   │   ├── IEffectValidator.ts
│   │   │   │   ├── EffectValidator.ts
│   │   │   │   ├── ITileValidator.ts
│   │   │   │   └── TileValidator.ts
│   │   │   ├── resolvers/
│   │   │   │   ├── MovementResolver.ts
│   │   │   │   ├── AttackResolver.ts
│   │   │   │   ├── EffectResolver.ts
│   │   │   │   └── TileResolver.ts
│   │   │   ├── managers/
│   │   │   │   ├── StateApplicator.ts
│   │   │   │   ├── HealthManager.ts
│   │   │   │   ├── EffectManager.ts
│   │   │   │   ├── TileManager.ts
│   │   │   │   ├── TurnManager.ts
│   │   │   │   ├── DraftManager.ts
│   │   │   │   └── RoundManager.ts
│   │   │   ├── loop/
│   │   │   │   ├── GameLoop.ts
│   │   │   │   ├── ActionProcessor.ts
│   │   │   │   ├── PostProcessor.ts
│   │   │   │   └── EndDetector.ts
│   │   │   ├── context/
│   │   │   │   ├── GameContext.ts
│   │   │   │   └── GameFactory.ts
│   │   │   └── support/
│   │   │       ├── EventBus.ts
│   │   │       ├── GameLogger.ts
│   │   │       ├── i18n.ts
│   │   │       └── DataRegistry.ts
│   │   └── tests/
│   │       ├── validators/
│   │       ├── resolvers/
│   │       ├── managers/
│   │       └── integration/
│   │
│   ├── server/                  # 백앤드 서버
│   │   ├── src/
│   │   │   ├── ws/              # WebSocket 서버
│   │   │   │   ├── GameSocketServer.ts
│   │   │   │   └── HumanAdapter.ts
│   │   │   ├── api/             # HTTP REST API
│   │   │   │   ├── lobby.ts
│   │   │   │   ├── auth.ts
│   │   │   │   └── stats.ts
│   │   │   ├── session/         # 게임 세션 (Redis)
│   │   │   └── db/              # 영구 저장 (PostgreSQL)
│   │   └── tests/
│   │
│   ├── ai/                      # AI 플레이어
│   │   ├── src/
│   │   │   ├── AIAdapter.ts     # IPlayerAdapter 구현
│   │   │   ├── heuristic/       # Phase 1: 규칙 기반 AI
│   │   │   ├── mcts/            # Phase 2: MCTS
│   │   │   └── rl/              # Phase 3: 강화학습
│   │   └── tests/
│   │
│   └── client/                  # 클라이언트 어댑터 레이어
│       │                        # ⚠️ 초기 프로토타입: React + Pixi.js (브라우저)
│       │                        # ⚠️ 정식 클라이언트: Unity 기반으로 교체 예정
│       │                        #    (렌더링 레이어만 교체; WebSocket 프로토콜 동일)
│       ├── src/
│       │   ├── renderer/        # 렌더러 (Pixi.js → Unity 교체 대상)
│       │   ├── ui/              # UI 컴포넌트 (프로토타입)
│       │   ├── ws/              # WebSocket 클라이언트 (프로토콜은 Unity와 공유)
│       │   └── store/           # 클라이언트 상태
│       └── tests/
│
├── test-unit-data.json
└── package.json                 # 모노레포 루트 (pnpm workspaces)
```

---

## 7. 테스트 전략

### 단위 테스트 (Unit Tests)
| 대상 | 커버리지 목표 | 비고 |
|---|---|---|
| 모든 Validator | 100% | 순수 함수, 가장 쉽고 중요 |
| 모든 Resolver | 100% | 모든 엣지케이스 포함 |
| StateApplicator | 100% | 모든 Change 타입 |
| EndDetector | 100% | 종료 조건 전부 |
| Managers | 90%+ | 복잡한 흐름 포함 |

### 통합 테스트 (Integration Tests)
- 시나리오 기반: "빙결 유닛이 밀어냄 충돌 받는 경우" 등 룰 상 중요 엣지케이스
- GameLoop 전체 2인 게임 1회 시뮬레이션
- AI vs AI 30라운드 정상 완주

### 테스트 픽스처
```ts
// 테스트용 게임 상태 빌더
const state = TestStateBuilder
  .create()
  .withUnit("u1", { position: {x:0,y:0}, effects: ["effect.freeze"] })
  .withUnit("u2", { position: {x:1,y:0} })
  .withTile({x:2,y:0}, "tile.fire")
  .build()
```

---

## 8. 구현 순서 (Phase 1)

### Step 1: 기반 인프라 (1-2일)
- [ ] 모노레포 설정 (pnpm workspaces)
- [ ] TypeScript 설정 (strict mode)
- [ ] Zod 메타데이터 스키마 정의
- [ ] DataRegistry 구현 + 테스트 데이터 로드
- [ ] i18n 헬퍼 구현
- [ ] 상수/에러 코드 파일 정의

### Step 2: 상태 모델 (1일)
- [ ] GameState, UnitState, TileState, GameChange 타입 정의
- [ ] StateApplicator 구현 + 테스트

### Step 3: 판정자 (2-3일)
- [ ] MovementValidator + 테스트 (물/강 타일, 빙결, 경유, BFS)
- [ ] AttackValidator + 테스트 (근거리/원거리/포격, 빙결)
- [ ] EffectValidator + 테스트
- [ ] TileValidator + 테스트 (강 생성 조건)

### Step 4: 처리기 (2-3일)
- [ ] MovementResolver + 테스트 (타일 효과 수령, 강 진입)
- [ ] AttackResolver + 테스트 (관통/광선/방패, 밀어냄, 타일 변환)
- [ ] EffectResolver + 테스트 (틱, 빙결 상호작용)
- [ ] TileResolver + 테스트 (속성 변환, 강 생성)

### Step 5: 관리자 (2일)
- [ ] HealthManager + TileManager + EffectManager
- [ ] TurnManager + DraftManager + RoundManager
- [ ] EndDetector

### Step 6: 게임 루프 (2일)
- [ ] ActionProcessor (판정 → 처리 → 적용 파이프라인)
- [ ] PostProcessor
- [ ] GameLoop
- [ ] EventBus + GameLogger

### Step 7: 플레이어 어댑터 (1일)
- [ ] IPlayerAdapter 인터페이스
- [ ] HeuristicAI (최소 동작: 랜덤 유효 액션)
- [ ] AI vs AI 테스트 실행

### Step 8: 통합 테스트 (1-2일)
- [ ] 전체 게임 시뮬레이션 (AI vs AI)
- [ ] 주요 룰 시나리오 테스트
