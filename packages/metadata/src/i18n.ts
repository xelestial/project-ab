// ============================================================
// P-07: Central i18n helper — all user-visible text goes through getText()
// ============================================================

import type { Locale } from "./schemas/index.js";
export type { Locale };

type TranslationMap = Record<string, string>;
type Translations = Record<Locale, TranslationMap>;

const translations: Translations = {
  ko: {
    // Movement errors
    "error.move.out_of_range": "이동 범위를 벗어났습니다.",
    "error.move.blocked_mountain": "산악 지형으로 이동할 수 없습니다.",
    "error.move.blocked_unit": "해당 위치에 멈출 수 없습니다.",
    "error.move.insufficient_mp": "이동력이 부족합니다.",
    "error.move.already_moved": "이미 이동을 완료했습니다.",
    "error.move.frozen": "빙결 상태에서는 행동할 수 없습니다.",
    "error.move.no_path": "경로를 찾을 수 없습니다.",

    // Attack errors
    "error.attack.out_of_range": "공격 범위를 벗어났습니다.",
    "error.attack.no_los": "시야가 차단되어 있습니다.",
    "error.attack.already_attacked": "이미 공격을 완료했습니다.",
    "error.attack.frozen": "빙결 상태에서는 공격할 수 없습니다.",
    "error.attack.invalid_target": "유효하지 않은 대상입니다.",

    // Skill errors
    "error.skill.not_found": "스킬을 찾을 수 없습니다.",
    "error.skill.already_used": "이미 스킬을 사용했습니다.",
    "error.skill.frozen": "빙결 상태에서는 스킬을 사용할 수 없습니다.",

    // Draft errors
    "error.draft.timeout": "드래프트 시간이 초과되었습니다.",
    "error.draft.slot_occupied": "이미 배치된 위치입니다.",
    "error.draft.invalid_unit": "유효하지 않은 유닛입니다.",
    "error.draft.phase_over": "드래프트 단계가 종료되었습니다.",

    // Turn / Phase
    "error.turn.not_your_turn": "현재 차례가 아닙니다.",
    "error.turn.invalid_phase": "현재 페이즈에서 불가능한 행동입니다.",

    // Extinguish
    "error.extinguish.not_on_fire": "화염 상태가 아닙니다.",
    "error.extinguish.already_acted": "이미 행동을 완료했습니다.",

    // Generic
    "error.internal": "내부 오류가 발생했습니다.",
    "error.unknown.unit": "알 수 없는 유닛입니다.",
    "error.unknown.weapon": "알 수 없는 무기입니다.",
    "error.unknown.effect": "알 수 없는 효과입니다.",
    "error.unknown.map": "알 수 없는 맵입니다.",

    // Game phases
    "phase.draft": "드래프트",
    "phase.battle": "전투",
    "phase.result": "결과",

    // Turn labels
    "turn.your_turn": "내 차례",
    "turn.opponent_turn": "상대 차례",
    "turn.round": "{round}라운드",

    // End conditions
    "end.all_units_dead": "모든 유닛 전멸",
    "end.round_limit": "라운드 제한 도달",
    "end.surrender": "항복",
    "end.disconnect": "연결 끊김",
    "end.winner": "{player}의 승리!",
    "end.draw": "무승부",

    // Unit stats
    "stat.health": "체력",
    "stat.armor": "방어력",
    "stat.movement": "이동력",

    // Unit display names
    "unit.t1.name": "방패병 A",
    "unit.t1.desc": "관통을 막고 타일 속성을 흡수해 역이용하는 탱커입니다.",
    "unit.f1.name": "돌격병 A",
    "unit.f1.desc": "직선 돌진과 넉백으로 전선을 여는 근접 전투원입니다.",
    "unit.r1.name": "관통사수 A",
    "unit.r1.desc": "인접 타일 속성을 흡수해 관통 사격에 실어 보내는 원거리 유닛입니다.",
    "unit.b1.name": "화염투사 A",
    "unit.b1.desc": "화염 타일을 만들고 화염 지형에서 회복하는 브루트입니다.",
    "unit.a1.name": "도탄포수 A",
    "unit.a1.desc": "곡사와 인접 스플래시 피해로 뭉친 적을 견제합니다.",
    "unit.u1.name": "의무교란병 A",
    "unit.u1.desc": "아군을 회복하고 적의 원거리 공격을 봉쇄하는 지원 유닛입니다.",
    "unit.t2.name": "방패병 B",
    "unit.t2.desc": "관통을 막고 갈고리로 원거리 적을 끌어오는 탱커입니다.",
    "unit.f2.name": "광역돌격병 B",
    "unit.f2.desc": "좌우까지 밀어내는 넉백과 공격 후 추가 이동을 사용합니다.",
    "unit.r2.name": "화염관통사수 B",
    "unit.r2.desc": "관통 사격으로 적과 경로 타일에 화염을 남기는 원거리 유닛입니다.",
    "unit.b2.name": "강타병 B",
    "unit.b2.desc": "강한 2칸 넉백으로 적 위치를 무너뜨리는 브루트입니다.",
    "unit.a2.name": "화염포수 B",
    "unit.a2.desc": "곡사로 대상 주변 타일에 화염을 퍼뜨립니다.",
    "unit.u2.name": "방화교란병 B",
    "unit.u2.desc": "인접 적의 발밑을 불태우고 근접 공격을 봉쇄합니다.",
    "unit.t3.name": "전격방패병 C",
    "unit.t3.desc": "전기 체인을 차단하면서 전격 근접 공격을 사용하는 탱커입니다.",
    "unit.f3.name": "절연돌격병 C",
    "unit.f3.desc": "전기 피해에 면역이며 돌진과 전격 보조 공격을 사용합니다.",
    "unit.r3.name": "충격파사수 C",
    "unit.r3.desc": "원거리 충격파와 전격 보조 공격으로 위치를 흔듭니다.",
    "unit.b3.name": "물폭탄병 C",
    "unit.b3.desc": "물 타일을 만들어 화염과 산성을 제어하는 브루트입니다.",
    "unit.a3.name": "절연포수 C",
    "unit.a3.desc": "곡사 스플래시를 사용하며 전기 피해와 체인에 강합니다.",
    "unit.u3.name": "전기공병 C",
    "unit.u3.desc": "전기 파일론을 설치하고 주변 전기 피해를 증폭합니다.",
    "unit.t4.name": "빙결방패병 D",
    "unit.t4.desc": "빙결 타일을 만들고 얼어붙은 적 근처에서 회복하는 탱커입니다.",
    "unit.f4.name": "서리전투병 D",
    "unit.f4.desc": "좌우를 함께 얼리는 근접 공격을 사용하지만 화염에 취약합니다.",
    "unit.r4.name": "빙결관통사수 D",
    "unit.r4.desc": "빙결 관통사격으로 직선상의 타일과 대상을 얼립니다.",
    "unit.b4.name": "수류전환병 D",
    "unit.b4.desc": "대상 타일을 물로 바꾸고 물과 강 지형에 면역입니다.",
    "unit.a4.name": "질량포수 D",
    "unit.a4.desc": "빙결 피해 차단을 관통하는 곡사 공격을 사용합니다.",
    "unit.u4.name": "살수빙결술사 D",
    "unit.u4.desc": "빙결 타일을 만들고 주변 화염 타일과 화염 효과를 제거합니다.",
    "obstacle.electric_pylon.name": "전기 파일론",
    "obstacle.electric_pylon.desc": "전기 체인을 전달할 수 있는 소환 장애물입니다.",

    // Weapon / active ability display names
    "weapon.ta_melee_kb.name": "방패 밀치기",
    "weapon.ta_melee_kb.desc": "인접 대상을 공격하고 1칸 밀어냅니다.",
    "weapon.fa_rush_kb.name": "돌진 강타",
    "weapon.fa_rush_kb.desc": "직선상의 대상에게 돌진해 공격하고 1칸 밀어냅니다.",
    "weapon.ra_penetrate_absorb.name": "속성 흡수 관통사격",
    "weapon.ra_penetrate_absorb.desc": "인접 타일 속성을 흡수한 뒤 직선상의 적을 관통 공격합니다.",
    "weapon.ba_melee_fire.name": "화염 강타",
    "weapon.ba_melee_fire.desc": "인접 대상을 공격하고 대상 타일을 화염으로 바꿉니다.",
    "weapon.ba_self_ignite.name": "자기 발화",
    "weapon.ba_self_ignite.desc": "자신의 현재 타일을 화염으로 바꿉니다.",
    "weapon.arc_ricochet.name": "도탄 포격",
    "weapon.arc_ricochet.desc": "곡사 공격으로 대상과 인접 유닛에게 피해를 줍니다.",
    "weapon.ua_confuse_ranged.name": "원거리 교란",
    "weapon.ua_confuse_ranged.desc": "대상을 공격하고 원거리 공격을 일시적으로 봉쇄합니다.",
    "weapon.tb_melee_kb.name": "방패 견제",
    "weapon.tb_melee_kb.desc": "인접 대상을 공격하고 1칸 밀어냅니다.",
    "weapon.hook.name": "갈고리 당기기",
    "weapon.hook.desc": "3칸 떨어진 직선상의 대상을 자신 쪽으로 끌어옵니다.",
    "weapon.fb_wide_kb.name": "광역 밀치기",
    "weapon.fb_wide_kb.desc": "대상과 좌우 인접 유닛을 함께 밀어냅니다.",
    "weapon.rb_penetrate_fire.name": "화염 관통사격",
    "weapon.rb_penetrate_fire.desc": "직선상의 대상을 관통하고 지나간 타일에 화염을 남깁니다.",
    "weapon.bb_melee_kb2.name": "강한 밀치기",
    "weapon.bb_melee_kb2.desc": "인접 대상을 공격하고 2칸 밀어냅니다.",
    "weapon.ab_arc_fireball.name": "화염 포격",
    "weapon.ab_arc_fireball.desc": "곡사 공격으로 대상 주변 타일을 화염으로 바꿉니다.",
    "weapon.ub_confuse_melee.name": "근접 교란",
    "weapon.ub_confuse_melee.desc": "대상을 공격하고 근접 공격을 일시적으로 봉쇄합니다.",
    "weapon.shock_melee.name": "전격 강타",
    "weapon.shock_melee.desc": "전기 속성 근접 공격을 가하고 전기 체인을 발생시킵니다.",
    "weapon.fc_rush_kb.name": "돌진 밀치기",
    "weapon.fc_rush_kb.desc": "직선상의 대상에게 돌진해 공격하고 1칸 밀어냅니다.",
    "weapon.rc_shockwave.name": "충격파 사격",
    "weapon.rc_shockwave.desc": "원거리 대상 주변 유닛을 바깥쪽으로 밀어냅니다.",
    "weapon.bc_water_bomb.name": "물폭탄",
    "weapon.bc_water_bomb.desc": "대상 및 좌우 타일에 물 지형을 생성합니다.",
    "weapon.uc_pylon.name": "전기 파일론 소환",
    "weapon.uc_pylon.desc": "지정한 빈 타일에 전기 파일론을 설치합니다.",
    "weapon.td_melee_frost.name": "빙결 강타",
    "weapon.td_melee_frost.desc": "인접 대상을 얼음 속성으로 공격하고 대상 타일을 빙결로 바꿉니다.",
    "weapon.fd_wide_frost.name": "서리 휩쓸기",
    "weapon.fd_wide_frost.desc": "대상과 좌우 타일을 함께 빙결로 바꿉니다.",
    "weapon.rd_ice_arrow.name": "빙결 관통화살",
    "weapon.rd_ice_arrow.desc": "직선상의 대상을 관통하고 지나간 타일을 빙결로 바꿉니다.",
    "weapon.rd_melee.name": "근접 견제",
    "weapon.rd_melee.desc": "인접 대상을 기본 근접 공격합니다.",
    "weapon.bd_water_convert.name": "수류 전환",
    "weapon.bd_water_convert.desc": "대상 타일을 물 지형으로 바꿉니다.",
    "weapon.ad_arc_mass.name": "질량 포격",
    "weapon.ad_arc_mass.desc": "빙결의 피해 차단을 관통하는 곡사 공격입니다.",
    "weapon.ud_frost_tile.name": "서리 지대 생성",
    "weapon.ud_frost_tile.desc": "자신 또는 인접 타일을 빙결 지형으로 바꿉니다.",

    // Passive display names
    "passive.shield.name": "방패",
    "passive.shield.desc": "관통 공격의 전파를 차단합니다.",
    "passive.tile_absorb_attack.name": "속성 흡수",
    "passive.tile_absorb_attack.desc": "공격 시 공격자 위치 또는 선택한 타일의 속성을 흡수해 대상 타일에 적용합니다.",
    "passive.melee_mastery.name": "근접 숙련",
    "passive.melee_mastery.desc": "근접 공격으로 받는 피해를 1 줄입니다.",
    "passive.fire_affinity.name": "화염 친화",
    "passive.fire_affinity.desc": "화염 타일에 진입하면 타일을 평지로 바꾸고 체력을 1 회복합니다.",
    "passive.medic.name": "응급 처치",
    "passive.medic.desc": "턴 시작 시 인접 아군의 체력을 1 회복합니다. 자신은 제외됩니다.",
    "passive.agility.name": "기민함",
    "passive.agility.desc": "공격 후 이동력 1을 얻고 다시 이동할 수 있습니다.",
    "passive.turn_arson.name": "방화 본능",
    "passive.turn_arson.desc": "턴 시작 시 인접 적이 있으면 그 적의 타일을 화염으로 바꿉니다.",
    "passive.insulator.name": "절연체",
    "passive.insulator.desc": "전기 피해에 면역이며 전기 체인 전파를 차단합니다.",
    "passive.generator.name": "전기 증폭기",
    "passive.generator.desc": "반경 2 안에서 발생하는 전기 피해를 2배로 증폭합니다.",
    "passive.freeze_immunity.name": "빙결 면역",
    "passive.freeze_immunity.desc": "빙결 효과에 걸리지 않습니다.",
    "passive.amphibious.name": "수륙 적응",
    "passive.amphibious.desc": "물과 강 타일 효과를 무시합니다.",
    "passive.fire_weakness.name": "화염 약점",
    "passive.fire_weakness.desc": "화염 피해를 받을 때 추가 피해 1을 받습니다.",
    "passive.cryo_affinity.name": "냉기 친화",
    "passive.cryo_affinity.desc": "턴 시작 시 인접한 빙결 적 1명마다 체력을 1 회복합니다.",
    "passive.sprinkler.name": "살수 장치",
    "passive.sprinkler.desc": "턴 시작 시 반경 1의 화염 타일과 화염 상태를 제거합니다.",

    // Effects — legacy generic keys
    "effect.freeze": "빙결",
    "effect.fire": "화염",
    "effect.acid": "산성",
    "effect.water": "물",
    "effect.sand": "모래",
    "effect.electric": "감전",

    // Effect metadata keys
    "effect.freeze.name": "빙결",
    "effect.freeze.desc": "행동할 수 없고 피해를 막지만, 피격되거나 충돌하면 해제됩니다.",
    "effect.fire.name": "화염",
    "effect.fire.desc": "턴 시작 시 피해를 받습니다. 수동 소화 또는 강 진입으로 제거됩니다.",
    "effect.acid.name": "산성",
    "effect.acid.desc": "턴 시작 시 피해를 받고, 적용 시 현재 타일도 산성화됩니다.",
    "effect.water.name": "물",
    "effect.water.desc": "젖은 상태입니다. 이동하면 제거됩니다.",
    "effect.sand.name": "모래",
    "effect.sand.desc": "모래가 묻은 상태입니다. 이동하면 제거됩니다.",
    "effect.electric.name": "감전",
    "effect.electric.desc": "턴 시작 시 전기 피해를 받고 1턴 후 제거됩니다.",
    "effect.stun.name": "기절",
    "effect.stun.desc": "모든 행동이 차단됩니다. 1턴 후 제거됩니다.",
    "effect.confused_ranged.name": "원거리 교란",
    "effect.confused_ranged.desc": "원거리 공격 타입을 사용할 수 없습니다.",
    "effect.confused_melee.name": "근접 교란",
    "effect.confused_melee.desc": "근접 공격 타입을 사용할 수 없습니다.",

    // Tile attributes — legacy generic keys
    "tile.road": "도로",
    "tile.plain": "평지",
    "tile.mountain": "산악",
    "tile.sand": "모래",
    "tile.river": "강",
    "tile.fire": "화염 타일",
    "tile.water": "물 타일",
    "tile.acid": "산성 타일",
    "tile.electric": "감전 타일",
    "tile.ice": "빙결 타일",

    // Tile metadata keys
    "tile.road.name": "도로",
    "tile.road.desc": "기본 이동 비용 1의 도로 타일입니다.",
    "tile.plain.name": "평지",
    "tile.plain.desc": "기본 이동 비용 1의 일반 타일입니다.",
    "tile.mountain.name": "산악",
    "tile.mountain.desc": "이동할 수 없는 장애물 타일입니다. 곡사 공격의 장애물로도 계산됩니다.",
    "tile.sand.name": "모래",
    "tile.sand.desc": "이동 비용 2이며 진입 시 모래 효과를 부여합니다.",
    "tile.river.name": "강",
    "tile.river.desc": "이동 비용 2이며 정지할 수 없습니다. 넉백으로 진입하면 모든 효과가 제거됩니다.",
    "tile.fire.name": "화염 타일",
    "tile.fire.desc": "진입 시 화염 효과를 부여하고 턴 시작 시 피해를 줍니다.",
    "tile.water.name": "물 타일",
    "tile.water.desc": "진입 시 화염과 산성 효과를 제거합니다.",
    "tile.acid.name": "산성 타일",
    "tile.acid.desc": "진입 시 산성 효과를 부여하고 턴 시작 시 피해를 줍니다.",
    "tile.electric.name": "감전 타일",
    "tile.electric.desc": "진입 시 감전 효과를 부여하고 턴 시작 시 피해를 줍니다.",
    "tile.ice.name": "빙결 타일",
    "tile.ice.desc": "진입 시 기존 효과를 모두 제거한 뒤 빙결 효과를 부여합니다.",
  },
  en: {
    // Movement errors
    "error.move.out_of_range": "Out of movement range.",
    "error.move.blocked_mountain": "Cannot move onto mountain terrain.",
    "error.move.blocked_unit": "Cannot stop on that position.",
    "error.move.insufficient_mp": "Insufficient movement points.",
    "error.move.already_moved": "Already moved this turn.",
    "error.move.frozen": "Cannot act while frozen.",
    "error.move.no_path": "No valid path found.",

    // Attack errors
    "error.attack.out_of_range": "Target is out of attack range.",
    "error.attack.no_los": "Line of sight is blocked.",
    "error.attack.already_attacked": "Already attacked this turn.",
    "error.attack.frozen": "Cannot attack while frozen.",
    "error.attack.invalid_target": "Invalid target.",

    // Skill errors
    "error.skill.not_found": "Skill not found.",
    "error.skill.already_used": "Skill already used this game.",
    "error.skill.frozen": "Cannot use skills while frozen.",

    // Draft errors
    "error.draft.timeout": "Draft timed out.",
    "error.draft.slot_occupied": "Position already occupied.",
    "error.draft.invalid_unit": "Invalid unit selection.",
    "error.draft.phase_over": "Draft phase has ended.",

    // Turn / Phase
    "error.turn.not_your_turn": "It is not your turn.",
    "error.turn.invalid_phase": "Action not available in this phase.",

    // Extinguish
    "error.extinguish.not_on_fire": "Unit is not on fire.",
    "error.extinguish.already_acted": "Already performed an action.",

    // Generic
    "error.internal": "An internal error occurred.",
    "error.unknown.unit": "Unknown unit.",
    "error.unknown.weapon": "Unknown weapon.",
    "error.unknown.effect": "Unknown effect.",
    "error.unknown.map": "Unknown map.",

    // Game phases
    "phase.draft": "Draft",
    "phase.battle": "Battle",
    "phase.result": "Result",

    // Turn labels
    "turn.your_turn": "Your Turn",
    "turn.opponent_turn": "Opponent's Turn",
    "turn.round": "Round {round}",

    // End conditions
    "end.all_units_dead": "All Units Eliminated",
    "end.round_limit": "Round Limit Reached",
    "end.surrender": "Surrender",
    "end.disconnect": "Disconnected",
    "end.winner": "{player} Wins!",
    "end.draw": "Draw",

    // Unit stats
    "stat.health": "Health",
    "stat.armor": "Armor",
    "stat.movement": "Movement",

    // Unit display names
    "unit.t1.name": "Shield Tanker A",
    "unit.t1.desc": "A tanker that blocks penetration and absorbs tile attributes.",
    "unit.f1.name": "Rush Fighter A",
    "unit.f1.desc": "A melee fighter that opens the line with rush and knockback.",
    "unit.r1.name": "Absorb Ranger A",
    "unit.r1.desc": "A ranger that absorbs adjacent tile attributes into penetrating shots.",
    "unit.b1.name": "Fire Brute A",
    "unit.b1.desc": "A brute that creates fire tiles and heals from fire terrain.",
    "unit.a1.name": "Ricochet Artillery A",
    "unit.a1.desc": "An artillery unit that uses arcing splash attacks.",
    "unit.u1.name": "Medic Disruptor A",
    "unit.u1.desc": "A support unit that heals allies and blocks enemy ranged attacks.",
    "unit.t2.name": "Shield Tanker B",
    "unit.t2.desc": "A tanker that blocks penetration and pulls enemies with a hook.",
    "unit.f2.name": "Wide Rush Fighter B",
    "unit.f2.desc": "A fighter that knocks back the target and side units, then gains extra movement.",
    "unit.r2.name": "Fire Penetration Ranger B",
    "unit.r2.desc": "A ranger that leaves fire tiles through a penetrating shot.",
    "unit.b2.name": "Heavy Knockback Brute B",
    "unit.b2.desc": "A brute that disrupts enemy positions with 2-tile knockback.",
    "unit.a2.name": "Fireball Artillery B",
    "unit.a2.desc": "An artillery unit that spreads fire around the target.",
    "unit.u2.name": "Arson Disruptor B",
    "unit.u2.desc": "A support unit that ignites adjacent enemy tiles and blocks melee attacks.",
    "unit.t3.name": "Shock Shield Tanker C",
    "unit.t3.desc": "A tanker that blocks electric chains and uses shock melee attacks.",
    "unit.f3.name": "Insulated Rush Fighter C",
    "unit.f3.desc": "A fighter with electric immunity, rush, and shock secondary attacks.",
    "unit.r3.name": "Shockwave Ranger C",
    "unit.r3.desc": "A ranger that pushes nearby units with shockwave shots.",
    "unit.b3.name": "Water Bomb Brute C",
    "unit.b3.desc": "A brute that creates water tiles to control fire and acid.",
    "unit.a3.name": "Insulated Artillery C",
    "unit.a3.desc": "An artillery unit resistant to electric damage and chain propagation.",
    "unit.u3.name": "Pylon Engineer C",
    "unit.u3.desc": "An engineer that summons electric pylons and amplifies electric damage.",
    "unit.t4.name": "Frost Shield Tanker D",
    "unit.t4.desc": "A tanker that creates ice tiles and heals near frozen enemies.",
    "unit.f4.name": "Frost Fighter D",
    "unit.f4.desc": "A fighter that freezes a wide area but is vulnerable to fire.",
    "unit.r4.name": "Ice Penetration Ranger D",
    "unit.r4.desc": "A ranger that freezes targets and tiles with penetrating ice shots.",
    "unit.b4.name": "Water Converter Brute D",
    "unit.b4.desc": "A brute that converts tiles to water and ignores water/river effects.",
    "unit.a4.name": "Mass Artillery D",
    "unit.a4.desc": "An artillery unit whose attack pierces freeze damage blocking.",
    "unit.u4.name": "Sprinkler Frost Utility D",
    "unit.u4.desc": "A support unit that creates ice tiles and removes nearby fire.",
    "obstacle.electric_pylon.name": "Electric Pylon",
    "obstacle.electric_pylon.desc": "A summoned obstacle that can relay electric chain effects.",

    // Weapon / active ability display names
    "weapon.ta_melee_kb.name": "Shield Bash",
    "weapon.ta_melee_kb.desc": "Attack an adjacent target and knock it back 1 tile.",
    "weapon.fa_rush_kb.name": "Rush Bash",
    "weapon.fa_rush_kb.desc": "Rush to a straight-line target, attack it, and knock it back 1 tile.",
    "weapon.ra_penetrate_absorb.name": "Absorb Penetrating Shot",
    "weapon.ra_penetrate_absorb.desc": "Absorb an adjacent tile attribute and fire a penetrating shot.",
    "weapon.ba_melee_fire.name": "Fire Bash",
    "weapon.ba_melee_fire.desc": "Attack an adjacent target and turn its tile into fire.",
    "weapon.ba_self_ignite.name": "Self Ignite",
    "weapon.ba_self_ignite.desc": "Turn the user's current tile into fire.",
    "weapon.arc_ricochet.name": "Ricochet Artillery",
    "weapon.arc_ricochet.desc": "Arc a shot that damages the target and nearby units.",
    "weapon.ua_confuse_ranged.name": "Ranged Disruption",
    "weapon.ua_confuse_ranged.desc": "Attack a target and temporarily block ranged attacks.",
    "weapon.tb_melee_kb.name": "Shield Check",
    "weapon.tb_melee_kb.desc": "Attack an adjacent target and knock it back 1 tile.",
    "weapon.hook.name": "Hook Pull",
    "weapon.hook.desc": "Pull a target 3 tiles away in a straight line toward the user.",
    "weapon.fb_wide_kb.name": "Wide Knockback",
    "weapon.fb_wide_kb.desc": "Knock back the target and side-adjacent units.",
    "weapon.rb_penetrate_fire.name": "Fire Penetrating Shot",
    "weapon.rb_penetrate_fire.desc": "Fire a penetrating shot that leaves fire tiles along the line.",
    "weapon.bb_melee_kb2.name": "Heavy Knockback",
    "weapon.bb_melee_kb2.desc": "Attack an adjacent target and knock it back 2 tiles.",
    "weapon.ab_arc_fireball.name": "Fireball Artillery",
    "weapon.ab_arc_fireball.desc": "Arc a shot that turns nearby target tiles into fire.",
    "weapon.ub_confuse_melee.name": "Melee Disruption",
    "weapon.ub_confuse_melee.desc": "Attack a target and temporarily block melee attacks.",
    "weapon.shock_melee.name": "Shock Bash",
    "weapon.shock_melee.desc": "Make an electric melee attack that can trigger chain shock.",
    "weapon.fc_rush_kb.name": "Rush Knockback",
    "weapon.fc_rush_kb.desc": "Rush to a straight-line target, attack it, and knock it back 1 tile.",
    "weapon.rc_shockwave.name": "Shockwave Shot",
    "weapon.rc_shockwave.desc": "Push units adjacent to the target outward.",
    "weapon.bc_water_bomb.name": "Water Bomb",
    "weapon.bc_water_bomb.desc": "Create water terrain on the target and side tiles.",
    "weapon.uc_pylon.name": "Summon Electric Pylon",
    "weapon.uc_pylon.desc": "Install an electric pylon on an empty target tile.",
    "weapon.td_melee_frost.name": "Frost Bash",
    "weapon.td_melee_frost.desc": "Attack an adjacent target with ice and turn its tile into ice.",
    "weapon.fd_wide_frost.name": "Frost Sweep",
    "weapon.fd_wide_frost.desc": "Turn the target and side tiles into ice.",
    "weapon.rd_ice_arrow.name": "Ice Piercing Arrow",
    "weapon.rd_ice_arrow.desc": "Fire a penetrating ice shot that freezes affected tiles.",
    "weapon.rd_melee.name": "Melee Check",
    "weapon.rd_melee.desc": "Make a basic adjacent melee attack.",
    "weapon.bd_water_convert.name": "Water Conversion",
    "weapon.bd_water_convert.desc": "Convert the target tile to water.",
    "weapon.ad_arc_mass.name": "Mass Artillery",
    "weapon.ad_arc_mass.desc": "Arc an attack that pierces freeze damage blocking.",
    "weapon.ud_frost_tile.name": "Create Frost Tile",
    "weapon.ud_frost_tile.desc": "Turn the user's tile or an adjacent tile into ice.",

    // Passive display names
    "passive.shield.name": "Shield",
    "passive.shield.desc": "Blocks propagation from penetrating attacks.",
    "passive.tile_absorb_attack.name": "Attribute Absorb",
    "passive.tile_absorb_attack.desc": "Absorb the user's tile or selected tile attribute and apply it to the target tile.",
    "passive.melee_mastery.name": "Melee Mastery",
    "passive.melee_mastery.desc": "Reduce incoming melee damage by 1.",
    "passive.fire_affinity.name": "Fire Affinity",
    "passive.fire_affinity.desc": "On entering a fire tile, convert it to plain and heal 1 HP.",
    "passive.medic.name": "Medic",
    "passive.medic.desc": "At turn start, heal adjacent allies by 1 HP, excluding self.",
    "passive.agility.name": "Agility",
    "passive.agility.desc": "After attacking, gain 1 movement point and become able to move again.",
    "passive.turn_arson.name": "Arson Instinct",
    "passive.turn_arson.desc": "At turn start, ignite the tile under adjacent enemies.",
    "passive.insulator.name": "Insulator",
    "passive.insulator.desc": "Immune to electric damage and blocks electric chain propagation.",
    "passive.generator.name": "Electric Generator",
    "passive.generator.desc": "Double electric damage dealt within radius 2.",
    "passive.freeze_immunity.name": "Freeze Immunity",
    "passive.freeze_immunity.desc": "Immune to freeze effects.",
    "passive.amphibious.name": "Amphibious",
    "passive.amphibious.desc": "Ignore water and river tile effects.",
    "passive.fire_weakness.name": "Fire Weakness",
    "passive.fire_weakness.desc": "Take 1 additional damage from fire.",
    "passive.cryo_affinity.name": "Cryo Affinity",
    "passive.cryo_affinity.desc": "At turn start, heal 1 HP per adjacent frozen enemy.",
    "passive.sprinkler.name": "Sprinkler",
    "passive.sprinkler.desc": "At turn start, remove nearby fire tiles and fire unit effects.",

    // Effects — legacy generic keys
    "effect.freeze": "Freeze",
    "effect.fire": "Fire",
    "effect.acid": "Acid",
    "effect.water": "Water",
    "effect.sand": "Sand",
    "effect.electric": "Electric",

    // Effect metadata keys
    "effect.freeze.name": "Freeze",
    "effect.freeze.desc": "Blocks actions and damage, but is removed on hit or collision.",
    "effect.fire.name": "Fire",
    "effect.fire.desc": "Deals damage at turn start. Removed by manual extinguish or river entry.",
    "effect.acid.name": "Acid",
    "effect.acid.desc": "Deals damage at turn start and acidifies the current tile when applied.",
    "effect.water.name": "Water",
    "effect.water.desc": "Wet state. Removed on movement.",
    "effect.sand.name": "Sand",
    "effect.sand.desc": "Sandy state. Removed on movement.",
    "effect.electric.name": "Electric",
    "effect.electric.desc": "Deals electric damage at turn start and expires after 1 turn.",
    "effect.stun.name": "Stun",
    "effect.stun.desc": "Blocks all actions and expires after 1 turn.",
    "effect.confused_ranged.name": "Ranged Disruption",
    "effect.confused_ranged.desc": "Prevents ranged attack types.",
    "effect.confused_melee.name": "Melee Disruption",
    "effect.confused_melee.desc": "Prevents melee attack types.",

    // Tile attributes — legacy generic keys
    "tile.road": "Road",
    "tile.plain": "Plain",
    "tile.mountain": "Mountain",
    "tile.sand": "Sand",
    "tile.river": "River",
    "tile.fire": "Fire Tile",
    "tile.water": "Water Tile",
    "tile.acid": "Acid Tile",
    "tile.electric": "Electric Tile",
    "tile.ice": "Ice Tile",

    // Tile metadata keys
    "tile.road.name": "Road",
    "tile.road.desc": "A road tile with movement cost 1.",
    "tile.plain.name": "Plain",
    "tile.plain.desc": "A basic tile with movement cost 1.",
    "tile.mountain.name": "Mountain",
    "tile.mountain.desc": "An impassable obstacle tile. Counts as an obstruction for artillery.",
    "tile.sand.name": "Sand",
    "tile.sand.desc": "Movement cost 2. Applies the sand effect on entry.",
    "tile.river.name": "River",
    "tile.river.desc": "Movement cost 2 and cannot be stopped on. Knockback entry clears all effects.",
    "tile.fire.name": "Fire Tile",
    "tile.fire.desc": "Applies fire on entry and deals damage at turn start.",
    "tile.water.name": "Water Tile",
    "tile.water.desc": "Removes fire and acid effects on entry.",
    "tile.acid.name": "Acid Tile",
    "tile.acid.desc": "Applies acid on entry and deals damage at turn start.",
    "tile.electric.name": "Electric Tile",
    "tile.electric.desc": "Applies electric on entry and deals damage at turn start.",
    "tile.ice.name": "Ice Tile",
    "tile.ice.desc": "Clears existing effects and applies freeze on entry.",
  },
};

let _locale: Locale = "ko";

export function setLocale(locale: Locale): void {
  _locale = locale;
}

export function getLocale(): Locale {
  return _locale;
}

/**
 * Retrieve a translated string by key with optional interpolation.
 * Usage: getText("turn.round", { round: 3 }) → "3라운드"
 */
export function getText(key: string, params?: Record<string, string | number>): string {
  const map = translations[_locale];
  let text = map[key];

  if (text === undefined) {
    // Fallback to English, then to the key itself
    text = translations["en"][key] ?? key;
  }

  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }

  return text;
}
