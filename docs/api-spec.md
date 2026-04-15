# AB — 인터페이스 & API 명세서

> 작성일: 2026-04-13
> 범위: 모듈 간 인터페이스 / WebSocket 프로토콜 / HTTP REST API
> 언어: TypeScript (백앤드 Node.js, 프론트앤드 React 공유)

---

## 1. 공통 기본 타입

```ts
// ─── 식별자 ───────────────────────────────────────────────────
type GameId    = string   // "game_xxxxxxxx"
type PlayerId  = string   // "player_xxxxxxxx"
type UnitId    = string   // "unit_xxxxxxxx"
type ObjectId  = string   // "object_xxxxxxxx" (바위, 나무)
type EffectId  = string   // "effect.freeze" | "effect.fire" | ...
type SkillId   = string   // "skill.shield" | "skill.rush" | ...
type WeaponId  = string   // "weapon.fire-arrow" | ...
type TileAttr  = string   // "tile.fire" | "tile.water" | "tile.river" | ...
type BaseTile  = "road" | "plain" | "mountain"

// ─── 위치 ────────────────────────────────────────────────────
interface Position {
  x: number   // 열 (0 ~ 10)
  y: number   // 행 (0 ~ 10)
}

// ─── 방향 ────────────────────────────────────────────────────
type Direction = "up" | "down" | "left" | "right"

// ─── 게임 단계 ────────────────────────────────────────────────
type GamePhase  = "waiting" | "draft" | "turn" | "ended"

// ─── 액션 타입 ────────────────────────────────────────────────
type ActionType =
  | "move"
  | "attack"
  | "skill"
  | "extinguish"    // 화염 해제 (턴 전체 소비)
  | "pass"          // 아무것도 하지 않고 턴 종료
  | "draft_place"   // 드래프트 슬롯 배치

// ─── 공격 타입 ────────────────────────────────────────────────
type AttackType = "melee" | "ranged" | "artillery"

// ─── 범위 타입 ────────────────────────────────────────────────
type RangeType =
  | "normal"        // 단일 대상
  | "penetration"   // 관통: 대상 + 뒤 1칸
  | "beam"          // 광선: 직선 전체
  | "rush"          // 돌진: 직선 상 적 바로 앞까지 이동
  | "area"          // 범위: 중심 + 상하좌우

// ─── 공격 속성 ────────────────────────────────────────────────
type AttackAttribute = "fire" | "water" | "electric" | "acid" | "ice" | null

// ─── 유닛 클래스 ──────────────────────────────────────────────
type UnitClass = "tanker" | "fighter" | "ranger" | "raider" | string

// ─── 로케일 ──────────────────────────────────────────────────
type Locale = "ko" | "en"

// ─── 검증 결과 ────────────────────────────────────────────────
interface ValidationResult {
  valid: boolean
  reason?: string    // getText() key
}

// ─── 게임 종료 결과 ───────────────────────────────────────────
type EndReason = "all_units_dead" | "round_limit"
interface EndResult {
  winner: PlayerId | null   // null = 무승부
  reason: EndReason
  scores: Record<PlayerId, number>  // 승점: 승3, 무2, 패1
}
```

---

## 2. 메타데이터 스키마

### 2-1. UnitMeta
```ts
interface UnitMeta {
  id: string
  nameKey: string             // getText() key
  descKey: string
  class: UnitClass
  movement: number            // 기본 이동력
  health: number              // 최대 체력
  armor: number               // 방어력
  resistance: number          // 저항력 회수 (0이면 없음)
  priority: number            // 우선권 (기본값 1)
  attributes: string[]        // ["attr.shield", "attr.heavy-armor", ...]
  weaponId: WeaponId          // 기본 무기
  faction?: string            // 팩션 (선택)
}
```

### 2-2. WeaponMeta
```ts
interface WeaponMeta {
  id: WeaponId
  nameKey: string
  attackType: AttackType
  range: number               // 최대 사거리 (칸)
  minRange: number            // 최소 사거리 (근거리=0, 원거리=2, 포격=2)
  damage: number
  attackAttribute: AttackAttribute
  rangeTypes: RangeType[]     // 복수 가능 (예: 범위+밀어냄)
  effectsOnHit: EffectId[]    // 명중 시 적용 효과
  knockback?: KnockbackSpec   // 밀어냄/끌어옴 사양
  areaSpec?: AreaSpec         // 범위 공격 상세
  upgradable: boolean
}

interface KnockbackSpec {
  type: "push" | "pull"
  distance: number            // 기본 1
  damage: number              // 충돌 데미지 (기본 1)
}

interface AreaSpec {
  pattern: "cross" | "square" | "custom"
  radius: number
  effectPerCell?: EffectId[]
  knockbackPerCell?: KnockbackSpec
}
```

### 2-3. EffectMeta
```ts
interface EffectMeta {
  id: EffectId
  nameKey: string
  base: "unit" | "tile" | "both"
  damagePerTurn: number       // 0이면 데미지 없음
  blockedActions: ActionType[]// 빙결: 모두, 나머지: []
  selfRemovable: boolean      // 화염만 true (턴 소비)
  removedBy: RemoveCondition[]
  stackable: boolean          // 중복 적용 가능 여부
}

interface RemoveCondition {
  type: "effect" | "tile_entry" | "attack_attribute" | "skill"
  id: string                  // effect.freeze | tile.water | ...
}
```

