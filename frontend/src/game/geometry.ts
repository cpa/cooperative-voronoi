import type { Point } from "../types";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type PointerIntent =
  | { type: "drag"; pointId: string }
  | { type: "preview"; point: NormalizedPoint };

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function pointerToNormalized(rect: RectLike, clientX: number, clientY: number): NormalizedPoint {
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height)
  };
}

export function normalizedToCanvas(point: NormalizedPoint, width: number, height: number): NormalizedPoint {
  return {
    x: point.x * width,
    y: point.y * height
  };
}

export function hitTestOwnedPoint(
  points: Point[],
  ownerId: string,
  rect: RectLike,
  clientX: number,
  clientY: number,
  radiusPx = 22
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const point of points) {
    if (point.ownerId !== ownerId) {
      continue;
    }
    const canvasPoint = normalizedToCanvas(point, rect.width, rect.height);
    const distance = Math.hypot(canvasPoint.x + rect.left - clientX, canvasPoint.y + rect.top - clientY);
    if (distance <= radiusPx && (!best || distance < best.distance)) {
      best = { id: point.id, distance };
    }
  }
  return best?.id ?? null;
}

export function resolvePointerDown(
  points: Point[],
  ownerId: string,
  rect: RectLike,
  clientX: number,
  clientY: number
): PointerIntent {
  const pointId = hitTestOwnedPoint(points, ownerId, rect, clientX, clientY);
  if (pointId) {
    return { type: "drag", pointId };
  }
  return {
    type: "preview",
    point: pointerToNormalized(rect, clientX, clientY)
  };
}
