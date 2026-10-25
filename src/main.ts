import {
  Color,
  Move,
  PieceType,
  Position,
  Square,
} from "tsshogi";
import { parsePositionText } from "./parse";
import { generateLegalMoves } from "./moves";
import { formatSolution } from "./notation";
import type { SearchRequest, SearchResponse } from "./worker";
import "./style.css";

/** 起動時のデフォルト局面（1手詰のサンプル） */
const DEFAULT_SFEN = "k8/9/G8/9/9/9/9/9/9 b G 1";

const PIECE_KANJI: Record<string, string> = {
  pawn: "歩",
  lance: "香",
  knight: "桂",
  silver: "銀",
  gold: "金",
  bishop: "角",
  rook: "飛",
  king: "玉",
  promPawn: "と",
  promLance: "杏",
  promKnight: "圭",
  promSilver: "全",
  horse: "馬",
  dragon: "龍",
};
const PROMOTED_TYPES = new Set([
  "promPawn",
  "promLance",
  "promKnight",
  "promSilver",
  "horse",
  "dragon",
]);
const HAND_ORDER: PieceType[] = [
  PieceType.ROOK,
  PieceType.BISHOP,
  PieceType.GOLD,
  PieceType.SILVER,
  PieceType.KNIGHT,
  PieceType.LANCE,
  PieceType.PAWN,
];
const FILE_CHARS = ["９", "８", "７", "６", "５", "４", "３", "２", "１"];
const RANK_CHARS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} not found`);
  return element as T;
}

type Selection =
  | { kind: "board"; square: Square }
  | { kind: "hand"; pieceType: PieceType }
  | null;

class App {
  private pos: Position;
  private initialSFEN = DEFAULT_SFEN;
  private history: Move[] = [];
  private selection: Selection = null;
  private targets = new Map<number, Move[]>();
  private pendingPromote: Move[] | null = null;
  private flipped = false;

  private worker: Worker | null = null;
  private searching = false;
  private solution: { rootSFEN: string; movesUSI: string[] } | null = null;
  private solutionApplied = 0;

  private boardEl = el<HTMLDivElement>("board");
  private handTopEl = el<HTMLDivElement>("hand-top");
  private handBottomEl = el<HTMLDivElement>("hand-bottom");
  private turnEl = el<HTMLSpanElement>("turn-indicator");
  private sfenEl = el<HTMLParagraphElement>("sfen-display");
  private pasteMessageEl = el<HTMLParagraphElement>("paste-message");
  private pastePanelEl = el<HTMLDivElement>("paste-panel");
  private pasteTextareaEl = el<HTMLTextAreaElement>("paste-textarea");
  private solverStatusEl = el<HTMLParagraphElement>("solver-status");
  private solverResultEl = el<HTMLParagraphElement>("solver-result");
  private replayControlsEl = el<HTMLDivElement>("replay-controls");
  private replayIndicatorEl = el<HTMLSpanElement>("replay-indicator");
  private promoteDialogEl = el<HTMLDivElement>("promote-dialog");

  constructor() {
    const pos = Position.newBySFEN(DEFAULT_SFEN);
    if (!pos) throw new Error("デフォルト局面の生成に失敗しました");
    this.pos = pos;
    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    el<HTMLButtonElement>("flip-button").addEventListener("click", () => {
      this.flipped = !this.flipped;
      this.selection = null;
      this.targets.clear();
      this.render();
    });
    el<HTMLButtonElement>("undo-button").addEventListener("click", () => {
      this.undo();
    });
    el<HTMLButtonElement>("reset-button").addEventListener("click", () => {
      this.resetToInitial();
    });
    el<HTMLButtonElement>("paste-button").addEventListener("click", () => {
      void this.pasteFromClipboard();
    });
    el<HTMLButtonElement>("paste-manual-button").addEventListener("click", () => {
      this.pastePanelEl.hidden = false;
      this.pasteTextareaEl.focus();
    });
    el<HTMLButtonElement>("paste-close-button").addEventListener("click", () => {
      this.pastePanelEl.hidden = true;
    });
    el<HTMLButtonElement>("paste-load-button").addEventListener("click", () => {
      this.loadFromText(this.pasteTextareaEl.value);
    });
    el<HTMLButtonElement>("search-button").addEventListener("click", () => {
      this.startSearch();
    });
    el<HTMLButtonElement>("cancel-search-button").addEventListener("click", () => {
      this.cancelSearch();
    });
    el<HTMLButtonElement>("replay-back").addEventListener("click", () => {
      this.replayBack();
    });
    el<HTMLButtonElement>("replay-forward").addEventListener("click", () => {
      this.replayForward();
    });
    el<HTMLButtonElement>("promote-yes").addEventListener("click", () => {
      this.resolvePromote(true);
    });
    el<HTMLButtonElement>("promote-no").addEventListener("click", () => {
      this.resolvePromote(false);
    });
  }

  private loadFromText(text: string): void {
    try {
      const result = parsePositionText(text);
      this.initialSFEN = result.sfen;
      this.pos.resetBySFEN(result.sfen);
      this.history = [];
      this.selection = null;
      this.targets.clear();
      this.clearSolution();
      this.pasteMessageEl.textContent = `読み込みました（${result.format}形式）。`;
      this.pasteMessageEl.className = "message ok";
      this.pastePanelEl.hidden = true;
      this.solverResultEl.textContent = "";
      this.solverStatusEl.textContent = "";
      this.render();
    } catch (e) {
      this.pasteMessageEl.textContent =
        e instanceof Error ? e.message : "読み込みに失敗しました。";
      this.pasteMessageEl.className = "message error";
      this.pastePanelEl.hidden = false;
    }
  }

  private async pasteFromClipboard(): Promise<void> {
    if (!navigator.clipboard?.readText) {
      this.pasteMessageEl.textContent =
        "この環境ではクリップボードを直接読めないため、下の欄に貼り付けてください。";
      this.pasteMessageEl.className = "message error";
      this.pastePanelEl.hidden = false;
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim() === "") {
        this.pasteMessageEl.textContent =
          "クリップボードが空でした。下の欄への手動貼り付けもできます。";
        this.pasteMessageEl.className = "message error";
        this.pastePanelEl.hidden = false;
        return;
      }
      this.pasteTextareaEl.value = text;
      this.loadFromText(text);
    } catch {
      this.pasteMessageEl.textContent =
        "クリップボードの読み取りが許可されませんでした。下の欄に貼り付けてください。";
      this.pasteMessageEl.className = "message error";
      this.pastePanelEl.hidden = false;
    }
  }

  private computeTargets(selection: Selection): void {
    this.targets.clear();
    if (!selection) return;
    const legal = generateLegalMoves(this.pos);
    for (const move of legal) {
      if (selection.kind === "board") {
        if (typeof move.from !== "string" && move.from.equals(selection.square)) {
          this.addTarget(move);
        }
      } else {
        if (typeof move.from === "string" && move.from === selection.pieceType) {
          this.addTarget(move);
        }
      }
    }
  }

  private addTarget(move: Move): void {
    const list = this.targets.get(move.to.index) ?? [];
    list.push(move);
    this.targets.set(move.to.index, list);
  }

  private onCellTap(square: Square): void {
    if (this.searching || this.pendingPromote) return;
    if (this.selection) {
      const candidates = this.targets.get(square.index);
      if (candidates && candidates.length > 0) {
        if (candidates.length === 1) {
          this.applyMove(candidates[0]);
        } else {
          this.pendingPromote = candidates;
          this.promoteDialogEl.hidden = false;
        }
        return;
      }
    }
    const piece = this.pos.board.at(square);
    if (piece && piece.color === this.pos.color) {
      this.selection = { kind: "board", square };
      this.computeTargets(this.selection);
    } else {
      this.selection = null;
      this.targets.clear();
    }
    this.render();
  }

  private onHandTap(color: Color, pieceType: PieceType): void {
    if (this.searching || this.pendingPromote) return;
    if (color !== this.pos.color) return;
    if (this.pos.hand(color).count(pieceType) <= 0) return;
    this.selection = { kind: "hand", pieceType };
    this.computeTargets(this.selection);
    this.render();
  }

  private resolvePromote(promote: boolean): void {
    if (!this.pendingPromote) return;
    const move = this.pendingPromote.find((m) => m.promote === promote);
    this.pendingPromote = null;
    this.promoteDialogEl.hidden = true;
    if (move) this.applyMove(move);
  }

  private applyMove(move: Move): void {
    if (!this.pos.doMove(move)) return;
    this.history.push(move);
    this.selection = null;
    this.targets.clear();
    this.clearSolution();
    this.render();
  }

  private undo(): void {
    const last = this.history.pop();
    if (!last) return;
    this.pos.undoMove(last);
    this.selection = null;
    this.targets.clear();
    this.clearSolution();
    this.render();
  }

  private resetToInitial(): void {
    this.pos.resetBySFEN(this.initialSFEN);
    this.history = [];
    this.selection = null;
    this.targets.clear();
    this.clearSolution();
    this.render();
  }

  private startSearch(): void {
    if (this.searching) return;
    this.cancelWorker();
    this.clearSolution();
    this.solverResultEl.textContent = "";
    const maxPlies = Number(el<HTMLSelectElement>("max-plies").value || "15");
    const timeLimitSec = Number(el<HTMLSelectElement>("time-limit").value || "10");
    const rootSFEN = this.pos.sfen;
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.searching = true;
    this.updateSearchUI();
    this.solverStatusEl.textContent = "探索中…";
    this.worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const { result } = event.data;
      this.searching = false;
      this.updateSearchUI();
      this.solverStatusEl.textContent = "";
      if (result.status === "mate" && result.movesUSI && result.plies) {
        this.solution = { rootSFEN, movesUSI: result.movesUSI };
        this.solutionApplied = 0;
        this.solverResultEl.textContent =
          `${result.plies}手詰め ` +
          formatSolution(rootSFEN, result.movesUSI) +
          ` (${result.nodes.toLocaleString()}ノード / ${(result.elapsedMs / 1000).toFixed(1)}秒)`;
      } else if (result.status === "nomate") {
        this.solverResultEl.textContent = `${maxPlies}手まででは詰みなし (${result.nodes.toLocaleString()}ノード / ${(result.elapsedMs / 1000).toFixed(1)}秒で全探索)`;
      } else {
        this.solverResultEl.textContent = `時間切れのため不明 (${result.nodes.toLocaleString()}ノード探索)`;
      }
      this.render();
    };
    this.worker.onerror = () => {
      this.searching = false;
      this.updateSearchUI();
      this.solverStatusEl.textContent = "探索でエラーが発生しました。";
    };
    const request: SearchRequest = {
      type: "search",
      sfen: rootSFEN,
      maxPlies,
      timeLimitMs: timeLimitSec * 1000,
    };
    this.worker.postMessage(request);
  }

  private cancelSearch(): void {
    if (!this.searching) return;
    this.cancelWorker();
    this.searching = false;
    this.updateSearchUI();
    this.solverStatusEl.textContent = "探索をキャンセルしました。";
  }

  private cancelWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private updateSearchUI(): void {
    el<HTMLButtonElement>("search-button").disabled = this.searching;
    el<HTMLButtonElement>("cancel-search-button").disabled = !this.searching;
  }

  private clearSolution(): void {
    this.solution = null;
    this.solutionApplied = 0;
  }

  private replayForward(): void {
    if (!this.solution) return;
    if (this.solutionApplied >= this.solution.movesUSI.length) return;
    if (this.solutionApplied === 0 && this.pos.sfen !== this.solution.rootSFEN) {
      this.pos.resetBySFEN(this.solution.rootSFEN);
      this.history = [];
    }
    const move = this.pos.createMoveByUSI(
      this.solution.movesUSI[this.solutionApplied],
    );
    if (!move) return;
    if (!this.pos.doMove(move)) return;
    this.history.push(move);
    this.solutionApplied += 1;
    this.selection = null;
    this.targets.clear();
    this.render();
  }

  private replayBack(): void {
    if (!this.solution || this.solutionApplied <= 0) return;
    const last = this.history.pop();
    if (!last) return;
    this.pos.undoMove(last);
    this.solutionApplied -= 1;
    this.selection = null;
    this.targets.clear();
    this.render();
  }

  private render(): void {
    this.renderHands();
    this.renderBoard();
    const turnText = this.pos.color === Color.BLACK ? "☗ 先手番" : "☖ 後手番";
    this.turnEl.textContent = this.pos.checked ? `${turnText}（王手）` : turnText;
    this.sfenEl.textContent = this.pos.sfen;
    el<HTMLButtonElement>("undo-button").disabled = this.history.length === 0;
    if (this.solution) {
      this.replayControlsEl.hidden = false;
      this.replayIndicatorEl.textContent = `${this.solutionApplied} / ${this.solution.movesUSI.length} 手`;
      el<HTMLButtonElement>("replay-back").disabled = this.solutionApplied <= 0;
      el<HTMLButtonElement>("replay-forward").disabled =
        this.solutionApplied >= this.solution.movesUSI.length;
    } else {
      this.replayControlsEl.hidden = true;
    }
  }

  private renderHands(): void {
    const topColor = this.flipped ? Color.BLACK : Color.WHITE;
    const bottomColor = this.flipped ? Color.WHITE : Color.BLACK;
    this.renderHand(this.handTopEl, topColor);
    this.renderHand(this.handBottomEl, bottomColor);
  }

  private renderHand(container: HTMLElement, color: Color): void {
    container.innerHTML = "";
    const label = document.createElement("span");
    label.className = "hand-label";
    label.textContent = color === Color.BLACK ? "☗ 先手" : "☖ 後手";
    container.appendChild(label);
    const hand = this.pos.hand(color);
    let empty = true;
    for (const pieceType of HAND_ORDER) {
      const count = hand.count(pieceType);
      if (count <= 0) continue;
      empty = false;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "hand-piece";
      if (
        this.selection?.kind === "hand" &&
        this.selection.pieceType === pieceType &&
        color === this.pos.color
      ) {
        chip.classList.add("selected");
      }
      chip.textContent = PIECE_KANJI[pieceType] + (count > 1 ? String(count) : "");
      chip.addEventListener("click", () => this.onHandTap(color, pieceType));
      container.appendChild(chip);
    }
    if (empty) {
      const none = document.createElement("span");
      none.className = "hand-none";
      none.textContent = "持駒なし";
      container.appendChild(none);
    }
  }

  private renderBoard(): void {
    this.boardEl.innerHTML = "";
    const corner = document.createElement("div");
    this.boardEl.appendChild(corner);
    for (let c = 0; c < 9; c++) {
      const file = this.flipped ? c + 1 : 9 - c;
      const label = document.createElement("div");
      label.className = "coord coord-file";
      label.textContent = FILE_CHARS[9 - file];
      this.boardEl.appendChild(label);
    }
    const corner2 = document.createElement("div");
    this.boardEl.appendChild(corner2);
    for (let r = 0; r < 9; r++) {
      const rank = this.flipped ? 9 - r : r + 1;
      for (let c = 0; c < 9; c++) {
        const file = this.flipped ? c + 1 : 9 - c;
        const square = new Square(file, rank);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        const piece = this.pos.board.at(square);
        if (piece) {
          const span = document.createElement("span");
          span.className = "piece";
          if (piece.color === Color.WHITE) span.classList.add("gote");
          if (PROMOTED_TYPES.has(piece.type)) span.classList.add("promoted");
          span.textContent =
            piece.type === PieceType.KING && piece.color === Color.BLACK
              ? "王"
              : PIECE_KANJI[piece.type];
          cell.appendChild(span);
        }
        if (
          this.selection?.kind === "board" &&
          this.selection.square.equals(square)
        ) {
          cell.classList.add("selected");
        }
        if (this.targets.has(square.index)) {
          cell.classList.add("target");
        }
        cell.addEventListener("click", () => this.onCellTap(square));
        this.boardEl.appendChild(cell);
      }
      const rankLabel = document.createElement("div");
      rankLabel.className = "coord coord-rank";
      rankLabel.textContent = RANK_CHARS[rank - 1];
      this.boardEl.appendChild(rankLabel);
    }
  }
}

new App();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