### 2-4. TileAttributeMeta
```ts
interface TileAttributeMeta {
  id: TileAttr
  nameKey: string
  movementCost: number        // 기본 1, 물/강 = 2
  canStop: boolean            // 강 타일 = false
  entryEffect?: EffectId      // 진입 시 적용 효과
  periodicEffect?: {          // 타일 위에 있는 동안 매 턴 효과
    effectId: EffectId
    damage: number
  }
  removesEffectsOnEntry: EffectId[]  // 물 타일: [fire, acid, poison]
  formsRiver?: boolean        // 물 타일만 true
  riverThreshold?: number     // 강이 되는 인접 개수 (3)
}
```

### 2-5. MapMeta
```ts
interface MapMeta {
  id: string
  nameKey: string
  width: number               // 11
  height: number              // 11
  tiles: TileCell[][]         // [y][x]
  spawnPoints: SpawnPoint[]
  objects: ObjectPlacement[]
}

interface TileCell {
  base: BaseTile
  attribute?: TileAttr
}

interface SpawnPoint {
  playerId: number            // 0-based 플레이어 인덱스
  positions: Position[]       // 배치 가능 위치들
}

interface ObjectPlacement {
  type: "rock" | "tree"
  position: Position
  health: number              // 기본값 2
}
```

---

## 3. 게임 상태 타입

### 3-1. GameState (불변)
```ts
interface GameState {
  readonly gameId: GameId
  readonly round: number              // 1 ~ 30
  readonly phase: GamePhase
  readonly currentTurnIndex: number   // turnOrder 인덱스
  readonly turnOrder: TurnSlot[]      // 이번 라운드 확정 순서
  readonly firstPlayerId: PlayerId    // 이번 라운드 선공 플레이어
  readonly players: ReadonlyRecord<PlayerId, PlayerState>
  readonly units: ReadonlyRecord<UnitId, UnitState>
  readonly map: MapState
  readonly draftState?: DraftState    // phase === "draft" 일 때
  readonly winner: EndResult | null
}

interface TurnSlot {
  unitId: UnitId
  ownerId: PlayerId
  slotIndex: number           // 0-based
}

interface PlayerState {
  readonly id: PlayerId
  readonly name: string
  readonly teamId: string | null      // 4인 팀전 시 사용
  readonly unitIds: UnitId[]
  readonly score: number
  readonly isConnected: boolean
}
```

### 3-2. UnitState (불변)
```ts
interface UnitState {
  readonly id: UnitId
  readonly metaId: string             // UnitMeta.id 참조
  readonly ownerId: PlayerId
  readonly position: Position
  readonly currentHp: number
  readonly maxHp: number
  readonly armor: number
  readonly movement: number
  readonly effects: ReadonlyRecord<EffectId, ActiveEffect>
  readonly activeAttributes: string[] // 강에 빠지면 []로 초기화됨
  readonly baseAttributes: string[]   // 원본 속성 (강 탈출 시 복원용)
  readonly actionsUsed: ActionsUsed
  readonly isAlive: boolean
  readonly isInRiver: boolean
}

interface ActiveEffect {
  readonly effectId: EffectId
  readonly appliedRound: number
  readonly appliedTurn: number
  readonly source?: UnitId            // 누가 적용했는지
}

interface ActionsUsed {
  readonly moved: boolean
  readonly attacked: boolean
  readonly usedSkill: boolean
  readonly extinguished: boolean
}
```

### 3-3. TileState (불변)
```ts
interface TileState {
  readonly position: Position
  readonly base: BaseTile
  readonly attribute: TileAttr | null
  readonly occupant: UnitId | ObjectId | null
  readonly objectHealth?: number      // 물체(바위/나무)의 체력
}
```

### 3-4. MapState (불변)
```ts
interface MapState {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly tiles: ReadonlyRecord<string, TileState>  // key = "x,y"
}

// 헬퍼
function tileKey(pos: Position): string { return `${pos.x},${pos.y}` }
```

### 3-5. DraftState
```ts
interface DraftState {
  readonly slots: ReadonlyRecord<number, DraftSlot | null>  // index → slot
  readonly totalSlots: number         // 2인=3, 4인=6
  readonly timeoutAt: number          // timestamp (ms)
  readonly submissions: ReadonlyRecord<PlayerId, boolean>
}

interface DraftSlot {
  readonly unitId: UnitId
  readonly ownerId: PlayerId
}
```

---

## 4. 변화(GameChange) 타입

