import type { GameState } from "../types/game";

const STORAGE_KEY = "high-school-draft-sim:game-state";

export function saveGameState(state: GameState, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadGameState(storage: Storage = localStorage): GameState | undefined {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  return JSON.parse(raw) as GameState;
}

export function clearGameState(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
