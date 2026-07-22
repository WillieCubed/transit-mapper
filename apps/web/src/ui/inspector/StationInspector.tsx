import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../editor/EditorProvider";
import { INTERCHANGE_METERS, servedWayIds, serviceWayIds } from "@transitmapper/core/model/geo";
import { InspectorTabs, type InspectorTab } from "../InspectorTabs";
import { Panel } from "../Panel";
import { blurOnEnter } from "../formUtils";
import { Icon } from "../Icon";
import { useView } from "../ViewProvider";
import { EmptyInspector, Stat } from "./shared";

export interface StationInspectorProps {
  id: string;
}

// Task-based like the way/service inspectors: Stop (what serves it),
// Physical (footprint/platforms — Infrastructure-view detail), Complex
// (transfer grouping). One concern at a time.
export function StationInspector({ id }: StationInspectorProps) {
  const station = useEditor((s) => s.system.stations.find((st) => st.id === id));
  // Narrow selectors, not the whole `system` — see ServiceInspector's note.
  const ways = useEditor((s) => s.system.ways);
  const services = useEditor((s) => s.system.services);
  const readOnly = useEditor((s) => s.readOnly);
  const setStationName = useEditor((s) => s.setStationName);
  const setStationDwellSeconds = useEditor((s) => s.setStationDwellSeconds);
  const deleteStation = useEditor((s) => s.deleteStation);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const focusNameToken = useEditor((s) => s.focusNameToken);
  const focusNameStationId = useEditor((s) => s.focusNameStationId);
  const consumeFocusName = useEditor((s) => s.consumeFocusName);
  const [tab, setTab] = useState<string>("stop");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Placing a station is the one moment the very next thing you want to do
  // is name it — jump straight to typing instead of making that a second
  // click. Immediately consuming (clearing) focusNameStationId matters: this
  // component isn't remount-keyed by id, but it DOES remount when selection
  // swaps to a different kind of object and back — without the explicit
  // consume, re-selecting this exact station later (a fresh mount, so this
  // effect runs again regardless of focusNameToken not having changed)
  // would incorrectly steal focus a second time. Confirmed live.
  useEffect(() => {
    if (focusNameStationId === id && !readOnly) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
      consumeFocusName(id);
    }
    // focusNameToken is the real trigger; id/readOnly/consumeFocusName are
    // read fresh, not watched — re-selecting the same station on an
    // already-mounted instance shouldn't refire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNameToken]);

  if (!station) return <EmptyInspector />;
  const nearWays = new Set(servedWayIds(station.coord, ways, INTERCHANGE_METERS));
  const served = services.filter((sv) => serviceWayIds(sv).some((w) => nearWays.has(w)));

  const tabs: InspectorTab[] = [
    { id: "stop", label: "Stop" },
    { id: "physical", label: "Physical" },
    { id: "complex", label: "Complex" },
  ];

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot" style={{ background: served[0]?.color ?? "#4b5563" }} />
        <input
          ref={nameInputRef}
          className="insp-name"
          aria-label="Station name"
          placeholder="Unnamed station"
          value={station.name ?? ""}
          disabled={readOnly}
          onChange={(e) => setStationName(id, e.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">
        {served.length > 1 ? `Interchange · ${served.length} services` : served.length === 1 ? `Served by ${served[0].name}` : "Station · a stop"}
      </div>

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "stop" && (
        <div className="insp-section" role="tabpanel">
          {!station.anchor && <div className="panel-hint">Free station — drag it onto a way to attach it.</div>}
          <label className="field-label">Served by</label>
          <div className="svc-list">
            {served.length === 0 && <span className="panel-hint">No services nearby</span>}
            {served.map((sv) => (
              <button key={sv.id} className="svc-chip" onClick={() => selectAndFocus({ kind: "service", id: sv.id })}>
                <span className="dot sm" style={{ background: sv.color }} /> {sv.name}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="dwell-input">Dwell time</label>
          <p className="insp-sub">How long a vehicle waits here before departing, in the ambient animation.</p>
          <div className="freq-row">
            <input
              id="dwell-input"
              type="number"
              min={0}
              className="freq-input"
              aria-label="Dwell time in seconds"
              value={station.dwellSeconds ?? ""}
              disabled={readOnly}
              placeholder="20 (default)"
              onChange={(e) => setStationDwellSeconds(id, e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))))}
              onKeyDown={blurOnEnter}
            />
            <span className="freq-suffix">seconds</span>
          </div>
        </div>
      )}

      {tab === "physical" && (
        <div className="insp-section" role="tabpanel">
          <StationFootprint stationId={id} readOnly={readOnly} />
        </div>
      )}

      {tab === "complex" && (
        <div className="insp-section" role="tabpanel">
          <StationGrouping stationId={id} readOnly={readOnly} />
        </div>
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteStation(id)}>
            <Icon name="trash" size={18} /> Delete station
          </button>
        </div>
      )}
    </Panel>
  );
}

