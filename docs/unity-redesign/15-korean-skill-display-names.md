# 15 — 스킬 한글 표시명 복구 기준

> 목적: 이전 8유닛 설계에서 사용하던 한글 스킬/특성 표현을 보존하고, 현재 24유닛 데이터의 `nameKey`/`descKey`에 어떤 한국어 표시명을 붙여야 하는지 명확히 한다.  
> 적용 대상: `packages/metadata/src/i18n.ts`, `UNIT.MD`, Unity `AB.Data`의 `UnitSo`/`WeaponSo`/`PassiveSo` 표시명, UI 스킬 버튼, 툴팁.  
> 주의: 현재 `packages/metadata/data/skills.json`은 빈 배열이다. 현재 게임의 실질적인 스킬은 `WeaponMeta`와 `UnitPassiveMeta`로 표현되어 있으므로, UI에서는 무기/패시브도 “스킬/능력”으로 표시해야 한다.

---

## 1. 왜 이름이 사라진 것처럼 보였나

현재 데이터 구조는 다음처럼 분리되어 있다.

```text
UnitMeta.nameKey       → 유닛 표시명
WeaponMeta.nameKey     → 액티브/무기 스킬 표시명
PassiveMeta.nameKey    → 패시브 스킬 표시명
SkillMeta.nameKey      → 정식 SkillMeta 표시명
```

하지만 현재 `skills.json`은 빈 배열이다. 따라서 “스킬 이름”을 `skills.json`에서만 찾으면 아무것도 나오지 않는다.

실제로 현재 캐릭터 고유 능력은 아래 두 경로에 들어 있다.

```text
UnitMeta.primaryWeaponId / secondaryWeaponId  → 액티브 스킬처럼 표시할 능력
UnitMeta.passiveIds                           → 패시브 스킬처럼 표시할 능력
```

즉, 현재 UI/문서에서 “스킬”이라고 부를 대상은 다음 세 종류다.

| 분류 | 데이터 원천 | UI 표기 |
|---|---|---|
| 기본 공격/액티브 능력 | `WeaponMeta` | 액티브 스킬 / 공격 스킬 |
| 보조 무기 | `secondaryWeaponId` | 보조 스킬 |
| 패시브 | `UnitPassiveMeta` | 패시브 스킬 |

---

## 2. 원래 8유닛 한글 원문

아래 원문은 과거 `test-unit-data.csv`에 있던 8유닛 설계 기준이다. 이 표현을 완전히 버리지 말고 현재 표시명의 근거로 사용한다.

| 유닛 | 원래 attributes 한글 | 원래 skills(weapon skill) 한글 |
|---|---|---|
| `t1` | 방패 | 공격위치에서 타일 효과(불, 산성, 냉기, 전기, 물)를 흡수 하고 공격한 타일에 적용합니다 |
| `f1` | 돌진 — 적 또는 아군에게 돌진합니다. 직선상의 대상에게 이동 거리 관계 없이 돌격합니다. 타일이 올라설 수 있는 경우에 한하며 자신과 돌격 대상 사이에는 어떤 장애물도 없어야 합니다 | 적을 1칸 밀어냅니다 |
| `r1` | 관통 | 한 칸 거리에 있는 타일 효과(불, 산성, 냉기, 전기, 물)를 흡수 하고 공격한 타일에 적용합니다 |
| `t2` | 방패 | 3칸 떨어진 적을 당겨옵니다 |
| `f2` | 돌진 — 적 또는 아군에게 돌진합니다. 직선상의 대상에게 이동 거리 관계 없이 돌격합니다. 타일이 올라설 수 있는 경우에 한하며 자신과 돌격 대상 사이에는 어떤 장애물도 없어야 합니다 | 적을 1칸 밀어냅니다 |
| `r2` | 관통 | 적을 1칸 밀어냅니다 |
| `b1` | 불 효과가 있는 타일에 이동하면 불 효과를 없애고 체력을 1 회복합니다 | 공격 타일에 물 지형을 설정합니다 |
| `b2` | 타일 속성 효과를 입지 않습니다, 항상 순수 공격 데미지만 받습니다 | 속성이 있는 타일에 올라가면, 자신의 인접 1타일에 모든 속성을 적용합니다 |

### 2-1. 보존해야 할 핵심 한글 키워드

