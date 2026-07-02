# Project AB Unit Reference

기준 파일:
- `packages/metadata/data/units.json`
- `packages/metadata/data/weapons.json`
- `packages/metadata/data/unit-passives.json`

표기:
- `이동/HP/방어` = `baseMovement/baseHealth/baseArmor`
- 사거리 `1-1` = 최소 1칸, 최대 1칸
- `보조` = `secondaryWeaponId`

## 전체 유닛 표

| ID | 클래스/팩션 | 이동/HP/방어 | 무기 능력 | 패시브 능력 |
|---|---|---:|---|---|
| `t1` | tanker/a | 3/5/1 | 근접 1칸, 피해 2, 넉백 1 | 관통 차단. 공격 시 공격자 타일 흡수 후 대상 타일에 적용 |
| `f1` | fighter/a | 3/4/0 | 근접 1칸, 피해 2, 돌진, 넉백 1 | 근접 피해 1 감소 |
| `r1` | ranger/a | 2/4/0 | 원거리 2-4칸, 피해 3, 관통, 인접 타일 흡수 | 없음 |
| `b1` | brute/a | 3/5/0 | 근접 1칸, 피해 1, 화염 타일 적용. 보조: 자기 타일 화염 적용 | 화염 타일 진입 시 plain 변환 + 자신 HP 1 회복 |
| `a1` | artillery/a | 2/4/0 | 곡사 2-5칸, 피해 2, 주변 splash 피해 1 | 없음 |
| `u1` | utility/a | 4/4/0 | 원거리 2-3칸, 피해 1, 원거리 공격 봉쇄 | 턴 시작 시 인접 아군 HP 1 회복, 자신 제외 |
| `t2` | tanker/b | 3/5/1 | 근접 1칸, 피해 1, 넉백 1. 보조: 3칸 pull | 관통 차단 |
| `f2` | fighter/b | 3/4/0 | 근접 1칸, 피해 2, 좌우 포함 넉백 1 | 공격 시 추가 이동 1 |
| `r2` | ranger/b | 2/4/0 | 원거리 2-4칸, 피해 2, 관통, 화염 타일 적용 | 없음 |
| `b2` | brute/b | 3/4/0 | 근접 1칸, 피해 1, 넉백 2 | 없음 |
| `a2` | artillery/b | 2/4/0 | 곡사 2-4칸, 피해 2, 주변 화염 타일 적용 | 없음 |
| `u2` | utility/b | 4/4/0 | 원거리 1칸, 피해 1, 근접 공격 봉쇄 | 턴 시작 시 인접 적 타일에 화염 적용 |
| `t3` | tanker/c | 3/5/1 | 근접 1칸, 전기 피해 1, chain shock | 관통 차단. 전기 피해 면역 + 전기 전도 차단 |
| `f3` | fighter/c | 3/4/0 | 근접 1칸, 피해 1, 돌진, 넉백 1. 보조: 전기 근접 chain shock | 전기 피해 면역 + 전기 전도 차단 |
| `r3` | ranger/c | 2/4/0 | 원거리 2-4칸, 피해 1, 인접 넉백 1. 보조: 전기 근접 chain shock | 전기 피해 면역 + 전기 전도 차단 |
| `b3` | brute/c | 3/5/0 | 근접 1칸, 피해 0, 물 타일 적용 | 전기 피해 면역 + 전기 전도 차단 |
| `a3` | artillery/c | 2/4/0 | 곡사 2-5칸, 피해 2, 주변 splash 피해 1 | 전기 피해 면역 + 전기 전도 차단 |
| `u3` | utility/c | 2/4/0 | 특수 1-4칸, 전기 파일론 소환 | 전기 피해 면역 + 전기 전도 차단. 반경 2 전기 피해 2배 증폭 |
| `t4` | tanker/d | 3/5/1 | 근접 1칸, 얼음 피해 1, 빙결 타일 적용 | 관통 차단. 인접 빙결 적마다 자신 HP 1 회복 |
| `f4` | fighter/d | 3/4/0 | 근접 1칸, 얼음 피해 1, 좌우 포함 빙결 타일 적용 | 화염 피해 +1. 인접 빙결 적마다 자신 HP 1 회복 |
| `r4` | ranger/d | 2/4/0 | 원거리 1칸, 얼음 피해 2, 관통, 빙결 타일 적용. 보조: 근접 피해 1 | 화염 피해 +1. 인접 빙결 적마다 자신 HP 1 회복 |
| `b4` | brute/d | 3/4/0 | 근접 1칸, 피해 1, 대상 타일 water 변환 | 빙결 면역. water/river 타일 면역 |
| `a4` | artillery/d | 2/4/0 | 곡사 2-4칸, 피해 2, 빙결 관통 | 인접 빙결 적마다 자신 HP 1 회복. 화염 피해 +1 |
| `u4` | utility/d | 2/4/0 | 특수 0-1칸, 빙결 타일 적용. 보조: 3칸 pull | 턴 시작 시 반경 1 화염 타일 제거 + 화염 유닛 효과 제거 |

