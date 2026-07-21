import { useImportProgress } from "./UiProvider";

/** A background import's live status (see UiProvider's ImportProgress) —
 *  no backdrop, doesn't trap focus or block the map: the whole point is
 *  that a long import stays out of the user's way while it streams in,
 *  unlike a blocking modal. Positioning is Workbench's job (stacked above
 *  the tool dock, in the same centered column, sharing its responsive
 *  offset) — this only renders the pill's own contents. Renders nothing
 *  when idle. */
export function ImportProgressPill() {
  const { importProgress } = useImportProgress();
  if (!importProgress) return null;
  const { label, done, total, state } = importProgress;

  return (
    <div className={`import-progress-pill ${state}`} role="status" aria-live="polite">
      {state === "loading" && <span className="import-progress-spinner" aria-hidden="true" />}
      <span>
        {label}
        {state === "loading" && total > 0 ? ` — ${done}/${total} routes` : ""}
      </span>
    </div>
  );
}
