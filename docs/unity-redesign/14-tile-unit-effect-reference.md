# 14 — 타일·유닛·효과 구현 레퍼런스

> 작성 목적: AI 코딩 에이전트 또는 신규 개발자가 Project AB의 타일 효과, 유닛 능력치, 상태 효과, 패시브, 무기 특수 효과를 구현할 때 이 문서만 보고도 동일한 동작을 재현할 수 있도록 정리한다.  
> 기준 코드: 현재 TypeScript 모노레포 구현. Unity 재설계에서는 이 문서를 `AB.Core`, `AB.Data`, `AB.Presentation`로 이식한다.  
> 주의: 이 문서는 룰 해석 문서가 아니라 **구현 지시서**다. 데이터와 처리 순서는 코드/JSON을 우선한다.

---

## 0. Source of Truth

AI가 코딩할 때 다음 파일을 기준으로 삼는다.

| 영역 | 현재 TS 파일 | Unity 이식 대상 |
|---|---|---|
| 스키마/열거형 | `packages/metadata/src/schemas/base.ts` | `AB.Core.Domain` enums |
| 메타데이터 스키마 | `packages/metadata/src/schemas/metadata.ts` | `AB.Core.Definitions`, `AB.Data.So` |
| 액션 스키마 | `packages/metadata/src/schemas/player-action.ts` | `AB.Core.Actions` |
| 변경 이벤트 | `packages/metadata/src/schemas/game-change.ts` | `AB.Core.Changes` |
| 실제 유닛 데이터 | `packages/metadata/data/units.json` | `UnitSo` 에셋 |
| 실제 무기 데이터 | `packages/metadata/data/weapons.json` | `WeaponSo` 에셋 |
| 실제 스킬 데이터 | `packages/metadata/data/skills.json` | `SkillSo` 에셋 |
| 실제 효과 데이터 | `packages/metadata/data/effects.json` | `EffectSo` 에셋 |
| 실제 타일 데이터 | `packages/metadata/data/tiles.json` | `TileSo` 에셋 |
| 실제 패시브 데이터 | `packages/metadata/data/unit-passives.json` | `PassiveSo` 에셋 |
| 원소 반응 데이터 | `packages/metadata/data/elemental-reactions.json` | `ElementalReactionTableSo` 또는 `ElementalReactionDef[]` |
| 이동 판정 | `packages/engine/src/validators/movement-validator.ts` | `MovementValidator` |
| 공격 판정 | `packages/engine/src/validators/attack-validator.ts` | `AttackValidator` |
| 이동 결과 계산 | `packages/engine/src/resolvers/movement-resolver.ts` | `MovementResolver` |
| 공격 결과 계산 | `packages/engine/src/resolvers/attack-resolver.ts` | `AttackResolver` |
| 타일 진입 처리 | `packages/engine/src/resolvers/tile-transition-resolver.ts` | `TileTransitionResolver` |
| 상태 효과 처리 | `packages/engine/src/resolvers/effect-resolver.ts` | `EffectResolver` |
| 패시브 처리 | `packages/engine/src/resolvers/passive-resolver.ts` | `PassiveResolver` |
| 상태 적용 | `packages/engine/src/state/state-applicator.ts` | `StateApplicator` |

### 0-1. 구현 우선순위

1. JSON 데이터와 TypeScript 스키마를 먼저 맞춘다.
2. Validator는 판정만 한다. 상태를 변경하지 않는다.
3. Resolver는 `GameChange[]`만 만든다. 상태를 변경하지 않는다.
4. `StateApplicator`만 `GameState`를 변경한다.
5. Unity 이식 시에도 `ScriptableObject`는 편집용이고, 런타임에서는 순수 C# `Def`로 변환한다.

---

## 1. 핵심 열거형

### 1-1. ActionType

현재 액션은 다음 6개다.

| ActionType | 의미 | 구현 메모 |
|---|---|---|
| `move` | 유닛 이동 | 목적지까지 경로 판정 후 `unit_move` 생성 |
| `attack` | 기본/보조 무기 공격 | `AttackValidator` + `AttackResolver` |
| `skill` | 스킬 사용 | 현재 `skills.json`은 빈 배열. 구조는 존재하나 실데이터 미사용 |
| `extinguish` | 자기 화염 효과 수동 제거 | `effect_fire`의 `manual_extinguish` 제거 조건 사용 |
| `pass` | 턴 종료 | 상태 변화 없음 |
| `draft_place` | 드래프트 배치 | 전투 중 `ActionProcessor`에서는 거부 |

> 현재 룰 문서 일부에는 `rest`가 남아 있을 수 있으나, 현재 코드 기준 실제 액션은 `rest`가 아니라 `extinguish`다.

### 1-2. AttackType

| AttackType | 의미 | 구현 메모 |
|---|---|---|
| `melee` | 근접 공격 | 직교 사거리. 대상 타일이 `mountain`/`river`이면 불가 |
| `ranged` | 원거리 공격 | 직교 사거리. 대상 타일이 `mountain`/`river`이면 불가. 일반 LOS 없음 |
| `artillery` | 곡사 공격 | 공격자와 대상 사이에 유닛 또는 산이 최소 1개 있어야 함 |
| `special` | 특수 무기 | 개별 무기 옵션으로 처리. 기본 타입별 제약은 거의 없음 |

### 1-3. RangeType

| RangeType | 의미 | 구현 상태 |
|---|---|---|
| `single` | 대상 좌표 1칸 | 구현됨 |
| `line` | 직선형 | 현재는 rush 등 단일 대상 취급 |
| `area` | 맨해튼 반경 범위 | 구현됨 |
| `penetrate` | 대상 뒤쪽까지 관통 | 구현됨. 방패 패시브가 전파 차단 |
| `beam` | 공격자에서 대상 방향 직선 | 구현됨 |
| `arc` | 곡사형 | 현재 affected position은 기본적으로 single처럼 취급. `arcing`/artillery 조건과 결합 |
| `special` | 특수 | 기본적으로 single처럼 취급 |

### 1-4. AttackAttribute / TileAttributeType / UnitEffectType

| 종류 | 값 |
|---|---|
| `AttackAttribute` | `fire`, `water`, `acid`, `electric`, `ice`, `sand`, `none` |
| `TileAttributeType` | `road`, `plain`, `mountain`, `sand`, `river`, `fire`, `water`, `acid`, `electric`, `ice` |
| `UnitEffectType` | `freeze`, `fire`, `acid`, `water`, `sand`, `electric`, `stun`, `confused` |

