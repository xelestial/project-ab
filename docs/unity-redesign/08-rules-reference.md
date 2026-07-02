# 08 — 게임 룰 완전 명세 (Unity 재설계판)

> 이 문서만으로 게임 룰을 처음부터 정확히 구현할 수 있도록 모든 규칙·수치·예외·우선순위를 기술한다.
> 원본: [GAME_RULES.md](../../GAME_RULES.md) (내용 동일, 재설계 용어로 재기술).
> 다른 문서에서 "§n"으로 인용하는 절 번호는 이 문서 기준이다.
> 각 절 끝의 `[→ 구현]`은 해당 룰의 담당 모듈이다.

---

## §1. 개요 및 목표

- 16×16 아이소메트릭 그리드 위 2인(또는 4인 2v2) 턴제 전략 게임.
- 드래프트로 유닛 배치 → 전투에서 번갈아 조작.
- 상대 팀 **전 유닛 전멸** 시 승리. 30라운드 내 미결 시 **생존 유닛 수** 비교, 동률 무승부.

## §2. 게임 흐름 (전체 루프)

```
게임 시작
 └─ [드래프트] 전원 동시 배치, 타임아웃 180초 (미배치는 자동 랜덤 배치)
 └─ [전투 루프] 라운드 1..30
      ├─ 유닛 순서 드래프트 (양측 동시, 30초)
      ├─ 라운드 시작 (액션 리셋, 이동력 복원)
      ├─ 턴 루프 (인터리브 슬롯 순서대로)
      │    ├─ 슬롯 유닛 사망 → 스킵
      │    ├─ 턴 시작: 슬롯 플레이어의 전 생존 유닛 효과 tick → 일괄 사망 판정
      │    └─ 멀티-액션 루프 (이동 → 공격 or 패스; 액션 타임아웃 60초 → 자동 패스)
      └─ 라운드 종료 (Round += 1)
 └─ Round > 30 → 생존 수 판정
```

**핵심 제약:**
- 한 턴: 최대 **이동 1회 + 공격 1회**.
- 이동→공격 가능, **공격→이동 불가**. 공격은 항상 턴 종료.
- 패스는 즉시 턴 종료.

`[→ 구현: GameLoop, TurnController — 05 문서]`

## §3. 드래프트 단계

### §3.1 개요
- 시작 시 `Draft` 페이즈. 모든 플레이어 **동시(병렬)** 배치. 제한 180초.
- 타임아웃 또는 미배치 슬롯 존재 시 자동 랜덤 배치 후 확정 → `Battle` 전환.

### §3.2 풀 규칙
- 1v1: 개인 풀에서 최대 `MaxUnitsPerPlayer`(6)개 선택.
- 2v2: 팀 공유 풀(6 슬롯)에서 팀 우선순위 합산 순으로 선택.
- 같은 `metaId`를 **같은 플레이어가 중복 드래프트 불가**. 양 플레이어가 각각 선택은 가능.

### §3.3 배치 규칙
- 본인에게 할당된 **스폰 포인트**에만 배치 가능. 이미 점유된 위치 불가.

### §3.4 타임아웃 처리
- 미확정 슬롯: 남은 풀에서 **랜덤 유닛을 빈 스폰 포인트에 배치** (IRandomSource). 이후 Battle 전환.

`[→ 구현: DraftManager — 04 문서 §4-3]`

## §4. 라운드 구조

- §4.1 라운드는 1부터. 종료 시 +1. 최대 **30**. Round 31 진입 시 종료 판정 (§24.2).
- §4.2 라운드 시작: 전 생존 유닛 `ActionsUsed` 리셋(moved/attacked/skillUsed=false) + `MovementPoints = BaseMovement` 복원.
  - 주의: oneShot 스킬 사용 이력(`UsedOneShotSkills`)은 리셋되지 않는다 (게임 전체 1회).
- §4.3 라운드 종료: `Round += 1`.

`[→ 구현: RoundManager]`

## §5. 유닛 순서 드래프트

