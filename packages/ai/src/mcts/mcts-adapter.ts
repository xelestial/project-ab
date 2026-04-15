/**
 * MCTSAdapter — Monte Carlo Tree Search AI.
 *
 * Phase 3: ActionProcessor 기반 실제 게임 상태 롤아웃 구현.
 *
 * MCTS 흐름:
 *   1. Selection   — UCB1으로 트리 탐색 (미방문 자식 우선)
 *   2. Expansion   — 리프 노드에서 자식 확장 (후보 액션 생성)
 *   3. Simulation  — 최대 N스텝 랜덤 롤아웃 → 상태 평가
 *   4. Backprop    — 평점을 트리 위로 역전파
 *
 * 설정 (MCTSOptions):
 *   iterations    — 반복 횟수 (default: 200)
 *   explorationC  — UCB1 탐색 상수 C (default: √2)
 *   timeoutMs     — 하드 타임 캡 (default: 1000 ms)
 *   rolloutDepth  — 롤아웃 최대 깊이 (default: 6 액션)
 */
import type { GameState, PlayerAction, PlayerId, UnitId } from "@ab/metadata";
import type {
  IPlayerAdapter,
  IMovementValidator,
  IAttackValidator,
  IActionProcessor,
} from "@ab/engine";
import { getPlayerUnits, getAliveUnits, manhattanDistance } from "@ab/engine";

// ─── MCTS node ────────────────────────────────────────────────────────────────

interface MctsNode {
  action: PlayerAction | null;
  wins: number;
  visits: number;
  children: MctsNode[];
  parent: MctsNode | null;
  expanded: boolean;
}

