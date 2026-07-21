import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The one modal-dialog shell every dialog in this app renders through —
 * Export/Import/Share/Shortcuts. Built on Radix's Dialog primitive instead
 * of hand-rolled focus-trap/Escape/portal logic: real focus management,
 * scroll locking, and a portal (so a dialog opened from deep in the tree
 * never gets clipped by an ancestor's overflow:hidden) come for free and
 * are battle-tested, instead of this app maintaining its own version of the
 * same ~40 lines forever. Visual styling is untouched — Radix is headless,
 * so .modal-backdrop/.modal keep doing exactly what they did before.
 */
interface ModalProps {
  title: string;
  /** Screen-reader-only context for what this dialog is/does — Radix warns
   *  without one, and it's genuinely useful info non-visually. */
  description: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, description, onClose, className = "", children, footer }: ModalProps) {
  // Every dialog here is opened by a trigger that lives outside this
  // component (a button in TopBar/FileMenu/GroupInspector/…), not a
  // <Dialog.Trigger> Radix can track itself — so its own default
  // "return focus to whatever opened me" doesn't reliably have anything to
  // return to. Capture it ourselves and hand it back explicitly on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
  }, []);

  // The parent mounts/unmounts this component instantly based on its own
  // activeDialog state, which would skip Radix's exit-animation window
  // entirely (Presence never sees `open` go false — the DOM node is just
  // yanked out). So this component owns a short-lived local `open` instead:
  // requestClose() flips it to false (plays the CSS exit animation via
  // data-state="closed"), and only once that animation actually finishes
  // do we call the real onClose that tells the parent to unmount us.
  const [open, setOpen] = useState(true);
  const requestClose = () => setOpen(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className={`modal ${className}`.trim()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            previouslyFocused.current?.focus?.();
          }}
          onAnimationEnd={(e) => {
            // Ignore bubbled animationend from descendants (e.g. a color
            // popover opening/closing inside the dialog) — only this
            // element's own open/close transition should trigger unmount.
            if (e.target === e.currentTarget && !open) onClose();
          }}
        >
          <div className="modal-head">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-btn" aria-label="Close">
                <Icon name="x" size={20} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
          {footer}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
