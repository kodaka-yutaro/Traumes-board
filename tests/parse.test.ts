import { describe, expect, it } from "vitest";
import { parseBOD, parsePositionText } from "../src/parse";
import { searchMate } from "../src/solver";
import { formatSolution } from "../src/notation";

/** 詰将棋ノート形式のKIFサンプル（後手玉9一・先手金9三・先手持駒金・先手番） */
export const NOTEBOOK_KIF = `後手の持駒：なし
  ９ ８ ７ ６ ５ ４ ３ ２ １
+---------------------------+
|v玉 ・ ・ ・ ・ ・ ・ ・ ・|一
| ・ ・ ・ ・ ・ ・ ・ ・ ・|二
| 金 ・ ・ ・ ・ ・ ・ ・ ・|三
| ・ ・ ・ ・ ・ ・ ・ ・ ・|四
| ・ ・ ・ ・ ・ ・ ・ ・ ・|五
| ・ ・ ・ ・ ・ ・ ・ ・ ・|六
| ・ ・ ・ ・ ・ ・ ・ ・ ・|七
| ・ ・ ・ ・ ・ ・ ・ ・ ・|八
| ・ ・ ・ ・ ・ ・ ・ ・ ・|九
+---------------------------+
先手の持駒：金
先手番
手数----指手---------消費時間--
`;

export const SIMPLE_BOD = `後手の持駒：なし
  ９ ８ ７ ６ ５ ４ ３ ２ １
+---------------------------+
|v玉 ・ ・ ・ ・ ・ ・ ・ ・|一
| ・ ・ ・ ・ ・ ・ ・ ・ ・|二
| 金 ・ ・ ・ ・ ・ ・ ・ ・|三
| ・ ・ ・ ・ ・ ・ ・ ・ ・|四
| ・ ・ ・ ・ ・ ・ ・ ・ ・|五
| ・ ・ ・ ・ ・ ・ ・ ・ ・|六
| ・ ・ ・ ・ ・ ・ ・ ・ ・|七
| ・ ・ ・ ・ ・ ・ ・ ・ ・|八
| ・ ・ ・ ・ ・ ・ ・ ・ ・|九
+---------------------------+
先手の持駒：金
先手番
`;

export const EXPECTED_SFEN = "k8/9/G8/9/9/9/9/9/9 b G 1";

describe("parsePositionText", () => {
  it("詰将棋ノート形式のKIFを読み込める", () => {
    const result = parsePositionText(NOTEBOOK_KIF);
    expect(result.format).toBe("KIF");
    expect(result.sfen).toBe(EXPECTED_SFEN);
  });

  it("SFEN文字列を読み込める", () => {
    const result = parsePositionText(EXPECTED_SFEN);
    expect(result.format).toBe("SFEN");
    expect(result.sfen).toBe(EXPECTED_SFEN);
  });

  it("BOD形式をフォールバックで読み込める", () => {
    expect(parseBOD(SIMPLE_BOD)).toBe(EXPECTED_SFEN);
    const result = parsePositionText(SIMPLE_BOD);
    expect(result.sfen).toBe(EXPECTED_SFEN);
  });

  it("解釈できないテキストはエラーになる", () => {
    expect(() => parsePositionText("hello world")).toThrow();
  });
});
