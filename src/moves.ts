import {
  Move,
  PieceType,
  Position,
  Square,
  handPieceTypes,
  isPromotable,
} from "tsshogi";

/**
 * 現在の手番側の合法手をすべて列挙する。
 * tsshogi には合法手の一括生成がないため、候補を列挙して isValidMove で絞る。
 */
export function generateLegalMoves(pos: Position): Move[] {
  const moves: Move[] = [];
  const color = pos.color;
  // 盤上の自駒の移動
  for (const from of pos.board.listSquaresByColor(color)) {
    const piece = pos.board.at(from);
    if (!piece) continue;
    for (const to of Square.all) {
      if (to.equals(from)) continue;
      const move = pos.createMove(from, to);
      if (!move) continue;
      if (pos.isValidMove(move)) {
        moves.push(move);
      }
      if (isPromotable(piece.type)) {
        const promoted = move.withPromote();
        if (pos.isValidMove(promoted)) {
          moves.push(promoted);
        }
      }
    }
  }
  // 持駒を打つ手
  const hand = pos.hand(color);
  for (const pieceType of handPieceTypes) {
    if (hand.count(pieceType) <= 0) continue;
    for (const to of Square.all) {
      const move = pos.createMove(pieceType as PieceType, to);
      if (move && pos.isValidMove(move)) {
        moves.push(move);
      }
    }
  }
  return moves;
}

const CAPTURE_VALUE: Partial<Record<PieceType, number>> = {
  [PieceType.KING]: 10000,
  [PieceType.DRAGON]: 1100,
  [PieceType.HORSE]: 1000,
  [PieceType.ROOK]: 1000,
  [PieceType.BISHOP]: 900,
  [PieceType.GOLD]: 600,
  [PieceType.PROM_SILVER]: 600,
  [PieceType.PROM_KNIGHT]: 600,
  [PieceType.PROM_LANCE]: 600,
  [PieceType.PROM_PAWN]: 600,
  [PieceType.SILVER]: 500,
  [PieceType.KNIGHT]: 400,
  [PieceType.LANCE]: 300,
  [PieceType.PAWN]: 100,
};

/**
 * 攻め方の王手候補を列挙する。
 * 着手後に相手の玉に王手がかかる手だけを残し、打ち歩詰めになる歩打ちは除外する。
 */
export function generateCheckingMoves(pos: Position): Move[] {
  const legal = generateLegalMoves(pos);
  const checking: Move[] = [];
  for (const move of legal) {
    // 打ち歩詰めは反則として除外
    if (typeof move.from === "string" && move.pieceType === PieceType.PAWN) {
      if (pos.isPawnDropMate(move)) continue;
    }
    if (!pos.doMove(move)) continue;
    const givesCheck = pos.checked;
    pos.undoMove(move);
    if (givesCheck) checking.push(move);
  }
  // 取る手（価値の高い駒を取る手）を先に試すと詰みが早く見つかりやすい
  checking.sort(
    (a, b) =>
      (CAPTURE_VALUE[b.capturedPieceType ?? PieceType.PAWN] ?? 0) -
      (CAPTURE_VALUE[a.capturedPieceType ?? PieceType.PAWN] ?? 0),
  );
  return checking;
}
