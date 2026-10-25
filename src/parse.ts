import { Position, importCSA, importKIF } from "tsshogi";

export type ParseResult = {
  sfen: string;
  format: "SFEN" | "KIF" | "CSA" | "BOD";
};

/** 駒の漢字 → SFEN 文字（成駒は + 付き） */
const KANJI_TO_SFEN: Record<string, string> = {
  歩: "P",
  香: "L",
  桂: "N",
  銀: "S",
  金: "G",
  角: "B",
  飛: "R",
  玉: "K",
  王: "K",
  と: "+P",
  杏: "+L",
  圭: "+N",
  全: "+S",
  馬: "+B",
  龍: "+R",
  竜: "+R",
};

const HAND_ORDER = ["R", "B", "G", "S", "N", "L", "P"] as const;

const KANJI_NUMERALS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 漢字数字（十八まで）を数値に変換する。変換できなければ null。 */
function kanjiNumber(text: string): number | null {
  if (text === "") return null;
  if (text === "十") return 10;
  if (text.startsWith("十")) {
    const rest = KANJI_NUMERALS[text.slice(1)];
    return rest ? 10 + rest : null;
  }
  if (text.length >= 2 && text[1] === "十") {
    const tens = KANJI_NUMERALS[text[0]];
    if (!tens) return null;
    const rest = text.slice(2);
    if (rest === "") return tens * 10;
    const ones = KANJI_NUMERALS[rest];
    return ones ? tens * 10 + ones : null;
  }
  return KANJI_NUMERALS[text] ?? null;
}

/** 持駒文字列（例: "歩十三 香三 桂"）を SFEN 文字 → 枚数 に変換する */
function parseHandText(text: string): Map<string, number> {
  const result = new Map<string, number>();
  const cleaned = text.replace(/[　\s]+/g, " ").trim();
  if (cleaned === "" || cleaned === "なし" || cleaned === "無し") {
    return result;
  }
  for (const token of cleaned.split(" ")) {
    if (token === "") continue;
    const head = token[0];
    const sfen = KANJI_TO_SFEN[head];
    if (!sfen || sfen.startsWith("+")) continue;
    let count = 1;
    if (token.length > 1) {
      const n = kanjiNumber(token.slice(1));
      if (n !== null) count = n;
    }
    result.set(sfen, (result.get(sfen) ?? 0) + count);
  }
  return result;
}

function handToSFEN(
  black: Map<string, number>,
  white: Map<string, number>,
): string {
  let out = "";
  for (const p of HAND_ORDER) {
    const n = black.get(p) ?? 0;
    if (n > 0) out += (n > 1 ? String(n) : "") + p;
  }
  for (const p of HAND_ORDER) {
    const n = white.get(p) ?? 0;
    if (n > 0) out += (n > 1 ? String(n) : "") + p.toLowerCase();
  }
  return out === "" ? "-" : out;
}

const RANK_KANJI: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/**
 * BOD形式（持駒行＋盤面グリッド＋手番行）のテキストを SFEN に変換する。
 * 変換できなければ null。
 */