---

## 2. 유닛 능력치 모델

### 2-1. UnitMeta 필드

```ts
interface UnitMeta {
  id: MetaId;
  nameKey: string;
  descKey: string;
  class: UnitClass;
  faction: string;
  baseMovement: number;
  baseHealth: number;
  baseArmor: number;
  attributes: AttackAttribute[];
  primaryWeaponId?: MetaId;
  secondaryWeaponId?: MetaId;
  skillIds: MetaId[];
  passiveIds: MetaId[];
  spriteKey: string;
  priority: number;
}
```

### 2-2. 런타임 UnitState 필드 해석

| 필드 | 의미 | 적용 규칙 |
|---|---|---|
| `unitId` | 매치 내 유닛 인스턴스 ID | 드래프트/스폰 시 생성 |
| `metaId` | `UnitMeta.id` 참조 | 능력치, 무기, 패시브 조회 키 |
| `playerId` | 소유 플레이어 | 아군/적군 판정 기준 |
| `position` | 현재 좌표 | 이동/넉백/풀/강 진입으로 변경 |
| `currentHealth` | 현재 HP | `unit_damage`, `unit_heal`로 변경 |
| `currentArmor` | 현재 방어력 | 기본 피해 계산 시 `damage - armor` |
| `movementPoints` | 현재 이동력 | 라운드 시작 시 `baseMovement`로 복구 |
| `activeEffects` | 상태 효과 배열 | 같은 `effectType`은 새 효과 추가 시 교체 |
| `actionsUsed.moved` | 이번 턴 이동 사용 여부 | 일반 `unit_move` 시 true. Rush 이동은 true로 만들지 않음 |
| `actionsUsed.attacked` | 이번 턴 공격 사용 여부 | 공격/스킬/소화 처리 후 true |
| `actionsUsed.skillUsed` | 스킬 사용 여부 | 현재 active skill 구조용. `oneShot`과 함께 확장 대상 |
| `actionsUsed.extinguished` | 소화 사용 여부 | `extinguish` 액션용 |
| `alive` | 생존 여부 | HP 0 이하 후 `HealthManager.applyDeaths`가 false 처리 |

### 2-3. 현재 유닛 데이터 표

| id | class | faction | move | hp | armor | primaryWeaponId | secondaryWeaponId | passiveIds | 특징 |
|---|---|---:|---:|---:|---:|---|---|---|---|
| `t1` | tanker | a | 3 | 5 | 1 | `wpn_ta_melee_kb` | - | `passive_shield`, `passive_tile_absorb_attack` | 방패 + 타일 흡수 공격 |
| `f1` | fighter | a | 3 | 4 | 0 | `wpn_fa_rush_kb` | - | `passive_melee_mastery` | 돌진 + 넉백, 근접 피해 감소 |
| `r1` | ranger | a | 2 | 4 | 0 | `wpn_ra_penetrate_absorb` | - | - | 관통 + 인접 타일 흡수 |
| `b1` | brute | a | 3 | 5 | 0 | `wpn_ba_melee_fire` | `wpn_ba_self_ignite` | `passive_fire_affinity` | 화염 타일 생성, 자기 발화 가능 |
| `a1` | artillery | a | 2 | 4 | 0 | `wpn_arc_ricochet` | - | - | 곡사 + 인접 스플래시 피해 |
| `u1` | utility | a | 4 | 4 | 0 | `wpn_ua_confuse_ranged` | - | `passive_medic` | 인접 아군 회복, ranged 혼란 부여 |
| `t2` | tanker | b | 3 | 5 | 1 | `wpn_tb_melee_kb` | `wpn_hook` | `passive_shield` | 방패 + 훅 보조 무기 |
| `f2` | fighter | b | 3 | 4 | 0 | `wpn_fb_wide_kb` | - | `passive_agility` | 좌우 넉백 + 공격 후 이동 회복 |
| `r2` | ranger | b | 2 | 4 | 0 | `wpn_rb_penetrate_fire` | - | - | 관통 + 화염 타일 생성 |
| `b2` | brute | b | 3 | 4 | 0 | `wpn_bb_melee_kb2` | - | - | 2칸 넉백 |
| `a2` | artillery | b | 2 | 4 | 0 | `wpn_ab_arc_fireball` | - | - | 곡사 + 주변 화염 타일 |
| `u2` | utility | b | 4 | 4 | 0 | `wpn_ub_confuse_melee` | - | `passive_turn_arson` | 인접 적 타일 화염화, melee 혼란 부여 |
| `t3` | tanker | c | 3 | 5 | 1 | `wpn_shock_melee` | - | `passive_shield`, `passive_insulator` | 전기 공격, 체인 차단 |
| `f3` | fighter | c | 3 | 4 | 0 | `wpn_fc_rush_kb` | `wpn_shock_melee` | `passive_insulator` | 돌진 + 전기 보조 |
| `r3` | ranger | c | 2 | 4 | 0 | `wpn_rc_shockwave` | `wpn_shock_melee` | `passive_insulator` | 쇼크웨이브 + 전기 보조 |
| `b3` | brute | c | 3 | 5 | 0 | `wpn_bc_water_bomb` | - | `passive_insulator` | 물 타일 폭탄 |
| `a3` | artillery | c | 2 | 4 | 0 | `wpn_arc_ricochet` | - | `passive_insulator` | 곡사 + 절연 |
| `u3` | utility | c | 2 | 4 | 0 | `wpn_uc_pylon` | - | `passive_insulator`, `passive_generator` | 전기 파일런 소환, 전기 피해 증폭 |
| `t4` | tanker | d | 3 | 5 | 1 | `wpn_td_melee_frost` | - | `passive_shield`, `passive_cryo_affinity` | 냉기 근접 + 빙결 적 인접 회복 |
| `f4` | fighter | d | 3 | 4 | 0 | `wpn_fd_wide_frost` | - | `passive_fire_weakness`, `passive_cryo_affinity` | 광역 냉기, 화염 취약 |
| `r4` | ranger | d | 2 | 4 | 0 | `wpn_rd_ice_arrow` | `wpn_rd_melee` | `passive_fire_weakness`, `passive_cryo_affinity` | 관통 냉기, 화염 취약 |
| `b4` | brute | d | 3 | 4 | 0 | `wpn_bd_water_convert` | - | `passive_freeze_immunity`, `passive_amphibious` | 물 변환, 빙결 면역, 물/강 면역 |
| `a4` | artillery | d | 2 | 4 | 0 | `wpn_ad_arc_mass` | - | `passive_cryo_affinity`, `passive_fire_weakness` | 빙결 방어 관통 곡사 |
| `u4` | utility | d | 2 | 4 | 0 | `wpn_ud_frost_tile` | `wpn_hook` | `passive_sprinkler` | 냉기 타일 생성, 주변 화염 제거 |
| `obstacle_electric_pylon` | obstacle | neutral | 0 | 2 | 0 | - | - | - | 소환 장애물. 전기 체인 릴레이 가능 |

