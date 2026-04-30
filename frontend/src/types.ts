export type RoomKind = "private";
export type ViewTransform = "identity" | "flipX" | "flipY" | "flipXY";
export type PointerKind = "mouse" | "touch" | "pen";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  ended: boolean;
  pointsCount: number;
  viewTransform: ViewTransform;
}

export interface Point {
  id: string;
  ownerId: string;
  color: string;
  x: number;
  y: number;
}

export interface GameState {
  room: {
    id: string;
    kind: RoomKind;
    locked: boolean;
    paused: boolean;
    lastMovePlayerId: string | null;
  };
  players: Player[];
  points: Point[];
  cursors: CursorPresence[];
  endedPlayerIds: string[];
  connectedPlayerIds: string[];
}

export interface Identity {
  clientId: string;
  name: string;
  color: string;
}

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

export interface CursorPresence {
  playerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  pointerType: PointerKind;
  updatedAt: number;
}

export type ClientAction =
  | { type: "add_point"; point: { x: number; y: number; color: string } }
  | { type: "move_point"; pointId: string; x: number; y: number }
  | { type: "delete_point"; pointId: string }
  | { type: "cursor_move"; cursor: { x: number; y: number; pointerType: PointerKind } }
  | { type: "cursor_clear" }
  | { type: "set_viewport"; viewport: ViewportSize }
  | { type: "vote_end" }
  | { type: "unvote_end" }
  | { type: "set_name"; name: string };

export interface ServerError {
  message: string;
  code: string;
}

export type ServerMessage =
  | { type: "state"; state: GameState }
  | { type: "error"; error: ServerError };
