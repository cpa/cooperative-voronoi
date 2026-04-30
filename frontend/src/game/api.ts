export interface CreatedGame {
  roomId: string;
  url: string;
}

export async function createPrivateGame(): Promise<CreatedGame> {
  const response = await fetch("/api/games", { method: "POST" });
  if (!response.ok) {
    throw new Error("Could not create a private game.");
  }
  return (await response.json()) as CreatedGame;
}
