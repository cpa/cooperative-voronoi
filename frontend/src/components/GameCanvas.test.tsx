import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameCanvas } from "./GameCanvas";
import type { GameState } from "../types";

const contextStub = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  arc: vi.fn(),
  stroke: vi.fn(),
  setTransform: vi.fn()
};

function gameState(): GameState {
  return {
    room: { id: "TouchRoom", kind: "private", locked: false, paused: false, lastMovePlayerId: null },
    players: [],
    points: [
      { id: "seed-1", ownerId: "__seed__", color: "#ff477e", x: 0.15, y: 0.2 },
      { id: "seed-2", ownerId: "__seed__", color: "#00bbf9", x: 0.75, y: 0.8 }
    ],
    cursors: [],
    endedPlayerIds: [],
    connectedPlayerIds: []
  };
}

function pointerEvent(type: string, init: Partial<PointerEvent>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  return event;
}

describe("GameCanvas", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(contextStub as unknown as CanvasRenderingContext2D);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    root = null;
  });

  it("previews touch placement while dragging and commits on lift", () => {
    const onCursorPoint = vi.fn();
    const onCommitPoint = vi.fn();

    act(() => {
      root?.render(
        <GameCanvas
          state={gameState()}
          meId="me"
          nextColor="#fee440"
          cursorPoint={null}
          remoteCursors={[]}
          viewTransform="identity"
          canPlace
          onCursorPoint={onCursorPoint}
          onCursorMove={vi.fn()}
          onCursorClear={vi.fn()}
          onCommitPoint={onCommitPoint}
          onViewportChange={vi.fn()}
        />
      );
    });

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Canvas did not render.");
    }
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    act(() => {
      canvas.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 60, clientY: 120, pointerId: 7, pointerType: "touch" })
      );
    });
    expect(onCommitPoint).not.toHaveBeenCalled();
    expect(onCursorPoint).toHaveBeenLastCalledWith({ x: 0.2, y: 0.2 });

    act(() => {
      canvas.dispatchEvent(
        pointerEvent("pointermove", { clientX: 240, clientY: 480, pointerId: 7, pointerType: "touch" })
      );
    });
    expect(onCommitPoint).not.toHaveBeenCalled();
    expect(onCursorPoint).toHaveBeenLastCalledWith({ x: 0.8, y: 0.8 });

    act(() => {
      canvas.dispatchEvent(
        pointerEvent("pointerup", { clientX: 240, clientY: 480, pointerId: 7, pointerType: "touch" })
      );
    });
    expect(onCommitPoint).toHaveBeenCalledOnce();
    expect(onCommitPoint).toHaveBeenLastCalledWith({ x: 0.8, y: 0.8 });
    expect(onCursorPoint).toHaveBeenLastCalledWith(null);
  });

  it("draws remote cursors without adding them to the tessellation points", () => {
    const onCommitPoint = vi.fn();

    act(() => {
      root?.render(
        <GameCanvas
          state={gameState()}
          meId="me"
          nextColor="#fee440"
          cursorPoint={null}
          remoteCursors={[
            {
              playerId: "other",
              color: "#111111",
              x: 0.5,
              y: 0.5,
              pointerType: "touch",
              updatedAt: Date.now()
            }
          ]}
          viewTransform="identity"
          canPlace
          onCursorPoint={vi.fn()}
          onCursorMove={vi.fn()}
          onCursorClear={vi.fn()}
          onCommitPoint={onCommitPoint}
          onViewportChange={vi.fn()}
        />
      );
    });

    expect(contextStub.arc).toHaveBeenCalled();
    expect(onCommitPoint).not.toHaveBeenCalled();
  });

  it("renders the game board without point marker dots", () => {
    act(() => {
      root?.render(
        <GameCanvas
          state={gameState()}
          meId="me"
          nextColor="#fee440"
          cursorPoint={null}
          remoteCursors={[]}
          viewTransform="identity"
          canPlace
          onCursorPoint={vi.fn()}
          onCursorMove={vi.fn()}
          onCursorClear={vi.fn()}
          onCommitPoint={vi.fn()}
          onViewportChange={vi.fn()}
        />
      );
    });

    expect(contextStub.arc).not.toHaveBeenCalled();
  });
});
