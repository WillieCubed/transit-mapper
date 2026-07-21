import { useMemo, useState } from "react";
import { useEditor } from "../editor/EditorProvider";
import type { Selection } from "../editor/store";
import { FACILITY_TYPES, MODES, WAY_TYPE_ORDER, WAY_TYPES } from "@transitmapper/core/model/catalog";
import { useListboxKeyboardNav } from "./useListboxKeyboardNav";

function rowKey(kind: NonNullable<Selection>["kind"], id: string): string {
  return `${kind}:${id}`;
}

// A hand-drawn system has dozens of objects; an imported GTFS feed can have
// thousands (RTC's real network alone is ~3800 stops) — rendering every one
// as its own DOM row is what froze the tab on import (React has to build
// and commit every element even for ones that scroll off-screen; CSS alone
// can't skip that part). Past this many in one section, only the first
// LIST_CAP render, with a button to reveal the rest on demand.
const LIST_CAP = 150;

interface CappedItems<T> {
  visible: T[];
  hiddenCount: number;
}

function capped<T>(items: T[], expanded: boolean): CappedItems<T> {
  if (expanded || items.length <= LIST_CAP) return { visible: items, hiddenCount: 0 };
  return { visible: items.slice(0, LIST_CAP), hiddenCount: items.length - LIST_CAP };
}

interface ShowMoreRowProps {
  hiddenCount: number;
  onClick: () => void;
}

function ShowMoreRow({ hiddenCount, onClick }: ShowMoreRowProps) {
  if (hiddenCount === 0) return null;
  return (
    <button type="button" className="link-btn" style={{ display: "block", margin: "4px 8px" }} onClick={onClick}>
      Show {hiddenCount} more…
    </button>
  );
}

/** The system's objects grouped by the model: services, infrastructure (by
 *  way type), stations, facilities, groups. Pure content — SidePanel (desktop)
 *  and the mobile sheet each own the card chrome / collapse state around it.
 *
 *  One flat keyboard-navigable list (role="listbox") spanning every section
 *  below — Arrow Up/Down, Home/End, and type-ahead all move through
 *  services → infrastructure → stations → facilities → groups in the same
 *  order they're drawn, the way a real layers panel (Figma, Photoshop)
 *  behaves, not a separate tab stop per row. See useListboxKeyboardNav. */
