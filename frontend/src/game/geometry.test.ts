import { describe, expect, it } from "vitest";
import { hitTestOwnedPoint, pointerToNormalized, resolvePointerDown } from "./geometry";
import type { Point } from "../types";

const rect = { left: 10, top: 20, width: 200, height: 100 };

describe("geometry helpers", () => {
  it("converts pointer coordinates to clamped normalized board positions", () => {
    expect(pointerToNormalized(rect, 110, 70)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointerToNormalized(rect, -100, 500)).toEqual({ x: 0, y: 1 });
  });

  it("hit-tests only owned points", () => {
    const points: Point[] = [
      { id: "mine", ownerId: "me", color: "#111111", x: 0.5, y: 0.5 },
      { id: "other", ownerId: "them", color: "#222222", x: 0.5, y: 0.5 }
    ];

    expect(hitTestOwnedPoint(points, "me", rect, 110, 70)).toBe("mine");
    expect(hitTestOwnedPoint(points, "them", rect, 5, 5)).toBeNull();
  });

  it("resolves canvas pointer down as drag or preview", () => {
    const points: Point[] = [{ id: "mine", ownerId: "me", color: "#111111", x: 0.25, y: 0.5 }];

    expect(resolvePointerDown(points, "me", rect, 60, 70)).toEqual({ type: "drag", pointId: "mine" });
    expect(resolvePointerDown(points, "me", rect, 190, 95)).toEqual({
      type: "preview",
      point: { x: 0.9, y: 0.75 }
    });
  });
});