### §5.1 제출
- 매 라운드 시작 전, 각 플레이어가 자기 **생존 유닛 ID 배열**을 동시 제출. 타임아웃 **30초**.
- 미제출/타임아웃 → 기존 생존 순서로 자동 채움.
- 제출 배열 보정: 사망 유닛 ID 제거, 누락된 생존 유닛은 (기존 생존 순서대로) 맨 뒤에 추가.

### §5.2 턴 순서 생성 (1v1)
**플레이어 순서:**
1. `Priority` 낮은 쪽 선공.
2. 동률 (기본값 1로 항상 동률):
   - 라운드 1 또는 직전 선공 기록 없음 → **동전 던지기** (IRandomSource.NextBool).
   - 라운드 2+ → **직전 라운드 선공자가 후공** (교대).

**인터리브:** `P1U0 → P2U0 → P1U1 → P2U1 → ...` — 한쪽 유닛이 적으면 그쪽 슬롯 먼저 소진 (남은 쪽 연속 배치).

### §5.3 턴 순서 생성 (2v2)
- 팀 순서: 팀별 `Priority` 합산. 팀 내 플레이어 순서도 합산 기준.
- 교대 규칙은 팀 레벨에 동일 적용.
- 인터리브: `T0P0U0 → T1P0U0 → T0P1U0 → T1P1U0 → T0P0U1 → ...`

`[→ 구현: TurnOrderBuilder — 04 문서 §4-4]`

## §6. 턴 구조 및 액션

### §6.1 슬롯 처리
```
for each slot in TurnOrder:
  if 슬롯 유닛 사망 → 스킵
  슬롯 플레이어의 전 생존 유닛 효과 tick (§15)
  일괄 사망 판정
  [멀티-액션 루프]
```

### §6.2 멀티-액션 루프
```
while 턴 미종료:
  유닛 사망 or (Moved && Attacked) → 종료
  action = await agent (60초; 타임아웃 → Pass)
  Pass → 턴 종료
  처리(검증→계산→적용→사망→종료판정); 거부면 재요청
  게임 종료 → 전체 종료
  Attack/Skill 액션이었다면 → 턴 종료
```

### §6.3 액션 유형
| 종류 | 설명 |
|---|---|
| Move | 목적지로 이동 |
| Attack | 좌표 공격 (기본 무기; r1은 sourceTile 선택 가능) |
| Skill | 스킬 사용 (skillId + target) |
| Rest | **휴식** — 체력 1 회복 + 모든 상태이상 제거 (공격 대신; 이동 후 가능, 턴 종료) |
| Pass | 턴 즉시 종료 |
| DraftPlace | 드래프트 배치 (드래프트 페이즈 전용) |

### §6.4 액션 제약
- 이동 턴당 1회 (`Moved`). 공격 턴당 1회 (`Attacked`). 공격 후 이동 불가, 이동 후 공격 가능.
- 스킬(oneShot): **게임 전체 1회**. 사용 시 `Attacked=true` + 턴 종료 (공격과 동일 취급).
- **휴식**: 모든 유닛 사용 가능, **공격 대신**(`Attacked==false`일 때만; **이동 후 가능**). 빙결 시 불가.
  효과: **체력 1 회복**(최대 HP 클램프) + **자신의 모든 상태이상 제거**. 즉시 턴 종료. 전제조건 없음.

`[→ 구현: ActionValidator, TurnController]`

## §7. 이동 규칙

### §7.1 기본
- `MovementPoints` 내에서 4방향 직교 이동 (대각선 불가). 경로 탐색 **다익스트라** (최소 비용).
- 목적지에 생존 유닛 → 불가. 경로 중간 유닛 → **통과 불가** (장애물).
- 이동 완료 후 목적지에 **타일 진입 처리** (§13). 경유 칸은 타일 효과 없음.
- 자발 이동 시 OnMove 제거 조건 효과(water, sand) 자동 제거.

### §7.2 타일별 진입 비용
| 타일 | 비용 | 특수 |
|---|---|---|
| plain / road | 1 | — |
| mountain | — | **진입 불가** |
| sand | **2** | 진입 시 모래 효과 |
| river | **2** | **통과만, 정지 불가** |
| fire | 1 | 진입 시 화염 효과 |
| water | 1 | 진입 시 화염/산성 제거 |
| acid | 1 | 진입 시 산성 효과 |
| electric | 1 | 진입 시 감전 효과 |
| ice | 1 | 진입 시 전 효과 제거 후 빙결 |

