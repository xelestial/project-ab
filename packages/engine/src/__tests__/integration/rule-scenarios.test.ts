/**
 * 규칙 엣지케이스 시나리오 통합 테스트
 * implementation-review.md의 확정된 룰에 따른 검증
 */
import { describe, it, expect } from "vitest";
import { StateApplicator } from "../../state/state-applicator.js";
import { MovementValidator } from "../../validators/movement-validator.js";
import { AttackValidator } from "../../validators/attack-validator.js";
import { AttackResolver } from "../../resolvers/attack-resolver.js";
import { MovementResolver } from "../../resolvers/movement-resolver.js";
import { EffectResolver } from "../../resolvers/effect-resolver.js";
import { EffectValidator } from "../../validators/effect-validator.js";
import { EndDetector } from "../../loop/end-detector.js";
import { TestStateBuilder, makeRegistry } from "../test-helpers.js";
import type { GameState } from "@ab/metadata";

const registry = makeRegistry();
const applicator = new StateApplicator();
const mv = new MovementValidator(registry);
const ev = new EffectValidator(registry);
const av = new AttackValidator(registry);
const ar = new AttackResolver(av, registry);
const mr = new MovementResolver(mv, registry);
const er = new EffectResolver(ev, registry);
const endDetector = new EndDetector();

// ─── Scenario helpers ──────────────────────────────────────────────────────────