| 키워드 | 현재 구현 대응 |
|---|---|
| 방패 | `passive_shield`, 관통 차단 |
| 돌진 | `weapon.rush`, `isRushMovement` |
| 관통 | `rangeType: penetrate`, `penetrating: true` |
| 밀어냄 | `knockback` |
| 당겨옴 | `pull` |
| 타일 효과 흡수 | `adjacentTileAbsorb` 또는 `passive_tile_absorb_attack` |
| 화염 타일 회복 | `passive_fire_affinity` |
| 타일 속성 면역 | 구버전 `immune_tile_effects` 계열. 현재는 일부 유닛에서 `immune_tile_type`/`immune_effect` 등으로 세분화 |
| 속성 전파 | 구버전 `spread_entered_tile_attr`. 현재 24유닛 데이터에서는 직접 사용하는 유닛 없음 |

---

## 3. 현재 WeaponMeta 한글 표시명

이 표의 `표시명`은 UI 버튼명으로 사용한다. `설명`은 툴팁/도감/상세 패널에 사용한다.

| Weapon ID | nameKey | 한글 표시명 | 한글 설명 |
|---|---|---|---|
| `wpn_ta_melee_kb` | `weapon.ta_melee_kb.name` | 방패 밀치기 | 인접 대상을 공격하고 1칸 밀어냅니다. |
| `wpn_fa_rush_kb` | `weapon.fa_rush_kb.name` | 돌진 강타 | 직선상의 대상에게 돌진해 공격하고 1칸 밀어냅니다. |
| `wpn_ra_penetrate_absorb` | `weapon.ra_penetrate_absorb.name` | 속성 흡수 관통사격 | 인접 타일 속성을 흡수한 뒤 직선상의 적을 관통 공격합니다. |
| `wpn_ba_melee_fire` | `weapon.ba_melee_fire.name` | 화염 강타 | 인접 대상을 공격하고 대상 타일을 화염으로 바꿉니다. |
| `wpn_ba_self_ignite` | `weapon.ba_self_ignite.name` | 자기 발화 | 자신의 현재 타일을 화염으로 바꿉니다. |
| `wpn_arc_ricochet` | `weapon.arc_ricochet.name` | 도탄 포격 | 곡사 공격으로 대상과 인접 유닛에게 피해를 줍니다. |
| `wpn_ua_confuse_ranged` | `weapon.ua_confuse_ranged.name` | 원거리 교란 | 대상을 공격하고 원거리 공격을 일시적으로 봉쇄합니다. |
| `wpn_tb_melee_kb` | `weapon.tb_melee_kb.name` | 방패 견제 | 인접 대상을 공격하고 1칸 밀어냅니다. |
| `wpn_hook` | `weapon.hook.name` | 갈고리 당기기 | 3칸 떨어진 직선상의 대상을 자신 쪽으로 끌어옵니다. |
| `wpn_fb_wide_kb` | `weapon.fb_wide_kb.name` | 광역 밀치기 | 대상과 좌우 인접 유닛을 함께 밀어냅니다. |
| `wpn_rb_penetrate_fire` | `weapon.rb_penetrate_fire.name` | 화염 관통사격 | 직선상의 대상을 관통하고 지나간 타일에 화염을 남깁니다. |
| `wpn_bb_melee_kb2` | `weapon.bb_melee_kb2.name` | 강한 밀치기 | 인접 대상을 공격하고 2칸 밀어냅니다. |
| `wpn_ab_arc_fireball` | `weapon.ab_arc_fireball.name` | 화염 포격 | 곡사 공격으로 대상 주변 타일을 화염으로 바꿉니다. |
| `wpn_ub_confuse_melee` | `weapon.ub_confuse_melee.name` | 근접 교란 | 대상을 공격하고 근접 공격을 일시적으로 봉쇄합니다. |
| `wpn_shock_melee` | `weapon.shock_melee.name` | 전격 강타 | 전기 속성 근접 공격을 가하고 전기 체인을 발생시킵니다. |
| `wpn_fc_rush_kb` | `weapon.fc_rush_kb.name` | 돌진 밀치기 | 직선상의 대상에게 돌진해 공격하고 1칸 밀어냅니다. |
| `wpn_rc_shockwave` | `weapon.rc_shockwave.name` | 충격파 사격 | 원거리 대상 주변 유닛을 바깥쪽으로 밀어냅니다. |
| `wpn_bc_water_bomb` | `weapon.bc_water_bomb.name` | 물폭탄 | 대상 및 좌우 타일에 물 지형을 생성합니다. |
| `wpn_uc_pylon` | `weapon.uc_pylon.name` | 전기 파일론 소환 | 지정한 빈 타일에 전기 파일론을 설치합니다. |
| `wpn_td_melee_frost` | `weapon.td_melee_frost.name` | 빙결 강타 | 인접 대상을 얼음 속성으로 공격하고 대상 타일을 빙결로 바꿉니다. |
| `wpn_fd_wide_frost` | `weapon.fd_wide_frost.name` | 서리 휩쓸기 | 대상과 좌우 타일을 함께 빙결로 바꿉니다. |
| `wpn_rd_ice_arrow` | `weapon.rd_ice_arrow.name` | 빙결 관통화살 | 직선상의 대상을 관통하고 지나간 타일을 빙결로 바꿉니다. |
| `wpn_rd_melee` | `weapon.rd_melee.name` | 근접 견제 | 인접 대상을 기본 근접 공격합니다. |
| `wpn_bd_water_convert` | `weapon.bd_water_convert.name` | 수류 전환 | 대상 타일을 물 지형으로 바꿉니다. |
| `wpn_ad_arc_mass` | `weapon.ad_arc_mass.name` | 질량 포격 | 빙결의 피해 차단을 관통하는 곡사 공격입니다. |
| `wpn_ud_frost_tile` | `weapon.ud_frost_tile.name` | 서리 지대 생성 | 자신 또는 인접 타일을 빙결 지형으로 바꿉니다. |

