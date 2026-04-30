import type { GameState } from "../types";

export const SEED_OWNER_ID = "__seed__";

export function countPlayerTurns(state: Pick<GameState, "points"> | null | undefined): number {
  return state?.points.filter((point) => point.ownerId !== SEED_OWNER_ID).length ?? 0;
}

export function shouldShowSatisfactionHint(turnCount: number): boolean {
  return turnCount > 0 && turnCount % 5 === 0;
}