```ts
type GameChange =
  | UnitMoveChange
  | UnitDamageChange
  | UnitHealChange
  | UnitEffectAddChange
  | UnitEffectRemoveChange
  | UnitDeathChange
  | UnitRiverEnterChange
  | UnitRiverExitChange
  | UnitAttributeOverrideChange
  | ObjectDamageChange
  | ObjectDestroyChange
  | TileAttributeSetChange
  | TileFormRiverChange
  | TileBreakRiverChange
  | TileOccupantSetChange

interface UnitMoveChange {
  type: "unit.move"
  unitId: UnitId
  from: Position
  to: Position
}

interface UnitDamageChange {
  type: "unit.damage"
  unitId: UnitId
  amount: number
  source: DamageSource   // 아래 정의
  finalHp: number
}

interface UnitHealChange {
  type: "unit.heal"
  unitId: UnitId
  amount: number
  finalHp: number
}

interface UnitEffectAddChange {
  type: "unit.effect.add"
  unitId: UnitId
  effectId: EffectId
  sourceUnitId?: UnitId
}

interface UnitEffectRemoveChange {
  type: "unit.effect.remove"
  unitId: UnitId
  effectId: EffectId
  reason: RemoveReason
}

interface UnitDeathChange {
  type: "unit.death"
  unitId: UnitId
  position: Position
  killedByUnitId?: UnitId
}

interface UnitRiverEnterChange {
  type: "unit.river.enter"
  unitId: UnitId
  position: Position
  lostEffects: EffectId[]
  lostAttributes: string[]
}

interface UnitRiverExitChange {
  type: "unit.river.exit"
  unitId: UnitId
  from: Position
  to: Position
  restoredAttributes: string[]
}

interface UnitAttributeOverrideChange {
  type: "unit.attribute.override"
  unitId: UnitId
  activeAttributes: string[]
}

interface ObjectDamageChange {
  type: "object.damage"
  objectId: ObjectId
  position: Position
  amount: number
  finalHp: number
}

interface ObjectDestroyChange {
  type: "object.destroy"
  objectId: ObjectId
  position: Position
}

interface TileAttributeSetChange {
  type: "tile.attribute.set"
  position: Position
  prevAttribute: TileAttr | null
  nextAttribute: TileAttr | null
}

interface TileFormRiverChange {
  type: "tile.river.form"
  positions: Position[]  // 강이 된 물 타일들
}

interface TileBreakRiverChange {
  type: "tile.river.break"
  positions: Position[]  // 강 → 물로 돌아간 타일들
}

interface TileOccupantSetChange {
  type: "tile.occupant.set"
  position: Position
  occupant: UnitId | ObjectId | null
}

// 데미지 출처
type DamageSource =
  | { kind: "attack"; attackerUnitId: UnitId; weaponId: WeaponId }
  | { kind: "effect"; effectId: EffectId }
  | { kind: "collision"; collidedWith: UnitId | ObjectId }
  | { kind: "tile_periodic"; tileAttr: TileAttr }
```

---

## 5. 플레이어 액션 타입

```ts
type GameAction =
  | MoveAction
  | AttackAction
  | SkillAction
  | ExtinguishAction
  | PassAction

interface MoveAction {
  type: "move"
  unitId: UnitId
  destination: Position
}

interface AttackAction {
  type: "attack"
  unitId: UnitId
  targetPosition: Position
  weaponId?: WeaponId    // 미지정 시 기본 무기 사용
}

interface SkillAction {
  type: "skill"
  unitId: UnitId
  skillId: SkillId
  targetPosition?: Position
  targetUnitId?: UnitId
}

interface ExtinguishAction {
  type: "extinguish"
  unitId: UnitId
  // 이동 + 공격 모두 포기하고 화염 해제
}

interface PassAction {
  type: "pass"
  unitId: UnitId
}

// 드래프트 액션
interface DraftPlaceAction {
  type: "draft_place"
  playerId: PlayerId
  unitId: UnitId
  slotIndex: number   // 0-based
}
```

---

## 6. 모듈 인터페이스 명세

### 6-1. IDataRegistry
```ts
interface IDataRegistry {
  getUnit(id: string): UnitMeta
  getWeapon(id: WeaponId): WeaponMeta
  getSkill(id: SkillId): SkillMeta
  getEffect(id: EffectId): EffectMeta
  getTileAttribute(id: TileAttr): TileAttributeMeta
  getMap(id: string): MapMeta
  getText(key: string, locale?: Locale, params?: Record<string, string>): string
  getConfig<T>(key: string): T
  getAllUnits(): UnitMeta[]
  getAllEffects(): EffectMeta[]
}
```

### 6-2. IMovementValidator
```ts
interface IMovementValidator {
  /**
   * BFS로 목적지까지 이동 가능 여부 및 경로 계산
   * @param unit     이동할 유닛
   * @param dest     목적지
   * @param state    현재 게임 상태
   */
  validateMove(
    unit: UnitState,
    dest: Position,
    state: GameState
  ): MoveValidation

  /**
   * 특정 타일에 진입 가능한지 여부 (경로 탐색 중 호출)
   */
  canEnterTile(
    unit: UnitState,
    tile: TileState,
    state: GameState
  ): ValidationResult

  /**
   * 특정 타일을 목적지로 삼을 수 있는지 여부
   * 강 타일은 통과 가능하지만 멈출 수 없음
   */
  canStopOnTile(
    unit: UnitState,
    tile: TileState,
    state: GameState
  ): ValidationResult

  /**
   * 이동 가능한 모든 Position 반환 (범위 하이라이트용)
   */
  getReachableTiles(unit: UnitState, state: GameState): Position[]

  /**
   * 이동 가능한 모든 Position 중 멈출 수 있는 것만 반환
   */
  getStoppableTiles(unit: UnitState, state: GameState): Position[]
}

interface MoveValidation extends ValidationResult {
  path?: Position[]          // 경유 경로 (출발지 제외, 목적지 포함)
  cost?: number              // 소요 이동력
  tilesEnteredWithEffect?: Position[]  // 효과 타일 경유 목록
}
```