export function parseBOD(text: string): string | null {
  const lines = text.split(/\r?\n/);
  let blackHandText: string | null = null;
  let whiteHandText: string | null = null;
  let turn: "b" | "w" = "b";
  const rows = new Map<number, string[]>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const whiteHand = line.match(/^後手の持駒[:：](.*)$/);
    if (whiteHand) {
      whiteHandText = whiteHand[1];
      continue;
    }
    const blackHand = line.match(/^先手の持駒[:：](.*)$/);
    if (blackHand) {
      blackHandText = blackHand[1];
      continue;
    }
    if (/^先手番/.test(line)) {
      turn = "b";
      continue;
    }
    if (/^後手番/.test(line)) {
      turn = "w";
      continue;
    }
    // 盤面グリッド行: |...|段 の形
    const gridMatch = line.match(/^\|(.*)\|(.)$/);
    if (gridMatch) {
      const rank = RANK_KANJI[gridMatch[2]];
      if (!rank) continue;
      const inner = gridMatch[1].replace(/[　\s]/g, "");
      const cells: string[] = [];
      let i = 0;
      while (i < inner.length && cells.length < 9) {
        const ch = inner[i];
        if (ch === "・" || ch === "･") {
          cells.push("");
          i += 1;
        } else if (ch === "v" || ch === "V") {
          const piece = KANJI_TO_SFEN[inner[i + 1]];
          if (!piece) return null;
          cells.push(piece.toLowerCase());
          i += 2;
        } else {
          const piece = KANJI_TO_SFEN[ch];
          if (!piece) return null;
          cells.push(piece);
          i += 1;
        }
      }
      if (cells.length !== 9) return null;
      rows.set(rank, cells);
    }
  }

  if (rows.size !== 9 || blackHandText === null || whiteHandText === null) {
    return null;
  }
  const rankStrings: string[] = [];
  for (let rank = 1; rank <= 9; rank++) {
    const cells = rows.get(rank);
    if (!cells) return null;
    let row = "";
    let empty = 0;
    for (const cell of cells) {
      if (cell === "") {
        empty += 1;
      } else {
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        row += cell;
      }
    }
    if (empty > 0) row += String(empty);
    rankStrings.push(row);
  }
  const hands = handToSFEN(
    parseHandText(blackHandText),
    parseHandText(whiteHandText),
  );
  const sfen = `${rankStrings.join("/")} ${turn} ${hands} 1`;
  return Position.isValidSFEN(sfen) ? sfen : null;
}

/**
 * 貼り付けられたテキストを自動判定して読み込み、初期局面の SFEN を返す。
 * 判定順: SFEN → KIF → CSA → BOD。すべて失敗したら Error を throw する。
 */
export function parsePositionText(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("テキストが空です。");
  }
  // SFEN らしい文字列（盤面部に / を含み、手番フィールドがある）
  const sfenCandidate = trimmed.split(/\s+/).slice(0, 4).join(" ");
  if (trimmed.includes("/") && Position.isValidSFEN(sfenCandidate)) {
    const pos = Position.newBySFEN(sfenCandidate);
    if (pos) {
      return { sfen: pos.sfen, format: "SFEN" };
    }
  }
  // tsshogi の importKIF/importCSA は形式外の文字列でも標準局面などを返して
  // しまうため、その形式らしいマーカーがある場合にだけ結果を採用する。
  const looksLikeKIF =
    /手数-+指手/.test(trimmed) ||
    /\|.*\|[一二三四五六七八九]/.test(trimmed) ||
    /^先手[:：]/m.test(trimmed) ||
    /^後手[:：]/m.test(trimmed) ||
    /手合割/.test(trimmed) ||
    /^\d+\s*[▲△☗☖]/m.test(trimmed);
  if (looksLikeKIF) {
    const kif = importKIF(trimmed);
    if (!(kif instanceof Error)) {
      return { sfen: kif.initialPosition.sfen, format: "KIF" };
    }
  }
  const looksLikeCSA =
    /(^|\n)V[23]\./.test(trimmed) ||
    /(^|\n)N[+-]/.test(trimmed) ||
    /(^|\n)P[1-9]/.test(trimmed) ||
    /(^|\n)[+-]\d{4}[A-Z]{2}/.test(trimmed) ||
    /(^|\n)PI/.test(trimmed);
  if (looksLikeCSA) {
    const csa = importCSA(trimmed);
    if (!(csa instanceof Error)) {
      return { sfen: csa.initialPosition.sfen, format: "CSA" };
    }
  }
  const bod = parseBOD(trimmed);
  if (bod) {
    const pos = Position.newBySFEN(bod);
    if (pos) {
      return { sfen: pos.sfen, format: "BOD" };
    }
  }
  throw new Error(
    "棋譜を読み込めませんでした。SFEN / KIF / CSA / BOD のいずれの形式でも解釈できません。",
  );
}