### 2-4. 유닛 클래스의 현재 역할

`class`는 주로 분류/밸런스/표시용이다. 현재 코어 룰은 `class` 자체로 행동을 분기하지 않는다. 실제 전투 차이는 `baseMovement`, `baseHealth`, `baseArmor`, `primaryWeaponId`, `secondaryWeaponId`, `passiveIds`로 결정한다.

---

## 3. 타일 데이터와 타일 효과

### 3-1. TileAttributeMeta 필드

```ts
interface TileAttributeMeta {
  id: MetaId;
  tileType: TileAttributeType;
  nameKey: string;
  descKey: string;
  moveCost: number;
  cannotStop: boolean;
  impassable: boolean;
  appliesEffectId?: MetaId;
  removesEffectTypes: UnitEffectType[];
  clearsAllEffects: boolean;
  damagePerTurn: number;
  ignoresArmor: boolean;
}
```

### 3-2. 현재 타일 효과 표

| tileType | moveCost | cannotStop | impassable | damagePerTurn | ignoresArmor | appliesEffectId | removesEffectTypes | clearsAllEffects | 구현 의미 |
|---|---:|---|---|---:|---|---|---|---|---|
| `road` | 1 | false | false | 0 | false | - | - | false | 기본 이동 타일 |
| `plain` | 1 | false | false | 0 | false | - | - | false | 기본 타일 |
| `mountain` | 1 | false | true | 0 | false | - | - | false | 이동/대상 지정 불가. 곡사 장애물로 사용 |
| `sand` | 2 | false | false | 0 | false | `effect_sand` | - | false | 진입 시 sand 효과. 이동 비용 2 |
| `river` | 2 | true | false | 0 | false | - | - | false | 통과 가능, 정지 불가. 넉백으로 들어가면 모든 효과 제거 |
| `fire` | 1 | false | false | 1 | true | `effect_fire` | - | false | 진입 시 fire 효과, 턴 시작 시 타일 피해 1 |
| `water` | 1 | false | false | 0 | false | - | `fire`, `acid` | false | 진입 시 fire/acid 효과 제거 |
| `acid` | 1 | false | false | 1 | true | `effect_acid` | - | false | 진입 시 acid 효과, 턴 시작 시 타일 피해 1 |
| `electric` | 1 | false | false | 1 | true | `effect_electric` | - | false | 진입 시 electric 효과, 턴 시작 시 타일 피해 1 |
| `ice` | 1 | false | false | 0 | false | `effect_freeze` | - | true | 진입 시 기존 모든 효과 제거 후 freeze 적용 |

### 3-3. 타일 이동 규칙

1. 이동은 직교 4방향만 사용한다.
2. 이동 비용은 `river`와 `sand`가 2, 나머지는 1이다.
3. `mountain`은 진입 불가다.
4. `river`는 경유 가능하지만 목적지로 정지할 수 없다.
5. 목적지에 살아있는 유닛이 있으면 이동 불가다.
6. 현재 TS 구현상 경로 중간의 점유 칸은 통과 가능하게 되어 있다. 목적지만 점유 불가다. Unity 재설계에서 유닛 경유도 막으려면 `MovementValidator.bfs()`에서 neighbor가 occupied일 때 enqueue 자체를 막아야 한다.
7. 이동 목적지에 도착했을 때만 타일 진입 효과를 처리한다. 경로 중간 타일의 효과는 처리하지 않는다.
8. 경로 중간의 `river`도 효과를 처리하지 않는다. `river`는 정지 불가/이동 비용 2 역할만 한다.

### 3-4. 타일 진입 처리 순서

`TileTransitionResolver.resolveUnitEntersTile(unit, destinationPos, tileAttr, state)`는 다음 순서로 `GameChange[]`를 만든다.

#### Step 0. 항상 발동 패시브에서 면역 플래그 수집

수집 대상:

| 패시브 액션 | 의미 |
|---|---|
| `immune_tile_effects` | 모든 일반 타일 효과 무시 |
| `immune_tile_type` | 특정 타일 타입 진입 효과 완전 무시 |
| `immune_effect` | 특정 상태 효과 부여 무시 |

처리 규칙:

1. 유닛의 `always_on` 패시브를 조회한다.
2. `immune_tile_type` 목록에 현재 진입 타일이 포함되면 즉시 종료한다. 이 경우 타일 진입 패시브와 일반 타일 효과 모두 실행하지 않는다.
3. `immune_tile_effects`만 있으면 타일 진입 패시브는 실행할 수 있지만, 일반 타일 효과는 스킵한다.

#### Step 1. 타일 진입 패시브 처리

다음 트리거가 실행된다.

| 트리거 | 조건 |
|---|---|
| `on_tile_entry_of` | 원래 진입 타일 속성이 지정 속성과 같을 때 |
| `on_tile_entry_any_attribute` | 원래 진입 타일이 `plain`/`road`가 아닐 때 |

중요: 트리거 판정은 **패시브에 의해 변환되기 전 원래 타일 속성**을 기준으로 한다.

지원 액션:

| 액션 | 처리 |
|---|---|
| `convert_entered_tile` | 진입 타일을 다른 속성으로 바꾸는 `tile_attribute_change` 생성 |
| `heal_self` | 자신의 HP를 `baseHealth` 이하로 회복하는 `unit_heal` 생성 |
| `spread_entered_tile_attr` | 원래 진입 타일 속성을 상하좌우 4칸에 전파 |

#### Step 2. 일반 타일 효과 처리

1. `immune_tile_effects`가 있으면 전체 스킵한다.
2. 현재 effective tile metadata를 조회한다.
3. `clearsAllEffects`가 true면 유닛의 모든 active effect를 제거한다.
4. 아니면 `removesEffectTypes`에 들어 있는 효과만 제거한다.
5. `appliesEffectId`가 있으면 해당 effect를 추가한다.
6. effect 추가 전 `immune_effect` 패시브를 확인한다.
7. 이미 동일한 `effectId`를 가진 효과가 있으면 추가하지 않는다.

