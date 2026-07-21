import type { KeyboardEvent } from "react";

/**
 * Enter commits a text edit (blurs the field) instead of doing nothing. The
 * store already saves on every keystroke via onChange, but nothing else in
 * the field gave a "done" moment — most visibly the system name, which
 * otherwise never confirms. Matches Enter's existing meaning elsewhere in
 * the app (committing the current draw).
 */
export function blurOnEnter(e: KeyboardEvent<HTMLInputElement>): void {
  if (e.key === "Enter") e.currentTarget.blur();
}
