import { useEffect, useRef, useState } from "react";

/**
 * Keeps a piece of UI mounted for `exitMs` after `active` goes false, so a
 * CSS exit animation has time to actually play instead of the content just
 * vanishing the instant React unmounts it. Mirrors what Radix's own Presence
 * does internally for Popover/Dialog content — this is the same idea for
 * plain conditionally-rendered panels (Inspector, the Hide-UI toggle) that
 * aren't wrapped in a Radix primitive.
 *
 * `closing` flips true as soon as `active` goes false, for the render to key
 * a CSS class/data-attribute off of; `mounted` stays true until `exitMs`
 * later, when the caller should actually stop rendering.
 */
export function useDelayedUnmount(active: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(active);
  const [closing, setClosing] = useState(false);
  const everActive = useRef(active);

  useEffect(() => {
    if (active) {
      everActive.current = true;
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!everActive.current) return; // never opened yet — nothing to animate out
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [active, exitMs]);

  return { mounted, closing };
}