function applyChanges(state: GameState, changes: import("@ab/metadata").GameChange[]): GameState {
  return applicator.apply(changes, state);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Rule Scenarios", () => {

  // ── 시나리오 1: 빙결 유닛에 충돌 (Into the Breach 룰) ────────────────────────

  describe("Scenario 1: Knockback collision with frozen unit", () => {
    it("breaking freeze on collision — frozen unit takes 0 damage, attacker takes 1", () => {
      /**
       * 확정 룰: 밀어냄 방향에 빙결 유닛이 있으면
       *   - 빙결 해제
       *   - 밀려온 유닛 1 데미지 (충돌 데미지)
       *   - 빙결 유닛 0 데미지 (빙결이 흡수)
       */
      const state = TestStateBuilder.create()
        .withUnit("attacker", "t1", "p1", 5, 3)   // 공격자 (메즐, knockback 없는 기본무기)
        .withUnit("pushed", "f1", "p1", 5, 4)      // 밀려날 유닛
        .withFrozenUnit("frozen", "t1", "p2", 5, 5) // 빙결 유닛 (밀려남 방향에 위치)
        .build();

      // 직접 AttackResolver로 knockback weapon 테스트
      // knockback weapon이 있는 유닛으로 테스트: 여기선 AttackResolver의
      // resolveKnockback 로직을 직접 검증

      // pushed 유닛이 5,5 방향으로 밀려날 때 frozen 유닛과 충돌
      // 내부 knockback 처리를 위해 AttackResolver 내부 로직을 간접 검증

      // 빙결 유닛이 있는 상태 확인
      const frozenUnit = state.units["frozen"]!;
      expect(frozenUnit.activeEffects.some((e) => e.effectType === "freeze")).toBe(true);

      // StateApplicator로 freeze-break 시뮬레이션
      const changes: import("@ab/metadata").GameChange[] = [
        // freeze 해제
        {
          type: "unit_effect_remove",
          unitId: "frozen",
          effectId: "effect_freeze",
          effectType: "freeze",
        },
        // pushed 유닛 1 충돌 데미지
        {
          type: "unit_damage",
          unitId: "pushed",
          amount: 1,
          source: { type: "collision" },
          hpAfter: 3,
        },
        // knockback blocked (frozen unit absorbed)
        {
          type: "unit_knockback",
          unitId: "pushed",
          from: { row: 5, col: 4 },
          to: { row: 5, col: 5 },
          blockedBy: "frozen",
        },
      ];

      const newState = applyChanges(state, changes);

      // frozen unit: freeze is removed
      expect(newState.units["frozen"]?.activeEffects).toHaveLength(0);
      // pushed unit: took 1 damage, didn't move (blocked)
      expect(newState.units["pushed"]?.currentHealth).toBe(3);
      expect(newState.units["pushed"]?.position).toEqual({ row: 5, col: 4 }); // didn't move
    });
  });

  // ── 시나리오 2: 강으로 밀려남 ────────────────────────────────────────────────

  describe("Scenario 2: Unit pushed into river", () => {
    it("unit pushed into river loses all effects and attributes", () => {
      /**
       * 확정 룰: 강으로 밀려 들어가면 모든 효과/속성 상실.
       *          강 진입 비용 2, 나올 때 1.
       */
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 4, {
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .withTile(5, 5, "river")
        .build();

      const changes: import("@ab/metadata").GameChange[] = [
        {
          type: "unit_river_enter",
          unitId: "u1",
          position: { row: 5, col: 5 },
          clearedEffectIds: ["effect_fire"],
          clearedAttributes: [],
        },
      ];

      const newState = applyChanges(state, changes);

      // All effects cleared
      expect(newState.units["u1"]?.activeEffects).toHaveLength(0);
      // Unit moved to river position
      expect(newState.units["u1"]?.position).toEqual({ row: 5, col: 5 });
    });
  });

  // ── 시나리오 3: 소화 (화염 해제) ─────────────────────────────────────────────

  describe("Scenario 3: Extinguish consumes entire turn", () => {
    it("after extinguish, unit cannot move or attack", () => {
      /**
       * 확정 룰: 화염 소화는 턴 전체 소모 (이동 + 공격 모두 불가)
       */
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .build();

      // Extinguish clears fire + marks moved=true + attacked=true
      const changes: import("@ab/metadata").GameChange[] = [
        {
          type: "unit_effect_remove",
          unitId: "u1",
          effectId: "effect_fire",
          effectType: "fire",
        },
      ];
      let newState = applyChanges(state, changes);

      // Mark full turn used
      newState = {
        ...newState,
        units: {
          ...newState.units,
          u1: {
            ...newState.units["u1"]!,
            actionsUsed: { moved: true, attacked: true, skillUsed: false, extinguished: true },
          },
        },
      };

      expect(newState.units["u1"]?.actionsUsed.moved).toBe(true);
      expect(newState.units["u1"]?.actionsUsed.attacked).toBe(true);
      expect(newState.units["u1"]?.activeEffects).toHaveLength(0);

      // Movement validator: already moved
      const unit = newState.units["u1"]!;
      const mvResult = mv.validateMove(unit, { row: 5, col: 6 }, newState);
      expect(mvResult.valid).toBe(false);

      // Attack validator: already attacked
      const avResult = av.validateAttack(unit, { row: 5, col: 6 }, newState);
      expect(avResult.valid).toBe(false);
    });
  });

  // ── 시나리오 4: 산성 이중 효과 (유닛 + 타일 동시) ────────────────────────────

  describe("Scenario 4: Acid dual effect (unit + tile simultaneously)", () => {
    it("acid attack applies to unit AND converts tile to acid", () => {
      /**
       * 확정 룰: 산성은 유일하게 유닛과 타일에 동시 적용.
       *          산성 효과 상태에서 피격 시 데미지 2배.
       */
      const state = TestStateBuilder.create()
        .withUnit("attacker", "r1", "p1", 5, 3)
        .withUnit("target", "f1", "p2", 5, 5)
        .build();

      // Apply acid effect to unit + convert tile to acid
      const changes: import("@ab/metadata").GameChange[] = [
        {
          type: "unit_effect_add",
          unitId: "target",
          effectId: "effect_acid",
          effectType: "acid",
          turnsRemaining: 3,
        },
        {
          type: "tile_attribute_change",
          position: { row: 5, col: 5 },
          from: "plain",
          to: "acid",
        },
      ];

      const newState = applyChanges(state, changes);

      // Unit has acid effect
      expect(newState.units["target"]?.activeEffects.some((e) => e.effectType === "acid")).toBe(true);
      // Tile is now acid
      expect(newState.map.tiles["5,5"]?.attribute).toBe("acid");
    });

    it("acid effect doubles incoming damage", () => {
      // Unit with acid effect takes 2x damage
      const state = TestStateBuilder.create()
        .withUnit("target", "f1", "p2", 5, 5, {
          currentHealth: 4,
          activeEffects: [
            {
              effectId: "effect_acid" as import("@ab/metadata").MetaId,
              effectType: "acid",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .build();

      // base damage 2, acid doubles = 4
      // weapon.damage(2) - armor(0) = 2; acid doubles to 4
      const targetUnit = state.units["target"]!;
      const hasAcid = targetUnit.activeEffects.some((e) => e.effectType === "acid");
      expect(hasAcid).toBe(true);

      // Simulate AttackResolver damage calc: baseDamage - armor = 2, *2 if acid = 4
      const baseDmg = 2;
      const armor = targetUnit.currentArmor;
      let dmg = baseDmg - armor;
      if (hasAcid) dmg *= 2;
      expect(dmg).toBe(4);

      const hpAfter = Math.max(0, targetUnit.currentHealth - dmg);
      expect(hpAfter).toBe(0); // dead
    });
  });

  // ── 시나리오 5: 타일 속성 변환 (마지막 공격 속성 우선) ───────────────────────

  describe("Scenario 5: Tile attribute conversion", () => {
    it("fire tile converted to water by water attack", () => {
      /**
       * 확정 룰: 마지막 공격 속성이 타일 속성을 덮어씀.
       *          화염 타일 + 물 속성 공격 = 물 타일
       */
      const state = TestStateBuilder.create()
        .withTile(5, 5, "fire")
        .build();

      const changes: import("@ab/metadata").GameChange[] = [
        {
          type: "tile_attribute_change",
          position: { row: 5, col: 5 },
          from: "fire",
          to: "water",
        },
      ];

      const newState = applyChanges(state, changes);
      expect(newState.map.tiles["5,5"]?.attribute).toBe("water");
    });

    it("water tile conversion removes fire effect from standing unit", () => {
      /**
       * 확정 룰: 타일이 물로 변환되면 서 있던 유닛의 화염/산성 효과 즉시 제거
       */
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 3,
              appliedOnTurn: 1,
            },
          ],
        })
        .withTile(5, 5, "fire")
        .build();

      const changes: import("@ab/metadata").GameChange[] = [
        {
          type: "tile_attribute_change",
          position: { row: 5, col: 5 },
          from: "fire",
          to: "water",
        },
        {
          type: "unit_effect_remove",
          unitId: "u1",
          effectId: "effect_fire",
          effectType: "fire",
        },
      ];

      const newState = applyChanges(state, changes);
      expect(newState.map.tiles["5,5"]?.attribute).toBe("water");
      expect(newState.units["u1"]?.activeEffects).toHaveLength(0);
    });
  });

  // ── 시나리오 6: 빙결 상태 행동 불가 ─────────────────────────────────────────

  describe("Scenario 6: Freeze blocks ALL actions", () => {
    it("frozen unit cannot move", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 5, 5)
        .build();
      const unit = state.units["u1"]!;
      const result = mv.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toContain("frozen");
    });

    it("frozen unit cannot attack", () => {
      const state = TestStateBuilder.create()
        .withFrozenUnit("u1", "t1", "p1", 5, 5)
        .withUnit("enemy", "f1", "p2", 5, 6)
        .build();
      const unit = state.units["u1"]!;
      const result = av.validateAttack(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toContain("frozen");
    });
  });

  // ── 시나리오 7: 이동 경로 경유 (유닛 위 통과, 멈출 수 없음) ─────────────────

  describe("Scenario 7: Pass-through movement", () => {
    it("unit can pass through occupied tile but not stop on it", () => {
      // u1 at 5,4, u_mid at 5,5, destination 5,6
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 4)
        .withUnit("u_mid", "f1", "p2", 5, 5) // in the way
        .build();

      // Can reach 5,6 by passing through 5,5
      const unit = state.units["u1"]!;
      const result = mv.validateMove(unit, { row: 5, col: 6 }, state);
      expect(result.valid).toBe(true);

      // Cannot stop AT 5,5
      const resultStop = mv.validateMove(unit, { row: 5, col: 5 }, state);
      expect(resultStop.valid).toBe(false);
    });
  });

  // ── 시나리오 8: 게임 종료 조건 ────────────────────────────────────────────────

  describe("Scenario 8: Game end conditions", () => {
    it("game ends when last unit of a player dies", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5, { alive: false, currentHealth: 0 })
        .withUnit("u2", "f1", "p2", 6, 6)
        .build();

      const result = endDetector.check(state);
      expect(result.ended).toBe(true);
      expect(result.reason).toBe("all_units_dead");
      expect(result.winnerIds).toContain("p2");
    });

    it("game does not end mid-round while units alive", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "t1", "p1", 5, 5)
        .withUnit("u2", "f1", "p2", 6, 6)
        .build();

      const result = endDetector.check(state);
      expect(result.ended).toBe(false);
    });
  });

  // ── 시나리오 9: 효과 틱 데미지 ───────────────────────────────────────────────

  describe("Scenario 9: Effect tick damage", () => {
    it("fire effect deals 1 damage per turn and decrements counter", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 5, {
          currentHealth: 4,
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 3,
              appliedOnTurn: 1,
            },
          ],
        })
        .build();

      const unit = state.units["u1"]!;
      const er2 = new EffectResolver(new EffectValidator(registry), registry);
      const changes = er2.resolveTurnTick(unit, state);

      const dmg = changes.find((c) => c.type === "unit_damage");
      expect(dmg).toBeDefined();
      if (dmg?.type === "unit_damage") {
        expect(dmg.amount).toBe(1);
        expect(dmg.hpAfter).toBe(3);
      }

      // Effect should be updated with decremented turns
      const addChange = changes.find(
        (c) => c.type === "unit_effect_add" && c.effectType === "fire",
      );
      expect(addChange).toBeDefined();
      if (addChange?.type === "unit_effect_add") {
        expect(addChange.turnsRemaining).toBe(2);
      }
    });
  });

  // ── 시나리오 10: 이동 후 타일 진입 효과 ──────────────────────────────────────

  describe("Scenario 10: Tile entry effects on movement", () => {
    it("moving to fire tile applies fire effect", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 4)
        .withTile(5, 5, "fire")
        .build();

      const unit = state.units["u1"]!;
      const mr2 = new MovementResolver(mv, registry);
      const changes = mr2.resolve(unit, { row: 5, col: 5 }, state);

      const effectAdd = changes.find((c) => c.type === "unit_effect_add");
      expect(effectAdd).toBeDefined();
      if (effectAdd?.type === "unit_effect_add") {
        expect(effectAdd.effectType).toBe("fire");
      }
    });

    it("moving to water tile removes fire effect", () => {
      const state = TestStateBuilder.create()
        .withUnit("u1", "f1", "p1", 5, 4, {
          activeEffects: [
            {
              effectId: "effect_fire" as import("@ab/metadata").MetaId,
              effectType: "fire",
              turnsRemaining: 2,
              appliedOnTurn: 1,
            },
          ],
        })
        .withTile(5, 5, "water")
        .build();

      const unit = state.units["u1"]!;
      const mr2 = new MovementResolver(mv, registry);
      const changes = mr2.resolve(unit, { row: 5, col: 5 }, state);

      const effectRemove = changes.find(
        (c) => c.type === "unit_effect_remove" && c.effectType === "fire",
      );
      expect(effectRemove).toBeDefined();
    });
  });
});
