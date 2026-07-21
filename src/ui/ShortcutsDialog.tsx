import { useMemo } from "react";
import { KEY_BINDINGS } from "../editor/keymap";
import { Modal } from "./Modal";

const KEY_LABEL: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Enter: "↵",
  Delete: "Del",
  Backspace: "⌫",
  PageUp: "PgUp",
  PageDown: "PgDn",
  " ": "Space",
};

function keyLabel(k: string): string {
  return KEY_LABEL[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";

interface ShortcutsDialogProps {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  // Group bindings by their declared group, preserving first-seen order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof KEY_BINDINGS>();
    for (const b of KEY_BINDINGS) {
      if (!byGroup.has(b.group)) {
        byGroup.set(b.group, []);
        order.push(b.group);
      }
      byGroup.get(b.group)!.push(b);
    }
    return order.map((name) => ({ name, bindings: byGroup.get(name)! }));
  }, []);

  return (
    <Modal title="Keyboard shortcuts" description="Every keyboard shortcut available in the editor, grouped by category." onClose={onClose} className="shortcuts-modal">
      <div className="shortcuts-grid">
        {groups.map((g) => (
          <section key={g.name} className="shortcuts-group">
            <h3 className="shortcuts-group-title">{g.name}</h3>
            {g.bindings.map((b, i) => (
              // index, not b.description — two distinct bindings can share a
              // description (Ctrl+Shift+Z and Ctrl+Y are both "Redo"), and
              // KEY_BINDINGS is a static constant that never reorders, so an
              // index key is safe here and simpler than fabricating a
              // composite one.
              <div className="shortcut-row" key={i}>
                <span className="shortcut-desc">{b.description}</span>
                <span className="shortcut-keys">
                  {b.mod && <kbd>{MOD_LABEL}</kbd>}
                  {b.shift && <kbd>Shift</kbd>}
                  {b.keys.map((k) => (
                    <kbd key={k}>{keyLabel(k)}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      <p className="shortcuts-foot">
        Pan also works by right-drag or <kbd>Space</kbd>-drag · Alt-click deletes a point or station · Shift constrains to 45°.
      </p>
    </Modal>
  );
}