---

## 4. 상태 효과 데이터와 처리

### 4-1. EffectMeta 필드

```ts
interface EffectMeta {
  id: MetaId;
  nameKey: string;
  descKey: string;
  effectType: UnitEffectType;
  damagePerTurn: number;
  incomingDamageMultiplier: number;
  blocksAllActions: boolean;
  alsoAffectsTile: boolean;
  clearsAllEffectsOnApply: boolean;
  blocksDamage: boolean;
  ignoresArmor: boolean;
  blocksAttackType?: "melee" | "ranged";
  removeConditions: RemoveCondition[];
}
```

### 4-2. 현재 효과 표

| id | effectType | damagePerTurn | blocksAllActions | blocksDamage | ignoresArmor | alsoAffectsTile | clearsAllEffectsOnApply | removeConditions | 구현 의미 |
|---|---|---:|---|---|---|---|---|---|---|
| `effect_freeze` | freeze | 0 | true | true | false | false | true | turns 1, collision_with_frozen, on_hit | 모든 행동 차단, 피격 피해 차단, 맞거나 충돌하면 해제 |
| `effect_fire` | fire | 1 | false | false | true | false | false | turns 3, manual_extinguish, river_entry | 턴당 1 피해, 수동 소화/강 진입/3턴 후 제거 |
| `effect_acid` | acid | 1 | false | false | true | true | false | turns 3, river_entry | 턴당 1 피해, 적용 시 현재 타일을 acid로 바꿈 |
| `effect_water` | water | 0 | false | false | false | false | false | on_move | 이동하면 제거되는 젖음 상태 |
| `effect_sand` | sand | 0 | false | false | false | false | false | on_move | 이동하면 제거되는 모래 상태 |
| `effect_electric` | electric | 1 | false | false | true | false | false | turns 1 | 턴당 1 피해, 1턴 후 제거 |
| `effect_stun` | stun | 0 | true | false | false | false | false | turns 1 | 모든 행동 차단, 1턴 후 제거 |
| `effect_confused_ranged` | confused | 0 | false | false | false | false | false | turns 2 | ranged 공격 타입 사용 불가 |
| `effect_confused_melee` | confused | 0 | false | false | false | false | false | turns 2 | melee 공격 타입 사용 불가 |

### 4-3. 턴 시작 효과 처리

`GameLoop`는 현재 턴 플레이어의 모든 살아있는 유닛에 대해 `EffectManager.processTurnStart(unitId, state)`를 호출한다. 슬롯 유닛 1명만 처리하는 것이 아니라 **현재 플레이어 소유의 모든 생존 유닛**을 처리한다.

처리 순서:

1. `EffectResolver.resolveTurnTick(unit, state)` 호출.
2. active effect마다 `damagePerTurn`이 있으면 `unit_damage` 생성.
3. active effect마다 `turnsRemaining`이 있으면 1 감소.
4. 감소 후 0 이하이면 `unit_effect_remove` 생성.
5. 감소 후 1 이상이면 같은 effect를 `unit_effect_add`로 다시 추가하여 남은 턴 수 갱신.
6. 현재 서 있는 타일의 `damagePerTurn`을 확인하여 `unit_damage` 생성.
7. `immune_tile_damage` 또는 `immune_tile_type` 패시브가 있으면 타일 피해를 무시한다.
8. 그 뒤 `PassiveResolver.resolveTurnStart()`를 호출한다.
9. 이후 `HealthManager.applyDeaths()`로 사망 판정한다.

### 4-4. 효과 추가/제거 규칙

#### 효과 추가

`unit_effect_add` 적용 시 같은 `effectType`의 기존 효과는 제거되고 새 효과로 교체된다. 즉 같은 타입 효과는 중첩되지 않는다.

예:

```text
기존 activeEffects: [effect_fire(turns=2)]
새 unit_effect_add: effect_fire(turns=3)
결과: [effect_fire(turns=3)]
```

#### 효과 제거

`unit_effect_remove`는 `effectId`와 `effectType`이 모두 일치하는 효과만 제거한다.

---

## 5. 원소 반응

원소 반응은 `elemental-reactions.json`으로 데이터화되어 있다. 공격 시 `AttackResolver.resolveElementalReaction()`이 모든 반응을 순회한다.

### 5-1. 현재 반응 표

| attackAttr | targetEffect | damageMultiplier | fixedDamage | removedEffects | appliesEffectId | removeTileAttr | 의미 |
|---|---|---:|---:|---|---|---|---|
| fire | freeze | 0 | - | freeze | - | - | 얼어붙은 대상에게 화염: 피해 0, freeze 제거 |
| water | fire | 1 | - | fire | - | - | 불붙은 대상에게 물: 피해 정상, fire 제거 |
| ice | fire | 0 | - | fire | - | - | 불붙은 대상에게 얼음: 피해 0, fire 제거 |
| electric | water | 1 | - | water | effect_stun | water | 젖은 대상에게 전기: 피해 정상, water 제거, stun 부여, 물 타일 제거 |
| ice | none | 1 | - | - | effect_freeze | - | 얼음 공격은 기본적으로 freeze 부여 |
| ice | water | 1 | 2 | water | effect_freeze | - | 젖은 대상에게 얼음: 고정 피해 2, water 제거, freeze 부여 |

### 5-2. 반응 처리 규칙

1. 공격 속성 `attackAttr`와 반응 데이터의 `attackAttr`가 같아야 한다.
2. `targetEffect`가 `none`이면 항상 발동한다.
3. `targetEffect`가 특정 효과이면 대상 유닛이 해당 `effectType`을 갖고 있어야 한다.
4. 여러 반응이 동시에 매칭될 수 있다.
5. `fixedDamage`가 있으면 일반 피해 공식, 방어력, 배율을 우회한다.
6. `damageMultiplier`는 곱연산으로 누적된다.
7. `removedEffects`는 대상의 active effect에서 제거된다.
8. `appliesEffectId`는 대상에게 새 효과를 추가한다. 단 `immune_effect`가 있으면 무시한다.
9. `removeTileAttr`는 대상 좌표의 타일 속성이 일치할 때 `plain`으로 되돌린다.

### 5-3. 원소 면역