interface StationFootprintProps {
  stationId: string;
  readOnly: boolean;
}

function StationFootprint({ stationId, readOnly }: StationFootprintProps) {
  const station = useEditor((s) => s.system.stations.find((st) => st.id === stationId));
  const addStationFootprint = useEditor((s) => s.addStationFootprint);
  const deleteStationFootprint = useEditor((s) => s.deleteStationFootprint);
  const addPlatform = useEditor((s) => s.addPlatform);
  const deletePlatform = useEditor((s) => s.deletePlatform);
  const { setViewMode } = useView();
  if (!station) return null;

  // Footprints/platforms only ever render in the Infrastructure view (see
  // map/layers.ts's buildFeatures) — switch there the moment one exists, or
  // it'd be invisible right where it was just drawn, which reads as broken
  // rendering rather than the view-mode mismatch it actually is.
  const drawFootprint = () => {
    addStationFootprint(stationId);
    setViewMode("infrastructure");
  };
  const drawPlatform = () => {
    addPlatform(stationId);
    setViewMode("infrastructure");
  };

  return (
    <>
      <label className="field-label">Footprint</label>
      {!station.footprint ? (
        <>
          <p className="insp-sub">Physical boundary — visible &amp; editable in the Infrastructure view</p>
          {!readOnly && (
            <button className="add-btn" onClick={drawFootprint}>
              <Icon name="plus" size={17} /> Draw footprint
            </button>
          )}
        </>
      ) : (
        <>
          {!readOnly && <p className="insp-sub">Drag a corner in the Infrastructure view to reshape · Alt-click to erase one</p>}
          <div className="stats">
            <Stat label="Corners" value={String(station.footprint.length)} />
            <Stat label="Platforms" value={String(station.platforms?.length ?? 0)} />
          </div>

          <div className="svc-list">
            {(station.platforms ?? []).map((p, i) => (
              <div key={p.id} className="svc-chip chip-removable">
                <span className="chip-removable-label">Platform {i + 1}</span>
                {!readOnly && (
                  <button className="chip-remove-btn" aria-label="Remove platform" onClick={() => deletePlatform(stationId, p.id)}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {!readOnly && (
            <div className="insp-row-actions">
              <button className="add-btn" onClick={drawPlatform}>
                <Icon name="plus" size={17} /> Add platform
              </button>
              <button className="danger-btn" onClick={() => deleteStationFootprint(stationId)}>
                <Icon name="trash" size={18} /> Remove footprint
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

interface StationGroupingProps {
  stationId: string;
  readOnly: boolean;
}

function StationGrouping({ stationId, readOnly }: StationGroupingProps) {
  const groups = useEditor((s) => s.system.groups);
  const stations = useEditor((s) => s.system.stations);
  const createGroup = useEditor((s) => s.createGroup);
  const addGroupMember = useEditor((s) => s.addGroupMember);
  const removeGroupMember = useEditor((s) => s.removeGroupMember);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const [picked, setPicked] = useState("");

  const myGroup = groups.find((g) => g.memberIds.includes(stationId));
  const otherStations = stations.filter((st) => st.id !== stationId && !myGroup?.memberIds.includes(st.id));

  const groupWith = () => {
    if (!picked) return;
    if (myGroup) addGroupMember(myGroup.id, picked);
    else createGroup([stationId, picked], "Station complex");
    setPicked("");
  };

  return (
    <>
      <label className="field-label">Complex</label>
      {!myGroup && <p className="insp-sub">Group with another station to form a transfer complex</p>}
      {myGroup && (
        <div className="svc-list">
          <button className="svc-chip" onClick={() => selectAndFocus({ kind: "group", id: myGroup.id })}>{myGroup.name || "Complex"}</button>
          {myGroup.memberIds
            .filter((m) => m !== stationId)
            .map((mid) => {
              const st = stations.find((s) => s.id === mid);
              if (!st) return null;
              return (
                <div key={mid} className="svc-chip chip-removable">
                  <button className="chip-removable-label" onClick={() => selectAndFocus({ kind: "station", id: mid })}>
                    {st.name || "Unnamed station"}
                  </button>
                  {!readOnly && (
                    <button className="chip-remove-btn" aria-label="Remove from complex" onClick={() => removeGroupMember(myGroup.id, mid)}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}
      {!readOnly && otherStations.length > 0 && (
        <div className="insp-row-actions">
          <select className="opt-select" value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">Choose a station…</option>
            {otherStations.map((st) => (
              <option key={st.id} value={st.id}>{st.name || "Unnamed station"}</option>
            ))}
          </select>
          <button className="add-btn" onClick={groupWith} disabled={!picked}>
            <Icon name="plus" size={17} /> Group
          </button>
        </div>
      )}
    </>
  );
}
