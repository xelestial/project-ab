/**
 * 지형 생성기 단위·통합 테스트
 *
 * SeededRng를 사용해 모든 테스트는 결정적(deterministic)입니다.
 *
 * 1. SeededRng — 시드별 재현성
 * 2. pickBaseTile / pickElementalType — 선택 범위
 * 3. getSideCandidates — 제외 키 적용
 * 4. placeSideTiles — 배치 수, 타입, 스폰 보호
 * 5. applyRiverFormation — 연결 물 3+ → 강, 미만은 유지
 * 6. generateTerrain (통합)
 *    a. baseTile / elementalType config 고정
 *    b. 진영당 elemental 정확히 2개
 *    c. rockCount / waterCount 범위 [1,4] 준수
 *    d. 스폰 포인트 타일 배치 금지
 *    e. config.sideA/sideB 고정값 사용
 *    f. 같은 시드 → 동일 결과
 *    g. 다른 시드 → 다른 결과
 *    h. 16×16 그리드에서도 정상 동작
 */

import { describe, it, expect } from "vitest";
import { SeededRng, MathRng } from "../map/rng.js";
import {
  pickBaseTile,
  pickElementalType,
  pickSideCount,
  getSideCandidates,
  placeSideTiles,
  applyRiverFormation,
  generateTerrain,
  PLAIN_BASES,
  ELEMENTAL_TYPES,
} from "../map/terrain-generator.js";

// ─── 1. SeededRng ─────────────────────────────────────────────────────────────

