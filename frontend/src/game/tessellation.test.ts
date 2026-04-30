import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectContrastingVoronoiEdges, createTessellationBlob } from "./tessellation";

const contextStub = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  arc: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  stroke: vi.fn()
};

describe("tessellation image rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a PNG from transformed points without drawing point markers", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(contextStub as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(callback) {
      callback(new Blob(["png"], { type: "image/png" }));
    });

    const blob = await createTessellationBlob(
      [
        { id: "seed-1", ownerId: "__seed__", color: "#ff477e", x: 0.1, y: 0.2 },
        { id: "seed-2", ownerId: "__seed__", color: "#00bbf9", x: 0.8, y: 0.7 }
      ],
      "flipX",
      400,
      800
    );

    expect(blob.type).toBe("image/png");
    expect(contextStub.arc).not.toHaveBeenCalled();
  });

  it("collects only borders shared by different colors", () => {
    expect(
      collectContrastingVoronoiEdges([
        {
          color: "#ff477e",
          polygon: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ]
        },
        {
          color: "#00bbf9",
          polygon: [
            [10, 0],
            [20, 0],
            [20, 10],
            [10, 10],
            [10, 0]
          ]
        },
        {
          color: "#ff477e",
          polygon: [
            [0, 10],
            [10, 10],
            [10, 20],
            [0, 20],
            [0, 10]
          ]
        },
        {
          color: "#fee440",
          polygon: [
            [30, 30],
            [40, 30],
            [30, 30]
          ]
        }
      ])
    ).toEqual([{ x1: 10, y1: 0, x2: 10, y2: 10 }]);
  });
});
