import { useRef, type KeyboardEvent, type MutableRefObject } from "react";

interface ListboxKeyboardNav<T extends HTMLElement> {
  /** Attach to the role="listbox" container. */
  containerRef: MutableRefObject<T | null>;
  /** Attach to the same container's onKeyDown. */
  onKeyDown: (e: KeyboardEvent<T>) => void;
}

/**
 * Roving-tabindex keyboard navigation for a flat, DOM-ordered list of real
 * `<button role="option">` rows inside a `role="listbox"` container — the
 * behavior every modern list (Gmail, Figma's layers panel, Linear) shares:
 * Arrow Up/Down move to and activate the adjacent row, Home/End jump to the
 * first/last, and typing a letter jumps to the next row whose text starts
 * with it (type-ahead, buffer resets after a short pause).
 *
 * Deliberately DOM-driven (querySelectorAll + real focus movement) rather
 * than tracking an index in React state: the options can come from several
 * independent arrays rendered as separate sections (see LinesPanel) with
 * non-interactive headers between them, and this only cares about the
 * resulting `[role="option"]` elements in visual/DOM order — no caller-side
 * bookkeeping of "which array, which index" needed. Rows stay real
 * `<button>` elements so Enter/Space activation keeps working for free via
 * native button behavior; this hook only owns movement between them.
 * Callers still own each row's roving `tabIndex` (0 for the one row Tab
 * should land on — normally whichever is selected, else the first row).
 */
export function useListboxKeyboardNav<T extends HTMLElement = HTMLDivElement>(): ListboxKeyboardNav<T> {
  const containerRef = useRef<T | null>(null);
  const typeAheadBuffer = useRef("");
  const typeAheadTimer = useRef<number | undefined>(undefined);

  // :not(:disabled) — a disabled option (e.g. an issue with nothing to jump
  // to) can never actually receive focus, so leaving it in this list would
  // strand arrow-key movement there: .focus() silently no-ops on a disabled
  // element, document.activeElement never becomes it, and the next keypress
  // recomputes the same currentIndex forever.
  const options = (): HTMLElement[] =>
    containerRef.current
      ? Array.from(containerRef.current.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)'))
      : [];

  // .focus() alone would only move keyboard focus, leaving the app's actual
  // selection (and the Inspector panel it drives) pointing at whatever was
  // selected before — .click() re-runs the row's own onClick, so arrow-key
  // movement selects as you go, matching Gmail/Figma rather than requiring a
  // separate Enter press to confirm.
  const activate = (el: HTMLElement | undefined) => {
    el?.focus();
    el?.click();
  };

  const onKeyDown = (e: KeyboardEvent<T>) => {
    const opts = options();
    if (opts.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const currentIndex = current ? opts.indexOf(current) : -1;

    // stopPropagation on every key this hook actually handles — the app's
    // global keymap (editor/keymap.ts) listens on `window` in the bubble
    // phase for single-letter tool shortcuts (l/s/f/v), arrow-key camera
    // pan, and more, so an unstopped event here would fire BOTH this list's
    // own navigation AND whatever global binding happens to share the same
    // key (confirmed live: typing "l" to search this list also switched the
    // active tool to Way). Once focus is inside a listbox, its own keyboard
    // model owns the keystroke — the same rule Finder/Explorer type-ahead
    // and Gmail's list navigation follow.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      activate(opts[currentIndex === -1 ? 0 : Math.min(opts.length - 1, currentIndex + 1)]);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      activate(opts[currentIndex === -1 ? 0 : Math.max(0, currentIndex - 1)]);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      activate(opts[0]);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      activate(opts[opts.length - 1]);
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.stopPropagation();
      window.clearTimeout(typeAheadTimer.current);
      typeAheadBuffer.current += e.key.toLowerCase();
      typeAheadTimer.current = window.setTimeout(() => {
        typeAheadBuffer.current = "";
      }, 600);
      const search = typeAheadBuffer.current;
      const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;
      const ordered = [...opts.slice(startIndex), ...opts.slice(0, startIndex)];
      const match = ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(search));
      if (match) activate(match);
    }
  };

  return { containerRef, onKeyDown };
}
