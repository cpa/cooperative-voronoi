import { describe, expect, it, vi } from "vitest";
import type { GameState } from "../types";
import { shareGameLink, shouldShowFirstPlayerSharePrompt } from "./share";

function stateWith(players: GameState["players"]): GameState {
  return {
    room: { id: "Room123", kind: "private", locked: false, paused: false, lastMovePlayerId: null },
    players,
    points: [],
    cursors: [],
    endedPlayerIds: [],
    connectedPlayerIds: players.map((player) => player.id)
  };
}

describe("share helpers", () => {
  it("shows the first-player prompt only to the only known player", () => {
    const state = stateWith([
      { id: "me", name: "Me", color: "#111111", connected: true, ended: false, pointsCount: 0, viewTransform: "identity" }
    ]);

    expect(shouldShowFirstPlayerSharePrompt(state, "me", new Set())).toBe(true);
    expect(shouldShowFirstPlayerSharePrompt(state, "other", new Set())).toBe(false);
    expect(shouldShowFirstPlayerSharePrompt(state, "me", new Set(["Room123"]))).toBe(false);
  });

  it("hides the first-player prompt once another player is known", () => {
    const state = stateWith([
      { id: "me", name: "Me", color: "#111111", connected: true, ended: false, pointsCount: 0, viewTransform: "identity" },
      {
        id: "other",
        name: "Other",
        color: "#222222",
        connected: true,
        ended: false,
        pointsCount: 0,
        viewTransform: "identity"
      }
    ]);

    expect(shouldShowFirstPlayerSharePrompt(state, "me", new Set())).toBe(false);
  });

  it("uses native share before clipboard fallback", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    await expect(shareGameLink({ share, clipboard }, "https://example.test/g/Room123")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Voronoi game",
      text: "Join this Voronoi game.",
      url: "https://example.test/g/Room123"
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to clipboard when native share is unavailable", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    await expect(shareGameLink({ clipboard }, "https://example.test/g/Room123")).resolves.toBe("copied");
    expect(clipboard.writeText).toHaveBeenCalledWith("https://example.test/g/Room123");
  });
});