### §7.3 강(river)
- 이동으로 통과 가능(비용 2/칸), 목적지로는 불가.
- 넉백/풀로 진입 시: `UnitRiverEnter` — 모든 효과 초기화, 강 위에 위치 (§10.3).

### §7.4 빙결 상태
- freeze 효과 보유 유닛은 이동 불가 (검증 거부 `MoveFrozen`).

`[→ 구현: MovementValidator, MovementResolver]`

## §8. 공격 규칙

### §8.1 기본 제약
- 빙결 유닛 공격 불가. `Attacked` 후 재공격 불가.
- **4방향 직교 직선만** 가능 (같은 행 또는 같은 열). 대각선 불가 → `AttackOutOfRange`.
- 사거리: `MinRange ≤ 직교 거리 ≤ MaxRange` (직교 거리 = 행 동일 시 열 차, 열 동일 시 행 차).

### §8.2 공격 유형별 제약
- **Melee**: 추가 제약 없음.
- **Ranged**: LOS 검사 없음 (자유 조준 — 확정 룰).
- **Artillery**: 공격자~대상 사이(양 끝 제외)에 **장애물(생존 유닛 또는 mountain) ≥ 1** 필요. 없으면 `AttackNoLos`.

### §8.3 관통 (Penetrate)
- 1차 대상 + 같은 직선 **뒤쪽 전체** 피격 (격자 끝까지; mountain에서 중단).
- **방패(BlocksPenetration 스킬 보유) 유닛에 적중 시 전파 차단**: 방패 유닛은 피해를 받고, 그 뒤는 피격 목록에서 제외.

### §8.4 돌진 (Rush)
- `Rush.RequiresClearPath=true` 무기: 공격자가 **대상 바로 인접 칸까지 먼저 이동** 후 공격.
- 경로 전 칸이 비어 있어야 함 (유닛/산 없음) — 아니면 `AttackNoLos`.
- 이 이동은 **이동 액션 비소모** (`IsRushMovement=true`), 도착 칸에서 **타일 진입 처리 받음**.
- 이미 인접이면 이동 없음.

### §8.5 풀 (Pull)
- `Pull.LandAdjacent=true` 무기: 대상을 공격자 바로 인접 칸으로 끌어옴.
- 경로 통과 가능해야 함 (`RequiresClearPath`). **데미지 0**. 끌려온 칸에서 타일 진입 처리.

### §8.6 범위 (Area)
- 맨해튼 반경 `AreaRadius` 내 전체 피격. `AreaIncludesCenter=false`면 중심 제외.

### §8.7 인접 타일 흡수 (r1 — AdjacentTileAbsorb)
- 플레이어가 `sourceTile`(공격자 인접 타일)을 지정하면 그 타일의 속성을 이번 공격의 속성으로 흡수.
- 흡수된 타일은 `plain`으로 변환. `sourceTile` 미지정 시 무속성(None) 공격.

### §8.8 자기 타일 흡수 (t1/t2 — skill_shield_defend 보유)
- 공격 시(AdjacentTileAbsorb 미발동일 때만) 자신이 선 타일에 속성(fire/water/acid/electric/ice/sand)이 있으면 그 속성을 공격 속성으로 흡수.
- 자기 타일 `plain` 변환 + 자신의 동일 타입 효과 제거.

### §8.9 데미지 계산
```
dmg = max(0, weapon.Damage - target.CurrentArmor)
dmg = floor(dmg × 원소반응배율(§21))
if target has acid: dmg = floor(dmg × 2.0)     // IncomingDamageMultiplier
```
- 최종 0 이상. HP ≤ 0 → 사망 (`Alive=false`, 일괄 판정).

`[→ 구현: AttackValidator, AffectedPositionCalculator, AttackResolver — 04 문서 §2-7]`

## §9. 속성 공격 및 원소 반응

### §9.1 속성 7종
`None / Fire / Water / Acid / Electric / Ice / Sand`

