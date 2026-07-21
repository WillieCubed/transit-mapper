import { parseSystem } from "@transitmapper/core/model/serialize";
import type { TransitSystem } from "@transitmapper/core/model/system";

// A real library of saved systems, replacing the old single-slot autosave
// (one system ever, "New system" silently overwrote it). Each system gets
// its own key so switching between them never touches the others; a small
// index holds just enough (id/name/updatedAt) to render a list without
// loading every full system.
const LEGACY_KEY = "transitmapper:system"; // pre-library single slot
const LIBRARY_INDEX_KEY = "transitmapper:library";
const ACTIVE_ID_KEY = "transitmapper:activeId";
const systemKey = (id: string) => `transitmapper:system:${id}`;

export interface LibraryEntry {
  id: string;
  name: string;
  updatedAt: number;
}

function readIndex(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is LibraryEntry => !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.updatedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeIndex(entries: LibraryEntry[]): void {
  try {
    localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable — editing still works in memory.
  }
}

/** Every saved system, most recently updated first. */
export function listLibrary(): LibraryEntry[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSystemById(id: string): TransitSystem | null {
  try {
    const raw = localStorage.getItem(systemKey(id));
    if (!raw) return null;
    return parseSystem(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Saves the full system AND keeps its index entry (name/updatedAt) in sync
 *  — callers never touch the index directly. */
export function saveToLibrary(system: TransitSystem): void {
  try {
    localStorage.setItem(systemKey(system.id), JSON.stringify(system));
  } catch {
    return; // storage full — nothing else to update either
  }
  writeIndex([...readIndex().filter((e) => e.id !== system.id), { id: system.id, name: system.name, updatedAt: system.updatedAt }]);
}

export function deleteFromLibrary(id: string): void {
  try {
    localStorage.removeItem(systemKey(id));
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter((e) => e.id !== id));
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_ID_KEY, id);
  } catch {
    // ignore
  }
}

/** One-time migration from the pre-library single autosave slot — loads it,
 *  saves it into the library under its own id, and removes the legacy key.
 *  Returns null (a no-op) if there was nothing there to migrate. */
export function migrateLegacySingleSlot(): TransitSystem | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const system = parseSystem(JSON.parse(raw));
    saveToLibrary(system);
    localStorage.removeItem(LEGACY_KEY);
    return system;
  } catch {
    return null;
  }
}