`immune_elemental_effects` 패시브가 있으면 `resolveElementalReaction()`은 반응을 모두 스킵하고 `isElementalImmune=true`를 반환한다. 현재 데이터에는 해당 패시브 액션을 쓰는 유닛은 없다.

`immune_effect`는 특정 `effectType` 부여만 막는다. 예: `passive_freeze_immunity`는 freeze 부여를 막는다.

---

## 6. 공격·무기 특수 효과

### 6-1. WeaponMeta 필드군

| 필드 | 의미 |
|---|---|
| `attackType` | `melee`, `ranged`, `artillery`, `special` |
| `rangeType` | 영향 범위 타입 |
| `minRange`, `maxRange` | 직교 맨해튼 사거리 |
| `damage` | 기본 피해 |
| `attribute` | 공격 원소 속성 |
| `knockback` | 대상 넉백 |
| `area` | 맨해튼 범위 공격 설정 |
| `penetrating` | 관통 여부 |
| `arcing` | 곡사 여부 |
| `rush` | 공격 전 대상 인접 칸으로 이동 |
| `pull` | 대상을 공격자 인접 칸으로 끌어옴 |
| `adjacentTileAbsorb` | 지정 인접 타일 속성을 흡수해 공격 속성으로 사용 |
| `requiresClearPath` | 공격자와 대상 사이에 유닛/산이 없어야 함 |
| `applyTileEffect` | 대상 타일을 특정 속성으로 변경 |
| `tileEffectWidth` | 대상 좌우 타일에도 타일 효과 적용 |
| `applyThroughPenetrate` | 관통된 후속 타일에도 `applyTileEffect` 적용 |
| `selfTileEffect` | 공격자 자신의 타일을 변경 |
| `convertTileTo` | 대상 타일을 특정 속성으로 변환 |
| `splash` | 대상 인접 유닛에게 추가 피해 |
| `splashTileEffect` | 대상 인접 4칸에 타일 효과 적용 |
| `shockwave` | 대상 인접 유닛을 바깥쪽으로 밀어냄 |
| `confusion` | 대상에게 특정 공격 타입 제한 효과 부여 |
| `chainShock` | 인접 유닛 네트워크를 따라 전기 체인 피해 |
| `piercesFreeze` | freeze의 피해 차단을 무시 |
| `canTargetSelf` | 자기 위치 대상 지정 허용 |
| `spawnObstacle` | 대상 칸에 장애물 유닛 소환 |

### 6-2. 공격 판정 순서

`AttackValidator.validateAttack()` 순서:

1. `freeze` 상태이면 공격 불가.
2. `stun` 상태이면 공격 불가.
3. 이미 공격했으면 공격 불가.
4. 대상 좌표가 맵 밖이면 불가.
5. 사용할 무기 결정: `options.overrideWeaponId ?? unitMeta.primaryWeaponId`.
6. `confused` 효과가 있고 효과가 막는 공격 타입과 무기 공격 타입이 같으면 불가.
7. 자기 자신 타일은 `canTargetSelf`가 true인 무기만 가능.
8. 공격은 항상 직교 직선이어야 한다. 대각선 불가.
9. `minRange <= 직교거리 <= maxRange`를 만족해야 한다.
10. `rush.requiresClearPath` 또는 `requiresClearPath`이면 공격자와 대상 사이에 유닛/산이 없어야 한다.
11. `spawnObstacle` 무기는 대상 칸이 비어 있고 `mountain`/`river`가 아니어야 한다.
12. `melee`/`ranged`는 대상 타일이 `mountain`/`river`이면 불가.
13. `artillery`는 공격자와 대상 사이에 유닛 또는 산이 최소 1개 있어야 한다.
14. `affectedPositions`를 계산한다.

### 6-3. 공격 결과 처리 순서

`AttackResolver.resolve()` 순서:

1. Phase 0a: `rush`가 있으면 공격자를 대상 인접 칸으로 이동시킨다. Rush 이동은 `actionsUsed.moved`를 소비하지 않는다.
2. Phase 0b: 무기 `adjacentTileAbsorb`가 있으면 `options.sourceTile`의 타일 속성을 흡수하고 그 타일을 `plain`으로 변경한다.
3. Phase 0c: 공격자에게 `absorb_tile_at_attacker` 패시브가 있으면 선택한 `sourceTile` 또는 공격자 현재 타일의 속성을 흡수한다.
4. 각 affected position마다 피해/반응/상태/넉백/풀/타일 변환을 처리한다.
5. Phase 1: 원소 반응과 피해 계산.
6. Phase 1b: confusion 부여.
7. Phase 2a: knockback.
8. Phase 2b: pull.
9. Phase 3: 대상 타일 효과 적용.
10. Phase 3b: splash 피해.
11. Phase 3c: shockwave.
12. Phase 4: selfTileEffect, chainShock, spawnObstacle 등 공격 전체 효과.

### 6-4. 피해 공식

일반 피해:

```text
base = max(0, weapon.damage - target.currentArmor)
base = floor(base * incomingDamageMultiplier effects)
base = floor(base * elementalReactionMultiplier)
base = apply immune_damage_type
base = apply vulnerability
base = apply damage_reduction
base = apply amplify_damage_type
finalDamage = max(0, base)
```

현재 구현 세부 순서:

1. `calcBaseDamage()`에서 `weapon.damage - armor`를 계산한다.
2. 대상 active effect의 `incomingDamageMultiplier`를 곱한다.
3. 원소 반응 multiplier를 곱한다.
4. `immune_damage_type`이면 0이 된다.
5. `vulnerability`면 추가 피해가 더해진다.
6. `damage_reduction`이면 피해가 감소한다.
7. `amplify_damage_type`이면 피해가 배율로 증폭된다.
8. `freeze.blocksDamage`가 있고 무기가 `piercesFreeze`가 아니면 피해가 0으로 차단된다.

`fixedDamage`가 있으면 위 공식 대부분을 우회한다. 현재 원소 반응에서 `ice + water`가 fixedDamage 2를 사용한다.

### 6-5. Freeze 특수 처리

1. `freeze` 대상이 피격되면 `on_hit` 조건에 의해 freeze가 제거된다.
2. 단 `immune_elemental_effects`로 반응이 완전히 면역이면 이 제거도 스킵된다.
3. `effect_freeze.blocksDamage = true`이므로 보통 피해는 차단된다.
4. 무기에 `piercesFreeze = true`가 있으면 피해 차단을 무시한다.
5. 현재 `wpn_ad_arc_mass`가 `piercesFreeze = true`다.