---

## 4. 현재 PassiveMeta 한글 표시명

| Passive ID | nameKey | 한글 표시명 | 한글 설명 |
|---|---|---|---|
| `passive_shield` | `passive.shield.name` | 방패 | 관통 공격의 전파를 차단합니다. |
| `passive_tile_absorb_attack` | `passive.tile_absorb_attack.name` | 속성 흡수 | 공격 시 공격자 위치 또는 선택한 타일의 속성을 흡수해 대상 타일에 적용합니다. |
| `passive_melee_mastery` | `passive.melee_mastery.name` | 근접 숙련 | 근접 공격으로 받는 피해를 1 줄입니다. |
| `passive_fire_affinity` | `passive.fire_affinity.name` | 화염 친화 | 화염 타일에 진입하면 타일을 평지로 바꾸고 체력을 1 회복합니다. |
| `passive_medic` | `passive.medic.name` | 응급 처치 | 턴 시작 시 인접 아군의 체력을 1 회복합니다. 자신은 제외됩니다. |
| `passive_agility` | `passive.agility.name` | 기민함 | 공격 후 이동력 1을 얻고 다시 이동할 수 있습니다. |
| `passive_turn_arson` | `passive.turn_arson.name` | 방화 본능 | 턴 시작 시 인접 적이 있으면 그 적의 타일을 화염으로 바꿉니다. |
| `passive_insulator` | `passive.insulator.name` | 절연체 | 전기 피해에 면역이며 전기 체인 전파를 차단합니다. |
| `passive_generator` | `passive.generator.name` | 전기 증폭기 | 반경 2 안에서 발생하는 전기 피해를 2배로 증폭합니다. |
| `passive_freeze_immunity` | `passive.freeze_immunity.name` | 빙결 면역 | 빙결 효과에 걸리지 않습니다. |
| `passive_amphibious` | `passive.amphibious.name` | 수륙 적응 | 물과 강 타일 효과를 무시합니다. |
| `passive_fire_weakness` | `passive.fire_weakness.name` | 화염 약점 | 화염 피해를 받을 때 추가 피해 1을 받습니다. |
| `passive_cryo_affinity` | `passive.cryo_affinity.name` | 냉기 친화 | 턴 시작 시 인접한 빙결 적 1명마다 체력을 1 회복합니다. |
| `passive_sprinkler` | `passive.sprinkler.name` | 살수 장치 | 턴 시작 시 반경 1의 화염 타일과 화염 상태를 제거합니다. |

---

## 5. 유닛별 UI 표시 기준

유닛 상세 패널에서는 다음 순서로 표시한다.

```text
[기본 공격]
- primaryWeaponId의 nameKey

[보조 스킬]
- secondaryWeaponId가 있으면 secondaryWeaponId의 nameKey

[패시브]
- passiveIds 순서대로 passive nameKey
```

