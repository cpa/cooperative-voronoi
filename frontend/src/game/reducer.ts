import type { ConnectionStatus, GameState } from "../types";
import type { NormalizedPoint } from "./geometry";

export interface GameUiState {
  server: GameState | null;
  connection: ConnectionStatus;
  selectedPointId: string | null;
  preview: NormalizedPoint | null;
  error: string | null;
}

export type GameUiAction =
  | { type: "server_state"; state: GameState }
  | { type: "reset" }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "select_point"; pointId: string | null }
  | { type: "set_preview"; point: NormalizedPoint | null }
  | { type: "error"; message: string | null };

export const initialGameUiState: GameUiState = {
  server: null,
  connection: "connecting",
  selectedPointId: null,
  preview: null,
  error: null
};

export function gameUiReducer(state: GameUiState, action: GameUiAction): GameUiState {
  switch (action.type) {
    case "server_state": {
      const pointExists = action.state.points.some((point) => point.id === state.selectedPointId);
      return {
        ...state,
        server: action.state,
        selectedPointId: pointExists ? state.selectedPointId : null,
        preview: action.state.room.locked ? null : state.preview,
        error: null
      };
    }
    case "reset":
      return initialGameUiState;
    case "connection":
      return { ...state, connection: action.status };
    case "select_point":
      return { ...state, selectedPointId: action.pointId, preview: action.pointId ? null : state.preview };
    case "set_preview":
      return { ...state, preview: action.point, selectedPointId: action.point ? null : state.selectedPointId };
    case "error":
      return { ...state, error: action.message };
    default:
      return state;
  }
}