### 6-3. IAttackValidator
```ts
interface IAttackValidator {
  /**
   * 공격 가능 여부 판정 + 영향 받는 위치 목록 계산
   */
  validateAttack(
    attacker: UnitState,
    targetPos: Position,
    state: GameState,
    weaponId?: WeaponId
  ): AttackValidation

  /**
   * 포격 조건 체크: 공격자와 대상 사이 장애물 존재 여부
   */
  hasArtilleryObstacle(
    attacker: UnitState,
    targetPos: Position,
    state: GameState
  ): boolean

  /**
   * 공격 가능한 모든 타겟 위치 반환 (범위 하이라이트용)
   */
  getAttackableTargets(
    unit: UnitState,
    state: GameState,
    weaponId?: WeaponId
  ): Position[]

  /**
   * 방패 유닛이 관통/광선을 차단하는지 여부
   * 방패 유닛이 타겟인 경우 뒤쪽 전파 차단
   */
  isShieldBlocking(
    shieldUnit: UnitState,
    attackDirection: Direction,
    rangeType: RangeType
  ): boolean
}

interface AttackValidation extends ValidationResult {
  affectedPositions?: AffectedPosition[]
}

interface AffectedPosition {
  position: Position
  role: "primary" | "penetration" | "beam" | "area" | "blocked_by_shield"
}
```

### 6-4. IEffectValidator
```ts
interface IEffectValidator {
  /**
   * 유닛에 효과 적용 가능 여부
   */
  canApplyToUnit(
    effectId: EffectId,
    target: UnitState,
    state: GameState
  ): ValidationResult

  /**
   * 타일에 효과 적용 가능 여부
   */
  canApplyToTile(
    effectId: EffectId,
    target: TileState,
    state: GameState
  ): ValidationResult

  /**
   * 특정 조건으로 효과 제거 가능 여부
   * (저항력, 면역 속성 등 체크)
   */
  canRemoveEffect(
    effectId: EffectId,
    unit: UnitState,
    reason: RemoveReason,
    state: GameState
  ): ValidationResult
}

type RemoveReason =
  | "water_tile_entry"
  | "freeze_applied"
  | "water_attack"
  | "self_extinguish"   // 화염만 가능
  | "skill"
  | "river_entry"
```

### 6-5. ITileValidator
```ts
interface ITileValidator {
  /**
   * 인접 물 타일 3개 이상 → 강 생성 조건 충족 여부
   * 인접 기준: 상하좌우 4방향 (대각선 제외)
   */
  shouldFormRiver(pos: Position, state: GameState): boolean

  /**
   * 강 타일 중 연결이 끊겨 물 타일로 돌아가야 하는 것 탐지
   */
  getRiverTilesToBreak(state: GameState): Position[]

  /**
   * 타일 속성 변환 가능 여부
   */
  canConvertTile(
    pos: Position,
    newAttr: TileAttr | null,
    state: GameState
  ): ValidationResult
}
```

### 6-6. IMovementResolver
```ts
interface IMovementResolver {
  /**
   * 이동 명령 처리 → GameChange[] 반환
   * (실제 상태 변경 없음, 변화 목록만 계산)
   */
  resolve(
    unit: UnitState,
    destination: Position,
    path: Position[],
    state: GameState
  ): GameChange[]
}
```

### 6-7. IAttackResolver
```ts
interface IAttackResolver {
  /**
   * 공격 명령 처리 → GameChange[] 반환
   * 포함: 데미지, 관통/광선, 방패 차단, 밀어냄/끌어옴,
   *       효과 적용, 타일 속성 변환
   */
  resolve(
    attacker: UnitState,
    targetPos: Position,
    affectedPositions: AffectedPosition[],
    state: GameState,
    weaponId?: WeaponId
  ): GameChange[]

  /**
   * 데미지 계산: attack - armor (최소 0), 산성 2배 적용
   */
  calculateDamage(
    baseDamage: number,
    target: UnitState
  ): number

  /**
   * 밀어냄/끌어옴 처리 → 관련 GameChange[]
   */
  resolveKnockback(
    target: UnitState,
    direction: Direction,
    spec: KnockbackSpec,
    state: GameState
  ): GameChange[]
}
```

### 6-8. IEffectResolver
```ts
interface IEffectResolver {
  /**
   * 유닛 턴 시작 시 효과 틱 처리
   * 화염: 1 데미지 / 독: 1 데미지 / 전기 타일 위: 1 데미지
   * 빙결: 틱 없음, 해제 타이밍만 처리
   */
  resolveTurnTick(unit: UnitState, state: GameState): GameChange[]

  /**
   * 효과 적용 처리 (빙결 시 기존 효과 일괄 제거 포함)
   */
  resolveApply(
    effectId: EffectId,
    targetUnitId: UnitId,
    sourceUnitId: UnitId | null,
    state: GameState
  ): GameChange[]

  /**
   * 효과 제거 처리
   */
  resolveRemove(
    effectId: EffectId,
    unitId: UnitId,
    reason: RemoveReason,
    state: GameState
  ): GameChange[]

  /**
   * 물 타일 진입 시 제거 가능한 효과 일괄 제거
   */
  resolveWaterEntry(unit: UnitState, state: GameState): GameChange[]

  /**
   * 빙결 적용 시 → 화염/산성/독 일괄 제거
   */
  resolveFreezeApply(unit: UnitState, state: GameState): GameChange[]
}
```

