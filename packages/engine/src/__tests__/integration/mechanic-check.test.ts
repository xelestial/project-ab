/**
 * 게임 메카닉 검증 테스트
 * - 공격 (기본 데미지, 아머 감산)
 * - 밀어냄 (knockback)
 * - 밀어냄 충돌 데미지
 * - 밀어냄 → 강 진입
 * - ActionProcessor 경유 사망 처리
 */
import { describe, it, expect } from "vitest";
import { buildDataRegistry } from "@ab/metadata";
import { StateApplicator } from "../../state/state-applicator.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import { AttackResolver } from "../../resolvers/attack-resolver.js";
import { MovementValidator } from "../../validators/movement-validator.js";
import { EffectValidator } from "../../validators/effect-validator.js";
import { TileValidator } from "../../validators/tile-validator.js";
import { MovementResolver } from "../../resolvers/movement-resolver.js";
import { EffectResolver } from "../../resolvers/effect-resolver.js";
import { TileResolver } from "../../resolvers/tile-resolver.js";
import { HealthManager } from "../../managers/health-manager.js";
import { EffectManager } from "../../managers/effect-manager.js";
import { TileManager } from "../../managers/tile-manager.js";
import { TurnManager } from "../../managers/turn-manager.js";
import { ActionProcessor } from "../../loop/action-processor.js";
import { TestStateBuilder, makeRegistry, makeTileTransitionResolver } from "../test-helpers.js";
import type { MetaId, PlayerId, UnitId, GameId, GameState } from "@ab/metadata";

// ─── 기본 픽스처 레지스트리 ─────────────────────────────────────────────────────

const registry = makeRegistry();
const tileTransition = makeTileTransitionResolver(registry);
const applicator = new StateApplicator();
const av = new AttackValidator(registry);
const ar = new AttackResolver(av, registry, tileTransition);
const mv = new MovementValidator(registry);
const ev = new EffectValidator(registry);
const tv = new TileValidator(registry);
const mr = new MovementResolver(mv, tileTransition);
const er = new EffectResolver(ev, registry);
const tr = new TileResolver(tv, registry);
const hm = new HealthManager(applicator);
const em = new EffectManager(er, applicator);
const tm2 = new TileManager(tr, applicator);
const turnMgr = new TurnManager(applicator);
// ActionProcessor constructor: turnMgr, mvValidator, atkValidator, mvResolver, atkResolver, effResolver, applicator, healthManager, effectManager, tileManager, registry
const ap = new ActionProcessor(
  turnMgr, mv, av, mr, ar, er, applicator, hm, em, tm2, registry,
);

// ─── Knockback 전용 레지스트리 ────────────────────────────────────────────────

function makeKnockbackRegistry() {
  return buildDataRegistry({
    units: [
      {
        id: "kb_unit",
        nameKey: "n", descKey: "d",
        class: "tanker", faction: "a",
        baseMovement: 3, baseHealth: 6, baseArmor: 0,
        attributes: [],
        primaryWeaponId: "wpn_kb",
        skillIds: [],
        spriteKey: "s",
      },
      {
        id: "dummy",
        nameKey: "n", descKey: "d",
        class: "fighter", faction: "a",
        baseMovement: 3, baseHealth: 4, baseArmor: 0,
        attributes: [],
        primaryWeaponId: "wpn_kb",
        skillIds: [],
        spriteKey: "s",
      },
    ],
    weapons: [
      {
        id: "wpn_kb",
        nameKey: "n", descKey: "d",
        attackType: "melee", rangeType: "single",
        minRange: 1, maxRange: 1,
        damage: 2, attribute: "none",
        knockback: { distance: 1, direction: "away" },
        penetrating: false, arcing: false,
      },
    ],
    skills: [],
    effects: [],
    tiles: [
      { id: "tile_plain", tileType: "plain", nameKey: "t", descKey: "t", moveCost: 1, cannotStop: false, impassable: false, damagePerTurn: 0 },
      { id: "tile_river", tileType: "river", nameKey: "t", descKey: "t", moveCost: 2, cannotStop: false, impassable: false, damagePerTurn: 0 },
    ],
    maps: [
      { id: "map_kb", nameKey: "m", descKey: "m", playerCounts: [2], tileOverrides: [], spawnPoints: [] },
    ],
  });
}

