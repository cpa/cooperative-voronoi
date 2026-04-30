import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientAction, ConnectionStatus, GameState, Identity, ServerMessage } from "../types";

export function useGameSocket(roomId: string | null, identity: Identity) {
  const [state, setState] = useState<GameState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let closedByEffect = false;
    setState(null);
    setStatus("connecting");
    setError(null);
    if (!roomId) {
      setStatus("closed");
      return;
    }

    const connect = () => {
      const socket = new WebSocket(websocketUrl(roomId, identity));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setStatus("open");
        setError(null);
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "state") {
          setState(message.state);
        } else if (message.type === "error") {
          setError(message.error.message);
        }
      });

      socket.addEventListener("error", () => {
        setStatus("error");
        setError("Connection problem. Reconnecting...");
      });

      socket.addEventListener("close", () => {
        if (closedByEffect) {
          return;
        }
        setStatus("closed");
        reconnectTimer = window.setTimeout(connect, 1200);
      });
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [identity.clientId, identity.color, identity.name, roomId]);

  const send = useCallback((action: ClientAction) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Still connecting. Try again in a moment.");
      return false;
    }
    socket.send(JSON.stringify(action));
    return true;
  }, []);

  return { state, status, error, send };
}

function websocketUrl(roomId: string, identity: Identity): string {
  const params = new URLSearchParams({
    client_id: identity.clientId,
    name: identity.name,
    color: identity.color
  });
  const configuredBase = import.meta.env.VITE_WS_BASE as string | undefined;
  if (configuredBase) {
    return `${configuredBase.replace(/\/$/, "")}/ws/${roomId}?${params.toString()}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/${roomId}?${params.toString()}`;
}