### §9.2 타일 변환
- 속성 공격(`≠None`)은 피격 타일을 해당 속성 타일로 변환 (이미 같은 속성이면 변환 없음).
- 변환된 타일 위에 유닛이 있으면 **타일 진입 처리(§13) 실행**.

### §9.3 유닛 효과 부여
- 속성 공격은 피격 유닛에 대응 효과 부여: Fire→fire, Acid→acid, Electric→electric, Ice→**freeze**, Sand→sand. **Water는 효과 부여 없음** (반응으로 fire 제거만).
- b2(ImmuneElementalEffects)는 공격발 원소 효과 면제.

### §9.4 원소 반응 → §21 테이블.

`[→ 구현: AttackResolver Phase 1, ElementalReactionTable]`

## §10. 넉백 / 풀

### §10.1 넉백
**방향**: `Away` = 공격자→대상 방향, `Fixed` = `FixedDelta`.
**각 스텝 판정 (Distance회 반복, 막히면 즉시 전체 종료):**
1. **벽/격자 밖/산**: 이동·피해 없음 (`BlockedByWall`), 종료.
2. **유닛 점유**: 막은 유닛이 freeze면 freeze 제거(`CollisionWithFrozen`); **밀린 유닛과 막은 유닛 양쪽에 각각 충돌 피해 1**; 이동 없음, 종료.
3. **river**: `UnitRiverEnter` (전 효과 초기화, 피해 0), 종료. §13 미적용.
4. **빈 타일**: 1칸 이동, 다음 스텝.

전 스텝 완료(또는 빈 타일에서 거리 소진) 시 **최종 위치에서 타일 진입 처리(§13) 1회**.

### §10.2 풀
- 대상을 공격자 바로 인접 칸(`attackerPos + direction(attacker→target)`)으로 이동.
- 경로 장애물 시 액션 자체가 거부 (검증 단계). 데미지 없음. 이동 후 타일 진입 처리 (river면 `UnitRiverEnter`).

### §10.3 강 진입 (`UnitRiverEnter`)
- 모든 활성 효과 제거. 위치 = 강 타일. 추가 피해 0 (`RiverPushDamage`).

`[→ 구현: KnockbackResolver, PullResolver — 04 문서 §2-4/§2-5]`

## §11. 유닛 효과 (Status Effects)

### §11.1 효과 목록
| 효과 | 턴당 피해 | 지속 | 행동 제한 | 제거 조건 |
|---|---|---|---|---|
| fire | 1 | 3턴 | 없음 | 3턴 만료 / **휴식** / 강 진입 |
| acid | **0** | 3턴 | 없음 | 3턴 만료 / **휴식** / 강 진입 |
| electric | 1 | 1턴 | 없음 | 1턴 만료 / **휴식** |
| freeze | 0 | 1턴 | **모든 행동 불가** | 1턴 만료 / 빙결 유닛과 충돌 (휴식 불가) |
| water | 0 | 영구 | 없음 | 자발 이동 시 / **휴식** |
| sand | 0 | 영구 | 없음 | 자발 이동 시 / **휴식** |

> **휴식(Rest, §6.4)**으로 자신의 모든 상태이상을 한 번에 제거 + 체력 1 회복 (공격 대신, 이동 후 가능).
> 빙결만은 행동 차단이라 휴식으로 풀 수 없다 (1턴 후 자동 해제).

### §11.2 산성 특수
- 부여 시 **유닛이 선 타일도 acid 타일로 변환** (`AlsoAffectsTile`).
- 보유 중 받는 공격 피해 **2배** (`IncomingDamageMultiplier=2.0`, §8.9의 마지막 곱).
- **지속 피해는 없다** (`DamagePerTurn=0`). 산성의 유일한 위협은 ×2 증폭이다.

### §11.3 빙결 특수
- 부여 시 **기존 모든 효과 먼저 제거** (`ClearsAllEffectsOnApply`).
- 빙결 유닛이 넉백 충돌의 '막는 쪽'이 되면 빙결 제거.

### §11.4 중복 부여
- 같은 타입 효과 보유 중이면 재부여 없음. (freeze는 §11.3 규칙이 별도로 적용 — 이미 freeze면 역시 재부여 없음.)