function makeKbState(
  attackerPos: { row: number; col: number },
  targetPos: { row: number; col: number },
  tiles: Record<string, import("@ab/metadata").TileState> = {},
  extraUnits: Record<string, import("@ab/metadata").UnitState> = {},
): GameState {
  const now = new Date().toISOString();
  return {
    gameId: "test" as GameId,
    phase: "battle",
    round: 1,
    turnOrder: [
      { playerId: "p1" as PlayerId, priority: 1 },
      { playerId: "p2" as PlayerId, priority: 1 },
    ],
    currentTurnIndex: 0,
    players: {
      p1: { playerId: "p1" as PlayerId, teamIndex: 0, priority: 1, unitIds: ["atk" as UnitId], connected: true, surrendered: false },
      p2: { playerId: "p2" as PlayerId, teamIndex: 1, priority: 1, unitIds: ["tgt" as UnitId, ...Object.keys(extraUnits) as UnitId[]], connected: true, surrendered: false },
    },
    units: {
      atk: {
        unitId: "atk" as UnitId, metaId: "kb_unit" as MetaId, playerId: "p1" as PlayerId,
        position: attackerPos,
        currentHealth: 6, currentArmor: 0, movementPoints: 3,
        activeEffects: [],
        actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      },
      tgt: {
        unitId: "tgt" as UnitId, metaId: "dummy" as MetaId, playerId: "p2" as PlayerId,
        position: targetPos,
        currentHealth: 4, currentArmor: 0, movementPoints: 3,
        activeEffects: [],
        actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      },
      ...extraUnits,
    },
    map: { mapId: "map_kb" as MetaId, gridSize: 11, tiles },
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("⚔️ 게임 메카닉 검증", () => {

  // ── 1. 기본 공격 ──────────────────────────────────────────────────────────────
  describe("1. 기본 공격 (데미지 + 아머 감산)", () => {
    it("f1이 t1(armor 1)을 공격 → 아머만큼 데미지 감소", () => {
      // f1 wpn_melee_basic damage 2, t1 currentArmor 1 → net 1, HP 6→5
      // TestStateBuilder는 currentArmor:0 기본값이므로 override 필요
      const state = TestStateBuilder.create()
        .withUnit("attacker", "f1", "p1", 5, 4)
        .withUnit("target",   "t1", "p2", 5, 5, { currentArmor: 1, currentHealth: 6 })
        .build();

      const attacker = state.units["attacker"]!;
      const changes = ar.resolve(attacker, { row: 5, col: 5 }, state);

      const dmg = changes.find(c => c.type === "unit_damage") as any;
      expect(dmg).toBeDefined();
      expect(dmg.amount).toBe(1);
      expect(dmg.hpAfter).toBe(5);

      console.log(`  ✅ 데미지 ${dmg.amount} (armor 감산 후), HP: 6 → ${dmg.hpAfter}`);
    });

    it("f1이 f1(armor 0)을 공격 → 풀 데미지 2 적용", () => {
      const state = TestStateBuilder.create()
        .withUnit("attacker", "f1", "p1", 5, 4)
        .withUnit("target",   "f1", "p2", 5, 5)
        .build();

      const attacker = state.units["attacker"]!;
      const changes = ar.resolve(attacker, { row: 5, col: 5 }, state);

      const dmg = changes.find(c => c.type === "unit_damage") as any;
      expect(dmg.amount).toBe(2);
      expect(dmg.hpAfter).toBe(2);

      console.log(`  ✅ 풀 데미지 ${dmg.amount}, HP: 4 → ${dmg.hpAfter}`);
    });

    it("HP 0 이하면 HealthManager가 unit_death를 발행해 alive=false 처리", () => {
      // AttackResolver는 unit_damage만 발행, HealthManager가 HP 0 체크 후 unit_death 추가
      const state = TestStateBuilder.create()
        .withUnit("attacker", "f1", "p1", 5, 4)
        .withUnit("target",   "f1", "p2", 5, 5, { currentHealth: 2 })
        .build();

      const attacker = state.units["attacker"]!;
      const dmgChanges = ar.resolve(attacker, { row: 5, col: 5 }, state);
      const afterDmg = applicator.apply(dmgChanges, state);

      // HP=0이지만 alive는 아직 true (unit_death 미발행)
      expect(afterDmg.units["target"]!.currentHealth).toBe(0);
      expect(afterDmg.units["target"]!.alive).toBe(true); // HealthManager 호출 전

      // HealthManager가 HP 0 유닛에 unit_death 발행
      const deathChanges = hm.checkDeaths(afterDmg);
      const finalState = applicator.apply(deathChanges, afterDmg);

      expect(finalState.units["target"]!.alive).toBe(false);
      console.log(`  ✅ HP 0 후 unit_death 적용 → alive: ${finalState.units["target"]!.alive}`);
    });

    it("사거리 밖 공격은 AttackValidator가 거부한다", () => {
      const state = TestStateBuilder.create()
        .withUnit("attacker", "f1", "p1", 5, 4)
        .withUnit("target",   "f1", "p2", 5, 7)  // 거리 3 > maxRange 1
        .build();

      const validation = av.validateAttack(state.units["attacker"]!, { row: 5, col: 7 }, state);
      expect(validation.valid).toBe(false);

      console.log(`  ✅ 사거리 초과 거부: ${validation.errorCode}`);
    });
  });

  // ── 2. 밀어냄 ─────────────────────────────────────────────────────────────────
  describe("2. 밀어냄 (knockback)", () => {
    it("knockback 무기: 공격 후 타겟이 공격 반대 방향으로 1칸 이동", () => {
      const kbReg = makeKnockbackRegistry();
      const kbAv = new AttackValidator(kbReg);
      const kbAr = new AttackResolver(kbAv, kbReg, makeTileTransitionResolver(kbReg));

      // atk(5,3) → tgt(5,4), 빈칸(5,5) → tgt가 (5,5)로 밀려남
      const state = makeKbState({ row: 5, col: 3 }, { row: 5, col: 4 });
      const changes = kbAr.resolve(state.units["atk"]!, { row: 5, col: 4 }, state);

      const kb = changes.find(c => c.type === "unit_knockback") as any;
      expect(kb).toBeDefined();
      expect(kb.unitId).toBe("tgt");
      expect(kb.from).toEqual({ row: 5, col: 4 });
      expect(kb.to).toEqual({ row: 5, col: 5 });
      expect(kb.blockedBy).toBeUndefined();

      const newState = applicator.apply(changes, state);
      expect(newState.units["tgt"]!.position).toEqual({ row: 5, col: 5 });

      console.log(`  ✅ 밀어냄: (5,4) → (5,5), 실제 위치: ${JSON.stringify(newState.units["tgt"]!.position)}`);
    });

    it("밀려날 방향이 맵 경계면 blockedBy='wall'로 막힘", () => {
      const kbReg = makeKnockbackRegistry();
      const kbAv = new AttackValidator(kbReg);
      const kbAr = new AttackResolver(kbAv, kbReg, makeTileTransitionResolver(kbReg));

      // col 10이 끝 → col 11 = 경계 밖
      const state = makeKbState({ row: 5, col: 9 }, { row: 5, col: 10 });
      const changes = kbAr.resolve(state.units["atk"]!, { row: 5, col: 10 }, state);

      const kb = changes.find(c => c.type === "unit_knockback") as any;
      expect(kb.blockedBy).toBe("wall");

      console.log(`  ✅ 맵 경계 충돌: blockedBy=${kb.blockedBy}`);
    });
  });

  // ── 3. 밀어냄 충돌 데미지 ─────────────────────────────────────────────────────
  describe("3. 밀어냄 충돌 데미지", () => {
    it("밀려난 유닛이 다른 유닛에 충돌 → 1 충돌 데미지 + 이동 안 함", () => {
      const kbReg = makeKnockbackRegistry();
      const kbAv = new AttackValidator(kbReg);
      const kbAr = new AttackResolver(kbAv, kbReg, makeTileTransitionResolver(kbReg));

      const now = new Date().toISOString();
      // blk(5,5)가 앞을 막고 있음
      const blocker: import("@ab/metadata").UnitState = {
        unitId: "blk" as UnitId, metaId: "dummy" as MetaId, playerId: "p2" as PlayerId,
        position: { row: 5, col: 5 },
        currentHealth: 4, currentArmor: 0, movementPoints: 3,
        activeEffects: [],
        actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      };
      const state = makeKbState(
        { row: 5, col: 3 },
        { row: 5, col: 4 },
        {},
        { blk: blocker },
      );

      const changes = kbAr.resolve(state.units["atk"]!, { row: 5, col: 4 }, state);

      console.log("  📌 충돌 변경 사항:");
      changes.forEach(c => console.log(`    - type=${c.type}`, JSON.stringify(c)));

      // 공격 데미지
      const atkDmg = changes.find(c => c.type === "unit_damage" && (c as any).source?.type === "attack") as any;
      expect(atkDmg).toBeDefined();
      expect(atkDmg.unitId).toBe("tgt");
      expect(atkDmg.amount).toBe(2);

      // 충돌 데미지
      const colDmg = changes.find(c => c.type === "unit_damage" && (c as any).source?.type === "collision") as any;
      expect(colDmg).toBeDefined();
      expect(colDmg.unitId).toBe("tgt");
      expect(colDmg.amount).toBe(1);

      // StateApplicator 적용 후 위치 불변
      const newState = applicator.apply(changes, state);
      expect(newState.units["tgt"]!.position).toEqual({ row: 5, col: 4 }); // 안 움직임
      expect(newState.units["tgt"]!.currentHealth).toBeLessThan(4);

      console.log(`  ✅ 공격 데미지: ${atkDmg.amount}, 충돌 데미지: ${colDmg.amount}`);
      console.log(`  ✅ tgt 최종 HP: ${newState.units["tgt"]!.currentHealth}, 위치: ${JSON.stringify(newState.units["tgt"]!.position)}`);
    });

    it("충돌 데미지 누적 후 HealthManager가 사망 처리한다", () => {
      const kbReg = makeKnockbackRegistry();
      const kbAv = new AttackValidator(kbReg);
      const kbAr = new AttackResolver(kbAv, kbReg, makeTileTransitionResolver(kbReg));
      const kbHm = new HealthManager(applicator);

      // tgt HP=1: attack 2 → HP 0 (이미 치명), 충돌까지 발생
      const blocker: import("@ab/metadata").UnitState = {
        unitId: "blk" as UnitId, metaId: "dummy" as MetaId, playerId: "p2" as PlayerId,
        position: { row: 5, col: 5 },
        currentHealth: 4, currentArmor: 0, movementPoints: 3,
        activeEffects: [],
        actionsUsed: { moved: false, attacked: false, skillUsed: false, extinguished: false },
        alive: true,
      };
      const state = makeKbState({ row: 5, col: 3 }, { row: 5, col: 4 }, {}, { blk: blocker });
      const weakState: GameState = {
        ...state,
        units: { ...state.units, tgt: { ...state.units["tgt"]!, currentHealth: 1 } },
      };

      const changes = kbAr.resolve(weakState.units["atk"]!, { row: 5, col: 4 }, weakState);
      // 데미지 적용 후 HP 0
      const afterDmg = applicator.apply(changes, weakState);
      expect(afterDmg.units["tgt"]!.currentHealth).toBeLessThanOrEqual(0);

      // HealthManager가 unit_death 발행 → alive=false
      const finalState = kbHm.applyDeaths(afterDmg);
      expect(finalState.units["tgt"]!.alive).toBe(false);
      console.log(`  ✅ 충돌 후 HP=${afterDmg.units["tgt"]!.currentHealth} → HealthManager → alive=${finalState.units["tgt"]!.alive}`);
    });
  });

  // ── 4. 밀어냄 → 강 진입 ──────────────────────────────────────────────────────
  describe("4. 밀어냄 → 강 진입", () => {
    it("밀려난 방향이 강 타일 → unit_river_enter 발생, 효과 초기화", () => {
      const kbReg = makeKnockbackRegistry();
      const kbAv = new AttackValidator(kbReg);
      const kbAr = new AttackResolver(kbAv, kbReg, makeTileTransitionResolver(kbReg));

      // (5,5)가 river
      const riverTile: import("@ab/metadata").TileState = {
        position: { row: 5, col: 5 },
        attribute: "river",
        attributeTurnsRemaining: undefined,
      };
      const state = makeKbState({ row: 5, col: 3 }, { row: 5, col: 4 }, { "5,5": riverTile });

      // tgt에 fire 효과 부여
      const stateWithFire: GameState = {
        ...state,
        units: {
          ...state.units,
          tgt: {
            ...state.units["tgt"]!,
            activeEffects: [{
              effectId: "effect_fire" as MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            }],
          },
        },
      };

      const changes = kbAr.resolve(stateWithFire.units["atk"]!, { row: 5, col: 4 }, stateWithFire);

      console.log("  📌 강 밀어냄 changes:");
      changes.forEach(c => console.log(`    - type=${c.type}`, JSON.stringify(c)));

      const riverEnter = changes.find(c => c.type === "unit_river_enter") as any;
      expect(riverEnter).toBeDefined();
      expect(riverEnter.unitId).toBe("tgt");
      expect(riverEnter.position).toEqual({ row: 5, col: 5 });

      // StateApplicator 적용
      const newState = applicator.apply(changes, stateWithFire);
      expect(newState.units["tgt"]!.position).toEqual({ row: 5, col: 5 });
      expect(newState.units["tgt"]!.activeEffects).toHaveLength(0); // fire 효과 소멸

      console.log(`  ✅ 강 진입: (5,4) → ${JSON.stringify(newState.units["tgt"]!.position)}`);
      console.log(`  ✅ 효과 초기화: ${newState.units["tgt"]!.activeEffects.length}개`);
    });
  });

  // ── 5. ActionProcessor 경유 풀 플로우 ─────────────────────────────────────────
  describe("5. ActionProcessor 경유 전체 플로우", () => {
    it("attack action → HP 0 → alive=false (사망 처리)", () => {
      const state = {
        ...TestStateBuilder.create()
          .withUnit("killer", "f1", "p1", 5, 4)
          .withUnit("victim", "f1", "p2", 5, 5, { currentHealth: 2 })
          .build(),
        turnOrder: [
          { playerId: "p1" as PlayerId, priority: 1 },
          { playerId: "p2" as PlayerId, priority: 1 },
        ],
      };

      const action = {
        type: "attack" as const,
        playerId: "p1" as PlayerId,
        unitId: "killer" as UnitId,
        target: { row: 5, col: 5 },
      };

      const result = ap.process(action, state);
      expect(result.accepted).toBe(true);
      expect(result.newState.units["victim"]!.alive).toBe(false);
      expect(result.newState.units["victim"]!.currentHealth).toBe(0);

      console.log(`  ✅ ActionProcessor 공격 → victim alive=${result.newState.units["victim"]!.alive}`);
    });

    it("move action → 유닛 위치 갱신", () => {
      const state = {
        ...TestStateBuilder.create()
          .withUnit("mover", "f1", "p1", 5, 4)
          .build(),
        turnOrder: [{ playerId: "p1" as PlayerId, priority: 1 }],
      };

      const action = {
        type: "move" as const,
        playerId: "p1" as PlayerId,
        unitId: "mover" as UnitId,
        destination: { row: 5, col: 6 },
      };

      const result = ap.process(action, state);
      expect(result.accepted).toBe(true);
      expect(result.newState.units["mover"]!.position).toEqual({ row: 5, col: 6 });

      console.log(`  ✅ ActionProcessor 이동 → 위치: ${JSON.stringify(result.newState.units["mover"]!.position)}`);
    });

    it("이미 이동한 유닛의 move action은 거부된다", () => {
      const state = {
        ...TestStateBuilder.create()
          .withUnit("mover", "f1", "p1", 5, 4, {
            actionsUsed: { moved: true, attacked: false, skillUsed: false, extinguished: false },
          })
          .build(),
        turnOrder: [{ playerId: "p1" as PlayerId, priority: 1 }],
      };

      const action = {
        type: "move" as const,
        playerId: "p1" as PlayerId,
        unitId: "mover" as UnitId,
        destination: { row: 5, col: 6 },
      };

      const result = ap.process(action, state);
      expect(result.accepted).toBe(false);

      console.log(`  ✅ 중복 이동 거부: ${result.errorCode}`);
    });
  });
});