### 6-9. ITileResolver
```ts
interface ITileResolver {
  /**
   * 공격 속성으로 타일 변환
   * 예: 불 타일에 물 속성 공격 → 물 타일
   * 변환된 타일 위 유닛의 효과에도 즉시 적용
   */
  resolveAttributeConversion(
    pos: Position,
    attackAttr: AttackAttribute,
    state: GameState
  ): GameChange[]

  /**
   * 모래 타일이 공격받을 때 → 모래폭풍으로 변환
   */
  resolveSandAttack(pos: Position, state: GameState): GameChange[]

  /**
   * 물 타일 변동 후 강 생성/소멸 처리
   */
  resolveRiverCheck(state: GameState): GameChange[]
}
```

### 6-10. IStateApplicator
```ts
interface IStateApplicator {
  /**
   * GameChange[] 를 GameState에 순서대로 적용 → 새 GameState 반환
   * 각 Change의 순서가 중요 (예: 이동 먼저, 그 후 타일 효과)
   */
  apply(changes: GameChange[], state: GameState): GameState

  /**
   * Change 단건 적용
   */
  applyOne(change: GameChange, state: GameState): GameState
}
```

### 6-11. IHealthManager
```ts
interface IHealthManager {
  /**
   * 데미지 적용 후 HP ≤ 0 유닛 감지
   */
  checkDeaths(state: GameState): GameChange[]

  /**
   * 사망한 유닛 타일에서 제거
   */
  resolveDeathCleanup(unitId: UnitId, state: GameState): GameChange[]
}
```

### 6-12. IEffectManager
```ts
interface IEffectManager {
  /**
   * 유닛 턴 시작 시 전체 효과 처리
   * 1. 빙결 해제 타이밍 체크
   * 2. 화염/독/전기 틱 처리
   * 3. 빙결이면 모든 행동 차단 플래그 설정
   */
  processTurnStart(unitId: UnitId, state: GameState): GameState

  /**
   * 이동 후 타일 진입 효과 처리
   * (물 타일: 화염/산성/독 제거, 효과 타일: 효과 적용)
   */
  processTileEntry(unitId: UnitId, pos: Position, state: GameState): GameState
}
```

### 6-13. ITileManager
```ts
interface ITileManager {
  /**
   * 공격 후 타일 속성 변환 + 유닛 효과 연동
   */
  processAttackOnTile(
    pos: Position,
    attackAttr: AttackAttribute,
    state: GameState
  ): GameState

  /**
   * 타일 속성 변화 후 강 조건 체크 및 처리
   */
  checkAndResolveRivers(state: GameState): GameState

  /**
   * 모래 타일 공격 수신 처리
   */
  processSandHit(pos: Position, state: GameState): GameState
}
```

### 6-14. ITurnManager
```ts
interface ITurnManager {
  getCurrentUnit(state: GameState): UnitState

  /**
   * 이번 턴에 특정 액션 타입이 허용되는지 확인
   * - 빙결: 모두 불가
   * - 화염 해제: 이미 이동/공격했으면 불가
   * - 유격대원이 아닌 경우 이동 후 공격 불가
   */
  isActionAllowed(
    unit: UnitState,
    action: ActionType,
    state: GameState
  ): ValidationResult

  /** 턴 종료 → 다음 턴으로 전환 */
  endTurn(state: GameState): GameState
}
```

### 6-15. IDraftManager
```ts
interface IDraftManager {
  /**
   * 드래프트 시작 (180초 타이머 시작)
   */
  startDraft(state: GameState): GameState

  /**
   * 플레이어가 슬롯에 유닛 배치
   * @returns 업데이트된 GameState
   * @throws  슬롯 이미 점유, 자신 유닛 아닌 경우 등
   */
  placeUnit(
    playerId: PlayerId,
    slotIndex: number,
    unitId: UnitId,
    state: GameState
  ): GameState

  /**
   * 드래프트 완료 처리 (타임아웃 또는 전원 완료)
   * 미배치 슬롯은 랜덤 배치 후 turnOrder 확정
   */
  finalizeDraft(state: GameState): GameState

  /**
   * 완성된 드래프트로부터 TurnSlot[] 계산
   * - 2인: A1,B1,A2,B2,A3,B3
   * - 4인(팀전): 팀A슬롯1,팀B슬롯1,...,팀A슬롯6,팀B슬롯6
   */
  buildTurnOrder(draftState: DraftState, state: GameState): TurnSlot[]
}
```

### 6-16. IRoundManager
```ts
interface IRoundManager {
  /**
   * 라운드 시작 처리
   * - firstPlayer 결정 (첫 라운드: 우선권 합산 / 이후: 교대)
   * - DraftManager.startDraft() 호출
   */
  startRound(state: GameState): GameState

  /** 라운드 종료 처리 */
  endRound(state: GameState): GameState

  isLastRound(state: GameState): boolean
}
```

### 6-17. IEndDetector
```ts
interface IEndDetector {
  /**
   * 게임 종료 조건 확인
   * @returns EndResult (게임 종료) | null (계속)
   */
  check(state: GameState): EndResult | null

  /** 각 플레이어 승점 계산 */
  calculateScores(result: EndResult, state: GameState): Record<PlayerId, number>
}
```