### §11.5 턴 시작 tick 순서 → §15.

`[→ 구현: EffectResolver, EffectManager, EffectDef]`

## §12. 타일 시스템

- §12.1 각 셀은 기본 `plain`. 비-plain 타일만 `MapState.Tiles`에 `"row,col"` 키로 저장.
- §12.2 속성 공격/패시브로 타일 변환 가능 (`TileAttributeChange`). 시한부 복구는 **미구현 — 영구 변환** (TileEffectTickChange는 예약).
- §12.3 mountain: 완전 통과 불가. artillery의 '장애물'로 카운트.
- §12.4 river: 비용 2/칸, 정지 불가. 자발 이동으로 위에서 멈출 수 없음. 넉백 진입 시 전 효과 제거.

## §13. 타일 진입 처리 순서 (완전 명세)

자발 이동 / 돌진 / 넉백 정착 / 풀 / 타일 변환(유닛이 위에 있을 때) 공통.
**예외**: 넉백·풀로 인한 **강 진입은 별도 처리(§10.3)** — 본 순서 미적용.

```
Step 0: ImmuneTileEffects 패시브(b2) 확인 → 보유 시 Step 2 전체 생략
Step 1: 타일 진입 트리거 패시브 실행 (보유 패시브 순서대로)
   트리거: OnTileEntryOf(타일타입) / OnTileEntryAnyAttribute(plain·road 제외)
   액션 순서:
     1. ConvertEnteredTile  → 타일 변환, effectiveTile 갱신
     2. HealSelf            → HP 회복 (최대 HP 클램프)
     3. SpreadEnteredTileAttr → 진입 타일의 '원래' 속성을 4방향 전파
        (이미 같은 속성 타일 제외; 전파된 타일 위 유닛은 §13 재적용)
Step 2: 일반 타일 효과 (effectiveTile 기준, Step 0 면역 아니면)
     1. ClearsAllEffects (ice)         → 전 효과 제거
     2. RemovesEffectTypes (water→fire,acid) → 해당 타입 제거
     3. AppliesEffectId                → 효과 부여 (§11.4 중복 금지,
                                          freeze는 §11.3 선행 제거,
                                          acid는 §11.2 타일 변환 동반)
```

`[→ 구현: TileEntryResolver, PassiveResolver — 04 문서 §2-1/§2-2]`

## §14. 공격 처리 순서 (완전 명세)

```
Phase 0a: 돌진 이동 (Rush) — 대상 인접 칸으로 이동(액션 비소모), 도착지 §13 실행,
          effectiveAttackerPos 갱신
Phase 0b: 인접 타일 흡수 (AdjacentTileAbsorb && sourceTile 지정)
          → effectiveAttr = sourceTile 속성; sourceTile → plain
Phase 0c: 자기 타일 흡수 (0b 미발동 && AbsorbsOwnTile 스킬 && 자기 타일에 속성)
          → effectiveAttr = 자기 타일 속성; 자기 타일 → plain; 자신의 동일 효과 제거
Phase 1 : AffectedPositions 각 좌표 — 유닛 있으면:
          ① 원소 반응 (§21) → 배율·효과 제거
          ② dmg = floor(max(0, Damage−Armor) × 배율) → acid 보유 시 ×2 후 floor
          ③ UnitDamage
          ④ effectiveAttr 대응 효과 부여 (§9.3; b2 면역 제외)
Phase 1후: effectiveAttr ≠ None → 각 좌표 타일을 속성 타일로 변환(동일 속성 제외),
          변환 칸 위 유닛에 §13 실행
Phase 2a: 넉백 (무기에 Knockback) — 1차 대상 유닛에만 §10.1
Phase 2b: 풀 (무기에 Pull) — 1차 대상 유닛에만 §10.2
(사망 판정은 액션 적용 후 일괄 — §15와 동일한 HealthManager 경로)
```

`[→ 구현: AttackResolver — 04 문서 §2-7 플로차트]`

## §15. 턴 시작 처리 순서 (완전 명세)

