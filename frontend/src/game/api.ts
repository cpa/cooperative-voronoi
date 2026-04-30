export interface CreatedGame {
  roomId: string;
  url: string;
}

export type StrangerMatchResponse =
  | { status: "waiting"; ticketId: string }
  | { status: "matched"; roomId: string; url: string }
  | { status: "expired" }
  | { status: "canceled" };

export async function createPrivateGame(): Promise<CreatedGame> {
  const response = await fetch("/api/games", { method: "POST" });
  if (!response.ok) {
    throw new Error("Could not create a private game.");
  }
  return (await response.json()) as CreatedGame;
}

export async function startStrangerMatch(clientId: string): Promise<StrangerMatchResponse> {
  const response = await fetch("/api/matchmaking/stranger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId })
  });
  if (!response.ok) {
    throw new Error("Could not start matchmaking.");
  }
  return (await response.json()) as StrangerMatchResponse;
}

export async function pollStrangerMatch(
  ticketId: string,
  clientId: string,
  signal?: AbortSignal
): Promise<StrangerMatchResponse> {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(`/api/matchmaking/stranger/${encodeURIComponent(ticketId)}?${params.toString()}`, {
    signal
  });
  if (!response.ok) {
    throw new Error("Could not check matchmaking.");
  }
  return (await response.json()) as StrangerMatchResponse;
}

export async function cancelStrangerMatch(ticketId: string, clientId: string): Promise<StrangerMatchResponse> {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(`/api/matchmaking/stranger/${encodeURIComponent(ticketId)}?${params.toString()}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error("Could not cancel matchmaking.");
  }
  return (await response.json()) as StrangerMatchResponse;
}