function makeNode(action: PlayerAction | null, parent: MctsNode | null): MctsNode {
  return { action, wins: 0, visits: 0, children: [], parent, expanded: false };
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface MCTSOptions {
  iterations?: number;
  explorationC?: number;
  timeoutMs?: number;
  rolloutDepth?: number;
}

const DEFAULTS: Required<MCTSOptions> = {
  iterations: 200,
  explorationC: Math.SQRT2,
  timeoutMs: 1000,
  rolloutDepth: 6,
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class MCTSAdapter implements IPlayerAdapter {
  readonly type = "ai" as const;

  private readonly opts: Required<MCTSOptions>;

  constructor(
    readonly playerId: string,
    private readonly movementValidator: IMovementValidator,
    private readonly attackValidator: IAttackValidator,
    private readonly actionProcessor?: IActionProcessor,
    options: MCTSOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  async requestDraftPlacement(
    state: GameState,
    _timeoutMs: number,
  ): Promise<Extract<PlayerAction, { type: "draft_place" }>> {
    const pool = state.draft?.poolIds ?? [];
    const firstUnit = pool[0];
    if (firstUnit === undefined) throw new Error("Empty draft pool");

    // 이미 드래프트되지 않은 첫 유닛 선택
    const draftedIds = new Set(state.draft?.slots.map((s) => s.metaId) ?? []);
    const available = pool.find((id) => !draftedIds.has(id)) ?? firstUnit;

    return {
      type: "draft_place",
      playerId: this.playerId as PlayerId,
      unitId: "" as UnitId,
      metaId: available,
      position: { row: 0, col: 0 }, // 실제 스폰 포인트: registry에서 조회 필요
    };
  }

  async requestAction(state: GameState, timeoutMs?: number): Promise<PlayerAction> {
    const deadline = Date.now() + (timeoutMs ?? this.opts.timeoutMs);
    const root = makeNode(null, null);

    // 후보 액션이 없으면 pass
    const candidates = this.getCandidateActions(state);
    if (candidates.length === 0) return this.makePass(state);

    // 즉시 승리 가능한 액션이 있으면 바로 반환 (공격으로 상대 전멸)
    if (this.actionProcessor !== undefined) {
      for (const action of candidates) {
        if (action.type === "attack") {
          const result = this.actionProcessor.process(action, state);
          if (result.accepted) {
            const enemies = getAliveUnits(result.newState).filter(
              (u) => u.playerId !== this.playerId,
            );
            if (enemies.length === 0) return action; // 즉시 승리
          }
        }
      }
    }

    // 루트 노드 자식 확장
    for (const action of candidates) {
      root.children.push(makeNode(action, root));
    }
    root.expanded = true;

    // MCTS 반복
    let iter = 0;
    while (iter < this.opts.iterations && Date.now() < deadline) {
      const leaf = this.select(root);
      const score = this.simulate(leaf, state);
      this.backpropagate(leaf, score);
      iter++;
    }

    // 가장 많이 방문된 자식 선택 (robust child)
    const best = root.children.reduce((a, b) => (a.visits > b.visits ? a : b));
    return best.action ?? this.makePass(state);
  }

  onStateUpdate(_state: GameState): void {
    // 향후 점진적 트리 재사용에 사용 가능
  }

  // ─── MCTS 4단계 ──────────────────────────────────────────────────────────────

  private select(node: MctsNode): MctsNode {
    let current = node;
    while (current.children.length > 0 && current.expanded) {
      const unvisited = current.children.find((c) => c.visits === 0);
      if (unvisited !== undefined) return unvisited;

      current = current.children.reduce((best, child) => {
        const ucb = this.ucb1(child, current);
        return ucb > this.ucb1(best, current) ? child : best;
      });
    }
    return current;
  }

  private ucb1(node: MctsNode, parent: MctsNode): number {
    if (node.visits === 0) return Infinity;
    const exploit = node.wins / node.visits;
    const explore = this.opts.explorationC * Math.sqrt(Math.log(parent.visits + 1) / node.visits);
    return exploit + explore;
  }

  /**
   * 시뮬레이션 (롤아웃):
   * - ActionProcessor가 주입된 경우: 실제 게임 상태로 rolloutDepth 스텝 롤아웃
   * - 미주입: 액션 타입 기반 휴리스틱 평가
   */
  private simulate(node: MctsNode, state: GameState): number {
    if (node.action === null) return 0.5;

    // ActionProcessor 기반 실제 롤아웃
    if (this.actionProcessor !== undefined) {
      return this.rollout(node.action, state);
    }

    // 폴백: 휴리스틱
    return this.heuristicScore(node.action, state);
  }

  /**
   * 실제 상태 전이 기반 롤아웃.
   * rolloutDepth 스텝까지 랜덤 유효 액션을 적용하고 최종 상태를 평가.
   */
  private rollout(firstAction: PlayerAction, state: GameState): number {
    if (this.actionProcessor === undefined) return 0.5;

    const result = this.actionProcessor.process(firstAction, state);
    if (!result.accepted) return 0.3; // 유효하지 않은 액션

    let current = result.newState;
    let depth = 0;

    while (depth < this.opts.rolloutDepth) {
      const allAlive = getAliveUnits(current);
      const myAlive = allAlive.filter((u) => u.playerId === this.playerId);
      const enemyAlive = allAlive.filter((u) => u.playerId !== this.playerId);

      if (myAlive.length === 0) return 0.0; // 패배
      if (enemyAlive.length === 0) return 1.0; // 승리

      // 현재 턴 플레이어의 랜덤 유효 액션
      const turnSlot = current.turnOrder[current.currentTurnIndex];
      if (turnSlot === undefined) break;

      const activePid = turnSlot.playerId;
      const activeUnits = getPlayerUnits(current, activePid).filter((u) => u.alive);
      if (activeUnits.length === 0) break;

      // 랜덤 액션 후보 생성
      const candidates = this.getCandidateActionsForPlayer(current, activePid);
      if (candidates.length === 0) break;

      const randomAction = candidates[Math.floor(Math.random() * candidates.length)]!;
      const step = this.actionProcessor.process(randomAction, current);
      if (!step.accepted) break;

      current = step.newState;
      depth++;
    }

    return this.evaluateState(current);
  }

  /**
   * 상태 평가 함수: [0, 1] 범위.
   * 1.0 = 나만 살아있음, 0.0 = 내 유닛 모두 사망.
   * 중간값: HP 비율 + 유닛 수 비율 합산.
   */
  private evaluateState(state: GameState): number {
    const allUnits = Object.values(state.units);
    const myUnits = allUnits.filter((u) => u.alive && u.playerId === this.playerId);
    const enemyUnits = allUnits.filter((u) => u.alive && u.playerId !== this.playerId);

    if (myUnits.length === 0) return 0.0;
    if (enemyUnits.length === 0) return 1.0;

    const totalCount = myUnits.length + enemyUnits.length;
    const countScore = myUnits.length / totalCount;

    const myHp = myUnits.reduce((s, u) => s + u.currentHealth, 0);
    const enemyHp = enemyUnits.reduce((s, u) => s + u.currentHealth, 0);
    const totalHp = myHp + enemyHp;
    const hpScore = totalHp > 0 ? myHp / totalHp : 0.5;

    return 0.4 * countScore + 0.6 * hpScore;
  }

  /** 폴백 휴리스틱 (ActionProcessor 미주입 시) */
  private heuristicScore(action: PlayerAction, state: GameState): number {
    const myUnits = getPlayerUnits(state, this.playerId).filter((u) => u.alive);
    const enemies = getAliveUnits(state).filter((u) => u.playerId !== this.playerId);

    if (enemies.length === 0) return 1.0;
    if (myUnits.length === 0) return 0.0;

    switch (action.type) {
      case "attack": return 0.7;
      case "extinguish": return 0.6;
      case "move": return 0.55;
      case "pass": return 0.4;
      default: return 0.5;
    }
  }

  private backpropagate(node: MctsNode, score: number): void {
    let current: MctsNode | null = node;
    while (current !== null) {
      current.visits += 1;
      current.wins += score;
      current = current.parent;
    }
  }

  // ─── 액션 후보 생성 ──────────────────────────────────────────────────────────

  private getCandidateActions(state: GameState): PlayerAction[] {
    return this.getCandidateActionsForPlayer(state, this.playerId);
  }

  private getCandidateActionsForPlayer(state: GameState, pid: string): PlayerAction[] {
    const myUnits = getPlayerUnits(state, pid).filter((u) => u.alive);
    const enemies = getAliveUnits(state).filter((u) => u.playerId !== pid);
    const actions: PlayerAction[] = [];

    for (const unit of myUnits) {
      // 공격 (적 점유 타일 우선)
      if (!unit.actionsUsed.attacked) {
        const targets = this.attackValidator.getAttackableTargets(unit, state);
        const enemyTargets = targets.filter((t) =>
          enemies.some((e) => e.position.row === t.row && e.position.col === t.col),
        );
        // 적 점유 타일 우선, 최대 3개
        for (const target of (enemyTargets.length > 0 ? enemyTargets : targets).slice(0, 3)) {
          actions.push({
            type: "attack",
            playerId: pid as PlayerId,
            unitId: unit.unitId,
            target,
          });
        }
      }

      // 이동 (적에게 가까워지는 방향 우선, 최대 3개)
      if (!unit.actionsUsed.moved && enemies.length > 0) {
        const reachable = this.movementValidator.getReachableTiles(unit, state);
        const nearest = enemies.reduce((a, b) =>
          manhattanDistance(a.position, unit.position) <= manhattanDistance(b.position, unit.position)
            ? a : b,
        );
        const sorted = [...reachable].sort(
          (a, b) =>
            manhattanDistance(a, nearest.position) - manhattanDistance(b, nearest.position),
        );
        for (const dest of sorted.slice(0, 3)) {
          actions.push({
            type: "move",
            playerId: pid as PlayerId,
            unitId: unit.unitId,
            destination: dest,
          });
        }
      }

      // 소화 (화재 상태 시)
      if (!unit.actionsUsed.extinguished && !unit.actionsUsed.attacked) {
        const hasFire = unit.activeEffects.some((e) => e.effectType === "fire");
        if (hasFire) {
          actions.push({
            type: "extinguish",
            playerId: pid as PlayerId,
            unitId: unit.unitId,
          });
        }
      }
    }

    if (actions.length === 0) {
      actions.push(this.makePassForPlayer(state, pid));
    }

    return actions;
  }

  private makePass(state: GameState): PlayerAction {
    return this.makePassForPlayer(state, this.playerId);
  }

  private makePassForPlayer(state: GameState, pid: string): PlayerAction {
    const unit = getPlayerUnits(state, pid).find((u) => u.alive);
    return {
      type: "pass",
      playerId: pid as PlayerId,
      unitId: (unit?.unitId ?? "") as UnitId,
    };
  }
}
