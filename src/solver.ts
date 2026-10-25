import { Move, Position } from "tsshogi";
import { generateCheckingMoves, generateLegalMoves } from "./moves";

export type MateStatus = "mate" | "nomate" | "timeout";

export type MateResult = {
  status: MateStatus;
  /** 詰みが見つかった場合の手数 */
  plies?: number;
  /** 詰みの手順（USI形式） */
  movesUSI?: string[];
  /** 探索したノード数 */
  nodes: number;
  /** 探索にかかった時間 [ms] */
  elapsedMs: number;
};

export type MateOptions = {
  /** 最大手数（奇数に丸める） */
  maxPlies: number;
  /** 制限時間 [ms] */
  timeLimitMs: number;
};

class TimeoutError extends Error {}

type NodeResult = {
  mate: boolean;
  /** この局面からの読み手順（mate の場合のみ） */
  moves: Move[];
  /** 繰り返し局面による打ち切りを含まない「クリーン」な結果か */
  clean: boolean;
};

/** 手数フィールドを除いた局面キー（置換表・繰り返し判定用） */
function positionKey(pos: Position): string {
  return pos.sfen.split(" ").slice(0, 3).join(" ");
}

class MateSearcher {
  private pos: Position;
  private deadline: number;
  private nodes = 0;
  private path = new Set<string>();
  /** 詰みが証明できた局面: キー → {手数, 手順USI} */
  private mateTT = new Map<string, { plies: number; movesUSI: string[] }>();
  /** 詰みなしが証明できた局面: キー → 証明できた最大深さ */
  private nomateTT = new Map<string, number>();

  constructor(rootSFEN: string, timeLimitMs: number) {
    const pos = Position.newBySFEN(rootSFEN);
    if (!pos) throw new Error(`Invalid SFEN: ${rootSFEN}`);
    this.pos = pos;
    this.deadline = Date.now() + timeLimitMs;
  }

  get nodeCount(): number {
    return this.nodes;
  }

