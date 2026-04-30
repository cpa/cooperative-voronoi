import { describe, expect, it } from "vitest";
import { inverseTransformPoint, transformPoint, transformPoints } from "./viewTransform";

describe("view transforms", () => {
  it("reflects normalized points for every transform", () => {
    const point = { x: 0.2, y: 0.7 };

    expect(transformPoint(point, "identity")).toEqual({ x: 0.2, y: 0.7 });
    expect(transformPoint(point, "flipX")).toEqual({ x: 0.8, y: 0.7 });
    expect(transformPoint(point, "flipY")).toEqual({ x: 0.2, y: 0.30000000000000004 });
    expect(transformPoint(point, "flipXY")).toEqual({ x: 0.8, y: 0.30000000000000004 });
  });

  it("uses the same transform as its inverse", () => {
    const point = { x: 0.35, y: 0.85 };

    expect(inverseTransformPoint(transformPoint(point, "flipX"), "flipX")).toEqual(point);
    expect(inverseTransformPoint(transformPoint(point, "flipY"), "flipY")).toEqual(point);
    expect(inverseTransformPoint(transformPoint(point, "flipXY"), "flipXY")).toEqual(point);
  });

  it("transforms points without changing ownership or color", () => {
    const points = [{ id: "p1", ownerId: "alice", color: "#ff477e", x: 0.1, y: 0.9 }];

    expect(transformPoints(points, "flipXY")).toEqual([
      { id: "p1", ownerId: "alice", color: "#ff477e", x: 0.9, y: 0.09999999999999998 }
    ]);
  });
});