### 6-6. 넉백

넉백 처리:

1. 방향이 `away`이면 공격자 위치에서 대상 위치 방향으로 밀어낸다.
2. 방향이 `fixed`이면 `fixedDelta`를 사용한다. 없으면 기본 `{ dRow: 0, dCol: 1 }`.
3. distance만큼 한 칸씩 검사한다.
4. 맵 밖이면 벽 충돌로 처리하고 마지막 유효 위치까지 clamp한다.
5. 다른 유닛이 있으면 충돌로 처리한다.
6. 충돌 시 밀린 대상은 `KNOCKBACK_COLLISION_DAMAGE`만큼 피해를 받는다.
7. 충돌 대상에게 `collision_with_frozen` 제거 조건이 붙은 효과가 있으면 제거한다.
8. 강으로 밀려나면 `unit_river_enter`가 발생하고 모든 active effect를 제거한다.
9. 강이 아니면 도착 칸의 타일 진입 효과를 처리한다.
10. `width: leftRight`이면 주 대상 양옆의 유닛도 같은 방식으로 넉백한다.

### 6-7. Pull

1. `pull`은 주 대상만 처리한다.
2. 대상을 공격자 인접 칸으로 이동시킨다.
3. pull 도착 칸이 비어 있어야 한다.
4. pull 도착 칸이 강이 아니면 타일 진입 효과를 처리한다.

### 6-8. ChainShock

1. `chainShock`은 primary target에서 시작한다.
2. primary target과 attacker는 visited로 시작하므로 추가 체인 피해를 받지 않는다.
3. 살아있는 유닛의 직교 인접 네트워크를 BFS로 전파한다.
4. `block_chain_conductor` 패시브가 있는 유닛은 체인을 더 전파하지 않는다.
5. 체인 피해는 `weapon.damage - armor` 기반이다.
6. 전기 피해 면역 `immune_damage_type electric`이 있으면 피해 0이다.
7. `obstacle_electric_pylon`은 패시브가 없으므로 체인 릴레이 역할을 할 수 있다.
8. ChainShock은 타일을 전기 타일로 바꾸지 않는다.

---

## 7. 패시브 효과

### 7-1. 패시브 데이터 표

| id | trigger | actions | 구현 의미 |
|---|---|---|---|
| `passive_shield` | always_on | `block_penetration` | 관통/빔 전파 차단 |
| `passive_tile_absorb_attack` | on_attack | `absorb_tile_at_attacker(applyToTargetTile=true)` | 공격자가 서 있는 타일 또는 선택한 sourceTile 속성을 흡수해 공격 속성으로 사용 |
| `passive_melee_mastery` | always_on | `damage_reduction(melee, 1)` | melee 피해 1 감소 |
| `passive_fire_affinity` | on_tile_entry_of fire | `convert_entered_tile plain`, `heal_self 1` | 화염 타일 진입 시 타일을 plain으로 바꾸고 자가 회복 |
| `passive_medic` | on_turn_start | `heal_adjacent_allies 1 radius 1 excludeSelf` | 인접 아군 회복 |
| `passive_agility` | on_attack | `bonus_move 1` | 공격 후 이동력 1 복구, moved=false |
| `passive_turn_arson` | on_turn_start, adjacent_enemy_exists | `apply_tile_effect_to_adjacent_enemies fire` | 인접 적이 서 있는 타일을 fire로 변경 |
| `passive_insulator` | always_on | `immune_damage_type electric`, `block_chain_conductor` | 전기 피해 면역, 체인 전파 차단 |
| `passive_generator` | always_on | `amplify_damage_type electric x2 radius 2` | 반경 2 내 대상이 받는 전기 피해 2배 |
| `passive_freeze_immunity` | always_on | `immune_effect freeze` | freeze 부여 면역 |
| `passive_amphibious` | always_on | `immune_tile_type water, river` | water/river 타일 타입 진입 효과 완전 무시 |
| `passive_fire_weakness` | always_on | `vulnerability fire +1` | fire 피해 +1 |
| `passive_cryo_affinity` | on_turn_start, adjacent_frozen_enemy_exists | `heal_self_per 1 per adjacent_frozen_enemy` | 인접 freeze 적 수만큼 자가 회복 |
| `passive_sprinkler` | on_turn_start | `remove_adjacent_tile_effect fire radius 1`, `remove_adjacent_unit_effect fire radius 1` | 반경 1 내 fire 타일과 fire 상태 제거 |

### 7-2. 패시브 처리 위치

| 트리거 | 처리 파일 | 처리 시점 |
|---|---|---|
| `always_on` | 여러 Resolver에서 직접 조회 | 공격/타일/피해 계산 중 즉시 참조 |
| `on_tile_entry_of` | `TileTransitionResolver` | 타일 진입 직후, 일반 타일 효과 전 |
| `on_tile_entry_any_attribute` | `TileTransitionResolver` | 타일 진입 직후, 일반 타일 효과 전 |
| `on_turn_start` | `PassiveResolver.resolveTurnStart` | 효과 tick과 타일 피해 이후 |
| `on_attack` | `AttackResolver` 또는 `PassiveResolver.resolveOnAttack` | 공격 성공 후 |

### 7-3. 패시브 구현상 주의

1. `block_penetration`은 `AttackValidator.calcAffectedPositions()`의 `unitHasShield()`에서 사용한다.
2. `absorb_tile_at_attacker`는 `PassiveResolver`가 아니라 `AttackResolver.resolveEffectiveAttribute()`에서 처리한다.
3. `bonus_move`는 공격 후 `unit_movement_restore`를 만들어 `movementPoints`를 지정 값으로 바꾸고 `actionsUsed.moved=false`로 되돌린다.
4. `immune_tile_type`은 타일 진입 효과와 타일 피해 양쪽에서 사용된다.
5. `immune_damage_type`은 공격 피해와 chainShock 피해에서 사용된다.
6. `amplify_damage_type`은 현재 아군/적군 구분 없이 맵 위 모든 살아있는 유닛의 패시브를 검사한다. 필요하면 팀 필터를 추가해야 한다.

---

## 8. GameChange 구현 계약

Resolver는 상태를 직접 변경하지 않고 다음 변화 타입을 생성해야 한다.

