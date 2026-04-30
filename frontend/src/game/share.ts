import type { GameState } from "../types";

interface ShareNavigator {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  clipboard?: {
    writeText: (text: string) => Promise<void>;
  };
}

export function shouldShowFirstPlayerSharePrompt(
  state: GameState | null,
  clientId: string,
  dismissedRoomIds: ReadonlySet<string>
) {
  if (!state || dismissedRoomIds.has(state.room.id) || state.players.length !== 1) {
    return false;
  }
  return state.players[0]?.id === clientId;
}

export async function shareGameLink(navigatorLike: ShareNavigator, url: string) {
  if (typeof navigatorLike.share === "function") {
    await navigatorLike.share({
      title: "Voronoi game",
      text: "Join this Voronoi game.",
      url
    });
    return "shared";
  }
  if (navigatorLike.clipboard?.writeText) {
    await navigatorLike.clipboard.writeText(url);
    return "copied";
  }
  throw new Error("Sharing is not available.");
}
