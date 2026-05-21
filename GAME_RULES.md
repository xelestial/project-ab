# Project AB — 완전 게임 규칙 명세서

> 이 문서만으로 게임을 처음부터 정확하게 구현할 수 있도록 모든 규칙, 수치, 예외사항, 우선순위를 기술합니다.

---

## 목차

1. [개요 및 목표](#1-개요-및-목표)
2. [게임 흐름 (전체 루프)](#2-게임-흐름-전체-루프)
3. [드래프트 단계](#3-드래프트-단계)
4. [전투 단계 — 라운드 구조](#4-전투-단계--라운드-구조)
5. [유닛 순서 드래프트](#5-유닛-순서-드래프트)
6. [턴 구조 및 액션](#6-턴-구조-및-액션)
7. [이동 규칙](#7-이동-규칙)
8. [공격 규칙](#8-공격-규칙)
9. [속성 공격 및 원소 반응](#9-속성-공격-및-원소-반응)
10. [넉백 / 풀 메카닉](#10-넉백--풀-메카닉)
11. [유닛 효과 (Status Effects)](#11-유닛-효과-status-effects)
12. [타일 시스템](#12-타일-시스템)
13. [타일 진입 처리 순서 (완전 명세)](#13-타일-진입-처리-순서-완전-명세)
14. [공격 처리 순서 (완전 명세)](#14-공격-처리-순서-완전-명세)
15. [턴 시작 처리 순서 (완전 명세)](#15-턴-시작-처리-순서-완전-명세)
16. [유닛 데이터](#16-유닛-데이터)
17. [무기 데이터](#17-무기-데이터)
18. [스킬 데이터](#18-스킬-데이터)
19. [패시브 데이터](#19-패시브-데이터)
20. [효과 데이터](#20-효과-데이터)
21. [원소 반응 테이블](#21-원소-반응-테이블)
22. [타일 데이터](#22-타일-데이터)
23. [맵 데이터](#23-맵-데이터)
24. [승리 조건 및 종료](#24-승리-조건-및-종료)
25. [상수 일람](#25-상수-일람)
26. [에러 코드 및 검증 규칙](#26-에러-코드-및-검증-규칙)

---

## 1. 개요 및 목표

**Project AB**는 아이소메트릭 그리드 위에서 진행되는 2인(또는 4인 2v2) 턴 기반 전략 게임이다.

- 각 플레이어는 드래프트 단계에서 유닛을 배치하고, 전투 단계에서 번갈아 유닛을 조작한다.
- 상대 팀의 **모든 유닛을 전멸**시키면 승리한다.
- 30라운드 내에 전멸이 달성되지 않으면 **생존 유닛 수**로 우열을 가리며, 같으면 무승부.

---

## 2. 게임 흐름 (전체 루프)

```
게임 시작
  └─ [드래프트 단계] 동시 배치, 타임아웃 180초
        └─ (타임아웃 시 미배치 슬롯 자동 랜덤 배치 후 확정)
  └─ [전투 단계 루프] 라운드 1..N
        ├─ 유닛 순서 드래프트 (양측 동시, 타임아웃 30초)
        ├─ 라운드 시작
        └─ 턴 루프
              ├─ 현재 슬롯의 유닛이 사망 → 슬롯 스킵
              ├─ 턴 시작: 현재 플레이어 유닛 전체 effect tick
              ├─ 사망 판정
              └─ 멀티-액션 루프 (이동 → 공격 or 패스)
                    ├─ 플레이어 액션 요청 (타임아웃 60초)
                    ├─ 타임아웃 → 자동 pass
                    ├─ pass → 턴 종료
                    ├─ 이동 → 상태 업데이트
                    ├─ 공격 → 상태 업데이트 → 턴 종료
                    └─ PostProcess (승리 판정)
              └─ 라운드 종료
        └─ 라운드 한계 도달 시 승리 판정
  └─ 게임 결과
```

**핵심 제약:**
- 한 턴에 유닛은 최대 **이동 1회 + 공격 1회**를 수행할 수 있다.
- 이동을 먼저 하고 공격할 수 있지만, **공격 후 이동은 불가**하다.
- 공격을 하면 항상 턴이 종료된다.
- pass 액션은 항상 즉시 턴을 종료한다.

---

## 3. 드래프트 단계

### 3.1 개요
- 게임 시작 후 `draft` 단계로 진입.
- 모든 플레이어가 **동시에** (병렬로) 유닛을 배치한다.
- 제한 시간: **180초 (3분)**.
- 시간이 초과되거나 미배치 슬롯이 있으면 서버가 자동으로 랜덤 배치하여 확정.

### 3.2 풀 규칙
- 1v1: 각 플레이어가 개인 풀에서 최대 `maxUnitsPerPlayer`개 선택.
- 2v2: 팀 공유 풀 (6개 슬롯)에서 팀 우선순위 합산 순으로 선택.
- 동일 `metaId`는 **같은 플레이어가 중복 드래프트 불가**.
- 같은 `metaId`를 양 플레이어가 각각 선택하는 것은 가능.

### 3.3 배치 규칙
- 유닛은 해당 플레이어에게 할당된 **스폰 포인트** 위치 중 하나에만 배치 가능.
- 이미 다른 유닛이 있는 위치에는 배치 불가.

### 3.4 타임아웃 처리
- 타임아웃 시 `applyTimeout` 호출:
  - 확인되지 않은 슬롯에 대해 남은 풀에서 **랜덤 유닛을 빈 스폰 포인트에 배치**.
  - 이후 phase를 `battle`로 전환.

---

## 4. 전투 단계 — 라운드 구조

### 4.1 라운드 카운터
- 라운드는 1부터 시작, 매 라운드 종료 시 +1.
- 최대 **30라운드**. Round 31이 되면 게임 종료 판정.

### 4.2 라운드 시작 처리 (`roundManager.startRound`)
- 모든 생존 유닛의 `actionsUsed` 리셋: `{ moved: false, attacked: false, skillUsed: false, extinguished: false }`.
- 모든 생존 유닛의 `movementPoints` 복원 (`baseMovement`).

### 4.3 라운드 종료 처리 (`roundManager.endRound`)
- `round += 1`.

---

## 5. 유닛 순서 드래프트

매 라운드 시작 전, 양 플레이어가 **자신 유닛의 행동 순서**를 제출한다.

### 5.1 제출 방식
- 두 플레이어가 동시에 (`Promise.all`) 자신의 생존 유닛 ID 배열을 제출.
- 타임아웃: **30초**.
- 타임아웃 또는 미제출 시 서버가 기존 생존 순서로 자동 채움.
- 제출한 배열에서 사망 유닛 ID는 필터링, 누락된 생존 유닛은 맨 뒤에 추가.

### 5.2 턴 순서 생성 규칙 (1v1)

**플레이어 순서 결정:**
1. 우선순위(`priority`)가 낮은 플레이어가 먼저 행동.
2. 우선순위가 같을 경우:
   - **라운드 1** 또는 이전 선공자 정보 없음 → **랜덤 동전 던지기**.
   - **라운드 2+** → 전 라운드 선공 플레이어가 **후공**으로 전환 (교대).
3. 우선순위 기본값: 1 (모든 플레이어 동일 → 항상 교대 방식 적용).

**인터리브 방식 (교차 배치):**
플레이어 순서 결정 후 유닛을 교차 배치:
```
P1U0 → P2U0 → P1U1 → P2U1 → P1U2 → P2U2 → ...
```
- 한쪽 플레이어 유닛 수가 더 적으면 해당 플레이어의 슬롯은 먼저 소진됨.

### 5.3 턴 순서 생성 규칙 (2v2)

- 팀별 `priority` 합산으로 팀 순서 결정.
- 팀 내부 플레이어 순서도 `priority` 합산으로 결정.
- 교대 규칙은 1v1과 동일하게 팀 레벨에서 적용.
- 인터리브: `T0_P0_U0 → T1_P0_U0 → T0_P1_U0 → T1_P1_U0 → ...`

---

## 6. 턴 구조 및 액션

### 6.1 슬롯 처리
```
for each slot in turnOrder:
  if slot.unitId is dead → skip (advanceTurnIndex)
  else:
    effect tick for all alive units of slot.playerId
    applyDeaths()
    [멀티-액션 루프]
```

### 6.2 멀티-액션 루프
```
while !turnEnded:
  if slot.unitId exists:
    if unit is dead → break
    if unit.actionsUsed.moved AND unit.actionsUsed.attacked → break
  
  action = await adapter.requestAction(timeout=60s)
            .catch(() => passAction)
  
  if action.type == "pass":
    turnEnded = true; break
  
  result = actionProcessor.process(action, state)
  if accepted: update state
  postProcess(state)
  if game ended: break
  
  if action.type == "attack":
    turnEnded = true; break
```

### 6.3 액션 유형

| 타입 | 설명 |
|------|------|
| `move` | 유닛을 목적지로 이동 |
| `attack` | 지정 좌표를 공격 (기본 무기) |
| `skill` | 스킬 사용 (skillId + target) |
| `extinguish` | 자신의 화염 효과 제거 (소화) |
| `pass` | 턴 즉시 종료 |
| `draft_place` | 드래프트 단계에서 유닛 배치 |

### 6.4 액션 제약
- 이동은 턴당 **1회만** 가능 (`actionsUsed.moved`).
- 공격은 턴당 **1회만** 가능 (`actionsUsed.attacked`).
  - 공격 후 이동은 **불가**.
  - 이동 후 공격은 **가능**.
- 스킬은 게임 전체에서 **1회만** 사용 가능 (`actionsUsed.skillUsed`, `oneShot: true` 스킬의 경우).
  - 스킬 사용은 공격 액션과 동일하게 `attacked = true`로 표시되며 턴을 종료한다.
- 소화(`extinguish`)는 자신에게 화염 효과가 있을 때만 가능 (`actionsUsed.extinguished`).
  - 소화는 이동 액션을 소모한다 (`actionsUsed.moved = true`).

---

## 7. 이동 규칙

### 7.1 기본 규칙
- 유닛은 자신의 `movementPoints` 범위 내에서 이동.
- 이동은 **4방향 (상하좌우) 직교 이동**만 가능 (대각선 불가).
- 경로 탐색: **Dijkstra 알고리즘** (최소 비용 경로).
- 목적지에 다른 생존 유닛이 있으면 이동 불가.
- 경로 중간에 다른 유닛이 있어도 **통과 불가** (유닛은 장애물).
- 이동 완료 시 `unit_move` 변경 발생, 이후 타일 진입 처리.

### 7.2 타일별 이동 비용

| 타일 | 진입 비용 | 특수 규칙 |
|------|-----------|-----------|
| plain | 1 | 없음 |
| road | 1 | 없음 |
| mountain | — | **진입 불가** (impassable) |
| sand | **2** | 진입 시 모래 효과 부여 |
| river | **2/칸** | 통과만 가능, **정지 불가** |
| fire | 1 | 진입 시 화염 효과 부여 |
| water | 1 | 진입 시 화염/산성 효과 제거 |
| acid | 1 | 진입 시 산성 효과 부여 |
| electric | 1 | 진입 시 감전 효과 부여 |
| ice | 1 | 진입 시 모든 효과 제거 후 빙결 효과 부여 |

### 7.3 강(River) 특수 규칙
- 이동 시 강 타일을 **통과할 수 있지만 정지는 불가**.
- 경로 계획 시 강 타일은 비용 2로 계산되어 통과 가능.
- 목적지가 강 타일이면 이동 거부.
- **넉백으로 강에 밀려들어가면**: `unit_river_enter` 처리 → 모든 효과 초기화, 강 위치로 이동.

### 7.4 빙결(Freeze) 상태의 이동
- 빙결 효과가 있는 유닛은 **이동 불가** (검증 단계에서 거부).

---

## 8. 공격 규칙

### 8.1 기본 제약
- 빙결 상태 유닛은 **공격 불가**.
- 이미 공격한 유닛(`actionsUsed.attacked`)은 재공격 불가.
- 공격은 **4방향 직선(직교)**만 가능. 대각선 방향 대상은 공격 불가.
- 사거리: 무기의 `minRange` ≤ 맨해튼 직교 거리 ≤ `maxRange`.
  - 직교 거리 = 같은 행이면 열 차이, 같은 열이면 행 차이.
  - 행과 열이 모두 다른 위치 → 공격 불가 (`null` 반환).

### 8.2 공격 유형별 추가 제약

**melee (근거리):**
- 특별한 LOS 제약 없음.
- 기본: 인접 1칸.

**ranged (원거리):**
- LOS 체크 없음 (확정 규칙: 원거리는 자유 조준).

**artillery (곡사):**
- 공격자와 대상 사이에 **최소 1개의 장애물**(유닛 또는 산악 타일)이 있어야 공격 가능.
- 장애물 없으면 `ATTACK_NO_LOS` 오류.

### 8.3 관통 (Penetrate) 공격
- `rangeType: "penetrate"` 무기는 1차 대상 + 같은 직선상 뒤쪽 타일도 피격.
- **방패(shield_defend) 스킬**을 가진 유닛에게 적중하면 관통 **전파 차단**.
  - 방패 유닛 자신은 피해를 받음, 뒤쪽은 피해 없음.

### 8.4 돌진(Rush) 공격
- `rush: { requiresClearPath: true }` 무기:
  - 공격자가 대상 바로 인접 위치까지 먼저 이동한 뒤 공격.
  - 이동 중 모든 위치가 비어 있어야 함 (clear path 검증).
  - 이 이동은 **이동 액션을 소모하지 않음** (`isRushMovement: true`).
  - 돌진 이동 중 도착 타일의 타일 효과를 받음.
- 사거리: minRange=1, maxRange=3 (직선 1~3칸 대상 공격).
- 돌진 도착 위치: 대상 바로 인접 타일 (공격자가 이미 인접해 있으면 이동 없음).

### 8.5 풀(Pull) 공격
- `pull: { landAdjacent: true }` 무기:
  - 대상을 공격자 바로 인접 위치로 끌어당김.
  - 경로가 통과 가능해야 함 (`requiresClearPath: true`).
  - 데미지 없음 (`damage: 0`).
  - 풀 된 대상은 이동 후 타일 진입 처리.

### 8.6 넓이(Area) 공격
- `rangeType: "area"` 무기: `radius` 맨해튼 반경 내 모든 타일 피격.
- `includeCenter: false`이면 중심 타일 제외.

### 8.7 인접 타일 흡수 (r1 — adjacentTileAbsorb)
- `adjacentTileAbsorb: true` 무기: 플레이어가 `sourceTile` (인접 타일)을 지정하면 해당 타일 속성을 공격 속성으로 흡수.
- 흡수된 타일은 `plain`으로 변환.
- `sourceTile`을 지정하지 않으면 일반 `none` 속성 공격.

### 8.8 타일 흡수 (t1 — skill_shield_defend)
- `skill_shield_defend` 스킬을 보유한 유닛:
  - 자신이 서있는 타일에 속성(fire, water, acid, electric, ice, sand)이 있으면 해당 속성을 공격 속성으로 흡수.
  - 자신의 타일이 `plain`으로 변환.
  - 자신에게 해당 타입의 효과가 있으면 함께 제거.
  - `adjacentTileAbsorb`가 있는 무기는 이 로직 대신 별도 처리.

### 8.9 데미지 계산

```
baseDamage = weapon.damage
armorReduction = target.currentArmor  (최소 0)
dmg = max(0, baseDamage - armorReduction)

// 원소 반응 multiplier 적용 (아래 9절 참조)
dmg = floor(dmg × reactionMultiplier)

// 산성 효과 배율 적용
if target has acid effect:
  dmg = floor(dmg × incomingDamageMultiplier)  // acid: 2.0
```

- 최종 데미지는 **0 이상** (음수 없음).
- HP가 0 이하가 되면 사망으로 표시 (`alive = false`).

---

## 9. 속성 공격 및 원소 반응

### 9.1 공격 속성 종류

| 속성 | 설명 |
|------|------|
| `none` | 속성 없음 (기본) |
| `fire` | 화염 |
| `water` | 물 |
| `acid` | 산성 |
| `electric` | 감전 |
| `ice` | 빙결 |
| `sand` | 모래 |

### 9.2 타일 변환
- 속성이 있는 공격(`attribute != "none"`)은 적중 타일을 해당 속성 타일로 변환.
  - 단, 이미 해당 속성이면 변환하지 않음.
- 타일 변환 후 해당 위치에 유닛이 서 있으면 **타일 진입 처리** 실행.

### 9.3 원소 반응

| 공격 속성 | 대상 효과 | 배율 | 제거되는 효과 |
|-----------|-----------|------|--------------|
| `fire` | `freeze` | **0** (데미지 없음) | freeze |
| `water` | `fire` | **1** (일반 데미지) | fire |
| `ice` | `fire` | **0** (데미지 없음) | fire |

- 여러 반응이 동시에 적용 가능 (모두 순서대로 적용).
- 반응으로 제거된 효과는 즉시 `unit_effect_remove` 처리.

---

## 10. 넉백 / 풀 메카닉

### 10.1 넉백 (Knockback)

**방향:**
- `direction: "away"`: 공격자 → 대상 방향의 반대 방향으로 밀어냄.
- `direction: "fixed"`: `fixedDelta` 벡터 방향으로 밀어냄.

**처리 순서 (각 step):**

1. **벽/경계 밖**: `unit_knockback` (blockedBy: "wall"), 이동 없음, 피해 없음, 즉시 종료.
2. **다른 유닛 점유**: 
   - 막는 유닛에게 `collision_with_frozen` 제거 조건 처리.
   - 밀려난 유닛에게 충돌 피해 **1 (KNOCKBACK_COLLISION_DAMAGE)**.
   - `unit_knockback` (blockedBy: 유닛ID), 이동 없음, 즉시 종료.
3. **강(River) 타일**: `unit_river_enter` (모든 효과 초기화), 즉시 종료.
4. **빈 타일**: `unit_knockback` (이동), 도착 타일 진입 처리 (효과 획득/제거).

- 거리(`distance`)만큼 위 순서를 반복하되 각 단계에서 막히면 즉시 종료.

### 10.2 풀 (Pull)

- 대상을 공격자 인접 위치로 이동.
- `getAdjacentToTarget(attackerPos, targetPos)` = 대상 바로 앞 위치.
- 경로에 장애물이 있으면 풀 실패 (clear path 검증).
- 이동 후 목적지 타일 진입 처리.
- 데미지 없음.

### 10.3 강 진입 처리 (`unit_river_enter`)
- 유닛의 **모든 활성 효과 제거** (`clearedEffectIds` 전체).
- 유닛 위치를 강 타일로 업데이트.
- 추가 피해 없음 (`RIVER_PUSH_DAMAGE = 0`).

---

## 11. 유닛 효과 (Status Effects)

### 11.1 효과 목록

| 효과 | 유형 | 턴당 피해 | 지속 | 행동 제한 | 제거 조건 |
|------|------|-----------|------|-----------|-----------|
| 화염 (fire) | fire | 1 | 3턴 | 없음 | 3턴 / 소화 행동 / 강 진입 |
| 산성 (acid) | acid | 1 | 3턴 | 없음 | 3턴 / 강 진입 |
| 감전 (electric) | electric | 1 | 1턴 | 없음 | 1턴 |
| 빙결 (freeze) | freeze | 0 | 1턴 | **모든 행동 불가** | 1턴 / 빙결 유닛과 충돌 |
| 물 (water) | water | 0 | 영구 | 없음 | 이동 시 자동 제거 |
| 모래 (sand) | sand | 0 | 영구 | 없음 | 이동 시 자동 제거 |

### 11.2 산성 효과의 특수 동작
- 유닛에게 산성 효과가 적용되면 **해당 유닛이 서있는 타일도 산성 타일로 변환** (`alsoAffectsTile: true`).
- 산성 상태 유닛은 받는 공격 데미지 **2배** (`incomingDamageMultiplier: 2`).

### 11.3 빙결 효과의 특수 동작
- 빙결 효과 적용 시 **기존 모든 효과 먼저 제거** (`clearsAllEffectsOnApply: true`).
- 빙결된 유닛과 충돌(넉백)하면 빙결이 제거됨 (`collision_with_frozen` 제거 조건).

### 11.4 효과 중복 적용
- 이미 같은 효과가 있으면 `unit_effect_add`를 다시 보내지 않음 (중복 부여 방지).
- 예외: 빙결 효과는 기존 효과를 모두 제거하고 새로 적용.

### 11.5 턴 시작 tick 처리 순서
1. 유닛의 각 활성 효과에 대해:
   a. `damagePerTurn > 0`이면 피해 적용.
   b. `turnsRemaining`이 있으면 1 감소; 0이 되면 제거.
2. 유닛이 서 있는 타일의 `damagePerTurn > 0`이면 피해 적용 (타일 지속 피해).
   - `immune_tile_damage` 패시브가 있으면 타일 피해 면제.

---

## 12. 타일 시스템

### 12.1 타일 상태
- 그리드의 각 셀은 **기본 타일 타입**을 가짐 (기본값: `plain`).
- 특수 타일은 `state.map.tiles` 에 `"row,col"` 키로 저장.
- `baseTile`이 지정되지 않은 셀은 `plain`으로 간주.

### 12.2 타일 변환 (`tile_attribute_change`)
- 속성 공격이나 패시브에 의해 타일이 다른 속성으로 변환될 수 있음.
- `attributeTurnsRemaining`: 지정되면 해당 턴 후 원래 타입으로 복구 (현재 미구현 — 영구 변환).

### 12.3 산악(Mountain)
- **완전 통과불가** (이동, 공격 시 장애물).
- 포병(artillery) 공격의 '장애물'로 카운트됨.

### 12.4 강(River)
- 이동 비용 2/칸, **정지 불가**.
- 자발적 이동으로 강 위에서 멈출 수 없음.
- 넉백으로 강에 밀리면 모든 효과 제거 후 강 위에 위치.

---

## 13. 타일 진입 처리 순서 (완전 명세)

유닛이 자발적 이동 또는 넉백으로 타일에 진입할 때:

> **강(river) 진입은 별도 처리** (`unit_river_enter`) → 이 순서 적용 안 됨.

**Step 0: 패시브 확인 (always_on)**
- `immune_tile_effects` 패시브 여부 확인 → true면 Step 2 건너뜀.

**Step 1: 타일 진입 트리거 패시브 실행**
- `on_tile_entry_of(tileAttribute)`: 특정 타입 타일 진입 시.
- `on_tile_entry_any_attribute`: 속성 있는 타일(plain/road 제외) 진입 시.

패시브 액션 처리 순서:
1. `convert_entered_tile`: 타일을 다른 속성으로 변환 → `effectiveTileAttr` 업데이트.
2. `heal_self`: 유닛 HP 회복 (최대 HP 초과 불가).
3. `spread_entered_tile_attr`: 진입한 타일의 **원래 속성**을 4방향 인접 타일에 전파.

**Step 2: 일반 타일 효과 적용 (immune_tile_effects가 false일 때만)**

`effectiveTileAttr`(패시브로 변환된 후의 속성) 기준으로:

1. `clearsAllEffects: true` (예: ice 타일): 유닛의 모든 활성 효과 제거.
2. `removesEffectTypes`: 해당 효과 유형 제거 (예: water 타일 → fire, acid 제거).
3. `appliesEffectId`: 해당 효과 부여 (이미 있으면 부여 안 함).

---

## 14. 공격 처리 순서 (완전 명세)

```
attack(attacker, target, state, options?):
```

**Phase 0a: 돌진 이동 (rush)**
- 무기에 `rush`가 있으면 attacker가 target 인접 위치로 이동.
- `isRushMovement: true` (이동 액션 소모 안 함).
- 이동 목적지에 타일 진입 처리 실행.
- `effectiveAttackerPos` 업데이트.

**Phase 0b: 인접 타일 흡수 (r1 — adjacentTileAbsorb)**
- `weapon.adjacentTileAbsorb && options.sourceTile`이 있을 때:
  - `sourceTile`의 속성을 `effectiveAttr`로 설정.
  - `sourceTile`을 `plain`으로 변환.

**타일 흡수 (t1 — skill_shield_defend, adjacentTileAbsorb 없을 때)**
- attacker가 `skill_shield_defend`를 보유하고 있고 자신의 타일에 속성이 있으면:
  - 해당 속성을 `effectiveAttr`로 설정.
  - attacker 타일을 `plain`으로 변환.
  - attacker의 해당 효과 제거.

**Phase 1: 각 affectedPosition에 대해 피해 처리**
- 해당 위치에 유닛이 있으면:
  1. 원소 반응 적용 → `multiplier` 및 효과 제거.
  2. 기본 데미지 계산: `floor(max(0, baseDamage - armor) × multiplier)`.
     - 추가로 산성 효과의 `incomingDamageMultiplier` 적용.
  3. `unit_damage` 처리.

**Phase 1 후: 타일 변환**
- `effectiveAttr != "none"`이면:
  - 해당 위치 타일을 공격 속성으로 변환.
  - 변환 후 해당 위치에 유닛이 있으면 타일 진입 처리 실행.

**Phase 2a: 넉백 처리 (isPrimary 위치에만)**
- 무기에 `knockback`이 있고 대상 유닛이 있으면 넉백 처리.
- 넉백으로 유닛이 이동한 경우 새 위치에 타일 진입 처리.
- 강에 밀린 경우 `unit_river_enter`.

**Phase 2b: 풀 처리 (isPrimary 위치에만)**
- 무기에 `pull`이 있고 대상 유닛이 있으면 풀 처리.
- 풀 후 새 위치에 타일 진입 처리.

---

## 15. 턴 시작 처리 순서 (완전 명세)

각 플레이어의 슬롯 턴이 시작될 때, 해당 플레이어의 **모든 생존 유닛**에 대해:

1. `effectManager.processTurnStart(unitId, state)` 호출.
   - Effect tick: 각 효과의 `damagePerTurn` 처리, `turnsRemaining` 감소/제거.
   - 타일 지속 피해: 유닛 위치 타일의 `damagePerTurn` 처리.
2. `healthManager.applyDeaths(state)` 호출.
   - HP ≤ 0인 유닛 `alive = false` 처리.

> **중요**: 같은 턴의 **다른 유닛**이 아니라, 동일 플레이어의 모든 유닛에 대해 effect tick이 먼저 적용된 후 사망 판정이 한꺼번에 이루어진다.

---

## 16. 유닛 데이터

### t1 — 강철방패 (Tanker A)

| 속성 | 값 |
|------|-----|
| class | tanker |
| faction | a |
| baseMovement | 3 |
| baseHealth | 6 |
| baseArmor | **1** |
| attributes | (없음) |
| primaryWeapon | `wpn_tanker_melee` |
| skills | `skill_shield_defend` |
| passives | (없음) |

**특징**: 아머 1로 1데미지 공격을 완전 차단. 방패 방어 스킬로 자신이 서있는 속성 타일을 흡수해 속성 공격 가능. 관통 공격의 전파를 차단.

---

### t2 — 철갑 방패 (Tanker B)

| 속성 | 값 |
|------|-----|
| class | tanker |
| faction | b |
| baseMovement | 3 |
| baseHealth | 6 |
| baseArmor | **1** |
| attributes | (없음) |
| primaryWeapon | `wpn_tanker_melee` |
| skills | `skill_shield_defend`, `skill_t2_pull` |
| passives | (없음) |

**특징**: t1의 모든 특성에 더해, 1회 사용 풀 스킬 보유. 3칸 이내 적을 인접으로 끌어당김.

---

### f1 — 돌격대원 (Fighter A)

| 속성 | 값 |
|------|-----|
| class | fighter |
| faction | a |
| baseMovement | 3 |
| baseHealth | 4 |
| baseArmor | 0 |
| attributes | (없음) |
| primaryWeapon | `wpn_fighter_rush_kb` |
| skills | (없음) |
| passives | (없음) |

**특징**: 직선 1~3칸 내 대상에게 돌진 공격. 공격 시 대상을 1칸 밀어냄.

---

### f2 — 돌격대원 B (Fighter B)

| 속성 | 값 |
|------|-----|
| class | fighter |
| faction | b |
| baseMovement | 3 |
| baseHealth | 4 |
| baseArmor | 0 |
| attributes | (없음) |
| primaryWeapon | `wpn_fighter_rush_kb` |
| skills | (없음) |
| passives | (없음) |

**특징**: f1과 동일.

---

### r1 — 화살사수 (Ranger A)

| 속성 | 값 |
|------|-----|
| class | ranger |
| faction | a |
| baseMovement | 2 |
| baseHealth | 4 |
| baseArmor | 0 |
| attributes | (없음) |
| primaryWeapon | `wpn_ranger_penetrate_absorb` |
| skills | (없음) |
| passives | (없음) |

**특징**: 사거리 2~3, 관통 공격. 인접 타일 속성 흡수 가능 (`sourceTile` 지정 시). 흡수 속성으로 대상 및 타일 변환.

---

### r2 — 레인저 B (Ranger B)

| 속성 | 값 |
|------|-----|
| class | ranger |
| faction | b |
| baseMovement | 2 |
| baseHealth | 4 |
| baseArmor | 0 |
| attributes | (없음) |
| primaryWeapon | `wpn_ranger_penetrate_kb` |
| skills | (없음) |
| passives | (없음) |

**특징**: 사거리 2~3, 관통 공격. 적중 시 1칸 밀어냄.

---

### b1 — 화염 브루트 (Brute A)

| 속성 | 값 |
|------|-----|
| class | brute |
| faction | a |
| baseMovement | 3 |
| baseHealth | 5 |
| baseArmor | 0 |
| attributes | (없음) |
| primaryWeapon | `wpn_brute_water` |
| skills | (없음) |
| passives | `passive_b1_fire_heal` |

**특징**: 
- **패시브**: 화염 타일에 진입하면 해당 타일을 `plain`으로 변환하고 HP 1 회복.
- **무기**: 사거리 1~2, 물 속성 공격 (타격 시 화염 효과 제거 + 타일 물로 변환).

---

### b2 — 타일 면역 브루트 (Brute B)

| 속성 | 값 |
|------|-----|
| class | brute |
| faction | b |
| baseMovement | 3 |
| baseHealth | 5 |
| baseArmor | 0 |
| attributes | (없음) |
| primaryWeapon | `wpn_brute_melee` |
| skills | (없음) |
| passives | `passive_b2_tile_immunity`, `passive_b2_tile_spread` |

**특징**:
- **패시브 1 (always_on)**: 타일 효과/피해 완전 면제, 원소 효과 면제.
  - 타일 진입 시 어떠한 효과도 받지 않음.
  - 타일 지속 피해도 받지 않음.
- **패시브 2 (on_tile_entry_any_attribute)**: 속성 있는 타일에 진입 시 4방향 인접 타일에 해당 속성 전파.

---

## 17. 무기 데이터

### wpn_tanker_melee — 방패 타격

| 속성 | 값 |
|------|-----|
| attackType | melee |
| rangeType | single |
| minRange | 1 |
| maxRange | 1 |
| damage | **2** |
| attribute | none |

---

### wpn_t2_pull — 철갑 끌어당기기 (스킬 무기)

| 속성 | 값 |
|------|-----|
| attackType | melee |
| rangeType | single |
| minRange | 1 |
| maxRange | **3** |
| damage | **0** |
| attribute | none |
| pull | `{ landAdjacent: true }` |
| requiresClearPath | **true** |

> 데미지 없음. 3칸 이내 적을 인접으로 끌어당김. 경로가 막히면 사용 불가.

---

### wpn_fighter_rush_kb — 돌진 베기

| 속성 | 값 |
|------|-----|
| attackType | melee |
| rangeType | single |
| minRange | 1 |
| maxRange | **3** |
| damage | **2** |
| attribute | none |
| rush | `{ requiresClearPath: true }` |
| knockback | `{ distance: 1, direction: "away" }` |

> 직선 3칸 돌진 + 타격 + 1칸 밀어냄. 경로 통과 필요.

---

### wpn_ranger_penetrate_absorb — 관통+흡수

| 속성 | 값 |
|------|-----|
| attackType | ranged |
| rangeType | **penetrate** |
| minRange | **2** |
| maxRange | **3** |
| damage | **2** |
| attribute | none |
| adjacentTileAbsorb | **true** |

> 최소 사거리 2 (인접 공격 불가). 관통. 인접 타일 흡수로 속성 공격 가능.

---

### wpn_ranger_penetrate_kb — 관통+넉백

| 속성 | 값 |
|------|-----|
| attackType | ranged |
| rangeType | **penetrate** |
| minRange | **2** |
| maxRange | **3** |
| damage | **2** |
| attribute | none |
| knockback | `{ distance: 1, direction: "away" }` |

> 최소 사거리 2. 관통. 1차 대상에게 1칸 넉백.

---

### wpn_brute_water — 물 속성 근거리

| 속성 | 값 |
|------|-----|
| attackType | melee |
| rangeType | single |
| minRange | 1 |
| maxRange | **2** |
| damage | **1** |
| attribute | **water** |

> 물 속성 공격: 대상의 화염 효과 제거 (원소 반응), 타일 물 변환.

---

### wpn_brute_melee — 브루트 근거리

| 속성 | 값 |
|------|-----|
| attackType | melee |
| rangeType | single |
| minRange | 1 |
| maxRange | **2** |
| damage | **1** |
| attribute | none |

---

## 18. 스킬 데이터

### skill_shield_defend — 방패 방어

| 속성 | 값 |
|------|-----|
| type | **passive** |
| oneShot | false |
| weaponId | (없음) |

**효과:**
1. 관통(`penetrate`) 및 광선(`beam`) 공격의 전파를 차단 (유닛에게 피해는 입음).
2. 공격 시 자신의 타일 속성을 흡수해 속성 공격 가능 (공격 직전 발동).

**관통 차단 메카닉:**
- `calcAffectedPositions`에서 `penetrate` 타입 처리 시, 방패 유닛에 적중하면 그 뒤쪽은 `affectedPositions`에 포함하지 않음.

---

### skill_t2_pull — 철갑 끌어당기기

| 속성 | 값 |
|------|-----|
| type | **active** |
| oneShot | **true** |
| weaponId | `wpn_t2_pull` |

**효과:**
- 사거리 1~3 직선상의 적을 t2 인접으로 끌어당김.
- 데미지 없음.
- 경로가 통과 가능해야 함.
- **게임당 1회**만 사용 가능.

---

## 19. 패시브 데이터

### passive_b1_fire_heal — b1 화염 치유

| 속성 | 값 |
|------|-----|
| trigger | `on_tile_entry_of(fire)` |
| actions | `convert_entered_tile(to: plain)`, `heal_self(amount: 1)` |

**발동 조건**: b1이 화염(`fire`) 타일에 진입할 때.

**처리 순서:**
1. 진입한 화염 타일을 `plain`으로 변환.
2. b1 HP +1 회복 (최대 HP 초과 불가).

> **주의**: 타일이 plain으로 변환된 후에는 일반 타일 효과(fire 효과 부여)가 적용되지 않음. `effectiveTileAttr`이 `plain`으로 변경되기 때문.

---

### passive_b2_tile_immunity — b2 타일 면역

| 속성 | 값 |
|------|-----|
| trigger | `always_on` |
| actions | `immune_tile_effects`, `immune_tile_damage`, `immune_elemental_effects` |

**효과:**
- **immune_tile_effects**: 타일 진입 시 어떠한 효과도 받지 않음 (Step 2 완전 건너뜀).
- **immune_tile_damage**: 턴 시작 시 타일 지속 피해 없음.
- **immune_elemental_effects**: (현재 구현에서는 공격 시 원소 효과 적용 면제; 향후 확장).

---

### passive_b2_tile_spread — b2 타일 전파

| 속성 | 값 |
|------|-----|
| trigger | `on_tile_entry_any_attribute` (plain, road 제외) |
| actions | `spread_entered_tile_attr` |

**발동 조건**: b2가 속성(plain/road 제외)이 있는 타일에 진입할 때.

**처리:**
- 진입한 타일의 **원래 속성**을 4방향 인접 타일에 모두 전파.
- 이미 같은 속성인 타일은 변환 안 함.
- `tile_attribute_change` 이벤트 발생.

> **주의**: `passive_b2_tile_immunity`와 `passive_b2_tile_spread`가 함께 발동 시, 타일 효과(Step 2)는 면제되지만 타일 전파(Step 1 패시브)는 실행됨. b2는 전파는 하지만 효과는 받지 않음.

---

## 20. 효과 데이터

### effect_fire — 화염

| 속성 | 값 |
|------|-----|
| effectType | fire |
| damagePerTurn | **1** |
| blocksAllActions | false |
| alsoAffectsTile | false |
| clearsAllEffectsOnApply | false |
| incomingDamageMultiplier | 1 (기본) |
| removeConditions | `turns(3)`, `manual_extinguish`, `river_entry` |

---

### effect_acid — 산성

| 속성 | 값 |
|------|-----|
| effectType | acid |
| damagePerTurn | **1** |
| blocksAllActions | false |
| alsoAffectsTile | **true** |
| clearsAllEffectsOnApply | false |
| incomingDamageMultiplier | **2.0** |
| removeConditions | `turns(3)`, `river_entry` |

---

### effect_electric — 감전

| 속성 | 값 |
|------|-----|
| effectType | electric |
| damagePerTurn | **1** |
| blocksAllActions | false |
| alsoAffectsTile | false |
| clearsAllEffectsOnApply | false |
| incomingDamageMultiplier | 1 |
| removeConditions | `turns(1)` |

---

### effect_freeze — 빙결

| 속성 | 값 |
|------|-----|
| effectType | freeze |
| damagePerTurn | 0 |
| blocksAllActions | **true** |
| alsoAffectsTile | false |
| clearsAllEffectsOnApply | **true** |
| incomingDamageMultiplier | 1 |
| removeConditions | `turns(1)`, `collision_with_frozen` |

---

### effect_water — 물

| 속성 | 값 |
|------|-----|
| effectType | water |
| damagePerTurn | 0 |
| blocksAllActions | false |
| alsoAffectsTile | false |
| clearsAllEffectsOnApply | false |
| incomingDamageMultiplier | 1 |
| removeConditions | `on_move` |

---

### effect_sand — 모래

| 속성 | 값 |
|------|-----|
| effectType | sand |
| damagePerTurn | 0 |
| blocksAllActions | false |
| alsoAffectsTile | false |
| clearsAllEffectsOnApply | false |
| incomingDamageMultiplier | 1 |
| removeConditions | `on_move` |

---

## 21. 원소 반응 테이블

| 공격 속성 (attackAttr) | 대상 효과 (targetEffect) | 데미지 배율 | 제거 효과 |
|----------------------|--------------------------|-------------|----------|
| `fire` | `freeze` | **0** | freeze |
| `water` | `fire` | **1** | fire |
| `ice` | `fire` | **0** | fire |

**규칙:**
- 위 조건에 해당하지 않으면 배율 = 1 (기본).
- 여러 반응이 동시에 해당하면 모두 적용 (순서대로).
- 배율이 0이면 데미지가 0이 되지만, 효과 제거는 여전히 발생.
- `floor()` 연산 적용 (소수 버림).

---

## 22. 타일 데이터

### plain — 평지

| 속성 | 값 |
|------|-----|
| moveCost | 1 |
| impassable | false |
| cannotStop | false |
| damagePerTurn | 0 |
| appliesEffectId | (없음) |
| removesEffectTypes | (없음) |
| clearsAllEffects | false |

---

### road — 도로

plain과 동일.

---

### mountain — 산악

| 속성 | 값 |
|------|-----|
| moveCost | — |
| impassable | **true** |
| cannotStop | — |
| damagePerTurn | 0 |

---

### sand — 모래

| 속성 | 값 |
|------|-----|
| moveCost | **2** |
| impassable | false |
| cannotStop | false |
| damagePerTurn | 0 |
| appliesEffectId | `effect_sand` |

---

### river — 강

| 속성 | 값 |
|------|-----|
| moveCost | **2** |
| impassable | false |
| cannotStop | **true** |
| damagePerTurn | 0 |
| 특수 | 자발적 이동으로 정지 불가; 넉백 진입 시 모든 효과 초기화 |

---

### fire — 화염 타일

| 속성 | 값 |
|------|-----|
| moveCost | 1 |
| impassable | false |
| cannotStop | false |
| damagePerTurn | **2** |
| appliesEffectId | `effect_fire` |

---

### water — 물 타일

| 속성 | 값 |
|------|-----|
| moveCost | 1 |
| impassable | false |
| cannotStop | false |
| damagePerTurn | 0 |
| removesEffectTypes | `["fire", "acid"]` |

---

### acid — 산성 타일

| 속성 | 값 |
|------|-----|
| moveCost | 1 |
| impassable | false |
| cannotStop | false |
| damagePerTurn | **1** |
| appliesEffectId | `effect_acid` |

---

### electric — 감전 타일

| 속성 | 값 |
|------|-----|
| moveCost | 1 |
| impassable | false |
| cannotStop | false |
| damagePerTurn | **1** |
| appliesEffectId | `effect_electric` |

---

### ice — 빙결 타일

| 속성 | 값 |
|------|-----|
| moveCost | 1 |
| impassable | false |
| cannotStop | false |
| damagePerTurn | 0 |
| appliesEffectId | `effect_freeze` |
| clearsAllEffects | **true** |

> 진입 시 모든 기존 효과를 제거한 뒤 빙결 효과 부여.

---

## 23. 맵 데이터

### map_1v1_6v6 — 전선 (1v1 6vs6)

| 속성 | 값 |
|------|-----|
| playerCounts | [2] |
| gridSize | **16×16** |
| maxUnitsPerPlayer | **6** |
| teamSize | 1 (1v1) |
| tileOverrides | (없음 — 랜덤 지형 생성) |

**스폰 포인트:**
| 플레이어 인덱스 | 위치 |
|----------------|------|
| 0 | (1,1), (1,2), (1,3), (2,1), (2,2), (2,3) |
| 1 | (14,14), (14,13), (14,12), (13,14), (13,13), (13,12) |

---

### map_2v2_6v6 — 팀 격전장 (2v2 6vs6)

| 속성 | 값 |
|------|-----|
| playerCounts | [4] |
| gridSize | **16×16** |
| maxUnitsPerPlayer | **3** |
| teamSize | 2 (2v2) |
| tileOverrides | (없음 — 랜덤 지형 생성) |

**스폰 포인트:**
| 플레이어 인덱스 | 위치 |
|----------------|------|
| 0 | (1,1), (1,2), (2,1) |
| 1 | (1,13), (1,14), (2,14) |
| 2 | (14,1), (14,2), (13,1) |
| 3 | (14,14), (14,13), (13,14) |

---

### 랜덤 지형 생성 규칙

맵 메타에 `tileOverrides`가 없으면 서버가 게임 생성 시 랜덤 지형을 생성한다.

| 지형 종류 | 수량 | 배치 규칙 |
|-----------|------|-----------|
| 산악(mountain) | 양쪽 각 3개 | 스폰 영역 제외, 랜덤 |
| 수계(water) | 양쪽 각 3개 | 스폰 영역 제외, 연속 3칸 이상이면 강(river)으로 승격 |
| 원소 타일 | 전체 3개 | fire, acid, electric, ice 중 랜덤 |

---

## 24. 승리 조건 및 종료

### 24.1 즉시 종료 조건 (매 sub-action 후 체크)

**플레이어 전멸 (all_units_dead):**
- 1v1: 어느 플레이어라도 생존 유닛이 0이 되면 → 상대방 승리.
- 2v2: 한 팀 전체 생존 유닛이 0이 되면 → 상대 팀 승리.
  - 팀 내 모든 플레이어의 생존 유닛을 합산.

**항복 (surrender):**
- 플레이어 `surrendered = true` 시 즉시 상대방 승리.

### 24.2 라운드 한계 (round_limit)

- `round > 30` (라운드 31)이 되면 종료.
- **생존 유닛 수**가 가장 많은 플레이어/팀 승리.
- 동률이면 **무승부 (draw)**.

### 24.3 연결 끊김 (disconnect)

- 플레이어 연결 끊김 감지 시 상대방 승리 처리 (서버 레벨 처리).

---

## 25. 상수 일람

| 상수 | 값 | 설명 |
|------|-----|------|
| `GRID_SIZE` | 11 | 기본 그리드 크기 (테스트 맵용) |
| `MAX_ROUNDS` | **30** | 최대 라운드 수 |
| `TURN_TIMEOUT_MS` | **60,000** | 액션 타임아웃 (60초) |
| `UNIT_ORDER_TIMEOUT_MS` | **30,000** | 유닛 순서 제출 타임아웃 (30초) |
| `DRAFT_TIMEOUT_MS` | **180,000** | 드래프트 타임아웃 (3분) |
| `MAX_DRAFT_SLOTS` | **3** | 플레이어당 최대 드래프트 유닛 수 (기본) |
| `KNOCKBACK_COLLISION_DAMAGE` | **1** | 넉백 충돌 피해 |
| `RIVER_PUSH_DAMAGE` | **0** | 강 넉백 피해 |
| `MOVE_COST_RIVER` | **2** | 강 타일 이동 비용 |
| `MOVE_COST_SAND` | **2** | 모래 타일 이동 비용 |
| `FREEZE_DURATION_TURNS` | **1** | 빙결 지속 턴 |
| `FIRE_DURATION_TURNS` | **3** | 화염 지속 턴 |
| `ACID_DURATION_TURNS` | **3** | 산성 지속 턴 |
| `ELECTRIC_DURATION_TURNS` | **1** | 감전 지속 턴 |

---

## 26. 에러 코드 및 검증 규칙

### 이동 에러

| 코드 | 조건 |
|------|------|
| `MOVE_FROZEN` | 빙결 상태 |
| `MOVE_ALREADY_MOVED` | 이미 이동 완료 |
| `MOVE_OUT_OF_RANGE` | 그리드 범위 밖 |
| `MOVE_BLOCKED_UNIT` | 목적지에 유닛 있음 또는 강 타일 |
| `MOVE_BLOCKED_MOUNTAIN` | 목적지 또는 경로에 산악 |
| `MOVE_NO_PATH` | 이동 포인트 내 경로 없음 |

### 공격 에러

| 코드 | 조건 |
|------|------|
| `ATTACK_FROZEN` | 빙결 상태 |
| `ATTACK_ALREADY_ATTACKED` | 이미 공격 완료 |
| `ATTACK_INVALID_TARGET` | 그리드 범위 밖 |
| `ATTACK_OUT_OF_RANGE` | 사거리 밖 또는 대각선 방향 |
| `ATTACK_NO_LOS` | 포병 장애물 없음 / 돌진/풀 경로 막힘 |

### 추가 검증 규칙

- **공격 방향**: 같은 행 또는 같은 열만 허용 (직교 직선).
- **관통 공격 방패 차단**: 방패 유닛에 적중 후 그 뒤쪽은 `affectedPositions`에 포함하지 않음.
- **돌진 경로 검증**: 공격자와 대상 사이 모든 타일이 비어 있어야 함 (유닛 없음, 산악 없음).
- **풀 경로 검증**: 동일 조건.
- **스킬 중복 사용**: `actionsUsed.skillUsed` 또는 `oneShot` + 이전 사용 기록이 있으면 거부.
- **소화 조건**: 자신에게 화염(`fire`) 효과가 있어야 함. `extinguished` 플래그로 1회만.

---

## 부록: 처리 우선순위 요약

복잡한 상황에서의 처리 우선순위:

1. **b2 타일 면역 + 타일 전파**: 타일 전파(Step 1)는 실행되지만 타일 효과 부여(Step 2)는 건너뜀.
2. **b1 화염 치유**: 타일을 plain으로 변환 후 치유 → plain 타일 효과(없음) 적용. 화염 효과 부여 안 됨.
3. **방패 + 관통 공격**: 방패 유닛 자신은 피해를 받고, 그 뒤 전파가 차단.
4. **빙결 + 다른 효과 동시**: 빙결 적용 시 기존 모든 효과 먼저 제거.
5. **넉백 → 강 진입**: 강 진입 처리(`unit_river_enter`)가 발생하며 모든 효과 제거. 다른 타일 진입 처리(`resolveUnitEntersTile`) 발동 안 함.
6. **원소 반응 → 배율 0**: 피해 0이지만 효과 제거는 여전히 발생.
7. **산성 유닛 피해**: `baseDamage - armor` 먼저 계산, 이후 `incomingDamageMultiplier(2.0)` 곱함 → `floor()`.
8. **돌진 이동 중 타일 효과**: 돌진 도착 위치에 타일 진입 처리 실행 (단, `isRushMovement`이므로 이동 액션 소모 안 함).

---

*이 문서는 프로젝트 AB 코드베이스의 engine, metadata 패키지를 기반으로 모든 규칙을 추출하여 작성되었습니다.*
