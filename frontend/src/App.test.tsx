import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

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

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener() {}
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  send() {}
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}

function pendingUntilAbort(signal?: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((current) =>
    current.textContent?.includes(label)
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button as HTMLButtonElement;
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function stubLocalStorage() {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    }
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("App stranger matchmaking", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    stubLocalStorage();
    window.localStorage.setItem(
      "voronoi.identity.v1",
      JSON.stringify({ clientId: "client-1", name: "Player", color: "#ff477e" })
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      contextStub as unknown as CanvasRenderingContext2D
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    window.localStorage?.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    root = null;
  });

  it("enters a waiting state after requesting a stranger match", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/matchmaking/stranger" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ status: "waiting", ticketId: "ticket-1" }));
      }
      return pendingUntilAbort(init?.signal ?? undefined);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<App />);
    });
    await act(async () => {
      click(findButton("play with stranger"));
      await Promise.resolve();
    });
    await flush();

    expect(findButton("finding stranger").disabled).toBe(true);
    expect(findButton("cancel")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/matchmaking/stranger",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clientId: "client-1" })
      })
    );
  });

  it("navigates to the matched game", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/matchmaking/stranger" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ status: "waiting", ticketId: "ticket-1" }));
      }
      if (url === "/api/matchmaking/stranger/ticket-1?clientId=client-1") {
        return Promise.resolve(jsonResponse({ status: "matched", roomId: "Room123", url: "/g/Room123" }));
      }
      return Promise.resolve(jsonResponse({ status: "waiting", ticketId: "ticket-1" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<App />);
    });
    await act(async () => {
      click(findButton("play with stranger"));
      await Promise.resolve();
    });
    await flush();

    expect(window.location.pathname).toBe("/g/Room123");
  });

  it("cancels a waiting stranger match", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/matchmaking/stranger" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ status: "waiting", ticketId: "ticket-1" }));
      }
      if (url === "/api/matchmaking/stranger/ticket-1?clientId=client-1" && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ status: "canceled" }));
      }
      return pendingUntilAbort(init?.signal ?? undefined);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(<App />);
    });
    await act(async () => {
      click(findButton("play with stranger"));
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      click(findButton("cancel"));
      await Promise.resolve();
    });
    await flush();

    expect(findButton("play with stranger").disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/matchmaking/stranger/ticket-1?clientId=client-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
