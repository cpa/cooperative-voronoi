import type { Identity } from "../types";

const STORAGE_KEY = "voronoi.identity.v1";
const COLORS = ["#1f9a8a", "#e25d47", "#d39a28", "#4078d4", "#7c5cce", "#d4518d"];

export function getOrCreateIdentity(): Identity {
  const existing = readIdentity();
  if (existing) {
    return existing;
  }
  const clientId = createId();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const name = `Player ${clientId.slice(-4).toUpperCase()}`;
  return saveIdentity({ clientId, name, color });
}

export function updateIdentityName(name: string): Identity {
  const identity = getOrCreateIdentity();
  return saveIdentity({ ...identity, name: name.trim().slice(0, 36) || "Player" });
}

function readIdentity(): Identity | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (parsed.clientId && parsed.name && parsed.color) {
      return {
        clientId: parsed.clientId,
        name: parsed.name,
        color: parsed.color
      };
    }
  } catch {
    return null;
  }
  return null;
}

function saveIdentity(identity: Identity): Identity {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Browsers can deny storage in private contexts; the in-memory identity still works.
  }
  return identity;
}

function createId(): string {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `client_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
