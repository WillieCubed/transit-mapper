import type { HTMLAttributes, ReactNode } from "react";

export type PanelSlot = "left" | "right";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Which overlay-grid slot this card docks into — see .app-chrome's
   *  grid-template-areas in app.css. */
  slot: PanelSlot;
  children: ReactNode;
}

/**
 * The one card shell every floating side panel renders through — SidePanel
 * (left) and every Inspector variant (right: Empty/Multi/Service/Way/
 * Station/Facility/Group each used to hand-roll this exact
 * `<aside className="panel panel-right">` themselves, seven identical
 * copies of the same wrapper).
 *
 * Bakes in the one guarantee every panel needs regardless of how much
 * content it holds: a viewport-bounded height with internal scroll (see
 * .panel's own comment in app.css) — a call site can't quietly ship
 * without that the way one of the seven above once could have, since
 * there's now exactly one place this markup is written.
 */
export function Panel({ slot, className = "", children, ...rest }: PanelProps) {
  return (
    <aside className={`panel panel-${slot} ${className}`.trim()} {...rest}>
      {children}
    </aside>
  );
}
