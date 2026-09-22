import { isLegalMove, uciToMove } from "./xiangqi.js";

export function selectHintMove(board, side, principalVariation) {
  if (!Array.isArray(principalVariation) || !principalVariation.length) {
    return null;
  }

  const uci = String(principalVariation[0] || "").trim().toLowerCase();
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) return null;

  try {
    const move = uciToMove(uci);
    return isLegalMove(board, side, move) ? move : null;
  } catch {
    return null;
  }
}