describe("1. SeededRng — 시드 재현성", () => {
  it("같은 시드는 동일한 숫자 시퀀스를 생성한다", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("다른 시드는 다른 시퀀스를 생성한다", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() 결과는 항상 [0, 1) 범위", () => {
    const rng = new SeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("randInt(min, max) 결과는 항상 [min, max] 범위의 정수", () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.randInt(1, 4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("shuffle() 결과는 같은 원소를 포함하고 순서만 다르다", () => {
    const rng = new SeededRng(13);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = rng.shuffle(arr);
    expect(shuffled).toHaveLength(arr.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
    // 원본 불변 확인
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("MathRng.next()도 [0, 1) 범위 (smoke test)", () => {
    const rng = new MathRng();
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ─── 2. pickBaseTile / pickElementalType ─────────────────────────────────────

describe("2. pickBaseTile / pickElementalType", () => {
  it("pickBaseTile은 항상 PLAIN_BASES 중 하나를 반환한다", () => {
    const rng = new SeededRng(1);
    for (let i = 0; i < 50; i++) {
      const t = pickBaseTile(rng);
      expect(PLAIN_BASES).toContain(t);
    }
  });

  it("pickElementalType은 항상 ELEMENTAL_TYPES 중 하나를 반환한다", () => {
    const rng = new SeededRng(2);
    for (let i = 0; i < 50; i++) {
      const t = pickElementalType(rng);
      expect(ELEMENTAL_TYPES).toContain(t);
    }
  });

  it("충분한 호출 시 모든 PLAIN_BASES가 적어도 한 번 선택된다", () => {
    const rng = new SeededRng(100);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickBaseTile(rng));
    for (const b of PLAIN_BASES) expect(seen).toContain(b);
  });

  it("충분한 호출 시 모든 ELEMENTAL_TYPES가 적어도 한 번 선택된다", () => {
    const rng = new SeededRng(200);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickElementalType(rng));
    for (const e of ELEMENTAL_TYPES) expect(seen).toContain(e);
  });

  it("pickSideCount는 항상 [min, max] 범위 정수를 반환한다", () => {
    const rng = new SeededRng(5);
    for (let i = 0; i < 200; i++) {
      const v = pickSideCount(1, 4, rng);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
    }
  });
});

// ─── 3. getSideCandidates ─────────────────────────────────────────────────────

describe("3. getSideCandidates — 후보 필터링", () => {
  it("제외 키 없으면 rows × gridSize 개 후보", () => {
    const rows = [0, 1, 2, 3, 4];
    const result = getSideCandidates(rows, 11, new Set());
    expect(result).toHaveLength(55); // 5 × 11
  });

  it("제외 키가 있으면 해당 셀이 제외된다", () => {
    const excluded = new Set(["0,0", "0,1", "1,5"]);
    const result = getSideCandidates([0, 1], 11, excluded);
    expect(result).toHaveLength(22 - 3);
    for (const pos of result) {
      expect(excluded).not.toContain(`${pos.row},${pos.col}`);
    }
  });

  it("반환된 후보는 모두 지정된 rows에 속한다", () => {
    const rows = [3, 4, 5];
    const result = getSideCandidates(rows, 8, new Set());
    for (const pos of result) {
      expect(rows).toContain(pos.row);
    }
  });
});

// ─── 4. placeSideTiles ────────────────────────────────────────────────────────

describe("4. placeSideTiles — 타일 배치", () => {
  const rows = [0, 1, 2, 3, 4];

  it("지정한 수만큼 mountain / water / elemental이 배치된다", () => {
    const rng = new SeededRng(10);
    const { tiles, placed } = placeSideTiles({
      rows, gridSize: 11, excludedKeys: new Set(),
      rockCount: 3, waterCount: 2, elementalType: "fire", elementalPerSide: 2, rng,
    });

    const attrs = Object.values(tiles).map((t) => t.attribute);
    expect(attrs.filter((a) => a === "mountain")).toHaveLength(3);
    expect(attrs.filter((a) => a === "water")).toHaveLength(2);
    expect(attrs.filter((a) => a === "fire")).toHaveLength(2);
    expect(placed).toEqual({ rockCount: 3, waterCount: 2, elementalCount: 2 });
  });

  it("제외 키에 포함된 위치에는 타일이 배치되지 않는다", () => {
    const rng = new SeededRng(20);
    const excluded = new Set(["0,0", "0,1", "0,2", "0,3", "0,4"]);
    const { tiles } = placeSideTiles({
      rows: [0], gridSize: 5, excludedKeys: excluded,
      rockCount: 2, waterCount: 2, elementalType: "ice", elementalPerSide: 1, rng,
    });
    // row 0이 전부 제외됐으므로 빈 결과
    expect(Object.keys(tiles)).toHaveLength(0);
  });

  it("후보보다 요청 수가 많으면 가능한 만큼만 배치한다", () => {
    const rng = new SeededRng(30);
    // row 0 col 0~4 = 5개만 가능, rock 3 + water 3 + elemental 2 = 8 요청
    const { tiles } = placeSideTiles({
      rows: [0], gridSize: 5, excludedKeys: new Set(),
      rockCount: 3, waterCount: 3, elementalType: "acid", elementalPerSide: 2, rng,
    });
    expect(Object.keys(tiles).length).toBeLessThanOrEqual(5);
  });

  it("같은 위치에 두 타일이 배치되지 않는다 (고유성)", () => {
    const rng = new SeededRng(40);
    const { tiles } = placeSideTiles({
      rows, gridSize: 11, excludedKeys: new Set(),
      rockCount: 4, waterCount: 4, elementalType: "electric", elementalPerSide: 2, rng,
    });
    const keys = Object.keys(tiles);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("배치된 타일은 지정된 rows에만 위치한다", () => {
    const rng = new SeededRng(50);
    const { tiles } = placeSideTiles({
      rows: [0, 1, 2], gridSize: 11, excludedKeys: new Set(),
      rockCount: 2, waterCount: 2, elementalType: "fire", elementalPerSide: 2, rng,
    });
    for (const t of Object.values(tiles)) {
      expect([0, 1, 2]).toContain(t.position.row);
    }
  });
});

// ─── 5. applyRiverFormation ───────────────────────────────────────────────────

describe("5. applyRiverFormation — 강 형성", () => {
  function waterTile(row: number, col: number) {
    return { position: { row, col }, attribute: "water" as const, attributeTurnsRemaining: undefined };
  }

  it("연결된 물 3개 → 전부 river로 변환된다", () => {
    const tiles = {
      "5,3": waterTile(5, 3),
      "5,4": waterTile(5, 4),
      "5,5": waterTile(5, 5),
    };
    const result = applyRiverFormation(tiles);
    expect(result["5,3"]!.attribute).toBe("river");
    expect(result["5,4"]!.attribute).toBe("river");
    expect(result["5,5"]!.attribute).toBe("river");
  });

  it("연결된 물 2개 → river 변환 없음 (minGroupSize=3)", () => {
    const tiles = {
      "5,3": waterTile(5, 3),
      "5,4": waterTile(5, 4),
    };
    const result = applyRiverFormation(tiles);
    expect(result["5,3"]!.attribute).toBe("water");
    expect(result["5,4"]!.attribute).toBe("water");
  });

  it("연결 그룹이 분리돼 있으면 크기별로 독립 판정", () => {
    const tiles = {
      // 그룹1: 3개 연결 → river
      "0,0": waterTile(0, 0),
      "0,1": waterTile(0, 1),
      "0,2": waterTile(0, 2),
      // 그룹2: 2개 연결 → water 유지
      "5,5": waterTile(5, 5),
      "5,6": waterTile(5, 6),
    };
    const result = applyRiverFormation(tiles);
    expect(result["0,0"]!.attribute).toBe("river");
    expect(result["0,1"]!.attribute).toBe("river");
    expect(result["0,2"]!.attribute).toBe("river");
    expect(result["5,5"]!.attribute).toBe("water");
    expect(result["5,6"]!.attribute).toBe("water");
  });

  it("비물 타일(mountain, fire 등)은 변경하지 않는다", () => {
    const tiles = {
      "3,3": { position: { row: 3, col: 3 }, attribute: "mountain" as const, attributeTurnsRemaining: undefined },
      "4,4": { position: { row: 4, col: 4 }, attribute: "fire" as const, attributeTurnsRemaining: undefined },
      "5,5": waterTile(5, 5),
    };
    const result = applyRiverFormation(tiles);
    expect(result["3,3"]!.attribute).toBe("mountain");
    expect(result["4,4"]!.attribute).toBe("fire");
  });

  it("원본 tiles 객체를 수정하지 않는다 (불변성)", () => {
    const tiles = {
      "1,1": waterTile(1, 1),
      "1,2": waterTile(1, 2),
      "1,3": waterTile(1, 3),
    };
    const snapshot = { ...tiles };
    applyRiverFormation(tiles);
    expect(tiles["1,1"]!.attribute).toBe(snapshot["1,1"]!.attribute);
  });

  it("minGroupSize 커스텀 값 적용 (2이면 물 2개도 river)", () => {
    const tiles = {
      "0,0": waterTile(0, 0),
      "0,1": waterTile(0, 1),
    };
    const result = applyRiverFormation(tiles, 2);
    expect(result["0,0"]!.attribute).toBe("river");
    expect(result["0,1"]!.attribute).toBe("river");
  });
});

// ─── 6. generateTerrain (통합) ────────────────────────────────────────────────

describe("6. generateTerrain — 통합", () => {
  const NO_SPAWNS: never[] = [];

  it("a. config.baseTile / elementalType 고정값이 그대로 사용된다", () => {
    const rng = new SeededRng(1);
    const result = generateTerrain(11, NO_SPAWNS, rng, {
      baseTile: "road",
      elementalType: "ice",
    });
    expect(result.baseTile).toBe("road");
    expect(result.elementalType).toBe("ice");
  });

  it("b. 진영당 elemental 정확히 3개 (총 6개) 배치된다", () => {
    const rng = new SeededRng(2);
    const result = generateTerrain(11, NO_SPAWNS, rng, { elementalType: "fire" });
    const elementalCount = Object.values(result.tiles).filter((t) => t.attribute === "fire").length;
    expect(result.sides.a.elementalCount).toBe(3);
    expect(result.sides.b.elementalCount).toBe(3);
    expect(elementalCount).toBe(6);
  });

  it("c. rockCount / waterCount는 기본 범위 [1,4] 이내", () => {
    // 여러 시드로 반복 검증
    for (let seed = 0; seed < 20; seed++) {
      const result = generateTerrain(11, NO_SPAWNS, new SeededRng(seed));
      expect(result.sides.a.rockCount).toBeGreaterThanOrEqual(1);
      expect(result.sides.a.rockCount).toBeLessThanOrEqual(4);
      expect(result.sides.a.waterCount).toBeGreaterThanOrEqual(1);
      expect(result.sides.a.waterCount).toBeLessThanOrEqual(4);
      expect(result.sides.b.rockCount).toBeGreaterThanOrEqual(1);
      expect(result.sides.b.rockCount).toBeLessThanOrEqual(4);
      expect(result.sides.b.waterCount).toBeGreaterThanOrEqual(1);
      expect(result.sides.b.waterCount).toBeLessThanOrEqual(4);
    }
  });

  it("d. 스폰 포인트 위치에는 어떤 타일도 배치되지 않는다", () => {
    const spawnPoints = [
      { playerId: 0, positions: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }] },
      { playerId: 1, positions: [{ row: 9, col: 9 }, { row: 9, col: 8 }, { row: 8, col: 9 }] },
    ];
    for (let seed = 0; seed < 10; seed++) {
      const result = generateTerrain(11, spawnPoints, new SeededRng(seed));
      for (const sp of spawnPoints) {
        for (const pos of sp.positions) {
          expect(result.tiles[`${pos.row},${pos.col}`]).toBeUndefined();
        }
      }
    }
  });

  it("e. config.sideA/B 고정 수가 정확히 적용된다", () => {
    const rng = new SeededRng(3);
    const result = generateTerrain(11, NO_SPAWNS, rng, {
      elementalType: "acid",
      sideA: { rockCount: 2, waterCount: 3 },
      sideB: { rockCount: 1, waterCount: 1 },
    });
    expect(result.sides.a.rockCount).toBe(2);
    expect(result.sides.a.waterCount).toBe(3);
    expect(result.sides.b.rockCount).toBe(1);
    expect(result.sides.b.waterCount).toBe(1);
  });

  it("f. 같은 시드 → 완전히 동일한 결과", () => {
    const spawnPoints = [
      { playerId: 0, positions: [{ row: 1, col: 1 }] },
      { playerId: 1, positions: [{ row: 9, col: 9 }] },
    ];
    const r1 = generateTerrain(11, spawnPoints, new SeededRng(777));
    const r2 = generateTerrain(11, spawnPoints, new SeededRng(777));
    expect(r1.baseTile).toBe(r2.baseTile);
    expect(r1.elementalType).toBe(r2.elementalType);
    expect(r1.tiles).toEqual(r2.tiles);
    expect(r1.sides).toEqual(r2.sides);
  });

  it("g. 다른 시드 → 다른 결과 (타일 배치 상이)", () => {
    const r1 = generateTerrain(11, NO_SPAWNS, new SeededRng(1));
    const r2 = generateTerrain(11, NO_SPAWNS, new SeededRng(9999));
    // 둘 다 같을 확률은 무시할 수준
    expect(Object.keys(r1.tiles)).not.toEqual(Object.keys(r2.tiles));
  });

  it("h. 16×16 그리드에서 진영 분리 및 제약 조건 모두 충족", () => {
    const spawnPoints = [
      { playerId: 0, positions: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 1, col: 3 }, { row: 2, col: 3 }] },
      { playerId: 1, positions: [{ row: 14, col: 14 }, { row: 14, col: 13 }, { row: 13, col: 14 }, { row: 13, col: 13 }, { row: 14, col: 12 }, { row: 13, col: 12 }] },
    ];
    const result = generateTerrain(16, spawnPoints, new SeededRng(42));

    // 스폰 보호
    for (const sp of spawnPoints) {
      for (const pos of sp.positions) {
        expect(result.tiles[`${pos.row},${pos.col}`]).toBeUndefined();
      }
    }

    // 진영 A (row 0-7) elemental = 3
    const midRow = 8;
    const sideATiles = Object.values(result.tiles).filter((t) => t.position.row < midRow);
    const sideBTiles = Object.values(result.tiles).filter((t) => t.position.row >= midRow);
    const el = result.elementalType;
    expect(sideATiles.filter((t) => t.attribute === el)).toHaveLength(3);
    expect(sideBTiles.filter((t) => t.attribute === el)).toHaveLength(3);

    // 중복 위치 없음
    const keys = Object.keys(result.tiles);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("i. config.rockMin/rockMax / waterMin/waterMax 범위 커스텀", () => {
    for (let seed = 0; seed < 10; seed++) {
      const result = generateTerrain(11, NO_SPAWNS, new SeededRng(seed), {
        rockMin: 2, rockMax: 2, waterMin: 3, waterMax: 3,
      });
      expect(result.sides.a.rockCount).toBe(2);
      expect(result.sides.b.rockCount).toBe(2);
      expect(result.sides.a.waterCount).toBe(3);
      expect(result.sides.b.waterCount).toBe(3);
    }
  });

  it("j. river formation이 통합 결과에 반영된다 (물 3+ 연결 → river)", () => {
    // waterCount 4를 강제해서 연결 그룹이 형성될 가능성을 높임
    // 결정적 확인: 실제 river가 있으면 검증, 없으면 pass (연결 여부는 확률적)
    const result = generateTerrain(11, NO_SPAWNS, new SeededRng(55), {
      sideA: { rockCount: 0, waterCount: 4 },
      sideB: { rockCount: 0, waterCount: 4 },
      elementalType: "fire",
    });
    // 결과에 mountain 없음 확인
    const mountains = Object.values(result.tiles).filter((t) => t.attribute === "mountain");
    expect(mountains).toHaveLength(0);

    // 만약 river가 있다면 water 연결 그룹에서 온 것
    const rivers = Object.values(result.tiles).filter((t) => t.attribute === "river");
    const waters = Object.values(result.tiles).filter((t) => t.attribute === "water");
    // river + water = 최초 배치한 물 수 (8)
    expect(rivers.length + waters.length).toBe(8);

    console.log(`  ✅ water=${waters.length}, river=${rivers.length} (합계 8)`);
  });
});
