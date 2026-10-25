import { describe, expect, it } from "vitest";
import { searchMate } from "../src/solver";
import { formatSolution } from "../src/notation";

/** 1手詰め: 後手玉9一、先手金9三、先手持駒金。▲９二金打で詰み */
const MATE1_SFEN = "k8/9/G8/9/9/9/9/9/9 b G 1";

/**
 * 3手詰め（プログラムで検証して選定）:
 * 後手玉9一、先手金7一・銀7二、先手持駒金。
 * ▲７一金→８一 ☖９二玉 ▲８三金打 の手順で詰む。深さ1では詰まない。
 */
const MATE3_SFEN = "k1G6/2S6/9/9/9/9/9/9/9 b G 1";

describe("searchMate", () => {
  it("1手詰めを正しく判定できる", () => {
    const result = searchMate(MATE1_SFEN, {
      maxPlies: 7,
      timeLimitMs: 5000,
    });
    expect(result.status).toBe("mate");
    expect(result.plies).toBe(1);
    expect(result.movesUSI).toEqual(["G*9b"]);
  });

  it("手順を日本語表記に変換できる", () => {
    const result = searchMate(MATE1_SFEN, {
      maxPlies: 7,
      timeLimitMs: 5000,
    });
    expect(result.status).toBe("mate");
    const text = formatSolution(MATE1_SFEN, result.movesUSI ?? []);
    expect(text).toContain("９二金打");
  });

  it("攻め駒のない局面では詰みなしになる", () => {
    const result = searchMate("k8/9/9/9/9/9/9/9/8K b - 1", {
      maxPlies: 7,
      timeLimitMs: 5000,
    });
    expect(result.status).toBe("nomate");
  });

  it("受け方に合法手（玉が金を取れる）がある局面では詰みなしになる", () => {
    const result = searchMate("k8/9/9/9/9/9/9/9/9 b G 1", {
      maxPlies: 7,
      timeLimitMs: 5000,
    });
    expect(result.status).toBe("nomate");
  });

  it("3手詰めを深さ1では詰まず深さ3で詰むと判定できる", () => {
    const shallow = searchMate(MATE3_SFEN, {
      maxPlies: 1,
      timeLimitMs: 5000,
    });
    expect(shallow.status).toBe("nomate");

    const deep = searchMate(MATE3_SFEN, {
      maxPlies: 3,
      timeLimitMs: 5000,
    });
    expect(deep.status).toBe("mate");
    expect(deep.plies).toBe(3);
    expect(deep.movesUSI).toHaveLength(3);
  });
});
