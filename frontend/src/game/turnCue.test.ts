import { describe, expect, it } from "vitest";
import type { GameState } from "../types";
import { countPlayerTurns, shouldShowSatisfactionHint } from "./turnCue";

function stateWithPoints(points: GameState["points"]): Pick<GameState, "points"> {
  return { points };
}

describe("turn cue helpers", () => {
  it("counts player turns without seed points", () => {
    expect(
      countPlayerTurns(
        stateWithPoints([
          { id: "seed-1", ownerId: "__seed__", color: "#111111", x: 0.1, y: 0.2 },
          { id: "player-1", ownerId: "alice", color: "#222222", x: 0.3, y: 0.4 },
          { id: "seed-2", ownerId: "__seed__", color: "#333333", x: 0.5, y: 0.6 },
          { id: "player-2", ownerId: "bob", color: "#444444", x: 0.7, y: 0.8 }
        ])
      )
    ).toBe(2);
  });

  it("shows the satisfaction hint every five player turns", () => {
    expect(shouldShowSatisfactionHint(0)).toBe(false);
    expect(shouldShowSatisfactionHint(4)).toBe(false);
    expect(shouldShowSatisfactionHint(5)).toBe(true);
    expect(shouldShowSatisfactionHint(10)).toBe(true);
  });
});
