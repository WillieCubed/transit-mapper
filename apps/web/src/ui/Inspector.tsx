import { useRef, type ReactNode } from "react";
import { useEditor } from "../editor/EditorProvider";
import type { MultiSelectItem, Selection } from "../editor/store";
import { Icon } from "./Icon";
import { NodeInspector } from "./NodeInspector";
import { Panel } from "./Panel";
import { useDelayedUnmount } from "./useDelayedUnmount";
import { useView } from "./ViewProvider";
import { ToolDraftInspector } from "./inspector/drafts";
import { ServiceInspector } from "./inspector/ServiceInspector";
import { WayInspector } from "./inspector/WayInspector";
import { StationInspector } from "./inspector/StationInspector";
import { FacilityInspector } from "./inspector/FacilityInspector";
import { GroupInspector } from "./inspector/GroupInspector";

function renderInspectorContent(selection: Selection, multiSelection: MultiSelectItem[]): ReactNode {
  if (multiSelection.length > 0) return <MultiInspector items={multiSelection} />;
  if (!selection) return null;
  // key={id}: switching selection to a DIFFERENT service must remount, not
  // reuse this instance — its "Custom" frequency/span disclosure is local
  // state derived once at mount from that service's own values (see
  // ServiceInspector), and would otherwise stay stuck open/closed from
  // whichever service was selected previously.
  if (selection.kind === "service") return <ServiceInspector key={selection.id} id={selection.id} />;
  if (selection.kind === "way") return <WayInspector id={selection.id} />;
  if (selection.kind === "facility") return <FacilityInspector id={selection.id} />;
  if (selection.kind === "group") return <GroupInspector id={selection.id} />;
  if (selection.kind === "node") return <NodeInspector id={selection.id} />;
  return <StationInspector id={selection.id} />;
}

// Slides in once there's something to say — either a selection, or (an
// armed drawing tool takes priority over a stale selection here, matching
// "what you're doing right now" rather than "what you clicked before you
// picked up a tool") that tool's own draft options. An empty inspector is
// chrome with nothing to say, so it doesn't occupy the immersive map
// otherwise. Slides back out the same way once BOTH clear: stays mounted
// (showing the last real content) for the CSS exit transition's duration
// instead of vanishing the instant either one clears — see useDelayedUnmount.
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const multiSelection = useEditor((s) => s.multiSelection);
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => s.readOnly);
  const { viewMode } = useView();
  const showingToolDraft = tool !== "select" && !readOnly && viewMode !== "diagram";
  const isOpen = showingToolDraft || multiSelection.length > 0 || selection !== null;
  const { mounted, closing } = useDelayedUnmount(isOpen, 160);

  const current = showingToolDraft ? <ToolDraftInspector tool={tool} /> : renderInspectorContent(selection, multiSelection);
  const lastContent = useRef<ReactNode>(current);
  if (current !== null) lastContent.current = current;

  if (!mounted) return null;
  return <div data-inspector-state={closing ? "closed" : "open"}>{current ?? lastContent.current}</div>;
}

const MULTI_KIND_LABEL: Record<MultiSelectItem["kind"], string> = { way: "way", station: "station", facility: "facility" };

interface MultiInspectorProps {
  items: MultiSelectItem[];
}

// Bulk actions only — moving/deleting several objects at once as one group,
// not editing shared properties across mixed kinds (a way and a station have
// nothing in common to show one merged form for).
function MultiInspector({ items }: MultiInspectorProps) {
  const readOnly = useEditor((s) => s.readOnly);
  const clearMultiSelection = useEditor((s) => s.clearMultiSelection);
  const deleteMultiSelection = useEditor((s) => s.deleteMultiSelection);

  const counts = new Map<MultiSelectItem["kind"], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const summary = [...counts.entries()].map(([kind, n]) => `${n} ${MULTI_KIND_LABEL[kind]}${n === 1 ? "" : "s"}`).join(", ");

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot ring" />
        <span className="insp-name static">{items.length} selected</span>
      </div>
      <div className="insp-kind">{summary}</div>

      {!readOnly && <p className="insp-sub">Drag any selected way, station, or facility to move the whole group · Shift-click to add or remove one</p>}

      <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={clearMultiSelection}>
        Clear selection
      </button>
      {!readOnly && (
        <button type="button" className="danger-btn" onClick={deleteMultiSelection}>
          <Icon name="trash" size={18} /> Delete {items.length} objects
        </button>
      )}
    </Panel>
  );
}
