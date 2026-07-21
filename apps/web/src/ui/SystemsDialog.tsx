import { useState } from "react";
import { useEditor } from "../editor/EditorProvider";
import { createEmptySystem, forkSystem } from "@transitmapper/core/model/serialize";
import {
  deleteFromLibrary,
  listLibrary,
  loadSystemById,
  saveToLibrary,
  setActiveId,
  type LibraryEntry,
} from "../storage/localStore";
import { blurOnEnter } from "./formUtils";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

function relativeTime(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface SystemsDialogProps {
  onClose: () => void;
}

/** Replaces the old single-slot autosave with a real library: every saved
 *  system its own row, switch between them without losing anything, rename/
 *  duplicate/delete in place. See storage/localStore.ts for the storage
 *  shape this reads and writes. */
export function SystemsDialog({ onClose }: SystemsDialogProps) {
  const currentId = useEditor((s) => s.system.id);
  const currentName = useEditor((s) => s.system.name);
  const setName = useEditor((s) => s.setName);
  const setSystem = useEditor((s) => s.setSystem);
  const [entries, setEntries] = useState<LibraryEntry[]>(() => listLibrary());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = () => setEntries(listLibrary());

  const open = (id: string) => {
    if (id === currentId) return;
    const system = loadSystemById(id);
    if (!system) return;
    setActiveId(id);
    setSystem(system, { readOnly: false });
    onClose();
  };

  const rename = (entry: LibraryEntry, name: string) => {
    if (entry.id === currentId) {
      setName(name);
      return;
    }
    const system = loadSystemById(entry.id);
    if (!system) return;
    saveToLibrary({ ...system, name, updatedAt: Date.now() });
    refresh();
  };

  const duplicate = (entry: LibraryEntry) => {
    const system = loadSystemById(entry.id);
    if (!system) return;
    saveToLibrary(forkSystem(system));
    refresh();
  };

  const startNew = () => {
    const system = createEmptySystem();
    saveToLibrary(system);
    setActiveId(system.id);
    setSystem(system, { readOnly: false });
    onClose();
  };

  const confirmDelete = (id: string) => {
    deleteFromLibrary(id);
    if (id === currentId) {
      const remaining = listLibrary();
      const next = remaining.length > 0 ? loadSystemById(remaining[0].id) : createEmptySystem();
      if (next) {
        if (remaining.length === 0) saveToLibrary(next);
        setActiveId(next.id);
        setSystem(next, { readOnly: false });
      }
    }
    setConfirmingId(null);
    refresh();
  };

  return (
    <Modal title="My systems" description="Every system you've saved locally — switch, rename, duplicate, or delete." onClose={onClose}>
      <p className="panel-hint">Saved on this device only — use Share to send a system to someone else.</p>

      <ul className="systems-list">
        {entries.map((entry) => {
          const isActive = entry.id === currentId;
          const isConfirming = confirmingId === entry.id;
          return (
            <li key={entry.id} className={`systems-row ${isActive ? "active" : ""}`}>
              <button
                type="button"
                className="systems-open"
                onClick={() => open(entry.id)}
                disabled={isActive}
                aria-label={isActive ? "Current system" : `Open ${entry.name || "Untitled system"}`}
                title={isActive ? "Current system" : "Open"}
              >
                <span className={`dot ${isActive ? "" : "ring"}`} />
              </button>
              <input
                className="systems-name-input"
                value={isActive ? currentName : entry.name}
                aria-label="System name"
                onChange={(e) => rename(entry, e.target.value)}
                onKeyDown={blurOnEnter}
              />
              <span className="systems-meta">{isActive ? "Current" : relativeTime(entry.updatedAt)}</span>
              <IconButton icon="copy" size={16} label="Duplicate" onClick={() => duplicate(entry)} />
              {isConfirming ? (
                <span className="systems-confirm">
                  <button type="button" className="danger-btn systems-confirm-btn" onClick={() => confirmDelete(entry.id)}>
                    Delete
                  </button>
                  <button type="button" className="ghost-btn systems-confirm-btn" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <IconButton icon="trash" size={16} label="Delete" onClick={() => setConfirmingId(entry.id)} />
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" className="ghost-btn" style={{ marginTop: 8 }} onClick={startNew}>
        <Icon name="plus" size={17} /> New system
      </button>
    </Modal>
  );
}
