import { useEffect, useRef } from "react";
import { GAME_CANVAS_COLORS } from "../game/colors";
import { drawTessellation, type TessellationPoint } from "../game/tessellation";

interface AnimatedPoint extends TessellationPoint {
  vx: number;
  vy: number;
}

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

const POINT_COUNT = 18;
const MIN_SPEED = 0.000006;
const MAX_SPEED = 0.000015;
export const INDEX_CANVAS_COLORS = GAME_CANVAS_COLORS;

export function AnimatedVoronoiCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const points = createPoints();
    const size: CanvasSize = { width: 1, height: 1, dpr: 1 };
    let animationFrame = 0;
    let lastTime = window.performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      size.width = rect.width;
      size.height = rect.height;
      size.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size.width * size.dpr);
      canvas.height = Math.round(size.height * size.dpr);
    };

    const tick = (time: number) => {
      const elapsed = Math.min(time - lastTime, 40);
      lastTime = time;
      movePoints(points, elapsed);
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawTessellation(context, size.width, size.height, points);
      animationFrame = window.requestAnimationFrame(tick);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className="gameCanvas demoCanvas" aria-label="Animated Voronoi demo" />;
}

function createPoints() {
  return Array.from({ length: POINT_COUNT }, (_, index): AnimatedPoint => {
    const angle = Math.random() * Math.PI * 2;
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    return {
      id: `demo-${index}`,
      x: 0.08 + Math.random() * 0.84,
      y: 0.08 + Math.random() * 0.84,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: INDEX_CANVAS_COLORS.pointColors[index % INDEX_CANVAS_COLORS.pointColors.length]
    };
  });
}

function movePoints(points: AnimatedPoint[], elapsed: number) {
  points.forEach((point) => {
    point.x += point.vx * elapsed;
    point.y += point.vy * elapsed;

    if (point.x <= 0.02 || point.x >= 0.98) {
      point.x = clamp(point.x, 0.02, 0.98);
      point.vx *= -1;
    }
    if (point.y <= 0.02 || point.y >= 0.98) {
      point.y = clamp(point.y, 0.02, 0.98);
      point.vy *= -1;
    }
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