  private tick(): void {
    this.nodes += 1;
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) {
      throw new TimeoutError();
    }
  }

  search(maxPlies: number): MateResult {
    const started = Date.now();
    const limit = maxPlies % 2 === 0 ? maxPlies - 1 : maxPlies;
    try {
      for (let depth = 1; depth <= limit; depth += 2) {
        if (Date.now() > this.deadline) throw new TimeoutError();
        this.path = new Set([positionKey(this.pos)]);
        const result = this.attackerNode(depth);
        if (result.mate) {
          return {
            status: "mate",
            plies: result.moves.length,
            movesUSI: result.moves.map((m) => m.usi),
            nodes: this.nodes,
            elapsedMs: Date.now() - started,
          };
        }
      }
      return {
        status: "nomate",
        nodes: this.nodes,
        elapsedMs: Date.now() - started,
      };
    } catch (e) {
      if (e instanceof TimeoutError) {
        return {
          status: "timeout",
          nodes: this.nodes,
          elapsedMs: Date.now() - started,
        };
      }
      throw e;
    }
  }

  /** 攻め方のノード: 王手のうちいずれかで詰ませられれば成功 */
  private attackerNode(depth: number): NodeResult {
    this.tick();
    const key = positionKey(this.pos);
    const mateHit = this.mateTT.get(key);
    if (mateHit && mateHit.plies <= depth) {
      const moves = mateHit.movesUSI
        .map((usi) => this.pos.createMoveByUSI(usi))
        .filter((m): m is Move => m !== null);
      if (moves.length === mateHit.plies) {
        return { mate: true, moves, clean: true };
      }
    }
    const nomateDepth = this.nomateTT.get(key);
    if (nomateDepth !== undefined && nomateDepth >= depth) {
      return { mate: false, moves: [], clean: true };
    }
    if (depth <= 0) {
      return { mate: false, moves: [], clean: true };
    }
    const checking = generateCheckingMoves(this.pos);
    if (checking.length === 0) {
      if ((this.nomateTT.get(key) ?? -1) < depth) {
        this.nomateTT.set(key, depth);
      }
      return { mate: false, moves: [], clean: true };
    }
    let clean = true;
    for (const move of checking) {
      if (!this.pos.doMove(move)) continue;
      const childKey = positionKey(this.pos);
      if (this.path.has(childKey)) {
        // 同一手順内で同じ局面が再出現 → このラインは不成立
        this.pos.undoMove(move);
        clean = false;
        continue;
      }
      this.path.add(childKey);
      const sub = this.defenderNode(depth - 1);
      this.path.delete(childKey);
      this.pos.undoMove(move);
      if (sub.mate) {
        const moves = [move, ...sub.moves];
        if (sub.clean) {
          const prev = this.mateTT.get(key);
          if (!prev || prev.plies > moves.length) {
            this.mateTT.set(key, {
              plies: moves.length,
              movesUSI: moves.map((m) => m.usi),
            });
          }
        }
        return { mate: true, moves, clean: sub.clean };
      }
      if (!sub.clean) clean = false;
    }
    if (clean && (this.nomateTT.get(key) ?? -1) < depth) {
      this.nomateTT.set(key, depth);
    }
    return { mate: false, moves: [], clean };
  }

  /** 受け方のノード: すべての応手が詰まされれば成功 */
  private defenderNode(depth: number): NodeResult {
    this.tick();
    // 王手がかかっていなければ攻め失敗（通常は到達しない）
    if (!this.pos.checked) {
      return { mate: false, moves: [], clean: true };
    }
    const key = positionKey(this.pos);
    const mateHit = this.mateTT.get(key);
    if (mateHit && mateHit.plies <= depth) {
      const moves = mateHit.movesUSI
        .map((usi) => this.pos.createMoveByUSI(usi))
        .filter((m): m is Move => m !== null);
      if (moves.length === mateHit.plies) {
        return { mate: true, moves, clean: true };
      }
    }
    const nomateDepth = this.nomateTT.get(key);
    if (nomateDepth !== undefined && nomateDepth >= depth) {
      return { mate: false, moves: [], clean: true };
    }
    const legal = generateLegalMoves(this.pos);
    if (legal.length === 0) {
      // 王手がかかっていて応手なし = 詰み
      this.mateTT.set(key, { plies: 0, movesUSI: [] });
      return { mate: true, moves: [], clean: true };
    }
    if (depth <= 0) {
      return { mate: false, moves: [], clean: true };
    }
    let clean = true;
    let mainLine: Move[] | null = null;
    for (const move of legal) {
      if (!this.pos.doMove(move)) continue;
      const childKey = positionKey(this.pos);
      if (this.path.has(childKey)) {
        // 受け方が繰り返し局面に持ち込める = 攻めは不成立
        this.pos.undoMove(move);
        return { mate: false, moves: [], clean: false };
      }
      this.path.add(childKey);
      const sub = this.attackerNode(depth - 1);
      this.path.delete(childKey);
      this.pos.undoMove(move);
      if (!sub.mate) {
        if (clean && (this.nomateTT.get(key) ?? -1) < depth) {
          this.nomateTT.set(key, depth);
        }
        return { mate: false, moves: [], clean: clean && sub.clean };
      }
      if (!sub.clean) clean = false;
      if (mainLine === null) {
        mainLine = [move, ...sub.moves];
      }
    }
    if (mainLine !== null) {
      if (clean) {
        const prev = this.mateTT.get(key);
        if (!prev || prev.plies > mainLine.length) {
          this.mateTT.set(key, {
            plies: mainLine.length,
            movesUSI: mainLine.map((m) => m.usi),
          });
        }
      }
      return { mate: true, moves: mainLine, clean };
    }
    return { mate: false, moves: [], clean };
  }
}

/** 詰将棋式の詰み探索（反復深化） */
export function searchMate(rootSFEN: string, options: MateOptions): MateResult {
  const searcher = new MateSearcher(rootSFEN, options.timeLimitMs);
  return searcher.search(options.maxPlies);
}
