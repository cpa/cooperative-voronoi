import type { Point, ViewTransform } from "../types";
import type { NormalizedPoint } from "./geometry";

export const VIEW_TRANSFORMS: ViewTransform[] = ["identity", "flipX", "flipY", "flipXY"];

export function transformPoint(point: NormalizedPoint, transform: ViewTransform): NormalizedPoint {
  switch (transform) {
    case "flipX":
      return { x: 1 - point.x, y: point.y };
    case "flipY":
      return { x: point.x, y: 1 - point.y };
    case "flipXY":
      return { x: 1 - point.x, y: 1 - point.y };
    case "identity":
    default:
      return point;
  }
}

export function inverseTransformPoint(point: NormalizedPoint, transform: ViewTransform): NormalizedPoint {
  return transformPoint(point, transform);
}

export function transformPoints(points: Point[], transform: ViewTransform): Point[] {
  if (transform === "identity") {
    return points;
  }
  return points.map((point) => ({ ...point, ...transformPoint(point, transform) }));
}
