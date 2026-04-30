export const GAME_POINT_COLORS = [
  "#ff477e",
  "#00bbf9",
  "#fee440",
  "#00f5d4",
  "#9b5de5",
  "#f15bb5",
  "#80ed99",
  "#f8961e"
] as const;

export const GAME_CANVAS_COLORS = {
  background: "#f7f4ec",
  cellAlpha: 0.42,
  pointColors: GAME_POINT_COLORS
} as const;

export const FLASHY_COLORS = GAME_POINT_COLORS;

export function randomPointColor() {
  return GAME_POINT_COLORS[Math.floor(Math.random() * GAME_POINT_COLORS.length)];
}

export function displayPointColor(color: string, id: string, index: number) {
  if ((GAME_POINT_COLORS as readonly string[]).includes(color)) {
    return color;
  }
  return GAME_POINT_COLORS[hashString(id || String(index)) % GAME_POINT_COLORS.length];
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
