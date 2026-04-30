import { useEffect, useMemo, useRef, useState } from "react";
import type { CursorPresence, GameState, PointerKind, Point, ViewTransform, ViewportSize } from "../types";
import type { NormalizedPoint } from "../game/geometry";
import { pointerToNormalized } from "../game/geometry";
import { drawTessellation } from "../game/tessellation";
import { inverseTransformPoint, transformPoint, transformPoints } from "../game/viewTransform";

interface GameCanvasProps {
  state: GameState;
  meId: string;
  nextColor: string;
  cursorPoint: NormalizedPoint | null;
  remoteCursors: CursorPresence[];
  viewTransform: ViewTransform;
  canPlace: boolean;
  onCursorPoint: (point: NormalizedPoint | null) => void;
  onCursorMove: (point: NormalizedPoint, pointerType: PointerKind) => void;
  onCursorClear: () => void;
  onCommitPoint: (point: NormalizedPoint) => void;
  onViewportChange: (viewport: ViewportSize) => void;
}

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

export function GameCanvas({
  state,
  meId,
  nextColor,
  cursorPoint,
  remoteCursors,
  viewTransform,
  canPlace,
  onCursorPoint,
  onCursorMove,
  onCursorClear,
  onCommitPoint,
  onViewportChange
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePlacementRef = useRef<number | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 1, height: 1, dpr: 1 });
  const [cursorClock, setCursorClock] = useState(() => Date.now());
  const renderPoints = useMemo(() => {
    if (!cursorPoint || !canPlace || state.room.locked || state.room.paused) {
      return state.points;
    }
    return [
      ...state.points,
      {
        id: "cursor",
        ownerId: meId,
        color: nextColor,
        x: cursorPoint.x,
        y: cursorPoint.y
      }
    ];
  }, [canPlace, cursorPoint, meId, nextColor, state.points, state.room.locked, state.room.paused]);
  const transformedPoints = useMemo(
    () => transformPoints(renderPoints, viewTransform),
    [renderPoints, viewTransform]
  );
  const visibleRemoteCursors = useMemo(
    () => remoteCursors.filter((cursor) => cursor.playerId !== meId && cursorClock - cursor.updatedAt < 2500),
    [cursorClock, meId, remoteCursors]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      setSize({ width: rect.width, height: rect.height, dpr });
      onViewportChange({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [onViewportChange]);

  useEffect(() => {
    if (!remoteCursors.length) {
      return;
    }
    const timer = window.setInterval(() => setCursorClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [remoteCursors.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    drawBoard(context, size.width, size.height, transformedPoints, state.room.locked);
    drawRemoteCursors(context, size.width, size.height, visibleRemoteCursors, viewTransform);
  }, [size, state.room.locked, transformedPoints, viewTransform, visibleRemoteCursors]);

  const canTrackCursor = !state.room.locked && !state.room.paused;
  const canInteract = canPlace && canTrackCursor;

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    return inverseTransformPoint(
      pointerToNormalized(canvas.getBoundingClientRect(), event.clientX, event.clientY),
      viewTransform
    );
  };

  const updateCursor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canTrackCursor) {
      return;
    }

    if (activePlacementRef.current !== null) {
      if (activePlacementRef.current !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const point = pointFromEvent(event);
      if (point) {
        onCursorPoint(point);
        onCursorMove(point, event.pointerType === "pen" ? "pen" : "touch");
      }
      return;
    }

    if (event.pointerType === "mouse") {
      const point = pointFromEvent(event);
      if (point) {
        if (canInteract) {
          onCursorPoint(point);
        }
        onCursorMove(point, "mouse");
      }
    }
  };

  const startPlacement = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canInteract) {
      return;
    }
    event.preventDefault();
    const point = pointFromEvent(event);
    if (!point) {
      return;
    }

    if (event.pointerType === "mouse") {
      onCommitPoint(point);
      return;
    }

    activePlacementRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    onCursorPoint(point);
    onCursorMove(point, event.pointerType === "pen" ? "pen" : "touch");
  };

  const finishPlacement = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePlacementRef.current !== event.pointerId) {
      return;
    }
    event.preventDefault();
    activePlacementRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const point = pointFromEvent(event);
    if (point && canInteract) {
      onCommitPoint(point);
    }
    onCursorPoint(null);
    onCursorClear();
  };

  const cancelPlacement = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePlacementRef.current === event.pointerId) {
      activePlacementRef.current = null;
      onCursorPoint(null);
      onCursorClear();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="gameCanvas"
      aria-label="Voronoi board"
      onPointerMove={updateCursor}
      onPointerDown={startPlacement}
      onPointerUp={finishPlacement}
      onPointerLeave={(event) => {
        if (activePlacementRef.current === null && event.pointerType === "mouse") {
          onCursorPoint(null);
          onCursorClear();
        }
      }}
      onPointerCancel={cancelPlacement}
    />
  );
}

function drawBoard(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: Point[],
  locked: boolean
) {
  drawTessellation(context, width, height, points);
  if (locked) {
    drawLockedVeil(context, width, height);
  }
}

function drawRemoteCursors(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cursors: CursorPresence[],
  viewTransform: ViewTransform
) {
  cursors.forEach((cursor) => {
    const point = transformPoint(cursor, viewTransform);
    const x = point.x * width;
    const y = point.y * height;
    context.save();
    context.fillStyle = cursor.color;
    context.strokeStyle = "rgba(255, 253, 247, 0.9)";
    context.lineWidth = 2;
    if (cursor.pointerType === "mouse") {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 16, y + 7);
      context.lineTo(x + 7, y + 16);
      context.closePath();
      context.fill();
      context.stroke();
    } else {
      context.beginPath();
      context.arc(x, y, 13, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
  });
}

function drawLockedVeil(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.fillStyle = "rgba(247, 244, 236, 0.5)";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(17, 24, 28, 0.74)";
  context.font = "600 15px Inter, ui-sans-serif, system-ui";
  context.textAlign = "center";
  context.fillText("ended", width / 2, height / 2);
  context.restore();
}