### 6-18. IActionProcessor
```ts
interface IActionProcessor {
  /**
   * 플레이어 액션 파이프라인
   * 1. TurnManager.isActionAllowed()
   * 2. Validator.validate()
   * 3. Resolver.resolve()
   * 4. StateApplicator.apply()
   * 5. PostProcessor.run()
   * 6. Logger.log()
   * 7. EventBus.emit("state.update")
   * @returns 업데이트된 GameState
   * @throws  ValidationError (판정 실패)
   */
  process(action: GameAction, state: GameState): GameState
}
```

### 6-19. IPostProcessor
```ts
interface IPostProcessor {
  /**
   * 액션 처리 후 후속 처리 체인
   * 순서 중요:
   * 1. HealthManager.checkDeaths()
   * 2. TileManager.checkAndResolveRivers()
   * 3. EndDetector.check()
   */
  run(state: GameState): PostProcessResult
}

interface PostProcessResult {
  state: GameState
  endResult: EndResult | null
  events: GameEvent[]    // 사망, 강 생성 등 주요 이벤트
}
```

### 6-20. IPlayerAdapter
```ts
interface IPlayerAdapter {
  readonly playerId: PlayerId
  readonly type: "human" | "ai" | "replay"

  /**
   * 드래프트 배치 요청 (timeout ms 내에 응답 없으면 랜덤)
   */
  requestDraftPlacement(
    state: GameState,
    timeoutMs: number
  ): Promise<DraftPlaceAction>

  /**
   * 턴 액션 요청 (timeout ms 내에 응답 없으면 pass)
   */
  requestAction(
    state: GameState,
    timeoutMs: number
  ): Promise<GameAction>

  /**
   * 서버 → 클라이언트 상태 전파 (WebSocket push)
   */
  onStateUpdate(event: StateUpdateEvent): void

  /**
   * 연결 해제 처리
   */
  onDisconnect(): void
}
```

### 6-21. IGameLoop
```ts
interface IGameLoop {
  /**
   * 게임 시작 → 종료까지 전체 루프 실행
   * @returns 최종 게임 결과
   */
  start(state: GameState): Promise<GameResult>

  /** 게임 강제 종료 */
  abort(reason: string): void
}

interface GameResult {
  gameId: GameId
  endResult: EndResult
  totalRounds: number
  log: GameLog
}
```

### 6-22. IEventBus
```ts
interface IEventBus {
  emit<T extends GameEvent>(event: T): void
  on<T extends GameEvent>(
    type: T["type"],
    handler: (event: T) => void
  ): UnsubscribeFn
  off(type: string, handler: Function): void
}

type UnsubscribeFn = () => void

// 이벤트 타입 전체 유니온
type GameEvent =
  | { type: "game.start";    gameId: GameId; state: GameState }
  | { type: "game.end";      gameId: GameId; result: EndResult }
  | { type: "round.start";   round: number; state: GameState }
  | { type: "round.end";     round: number }
  | { type: "draft.start";   timeoutAt: number }
  | { type: "draft.placed";  playerId: PlayerId; slotIndex: number; unitId: UnitId }
  | { type: "draft.end";     turnOrder: TurnSlot[] }
  | { type: "turn.start";    unit: UnitState }
  | { type: "turn.end";      unitId: UnitId }
  | { type: "action.accepted"; action: GameAction; changes: GameChange[] }
  | { type: "action.rejected"; action: GameAction; reason: string }
  | { type: "state.update";  state: GameState }
  | { type: "unit.died";     unitId: UnitId; killedBy?: UnitId }
  | { type: "river.formed";  positions: Position[] }
  | { type: "river.broken";  positions: Position[] }
```

### 6-23. IGameLogger
```ts
interface IGameLogger {
  logAction(
    action: GameAction,
    changes: GameChange[],
    stateBefore: GameState,
    stateAfter: GameState
  ): void

  logEvent(event: GameEvent): void

  getGameLog(gameId: GameId): GameLog
  exportGameLog(gameId: GameId): LogEntry[]
}

interface GameLog {
  gameId: GameId
  startedAt: number
  endedAt?: number
  players: Record<PlayerId, string>
  entries: LogEntry[]
}

interface LogEntry {
  seq: number
  timestamp: number
  round: number
  turnIndex: number
  playerId: PlayerId
  unitId: UnitId
  action: GameAction
  changes: GameChange[]
  stateHash: string   // 상태 무결성 검증용 해시
}
```

---

## 7. GameContext (DI 컨테이너)

```ts
interface GameContext {
  // 메타데이터
  readonly registry: IDataRegistry

  // 판정자
  readonly movementValidator: IMovementValidator
  readonly attackValidator: IAttackValidator
  readonly effectValidator: IEffectValidator
  readonly tileValidator: ITileValidator

  // 처리기
  readonly movementResolver: IMovementResolver
  readonly attackResolver: IAttackResolver
  readonly effectResolver: IEffectResolver
  readonly tileResolver: ITileResolver

  // 상태 적용
  readonly stateApplicator: IStateApplicator

  // 관리자
  readonly healthManager: IHealthManager
  readonly effectManager: IEffectManager
  readonly tileManager: ITileManager
  readonly turnManager: ITurnManager
  readonly draftManager: IDraftManager
  readonly roundManager: IRoundManager

  // 루프
  readonly actionProcessor: IActionProcessor
  readonly postProcessor: IPostProcessor
  readonly endDetector: IEndDetector
  readonly gameLoop: IGameLoop

  // 지원
  readonly eventBus: IEventBus
  readonly logger: IGameLogger
}

// 조립은 GameFactory에서만
class GameFactory {
  static create(options: GameOptions): { context: GameContext; initialState: GameState }
}

interface GameOptions {
  gameId?: GameId
  mapId: string
  players: PlayerConfig[]
  locale?: Locale
  aiDifficulty?: "heuristic" | "mcts"
}

interface PlayerConfig {
  playerId: PlayerId
  name: string
  type: "human" | "ai"
  teamId?: string
  unitIds: string[]   // 선택한 유닛 메타데이터 ID 목록
}
```

