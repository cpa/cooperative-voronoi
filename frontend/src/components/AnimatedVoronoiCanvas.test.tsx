import { describe, expect, it } from "vitest";
import { GAME_CANVAS_COLORS } from "../game/colors";
import { INDEX_CANVAS_COLORS } from "./AnimatedVoronoiCanvas";

describe("AnimatedVoronoiCanvas", () => {
  it("uses the same color palette as game mode", () => {
    expect(INDEX_CANVAS_COLORS).toBe(GAME_CANVAS_COLORS);
    expect(INDEX_CANVAS_COLORS.background).toBe(GAME_CANVAS_COLORS.background);
    expect(INDEX_CANVAS_COLORS.cellAlpha).toBe(GAME_CANVAS_COLORS.cellAlpha);
    expect([...INDEX_CANVAS_COLORS.pointColors]).toEqual([...GAME_CANVAS_COLORS.pointColors]);
  });
});