슬롯 턴 시작 시, **슬롯 플레이어의 모든 생존 유닛**에 대해 (소유 순서대로):
1. 효과 tick: 각 활성 효과(부여 순서대로) — `DamagePerTurn>0`이면 피해; `TurnsRemaining` 1 감소, 0이면 제거.
2. 타일 지속 피해: 유닛이 선 타일의 `DamagePerTurn>0`이면 피해. **ImmuneTileDamage 패시브(b2)는 면제.**

> **중요**: 전 유닛 tick을 먼저 모두 적용한 뒤, **사망 판정을 한꺼번에** 수행한다.

`[→ 구현: EffectManager.ProcessTurnStart + HealthManager.ApplyDeaths]`

---

## §16-19. 메타데이터 단일 소스

유닛/무기/스킬/패시브 값은 이 문서에 중복 기재하지 않는다. 아래 파일이 단일 소스다.

| 데이터 | 단일 소스 |
|---|---|
| 유닛 | `packages/metadata/data/units.json` |
| 무기 | `packages/metadata/data/weapons.json` |
| 스킬 | `packages/metadata/data/skills.json` |
| 패시브 | `packages/metadata/data/unit-passives.json` |
| 요약 문서 | `UNIT.MD` |

Unity 구현은 위 JSON 값을 기준으로 ScriptableObject를 생성/검증해야 한다.

## §20. 효과 데이터 (6종)

| metaId | type | 턴당피해 | 지속턴 | blocksAll | alsoAffectsTile | clearsOnApply | 피격배율 | 제거 조건 |
|---|---|---|---|---|---|---|---|---|
| effect_fire | fire | 1 | 3 | ✗ | ✗ | ✗ | 1 | turns(3), rest, river_entry |
| effect_acid | acid | **0** | 3 | ✗ | **✓** | ✗ | **2.0** | turns(3), rest, river_entry |
| effect_electric | electric | 1 | 1 | ✗ | ✗ | ✗ | 1 | turns(1), rest |
| effect_freeze | freeze | 0 | 1 | **✓** | ✗ | **✓** | 1 | turns(1), collision_with_frozen |
| effect_water | water | 0 | 영구(0) | ✗ | ✗ | ✗ | 1 | on_move, rest |
| effect_sand | sand | 0 | 영구(0) | ✗ | ✗ | ✗ | 1 | on_move, rest |

## §21. 원소 반응 테이블

| 공격 속성 | 대상 효과 | 배율 | 제거 효과 |
|---|---|---|---|
| Fire | freeze | **0** | freeze |
| Water | fire | **1** | fire |
| Ice | fire | **0** | fire |

- 미해당 시 배율 1. 복수 해당 시 순서대로 전부 적용 (배율 곱).
- **배율 0이어도 효과 제거는 발생.** `floor()` 적용.

## §22. 타일 데이터 (10종)

| type | 비용 | 통과불가 | 정지불가 | 턴당피해 | 부여 효과 | 제거 효과 | 전체제거 | 대응 속성 |
|---|---|---|---|---|---|---|---|---|
| plain | 1 | ✗ | ✗ | 0 | — | — | ✗ | None |
| road | 1 | ✗ | ✗ | 0 | — | — | ✗ | None |
| mountain | — | **✓** | — | 0 | — | — | ✗ | None |
| sand | **2** | ✗ | ✗ | 0 | effect_sand | — | ✗ | Sand |
| river | **2** | ✗ | **✓** | 0 | — | — | ✗ | None |
| fire | 1 | ✗ | ✗ | **2** | effect_fire | — | ✗ | Fire |
| water | 1 | ✗ | ✗ | 0 | — | fire, acid | ✗ | Water |
| acid | 1 | ✗ | ✗ | **0** | effect_acid | — | ✗ | Acid |
| electric | 1 | ✗ | ✗ | **1** | effect_electric | — | ✗ | Electric |
| ice | 1 | ✗ | ✗ | 0 | effect_freeze | — | **✓** | Ice |

> ice: 진입 시 전 효과 제거 **후** freeze 부여 (§13 Step 2 순서 1→3).

## §23. 맵 데이터

### map_1v1_6v6 — 전선
- 16×16, 플레이어 2, 팀 크기 1, 인당 최대 6유닛. tileOverrides 없음 (랜덤 지형).
- 스폰: P0 = (1,1),(1,2),(1,3),(2,1),(2,2),(2,3) / P1 = (14,14),(14,13),(14,12),(13,14),(13,13),(13,12)