| GameChange | 의미 |
|---|---|
| `unit_move` | 유닛 위치 변경. Rush가 아니면 moved=true |
| `unit_damage` | HP를 `hpAfter`로 변경 |
| `unit_heal` | HP를 `hpAfter`로 변경 |
| `unit_effect_add` | 효과 추가. 같은 `effectType` 기존 효과는 교체 |
| `unit_effect_remove` | effectId/effectType 일치 효과 제거 |
| `unit_death` | alive=false |
| `unit_knockback` | blockedBy가 없을 때만 위치 변경 |
| `unit_river_enter` | 강 진입. 위치 변경 + activeEffects 전체 제거 |
| `unit_pull` | 위치 변경 |
| `unit_actions_reset` | moved=false, attacked=false, extinguished=false. skillUsed는 유지 |
| `unit_movement_restore` | movementPoints 설정 + moved=false |
| `unit_spawn` | 새 유닛 생성. 생성 유닛은 그 턴 행동 불가 |
| `tile_attribute_change` | 타일 속성 변경 |
| `tile_effect_tick` | 타일 지속 턴 갱신 또는 plain 복귀 |
| `turn_advance` | currentTurnIndex 변경 |
| `round_advance` | round 변경 |
| `phase_change` | phase 변경 |

### 8-1. StateApplicator 주의

1. `StateApplicator.apply(changes, state)`는 changes를 순서대로 적용한다.
2. `unit_damage`와 `unit_heal`은 `amount`를 누적 계산하지 않고 `hpAfter` 값을 그대로 사용한다.
3. 여러 damage change를 같은 유닛에 대해 만들 때는 `hpAfter`가 서로 덮어쓰지 않도록 Resolver 내부에서 누적 HP 커서를 관리해야 한다.
4. 현재 일부 Resolver는 원본 unit snapshot 기준으로 `hpAfter`를 계산한다. 새 기능 구현 시에는 같은 유닛에 여러 피해가 동시에 들어가는 경우 `localHp`를 두고 누적 계산하는 방식을 권장한다.

---

## 9. AI 코딩용 구현 순서

### 9-1. 데이터 레이어

1. `TileAttributeType`, `AttackAttribute`, `UnitEffectType`, `UnitClass`, `AttackType`, `RangeType` enum을 만든다.
2. `UnitDef`, `WeaponDef`, `EffectDef`, `TileDef`, `PassiveDef`, `ElementalReactionDef`를 만든다.
3. Unity에서는 `UnitSo`, `WeaponSo`, `EffectSo`, `TileSo`, `PassiveSo`를 만들고 `ToDef()`로 순수 C# 객체를 생성한다.
4. `DataRegistry`는 `GetUnit`, `GetWeapon`, `GetEffect`, `GetTileByType`, `GetUnitPassives`, `GetElementalReactions`를 제공해야 한다.
5. 모든 참조는 런타임에서 `MetaId`로 조회한다.

### 9-2. 상태 레이어

1. `GameState`는 `units`, `map.tiles`, `map.baseTile`, `players`, `round`, `turnOrder`, `currentTurnIndex`를 포함한다.
2. `UnitState`는 HP, 방어력, 위치, 이동력, activeEffects, actionsUsed, alive를 포함한다.
3. `TileState`는 position, attribute, attributeTurnsRemaining을 포함한다.
4. 상태 변경은 반드시 `GameChange[] → StateApplicator`로만 한다.

### 9-3. 이동 구현

1. `MovementValidator.validateMove()`를 먼저 구현한다.
2. Dijkstra/BFS는 moveCost 1/2를 반영해야 한다.
3. `river`는 경유 가능, 목적지 불가다.
4. `mountain`은 경유/목적지 모두 불가다.
5. 이동 성공 시 `MovementResolver`가 `unit_move`를 만들고, 도착지 타일 효과를 `TileTransitionResolver`에 위임한다.

### 9-4. 효과 구현

1. `EffectResolver.resolveTurnTick()`를 구현한다.
2. active effect 피해와 countdown을 처리한다.
3. 현재 타일 periodic damage를 처리한다.
4. `EffectManager.processTurnStart()`는 effect tick 이후 on_turn_start 패시브를 처리한다.
5. `GameLoop`는 현재 턴 플레이어의 모든 생존 유닛에 대해 processTurnStart를 호출한다.

### 9-5. 공격 구현

1. `AttackValidator`에서 공격 가능 좌표와 affected positions를 계산한다.
2. `AttackResolver`에서 rush, tile absorb, damage, reactions, knockback, pull, tile effects, splash, shockwave, chainShock, spawnObstacle 순서로 처리한다.
3. 모든 상태 변화는 `GameChange[]`로만 반환한다.
4. 공격이 성공하면 `ActionProcessor`가 `actionsUsed.attacked=true`로 만든다.
5. 공격 후 `PassiveResolver.resolveOnAttack()`을 호출해 `bonus_move` 등을 처리한다.

---

## 10. 현재 데이터/문서 간 차이와 구현상 결론

### 10-1. Fire/Acid 타일 피해

일부 설계 문서에는 fire tile 피해가 2로 적혀 있을 수 있다. 현재 실제 `tiles.json`은 다음과 같다.

- `tile_fire.damagePerTurn = 1`
- `tile_acid.damagePerTurn = 1`
- `tile_electric.damagePerTurn = 1`

AI는 현재 구현을 재현할 때 JSON 값을 우선해야 한다.

### 10-2. Acid 피해 증폭

일부 설계 문서에는 acid가 incoming damage ×2로 설명될 수 있다. 현재 `effects.json`의 `effect_acid`에는 `incomingDamageMultiplier`가 명시되어 있지 않으므로 스키마 기본값 1이 적용된다. 즉 현재 데이터 기준 acid는 다음 효과다.

- 턴당 피해 1
- 방어 무시
- 3턴 지속
- 강 진입 시 제거
- 적용 시 타일도 acid로 변경

acid 취약화 효과를 의도한다면 `effect_acid`에 다음 값을 추가해야 한다.

```json
"incomingDamageMultiplier": 2
```

### 10-3. `skills.json`은 현재 빈 배열

현재 유닛의 개별 능력은 `skillIds`가 아니라 `primaryWeaponId`, `secondaryWeaponId`, `passiveIds` 위주로 구현되어 있다. 새 “캐릭터별 특수 스킬 1개”를 구현하려면 다음 중 하나를 선택한다.

#### 선택 A — 현재 구조 유지

- 특수 스킬을 `secondaryWeaponId`로 추가한다.
- UI에서 보조 무기 버튼을 제공한다.
- `AttackAction.weaponId`로 override한다.