---

## 8. WebSocket 프로토콜

### 8-1. 연결
```
ws://server/game/{gameId}?token={authToken}
```

### 8-2. 메시지 구조 (공통 봉투)
```ts
// 클라이언트 → 서버
interface ClientMessage<T = unknown> {
  id: string          // 메시지 고유 ID (클라이언트가 생성)
  type: ClientMsgType
  payload: T
}

// 서버 → 클라이언트
interface ServerMessage<T = unknown> {
  type: ServerMsgType
  payload: T
  ref?: string        // 응답 시 요청 메시지 id
  ts: number          // 서버 타임스탬프
}
```

### 8-3. 클라이언트 → 서버 메시지 타입
```ts
type ClientMsgType =
  | "action"          // 게임 액션 제출
  | "draft_place"     // 드래프트 슬롯 배치
  | "ping"            // 연결 유지
  | "request_state"   // 현재 상태 재요청 (재접속 시)

// action 페이로드
type ActionPayload = GameAction

// draft_place 페이로드
interface DraftPlacePayload {
  slotIndex: number
  unitId: UnitId
}
```

### 8-4. 서버 → 클라이언트 메시지 타입
```ts
type ServerMsgType =
  | "game_state"        // 전체 상태 스냅샷
  | "state_patch"       // 변경분만 전송 (GameChange[])
  | "action_accepted"   // 액션 수락
  | "action_rejected"   // 액션 거부 + 사유
  | "draft_update"      // 드래프트 상태 업데이트
  | "turn_start"        // 턴 시작 알림
  | "turn_timeout"      // 턴 타임아웃 (pass 처리)
  | "round_start"       // 라운드 시작
  | "game_over"         // 게임 종료
  | "pong"              // ping 응답
  | "error"             // 서버 에러

// game_state 페이로드 (재접속/초기 로딩용 전체 스냅샷)
interface GameStatePayload {
  state: GameState           // 직렬화된 전체 상태
}

// state_patch 페이로드 (매 액션 후 변경분)
interface StatePatchPayload {
  changes: GameChange[]
  roundAfter: number
  turnIndexAfter: number
}

// action_rejected 페이로드
interface ActionRejectedPayload {
  reason: string             // getText() 결과
  action: GameAction
}

// turn_start 페이로드
interface TurnStartPayload {
  unitId: UnitId
  ownerId: PlayerId
  turnIndex: number
  timeoutMs: number          // 턴 타임아웃 (미정 → 현재는 무제한)
}

// game_over 페이로드
interface GameOverPayload {
  result: EndResult
  log: GameLog
}
```

### 8-5. 클라이언트 메시지 예시
```json
// 이동 액션
{
  "id": "msg_001",
  "type": "action",
  "payload": {
    "type": "move",
    "unitId": "unit_abc123",
    "destination": { "x": 3, "y": 5 }
  }
}

// 공격 액션
{
  "id": "msg_002",
  "type": "action",
  "payload": {
    "type": "attack",
    "unitId": "unit_abc123",
    "targetPosition": { "x": 5, "y": 5 }
  }
}

// 드래프트 배치
{
  "id": "msg_003",
  "type": "draft_place",
  "payload": {
    "slotIndex": 0,
    "unitId": "unit_abc123"
  }
}
```

### 8-6. 서버 메시지 예시
```json
// 액션 수락 + 변경분
{
  "type": "state_patch",
  "ref": "msg_001",
  "ts": 1713000000000,
  "payload": {
    "changes": [
      { "type": "unit.move", "unitId": "unit_abc123", "from": {"x":0,"y":0}, "to": {"x":3,"y":5} },
      { "type": "tile.attribute.set", "position": {"x":3,"y":5}, "prevAttribute": "tile.fire", "nextAttribute": null }
    ],
    "roundAfter": 2,
    "turnIndexAfter": 1
  }
}

// 액션 거부
{
  "type": "action_rejected",
  "ref": "msg_001",
  "ts": 1713000000001,
  "payload": {
    "reason": "이동력이 부족합니다",
    "action": { "type": "move", "unitId": "unit_abc123", "destination": {"x":9,"y":9} }
  }
}
```

---

## 9. HTTP REST API

**Base URL**: `https://api.ab-game.io/v1`  
**인증**: Bearer Token (Authorization 헤더)

---

### 9-1. 인증

#### POST /auth/guest
게스트 계정 생성 (토큰 발급)
```ts
// Request Body
interface GuestAuthRequest {
  name: string   // 닉네임
}

// Response 200
interface AuthResponse {
  token: string
  playerId: PlayerId
  name: string
  expiresAt: number
}
```