### map_2v2_6v6 — 팀 격전장
- 16×16, 플레이어 4, 팀 크기 2, 인당 최대 3유닛. 랜덤 지형.
- 스폰: P0 = (1,1),(1,2),(2,1) / P1 = (1,13),(1,14),(2,14) / P2 = (14,1),(14,2),(13,1) / P3 = (14,14),(14,13),(13,14)
- 팀 구성: T0 = {P0, P2}, T1 = {P1, P3} (같은 쪽 모서리 열 기준).

### 랜덤 지형 생성 (tileOverrides 없을 때)
| 지형 | 수량 | 규칙 |
|---|---|---|
| mountain | 양측 각 3 | 스폰 영역 제외, 랜덤 |
| water | 양측 각 3 | 스폰 영역 제외; **연속 3칸 이상이면 river로 승격** |
| 원소 타일 | 전체 3 | fire/acid/electric/ice 중 랜덤 |

`[→ 구현: TerrainGenerator — 05 문서 §3]`

## §24. 승리 조건 및 종료

- §24.1 **즉시 종료** (매 액션 처리 후 + 턴 시작 tick 후 검사):
  - 전멸: 어느 팀의 생존 유닛 0 → 상대 팀 승리. (양 팀 동시 0이면 무승부)
  - 항복: `Surrendered=true` → 즉시 상대 승리.
- §24.2 **라운드 한계**: `Round > 30` → 생존 유닛 수 많은 팀 승리, 동률 무승부.
- §24.3 **연결 끊김**: (네트워크 빌드) 상대 승리. 로컬 빌드는 해당 없음.

`[→ 구현: EndDetector]`

## §25. 상수 일람

| 상수 | 값 | 위치 |
|---|---|---|
| MaxRounds | 30 | GameConstants |
| TurnTimeout | 60초 | GameConstants |
| UnitOrderTimeout | 30초 | GameConstants |
| DraftTimeout | 180초 | GameConstants |
| KnockbackCollisionDamage | 1 | GameConstants |
| RiverPushDamage | 0 | GameConstants |
| DefaultPlayerPriority | 1 | GameConstants |
| 강/모래 이동 비용 | 2 | TileDef (메타데이터) |
| 화염/산성 지속 | 3턴 | EffectDef |
| 감전/빙결 지속 | 1턴 | EffectDef |

## §26. 에러 코드 및 검증 규칙

→ 02 문서 §1-4 `RuleErrorCode` enum + 04 문서 Validator 판정 순서가 규범.
원본 코드 대응: `MOVE_FROZEN→MoveFrozen` 등 기계적 변환.

추가 검증 규칙 요약:
- 공격 방향: 같은 행/열만 (직교 직선).
- 관통 차단: 방패 유닛 적중 후 뒤쪽 미포함.
- 돌진/풀 경로: 전 칸 비어 있어야 (유닛·산 없음).
- 스킬: `UsedOneShotSkills` 포함 시 거부.
- 휴식: `Attacked==false` + 비빙결일 때만 (이동 후 가능, 전제조건 없음, 공격 대신 턴 종료).

---

## 부록 — 복잡 상황 처리 우선순위 (구현 검증 체크리스트)

1. **b2 면역+전파**: 전파(Step 1) 실행, 효과 부여(Step 2) 생략.
2. **b1 화염 치유**: plain 변환 → 회복 → plain 기준 Step 2 (화염 효과 안 받음).
3. **방패+관통**: 방패 유닛 피해 O, 뒤쪽 전파 X.
4. **빙결+타 효과**: freeze 부여 시 기존 효과 전부 선제거.
5. **넉백→강**: `UnitRiverEnter`(전 효과 제거)만, §13 미발동.
6. **반응 배율 0**: 피해 0이어도 효과 제거 발생.
7. **산성 피격**: `(Damage−Armor)` 먼저 → 반응 배율 → ×2.0 → floor.
8. **돌진 중 타일 효과**: 도착 칸 §13 실행, 단 이동 액션 비소모.