export function LinesPanel() {
  const services = useEditor((s) => s.system.services);
  const stations = useEditor((s) => s.system.stations);
  const ways = useEditor((s) => s.system.ways);
  const facilities = useEditor((s) => s.system.facilities);
  const groups = useEditor((s) => s.system.groups);
  const selection = useEditor((s) => s.selection);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const { containerRef, onKeyDown } = useListboxKeyboardNav<HTMLDivElement>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const expandSection = (key: string) => setExpanded((prev) => new Set(prev).add(key));

  // Memoized on the source array + this section's own expanded flag — NOT
  // on `selection` (this component re-renders on every row click) or on the
  // raw `expanded` Set (a fresh Set reference every expandSection call would
  // invalidate every section's memo, not just the one that changed). Once
  // "Show more" is clicked on a real GTFS import, `waysShown.visible` can be
  // the full multi-thousand-entry array — without this, waysByType's filter
  // re-ran that full scan on every unrelated selection click.
  const servicesExpanded = expanded.has("services");
  const waysExpanded = expanded.has("ways");
  const stationsExpanded = expanded.has("stations");
  const facilitiesExpanded = expanded.has("facilities");
  const groupsExpanded = expanded.has("groups");

  const servicesShown = useMemo(() => capped(services, servicesExpanded), [services, servicesExpanded]);
  const stationsShown = useMemo(() => capped(stations, stationsExpanded), [stations, stationsExpanded]);
  const facilitiesShown = useMemo(() => capped(facilities, facilitiesExpanded), [facilities, facilitiesExpanded]);
  const groupsShown = useMemo(() => capped(groups, groupsExpanded), [groups, groupsExpanded]);

  // Grouped by type BEFORE capping, not after — capping the flat `ways` array
  // first (as this used to) can push an entire type past the cutoff, hiding
  // its section label with no indication that type exists at all. Capping
  // per-group instead (in WAY_TYPE_ORDER) guarantees every type present gets
  // its label rendered as long as any of its share of the LIST_CAP budget
  // survives.
  const waysByType = useMemo(() => {
    const grouped = WAY_TYPE_ORDER.map((typeId) => ({ typeId, ways: ways.filter((w) => w.typeId === typeId) })).filter(
      (g) => g.ways.length > 0,
    );
    if (waysExpanded) return grouped;
    let remaining = LIST_CAP;
    const out: typeof grouped = [];
    for (const g of grouped) {
      if (remaining <= 0) break;
      out.push({ typeId: g.typeId, ways: g.ways.slice(0, remaining) });
      remaining -= Math.min(remaining, g.ways.length);
    }
    return out;
  }, [ways, waysExpanded]);
  const waysHiddenCount = ways.length - waysByType.reduce((sum, g) => sum + g.ways.length, 0);

  // Roving tabindex: Tab should land on exactly one row — whichever is
  // currently selected, or the very first row overall if nothing here is.
  const selectedKey = selection ? rowKey(selection.kind, selection.id) : null;
  const firstKey =
    services[0] ? rowKey("service", services[0].id)
    : waysByType[0]?.ways[0] ? rowKey("way", waysByType[0].ways[0].id)
    : stations[0] ? rowKey("station", stations[0].id)
    : facilities[0] ? rowKey("facility", facilities[0].id)
    : groups[0] ? rowKey("group", groups[0].id)
    : null;
  const rovingKey = selectedKey ?? firstKey;

  return (
    <div className="panel-body" ref={containerRef} role="listbox" aria-label="Objects" onKeyDown={onKeyDown}>
      <div className="panel-section-label">Services</div>
      {services.length === 0 && <p className="panel-hint">Way tool: drag or click to lay infrastructure; it starts one service you can recolor.</p>}
      {servicesShown.visible.map((sv) => {
        const active = selection?.kind === "service" && selection.id === sv.id;
        return (
          <button
            key={sv.id}
            role="option"
            aria-selected={active}
            tabIndex={rowKey("service", sv.id) === rovingKey ? 0 : -1}
            className={`list-row ${active ? "active" : ""}`}
            onClick={() => selectAndFocus({ kind: "service", id: sv.id })}
          >
            <span className="dot" style={{ background: sv.color }} />
            <span className="list-name">{sv.name}</span>
            <span className="list-tag">{MODES[sv.modeId]?.label ?? sv.modeId}</span>
          </button>
        );
      })}
      <ShowMoreRow hiddenCount={servicesShown.hiddenCount} onClick={() => expandSection("services")} />

      {waysByType.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Infrastructure</div>}
      {waysByType.map((group) => (
        <div key={group.typeId}>
          <div className="panel-group-label">{WAY_TYPES[group.typeId].label}</div>
          {group.ways.map((w, i) => {
            const active = selection?.kind === "way" && selection.id === w.id;
            return (
              <button
                key={w.id}
                role="option"
                aria-selected={active}
                tabIndex={rowKey("way", w.id) === rovingKey ? 0 : -1}
                className={`list-row ${active ? "active" : ""}`}
                onClick={() => selectAndFocus({ kind: "way", id: w.id })}
              >
                <span className="dot ring" />
                <span className="list-name">{WAY_TYPES[group.typeId].label} {i + 1}</span>
              </button>
            );
          })}
        </div>
      ))}
      <ShowMoreRow hiddenCount={waysHiddenCount} onClick={() => expandSection("ways")} />

      {stations.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Stations</div>}
      {stationsShown.visible.map((st, i) => {
        const active = selection?.kind === "station" && selection.id === st.id;
        return (
          <button
            key={st.id}
            role="option"
            aria-selected={active}
            tabIndex={rowKey("station", st.id) === rovingKey ? 0 : -1}
            className={`list-row ${active ? "active" : ""}`}
            onClick={() => selectAndFocus({ kind: "station", id: st.id })}
          >
            <span className="dot ring" />
            <span className="list-name">{st.name || `Station ${i + 1}`}</span>
          </button>
        );
      })}
      <ShowMoreRow hiddenCount={stationsShown.hiddenCount} onClick={() => expandSection("stations")} />

      {facilities.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Facilities</div>}
      {facilitiesShown.visible.map((f) => {
        const active = selection?.kind === "facility" && selection.id === f.id;
        return (
          <button
            key={f.id}
            role="option"
            aria-selected={active}
            tabIndex={rowKey("facility", f.id) === rovingKey ? 0 : -1}
            className={`list-row ${active ? "active" : ""}`}
            onClick={() => selectAndFocus({ kind: "facility", id: f.id })}
          >
            <span className="dot ring" />
            <span className="list-name">{f.name || FACILITY_TYPES[f.typeId]?.label || f.typeId}</span>
          </button>
        );
      })}
      <ShowMoreRow hiddenCount={facilitiesShown.hiddenCount} onClick={() => expandSection("facilities")} />

      {groups.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Groups</div>}
      {groupsShown.visible.map((g) => {
        const active = selection?.kind === "group" && selection.id === g.id;
        return (
          <button
            key={g.id}
            role="option"
            aria-selected={active}
            tabIndex={rowKey("group", g.id) === rovingKey ? 0 : -1}
            className={`list-row ${active ? "active" : ""}`}
            onClick={() => selectAndFocus({ kind: "group", id: g.id })}
          >
            <span className="dot ring" />
            <span className="list-name">{g.name || (g.footprint ? "Facility complex" : "Group")}</span>
            <span className="list-tag">{g.memberIds.length}</span>
          </button>
        );
      })}
      <ShowMoreRow hiddenCount={groupsShown.hiddenCount} onClick={() => expandSection("groups")} />
    </div>
  );
}
