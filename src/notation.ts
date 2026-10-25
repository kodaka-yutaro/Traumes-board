import { Position, formatMove } from "tsshogi";

/**
 * USI形式の手順を、開始局面から再生しながら日本語表記に変換する。
 * 例: "☗９二金打 ☖８一玉 ..."
 */
export function formatSolution(rootSFEN: string, movesUSI: string[]): string {
  const pos = Position.newBySFEN(rootSFEN);
  if (!pos) return movesUSI.join(" ");
  const parts: string[] = [];
  for (const usi of movesUSI) {
    const move = pos.createMoveByUSI(usi);
    if (!move) break;
    parts.push(formatMove(pos, move));
    if (!pos.doMove(move)) break;
  }
  return parts.join(" ");
}