| Unit ID | 기본 공격 | 보조 스킬 | 패시브 표시 |
|---|---|---|---|
| `t1` | 방패 밀치기 | - | 방패, 속성 흡수 |
| `f1` | 돌진 강타 | - | 근접 숙련 |
| `r1` | 속성 흡수 관통사격 | - | - |
| `b1` | 화염 강타 | 자기 발화 | 화염 친화 |
| `a1` | 도탄 포격 | - | - |
| `u1` | 원거리 교란 | - | 응급 처치 |
| `t2` | 방패 견제 | 갈고리 당기기 | 방패 |
| `f2` | 광역 밀치기 | - | 기민함 |
| `r2` | 화염 관통사격 | - | - |
| `b2` | 강한 밀치기 | - | - |
| `a2` | 화염 포격 | - | - |
| `u2` | 근접 교란 | - | 방화 본능 |
| `t3` | 전격 강타 | - | 방패, 절연체 |
| `f3` | 돌진 밀치기 | 전격 강타 | 절연체 |
| `r3` | 충격파 사격 | 전격 강타 | 절연체 |
| `b3` | 물폭탄 | - | 절연체 |
| `a3` | 도탄 포격 | - | 절연체 |
| `u3` | 전기 파일론 소환 | - | 절연체, 전기 증폭기 |
| `t4` | 빙결 강타 | - | 방패, 냉기 친화 |
| `f4` | 서리 휩쓸기 | - | 화염 약점, 냉기 친화 |
| `r4` | 빙결 관통화살 | 근접 견제 | 화염 약점, 냉기 친화 |
| `b4` | 수류 전환 | - | 빙결 면역, 수륙 적응 |
| `a4` | 질량 포격 | - | 냉기 친화, 화염 약점 |
| `u4` | 서리 지대 생성 | 갈고리 당기기 | 살수 장치 |

---

## 6. i18n 구현 규칙

### 6-1. 표시명 조회

UI는 하드코딩 문자열을 직접 쓰지 않는다.

```ts
const unitName = getText(unitMeta.nameKey);
const weaponName = getText(weaponMeta.nameKey);
const passiveName = getText(passiveMeta.nameKey);
```

### 6-2. 누락 방지 테스트

AI가 코딩할 때 다음 테스트를 추가하거나 유지한다.

```ts
for (const unit of registry.getAllUnits()) {
  expect(getText(unit.nameKey)).not.toBe(unit.nameKey);
}

for (const weapon of registry.getAllWeapons()) {
  expect(getText(weapon.nameKey)).not.toBe(weapon.nameKey);
}

for (const passive of registry.getAllUnitPassives()) {
  expect(getText(passive.nameKey)).not.toBe(passive.nameKey);
}
```

현재 `IDataRegistry`에는 `getAllUnitPassives()`가 없고 `getUnitPassive()`/`getUnitPassives(unitMetaId)`만 있으므로, 테스트 편의를 위해 다음 중 하나를 선택한다.

1. `DataRegistry.getAllUnitPassives()` 추가.
2. 모든 유닛의 `passiveIds`를 모아 중복 제거 후 `getUnitPassive(id)`로 검사.

---

## 7. 향후 SkillMeta 정식 사용 시 규칙

현재는 `skills.json`이 비어 있으므로 능력이 `WeaponMeta`/`PassiveMeta`에 있다. 나중에 캐릭터별 고유 스킬 1개를 `SkillMeta`로 분리하면 다음 규칙을 따른다.

```json
{
  "id": "skill_f1_rush_bash",
  "nameKey": "skill.f1_rush_bash.name",
  "descKey": "skill.f1_rush_bash.desc",
  "type": "active",
  "oneShot": true,
  "weaponId": "wpn_fa_rush_kb"
}
```

이때 `skill.*.name`은 반드시 기존 한글 표현을 계승해야 한다.

| 기존 Weapon/Passive | SkillMeta로 승격할 때 권장 Skill ID | 한글명 |
|---|---|---|
| `wpn_fa_rush_kb` | `skill_f1_rush_bash` | 돌진 강타 |
| `wpn_ra_penetrate_absorb` | `skill_r1_absorb_penetrate` | 속성 흡수 관통사격 |
| `wpn_hook` | `skill_t2_hook_pull` | 갈고리 당기기 |
| `wpn_uc_pylon` | `skill_u3_summon_pylon` | 전기 파일론 소환 |
| `wpn_ud_frost_tile` | `skill_u4_frost_tile` | 서리 지대 생성 |
| `passive_fire_affinity` | `skill_b1_fire_affinity` | 화염 친화 |
| `passive_sprinkler` | `skill_u4_sprinkler` | 살수 장치 |

---

## 8. 결론

“스킬 한글 이름”은 완전히 사라진 것이 아니라 다음처럼 흩어져 있었다.

1. 초기 8유닛 한글 설계는 과거 `test-unit-data.csv`에 남아 있었다.
2. 현재 데이터에서는 `skills.json`이 비어 있어 `SkillMeta` 기준 이름은 없다.
3. 현재 실질 스킬은 `WeaponMeta`와 `UnitPassiveMeta`에 있다.
4. 따라서 UI/문서/Unity 이식에서는 `weapon.*.name`, `passive.*.name`, `unit.*.name` 번역을 반드시 복구해야 한다.
