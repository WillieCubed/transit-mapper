import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../editor/EditorProvider";
import { crossingsWithoutJoiningChunked, validateSystemQuick, type Issue } from "@transitmapper/core/model/validate";
import type { TransitSystem } from "@transitmapper/core/model/system";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";
import { useListboxKeyboardNav } from "./useListboxKeyboardNav";

/**
 * A pure sanity check surfaced as UI: ghost ways/services, orphaned stations,
 * and ways that cross without joining (see model/validate.ts). Hidden
 * entirely when the system is clean — this is a warning light, not a panel
 * that's always present and usually empty.
 */
export function IssuesPopover() {
  const system = useEditor((s) => s.system);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  // This component is mounted the whole session (top-bar indicator), and
  // `system` is a fresh reference on every store mutation — a drag frame, an
  // unrelated edit, a GTFS batch. The badge doesn't need sub-frame freshness,
  // so debounce the value validation actually runs against instead of
  // re-running it (and re-rendering this) on every single one of those.
  const [debounced, setDebounced] = useState<TransitSystem>(system);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(system), 400);
    return () => window.clearTimeout(timer.current);
  }, [system]);
  const quickIssues = useMemo(() => validateSystemQuick(debounced), [debounced]);

  // Crossing-without-joining detection is the expensive half of validation
  // (see validate.ts's note — real routes sharing street corridors keep this
  // in the millions of candidate pairs even with a spatial grid). Streamed in
  // via the chunked generator instead of computed synchronously, so this
  // badge stays a live, accurate warning light without ever blocking a frame
  // — the exact same batch+yield shape as the GTFS import itself.
  const [crossingIssues, setCrossingIssues] = useState<Issue[]>([]);
  useEffect(() => {
    let cancelled = false;
    setCrossingIssues([]);
    (async () => {
      for await (const batch of crossingsWithoutJoiningChunked(debounced)) {
        if (cancelled) return;
        setCrossingIssues((prev) => [...prev, ...batch]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const issues = useMemo(() => [...quickIssues, ...crossingIssues], [quickIssues, crossingIssues]);
  const { containerRef, onKeyDown } = useListboxKeyboardNav<HTMLDivElement>();

  if (issues.length === 0) return null;

  const label = `${issues.length} issue${issues.length === 1 ? "" : "s"} found`;
  const firstJumpableId = issues.find((i) => i.target)?.id;

  return (
    <Popover trigger={<IconButton icon="warning" label={label} active className="issues-trigger" />}>
      <div className="issues-popover" role="listbox" aria-label="Issues" ref={containerRef} onKeyDown={onKeyDown}>
        <span className="panel-section-label">{label}</span>
        <ul className="issues-list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                tabIndex={issue.id === firstJumpableId ? 0 : -1}
                className="issues-item"
                disabled={!issue.target}
                onClick={() => issue.target && selectAndFocus(issue.target)}
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
