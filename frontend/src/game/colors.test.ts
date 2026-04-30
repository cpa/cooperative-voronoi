import { describe, expect, it } from "vitest";
import { FLASHY_COLORS, displayPointColor } from "./colors";

describe("color helpers", () => {
  it("keeps flashy colors unchanged", () => {
    expect(displayPointColor(FLASHY_COLORS[0], "point-1", 0)).toBe(FLASHY_COLORS[0]);
  });

  it("maps legacy colors to a deterministic flashy color", () => {
    const first = displayPointColor("#111111", "legacy-point", 0);
    const second = displayPointColor("#111111", "legacy-point", 0);

    expect(FLASHY_COLORS).toContain(first);
    expect(second).toBe(first);
  });
});