#### 선택 B — SkillMeta 정식 사용

- `skills.json`에 active skill을 채운다.
- 각 `UnitMeta.skillIds`에 고유 skill 1개를 넣는다.
- `SkillMeta.weaponId`가 특수 무기 역할을 한다.
- `SkillAction`으로 `ActionProcessor.processSkill()`을 호출한다.

Unity 재설계에서는 선택 B를 권장한다.

---

## 11. 신규 효과 추가 체크리스트

새 타일/효과/패시브/무기를 추가할 때 AI는 다음 순서를 지킨다.

### 11-1. 새 상태 효과 추가

1. `UnitEffectType`에 새 effect type 추가.
2. `EffectMetaSchema`가 필요한 필드를 지원하는지 확인.
3. `effects.json`에 effect 추가.
4. 부여 경로를 만든다: 타일 `appliesEffectId`, 무기 원소 반응, 무기 특수 효과, 패시브 중 하나.
5. 제거 조건을 명확히 작성한다.
6. `EffectResolver.resolveTurnTick()` 또는 `AttackResolver`에서 별도 로직이 필요한지 확인한다.
7. 테스트 작성: 적용, 중복 적용, 턴 감소, 제거, 사망 판정.

### 11-2. 새 타일 추가

1. `TileAttributeType`에 새 tile type 추가.
2. `tiles.json`에 moveCost, cannotStop, impassable, damagePerTurn, appliesEffectId 등을 정의.
3. 이동 비용이 특수하면 `MovementValidator.moveCost()`를 수정한다.
4. 공격 대상 불가 타일이면 `AttackValidator.checkAttackType()`을 수정한다.
5. 타일 진입 특별 규칙이 있으면 `TileTransitionResolver`에 추가한다.
6. 테스트 작성: 이동 가능성, 도착 효과, 턴 피해, 패시브 면역.

### 11-3. 새 패시브 추가

1. `PassiveActionSchema` 또는 `PassiveTriggerSchema`에 타입 추가.
2. 해당 처리 위치를 정한다.
   - 타일 진입이면 `TileTransitionResolver`
   - 턴 시작이면 `PassiveResolver.resolveTurnStart`
   - 공격 후면 `PassiveResolver.resolveOnAttack`
   - 피해 계산이면 `AttackResolver` helper
   - 이동 판정이면 `MovementValidator`
3. `unit-passives.json`에 데이터 추가.
4. 유닛의 `passiveIds`에 연결.
5. 테스트 작성.

### 11-4. 새 무기/스킬 추가

1. `weapons.json`에 무기 정의.
2. 기존 필드만으로 표현 가능한지 확인한다.
3. 불가능하면 `WeaponMetaSchema`에 필드를 추가하고 `AttackValidator`/`AttackResolver`에 처리 위치를 명확히 넣는다.
4. 기본 공격이면 `primaryWeaponId` 또는 `secondaryWeaponId`에 연결한다.
5. 특수 스킬이면 `skills.json`에 active skill을 만들고 `SkillMeta.weaponId`로 연결한다.
6. 테스트 작성: 사거리, 대상 제한, 피해, 타일 변환, 상태 효과, 패시브 상호작용.

---

## 12. 최소 테스트 시나리오

AI가 구현 후 반드시 확인해야 하는 시나리오다.

### 12-1. 타일

- plain/road 이동 비용 1.
- sand 이동 비용 2 + 도착 시 `effect_sand`.
- river 이동 비용 2 + 목적지 불가.
- mountain 진입 불가.
- fire 도착 시 `effect_fire` + 턴 시작 타일 피해.
- water 도착 시 fire/acid 제거.
- acid 도착 시 `effect_acid` + 턴 시작 타일 피해.
- electric 도착 시 `effect_electric` + 턴 시작 타일 피해.
- ice 도착 시 모든 효과 제거 후 `effect_freeze`.

### 12-2. 효과

- fire 3턴 지속, 매 tick 피해 1, 수동 소화 가능.
- acid 3턴 지속, 매 tick 피해 1, 강 진입 시 제거.
- electric 1턴 지속, 매 tick 피해 1.
- freeze 1턴 지속, 행동 불가, 피해 차단, 피격/충돌 시 제거.
- stun 1턴 지속, 행동 불가.
- confused_ranged는 ranged 무기 사용 불가.
- confused_melee는 melee 무기 사용 불가.

### 12-3. 패시브

- shield가 관통을 차단한다.
- fire_affinity가 fire 타일을 plain으로 바꾸고 회복한다.
- medic이 인접 아군을 회복한다.
- agility가 공격 후 이동을 다시 허용한다.
- insulator가 electric 피해와 chain propagation을 차단한다.
- generator가 radius 2 내 electric 피해를 증폭한다.
- freeze_immunity가 freeze 부여를 막는다.
- amphibious가 water/river 타일 효과를 무시한다.
- fire_weakness가 fire 피해를 +1 한다.
- cryo_affinity가 인접 frozen enemy 수만큼 회복한다.
- sprinkler가 반경 1의 fire 타일/유닛 효과를 제거한다.

---

## 13. Unity 이식 네이밍 권장

| TS | Unity/C# 권장 |
|---|---|
| `UnitMeta` | `UnitDef` |
| `WeaponMeta` | `WeaponDef` |
| `SkillMeta` | `SkillDef` |
| `EffectMeta` | `EffectDef` |
| `TileAttributeMeta` | `TileDef` |
| `UnitPassiveMeta` | `PassiveDef` |
| `ElementalReaction` | `ElementalReactionDef` |
| `GameChange` | `GameChange` abstract/union equivalent |
| `DataRegistry` | `IDataRegistry`, `DataRegistry` |
| `MovementValidator` | `MovementValidator` |
| `AttackValidator` | `AttackValidator` |
| `TileTransitionResolver` | `TileTransitionResolver` |
| `EffectResolver` | `EffectResolver` |
| `PassiveResolver` | `PassiveResolver` |
| `AttackResolver` | `AttackResolver` |
| `StateApplicator` | `StateApplicator` |

C#에서는 discriminated union이 없으므로 다음 중 하나를 선택한다.

1. `abstract class GameChange` + sealed subclasses.
2. `interface IGameChange` + sealed classes.
3. `readonly struct` + enum tag는 권장하지 않는다. 필드 조합 오류 가능성이 커진다.

권장 방식은 `abstract class GameChange` + sealed subclasses다.