## 소환물

| ID | 클래스/팩션 | 이동/HP/방어 | 능력 |
|---|---|---:|---|
| `obstacle_electric_pylon` | obstacle/neutral | 0/2/0 | `u3`가 소환. 무기 없음. 패시브 없음 |

## 무기 상세

| ID | 효과 |
|---|---|
| `wpn_ta_melee_kb` | 근접 1칸, 피해 2, 넉백 1 |
| `wpn_fa_rush_kb` | 근접 1칸, 피해 2, 돌진, 넉백 1 |
| `wpn_ra_penetrate_absorb` | 원거리 2-4칸, 피해 3, 관통, 인접 타일 흡수 |
| `wpn_ba_melee_fire` | 근접 1칸, 피해 1, 대상 타일 화염 적용 |
| `wpn_ba_self_ignite` | 특수 자기 대상, 피해 0, 자기 타일 화염 적용 |
| `wpn_arc_ricochet` | 원거리 곡사 2-5칸, 피해 2, 대상 주변 splash 피해 1 |
| `wpn_ua_confuse_ranged` | 원거리 2-3칸, 피해 1, 대상의 원거리 공격 봉쇄 |
| `wpn_tb_melee_kb` | 근접 1칸, 피해 1, 넉백 1 |
| `wpn_hook` | 특수 3칸, 피해 0, clear path 필요, 대상을 인접 타일로 pull |
| `wpn_fb_wide_kb` | 근접 1칸, 피해 2, 대상 및 좌우 방향 넉백 1 |
| `wpn_rb_penetrate_fire` | 원거리 2-4칸, 피해 2, 관통, 지나간 타일에 화염 적용 |
| `wpn_bb_melee_kb2` | 근접 1칸, 피해 1, 넉백 2 |
| `wpn_ab_arc_fireball` | 원거리 곡사 2-4칸, 피해 2, 대상 주변 타일에 화염 적용 |
| `wpn_ub_confuse_melee` | 원거리 1칸, 피해 1, 대상의 근접 공격 봉쇄 |
| `wpn_shock_melee` | 근접 1칸, 전기 피해 1, chain shock |
| `wpn_fc_rush_kb` | 근접 1칸, 피해 1, 돌진, 넉백 1 |
| `wpn_rc_shockwave` | 원거리 2-4칸, 피해 1, 대상 인접 유닛 넉백 1 |
| `wpn_bc_water_bomb` | 근접 1칸, 피해 0, 대상 및 좌우 타일에 물 적용 |
| `wpn_uc_pylon` | 특수 1-4칸, 전기 파일론 소환 |
| `wpn_td_melee_frost` | 근접 1칸, 얼음 피해 1, 대상 타일 빙결 적용 |
| `wpn_fd_wide_frost` | 근접 1칸, 얼음 피해 1, 대상 및 좌우 타일 빙결 적용 |
| `wpn_rd_ice_arrow` | 원거리 1칸, 얼음 피해 2, 관통, 지나간 타일에 빙결 적용 |
| `wpn_rd_melee` | 근접 1칸, 피해 1 |
| `wpn_bd_water_convert` | 근접 1칸, 피해 1, 대상 타일 water 변환 |
| `wpn_ad_arc_mass` | 원거리 곡사 2-4칸, 피해 2, 빙결 상태 관통 |
| `wpn_ud_frost_tile` | 특수 0-1칸, 피해 0, 대상 타일 빙결 적용, 자기 대상 가능 |

## 패시브 상세

| ID | 효과 |
|---|---|
| `passive_shield` | 관통 공격 전파 차단 |
| `passive_tile_absorb_attack` | 공격 시 공격자 위치의 타일 속성을 흡수해 대상 타일에 적용 |
| `passive_melee_mastery` | 근접 공격으로 받는 피해 1 감소 |
| `passive_fire_affinity` | 화염 타일 진입 시 타일을 plain으로 바꾸고 자신 HP 1 회복 |
| `passive_medic` | 턴 시작 시 반경 1 인접 아군 HP 1 회복, 자신 제외 |
| `passive_agility` | 공격 시 추가 이동 1 획득 |
| `passive_turn_arson` | 턴 시작 시 인접 적이 있으면 그 적의 타일에 화염 적용 |
| `passive_insulator` | 전기 피해 면역. 전기 chain conductor 역할 차단 |
| `passive_generator` | 반경 2 안 전기 피해 2배 증폭 |
| `passive_freeze_immunity` | 빙결 효과 면역 |
| `passive_amphibious` | water/river 타일 면역 |
| `passive_fire_weakness` | 화염 피해를 받을 때 추가 피해 1 |
| `passive_cryo_affinity` | 턴 시작 시 인접 빙결 적 1명마다 자신 HP 1 회복 |
| `passive_sprinkler` | 턴 시작 시 반경 1 화염 타일 제거 + 반경 1 유닛 화염 효과 제거 |
