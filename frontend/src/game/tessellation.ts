import { Delaunay } from "d3-delaunay";
import type { Point, ViewTransform } from "../types";
import { GAME_CANVAS_COLORS, displayPointColor } from "./colors";
import { transformPoints } from "./viewTransform";

export type TessellationPoint = Pick<Point, "id" | "color" | "x" | "y">;

type VoronoiCellPolygon = Array<[number, number]>;

interface VoronoiCell {
  polygon: VoronoiCellPolygon;
  color: string;
}

interface VoronoiBoundaryEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DrawTessellationOptions {
  background?: string;
  alpha?: number;
  structure?: boolean;
}

export function drawTessellation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: TessellationPoint[],
  options: DrawTessellationOptions = {}
) {
  const background = options.background ?? GAME_CANVAS_COLORS.background;
  const alpha = options.alpha ?? GAME_CANVAS_COLORS.cellAlpha;
  const structure = options.structure ?? true;
  context.clearRect(0, 0, width, height);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  drawVoronoi(context, width, height, points, alpha, structure);
}

export function drawVoronoi(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: TessellationPoint[],
  alpha = 0.42,
  structure = true
) {
  if (!points.length) {
    return;
  }
  const delaunay = Delaunay.from(
    points,
    (point) => point.x * width,
    (point) => point.y * height
  );
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  const cells: VoronoiCell[] = [];
  points.forEach((point, index) => {
    const polygon = voronoi.cellPolygon(index);
    if (!polygon) {
      return;
    }
    const color = displayPointColor(point.color, point.id, index);
    cells.push({ polygon, color });
    context.beginPath();
    polygon.forEach(([x, y], vertexIndex) => {
      if (vertexIndex === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
    context.fillStyle = hexToRgba(color, alpha);
    context.fill();
  });
  if (structure) {
    drawContrastingVoronoiEdges(context, collectContrastingVoronoiEdges(cells));
  }
}

export function collectContrastingVoronoiEdges(cells: VoronoiCell[]) {
  const edges = new Map<string, VoronoiBoundaryEdge & { colors: Set<string>; count: number }>();
  cells.forEach(({ polygon, color }) => {
    const cellEdges = new Set<string>();
    polygon.forEach(([x1, y1], index) => {
      const next = polygon[(index + 1) % polygon.length];
      if (!next) {
        return;
      }
      const [x2, y2] = next;
      const key = edgeKey(x1, y1, x2, y2);
      if (!key || cellEdges.has(key)) {
        return;
      }
      cellEdges.add(key);
      const edge = edges.get(key);
      if (edge) {
        edge.colors.add(color);
        edge.count += 1;
      } else {
        edges.set(key, { x1, y1, x2, y2, colors: new Set([color]), count: 1 });
      }
    });
  });
  return Array.from(edges.values())
    .filter((edge) => edge.count > 1 && edge.colors.size > 1)
    .map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
}

export function drawContrastingVoronoiEdges(
  context: CanvasRenderingContext2D,
  edges: VoronoiBoundaryEdge[]
) {
  context.save();
  context.strokeStyle = "rgba(17, 24, 28, 0.24)";
  context.lineCap = "round";
  context.lineWidth = 1.25;
  edges.forEach((edge) => {
    context.beginPath();
    context.moveTo(edge.x1, edge.y1);
    context.lineTo(edge.x2, edge.y2);
    context.stroke();
  });
  context.restore();
}

export function createTessellationBlob(
  points: Point[],
  transform: ViewTransform,
  width: number,
  height: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const maxSide = 1400;
  const scale = Math.max(1, Math.min(maxSide / Math.max(width, height), 3));
  const imageWidth = Math.max(320, Math.round(width * scale));
  const imageHeight = Math.max(320, Math.round(height * scale));
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.reject(new Error("Could not create image canvas."));
  }
  drawTessellation(context, imageWidth, imageHeight, transformPoints(points, transform), {
    background: "#f7f4ec",
    alpha: 0.48
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create tessellation image."));
      }
    }, "image/png");
  });
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return `rgba(104, 112, 120, ${alpha})`;
  }
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pointKey(x: number, y: number) {
  return `${Math.round(x * 100) / 100}:${Math.round(y * 100) / 100}`;
}

function edgeKey(x1: number, y1: number, x2: number, y2: number) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  const first = pointKey(x1, y1);
  const second = pointKey(x2, y2);
  if (first === second) {
    return null;
  }
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}