#### POST /auth/refresh
토큰 갱신
```ts
// Response 200 → AuthResponse
```

---

### 9-2. 로비 & 매치메이킹

#### POST /rooms
방 생성
```ts
// Request Body
interface CreateRoomRequest {
  name: string
  mode: "1v1" | "2v2"
  vsAI?: boolean
  aiDifficulty?: "heuristic"
  mapId?: string
}

// Response 201
interface RoomResponse {
  roomId: string
  code: string        // 6자리 초대 코드
  status: "waiting"
  players: RoomPlayer[]
  mode: "1v1" | "2v2"
  mapId: string
}
```

#### POST /rooms/join
방 참가 (초대 코드)
```ts
// Request Body
interface JoinRoomRequest {
  code: string
}
// Response 200 → RoomResponse
```

#### GET /rooms/{roomId}
방 상태 조회
```ts
// Response 200 → RoomResponse
```

#### POST /rooms/{roomId}/ready
준비 완료
```ts
// Response 200 → RoomResponse
```

#### POST /rooms/{roomId}/start
게임 시작 (방장만)
```ts
// Request Body
interface StartGameRequest {
  unitSelections: Record<PlayerId, string[]>  // 각 플레이어 유닛 ID 목록
}

// Response 200
interface StartGameResponse {
  gameId: GameId
  wsUrl: string     // WebSocket 접속 URL
}
```

---

### 9-3. 게임 세션

#### GET /games/{gameId}
게임 상태 조회 (재접속용)
```ts
// Response 200
interface GameSessionResponse {
  gameId: GameId
  status: "active" | "ended"
  state: GameState
  wsUrl: string
}
```

#### GET /games/{gameId}/log
게임 로그 전체 조회
```ts
// Response 200
interface GameLogResponse {
  gameId: GameId
  entries: LogEntry[]
}
```

---

### 9-4. 메타데이터

#### GET /meta/units
사용 가능한 유닛 목록
```ts
// Response 200
interface UnitsResponse {
  units: UnitMeta[]
}
```

#### GET /meta/units/{unitId}
유닛 상세
```ts
// Response 200 → UnitMeta
```

#### GET /meta/maps
사용 가능한 맵 목록
```ts
// Response 200
interface MapsResponse {
  maps: Array<Pick<MapMeta, "id" | "nameKey" | "width" | "height">>
}
```

---

### 9-5. 통계

#### GET /stats/players/{playerId}
플레이어 통계
```ts
// Response 200
interface PlayerStatsResponse {
  playerId: PlayerId
  name: string
  totalGames: number
  wins: number
  losses: number
  draws: number
  totalScore: number
  favoriteUnit: string
  avgRoundsPerGame: number
}
```

#### GET /stats/games/{gameId}/summary
게임 요약 통계
```ts
// Response 200
interface GameSummaryResponse {
  gameId: GameId
  rounds: number
  result: EndResult
  unitStats: UnitGameStat[]
  mostDamageDealt: { unitId: UnitId; damage: number }
  firstDeath: { unitId: UnitId; round: number }
}

interface UnitGameStat {
  unitId: UnitId
  ownerId: PlayerId
  damageDealt: number
  damageTaken: number
  kills: number
  survived: boolean
}
```

---

### 9-6. 공통 에러 응답
```ts
interface ErrorResponse {
  code: string      // "ERR_UNAUTHORIZED" | "ERR_ROOM_FULL" | ...
  message: string   // 사람이 읽을 수 있는 설명
  detail?: unknown  // 디버그 정보
}
```

| HTTP 코드 | 의미 |
|---|---|
| 400 | 잘못된 요청 (파라미터 오류) |
| 401 | 인증 필요 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (이미 시작된 게임 등) |
| 500 | 서버 내부 오류 |

---

## 10. 에러 코드 및 텍스트 키

### 게임 에러 코드
```ts
const GAME_ERRORS = {
  // 이동
  "error.move.not_your_turn":      "자신의 턴이 아닙니다",
  "error.move.already_moved":      "이미 이동을 사용했습니다",
  "error.move.frozen":             "빙결 상태에서는 행동할 수 없습니다",
  "error.move.out_of_range":       "이동 가능 범위를 벗어났습니다",
  "error.move.tile_blocked":       "해당 타일로 이동할 수 없습니다",
  "error.move.tile_occupied":      "이미 유닛이 있는 타일입니다",
  "error.move.river_no_passage":   "이동력이 부족하여 강을 건널 수 없습니다",

  // 공격
  "error.attack.already_attacked": "이미 공격을 사용했습니다",
  "error.attack.frozen":           "빙결 상태에서는 행동할 수 없습니다",
  "error.attack.out_of_range":     "공격 가능 범위를 벗어났습니다",
  "error.attack.too_close":        "원거리 공격은 인접한 적을 공격할 수 없습니다",
  "error.attack.no_obstacle":      "포격에 필요한 장애물이 없습니다",

  // 드래프트
  "error.draft.slot_occupied":     "이미 사용 중인 슬롯입니다",
  "error.draft.not_your_unit":     "자신의 유닛이 아닙니다",
  "error.draft.already_placed":    "이미 배치된 유닛입니다",

  // 화염 해제
  "error.extinguish.no_fire":      "화염 효과가 없습니다",
  "error.extinguish.frozen":       "빙결 상태에서는 행동할 수 없습니다",
} as const
```
