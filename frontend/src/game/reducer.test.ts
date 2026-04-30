import { describe, expect, it } from "vitest";
import type { GameState } from "../types";
import { gameUiReducer, initialGameUiState } from "./reducer";

function stateWith(overrides: Partial<GameState> = {}): GameState {
  return {
    room: { id: "private", kind: "private", locked: false, paused: false, lastMovePlayerId: null },
    players: [],
    points: [{ id: "p1", ownerId: "me", color: "#111111", x: 0.2, y: 0.3 }],
    cursors: [],
    endedPlayerIds: [],
    connectedPlayerIds: [],
    ...overrides
  };
}

describe("gameUiReducer", () => {
  it("keeps a selected point while it still exists", () => {
    const selected = gameUiReducer(initialGameUiState, { type: "select_point", pointId: "p1" });
    const next = gameUiReducer(selected, { type: "server_state", state: stateWith() });

    expect(next.selectedPointId).toBe("p1");
  });

  it("clears stale selected points after server updates", () => {
    const selected = gameUiReducer(initialGameUiState, { type: "select_point", pointId: "missing" });
    const next = gameUiReducer(selected, { type: "server_state", state: stateWith() });

    expect(next.selectedPointId).toBeNull();
  });

  it("clears previews when the game is locked", () => {
    const previewing = gameUiReducer(initialGameUiState, { type: "set_preview", point: { x: 0.4, y: 0.5 } });
    const next = gameUiReducer(previewing, {
      type: "server_state",
      state: stateWith({ room: { id: "private", kind: "private", locked: true, paused: false, lastMovePlayerId: null } })
    });

    expect(next.preview).toBeNull();
  });

  it("resets local game state when leaving a room", () => {
    const next = gameUiReducer(
      { ...initialGameUiState, server: stateWith(), preview: { x: 0.4, y: 0.5 }, error: "Problem" },
      { type: "reset" }
    );

    expect(next).toEqual(initialGameUiState);
  });
});
