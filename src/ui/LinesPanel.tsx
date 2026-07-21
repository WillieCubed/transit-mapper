import { useEditor } from "../editor/EditorProvider";
import type { Selection } from "../editor/store";
import { FACILITY_TYPES, MODES, WAY_TYPE_ORDER, WAY_TYPES } from "../model/catalog";
import { useListboxKeyboardNav } from "./useListboxKeyboardNav";

function rowKey(kind: NonNullable<Selection>["kind"], id: string): string {
  return `${kind}:${id}`;
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

  const waysByType = WAY_TYPE_ORDER.map((typeId) => ({ typeId, ways: ways.filter((w) => w.typeId === typeId) })).filter(
    (g) => g.ways.length > 0,
  );

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
      {services.map((sv) => {
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

      {stations.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Stations</div>}
      {stations.map((st, i) => {
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

      {facilities.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Facilities</div>}
      {facilities.map((f) => {
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

      {groups.length > 0 && <div className="panel-section-label" style={{ marginTop: 16 }}>Groups</div>}
      {groups.map((g) => {
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
    </div>
  );
}
