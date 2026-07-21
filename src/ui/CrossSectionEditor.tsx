// The lane-card cross-section editor (WayInspector): a horizontal strip
// mirroring the street left-to-right — each card IS its lane, sized
// proportionally to its real width — with per-lane controls (kind, width
// presets in feet, direction) and whole-profile operations (presets, flip,
// one-way ⇄ two-way). All edits go through the store's setWayProfile /
// applyProfilePreset, so undo/redo and connector pruning come for free.
import { useState } from "react";
import { useEditor } from "../editor/EditorProvider";
import { LANE_KINDS, laneKind, profilePresetsForWayType, wayType } from "../model/catalog";
import { flipProfile, isOneWay, makeOneWay, makeTwoWay, profileWidthM } from "../model/profile";
import { shortId } from "../model/ids";
import type { CrossSection, LaneDirection, LaneSpec } from "../model/system";
import { laneRender } from "../style/catalogStyle";
import { Icon } from "./Icon";

const FT = 0.3048;
const ftLabel = (m: number) => `${Math.round(m / FT)}′`;

const DIRECTION_GLYPH: Record<LaneDirection, string> = { forward: "↑", backward: "↓", both: "⇅", none: "·" };
const DIRECTION_CYCLE: LaneDirection[] = ["forward", "backward", "both"];

export interface CrossSectionEditorProps {
  wayId: string;
  readOnly: boolean;
}

export function CrossSectionEditor({ wayId, readOnly }: CrossSectionEditorProps) {
  const way = useEditor((s) => s.system.ways.find((w) => w.id === wayId));
  const setWayProfile = useEditor((s) => s.setWayProfile);
  const applyProfilePreset = useEditor((s) => s.applyProfilePreset);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);

  if (!way) return null;
  const type = wayType(way.typeId);
  const profile = way.profile;
  const presets = profilePresetsForWayType(way.typeId);
  const selected = profile.lanes.find((l) => l.id === selectedLaneId) ?? null;
  const selectedIndex = selected ? profile.lanes.indexOf(selected) : -1;

  const update = (lanes: LaneSpec[]) => setWayProfile(wayId, { lanes });
  const updateLane = (laneId: string, patch: Partial<LaneSpec>) =>
    update(profile.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)));
  const setProfile = (p: CrossSection) => setWayProfile(wayId, p);

  const addLane = () => {
    const kindId = selected?.kindId ?? type.primaryLaneKindId;
    const lane: LaneSpec = {
      id: shortId(),
      kindId,
      widthM: selected?.widthM ?? laneKind(kindId).defaultWidthM,
      direction: selected?.direction ?? "forward",
    };
    const at = selectedIndex >= 0 ? selectedIndex + 1 : profile.lanes.length;
    update([...profile.lanes.slice(0, at), lane, ...profile.lanes.slice(at)]);
    setSelectedLaneId(lane.id);
  };

  const removeLane = () => {
    if (!selected || profile.lanes.length <= 1) return;
    update(profile.lanes.filter((l) => l.id !== selected.id));
    setSelectedLaneId(null);
  };

  const moveLane = (delta: -1 | 1) => {
    if (!selected) return;
    const to = selectedIndex + delta;
    if (to < 0 || to >= profile.lanes.length) return;
    const lanes = [...profile.lanes];
    lanes.splice(selectedIndex, 1);
    lanes.splice(to, 0, selected);
    update(lanes);
  };

  const cycleDirection = () => {
    if (!selected) return;
    const i = DIRECTION_CYCLE.indexOf(selected.direction);
    updateLane(selected.id, { direction: DIRECTION_CYCLE[(i + 1) % DIRECTION_CYCLE.length] });
  };

  const selectedKind = selected ? laneKind(selected.kindId) : null;

  return (
    <>
      <label className="field-label">Cross-section</label>
      {!readOnly && presets.length > 0 && (
        <select
          className="opt-select"
          style={{ width: "100%", marginBottom: 6 }}
          aria-label="Apply a cross-section preset"
          value=""
          onChange={(e) => {
            if (e.target.value) applyProfilePreset(wayId, e.target.value);
          }}
        >
          <option value="">Apply preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {/* The strip IS the street: left-to-right facing the way's forward
          direction, each card proportional to its lane's real width. */}
      <div className="xs-strip" role="listbox" aria-label="Lanes, left to right">
        {profile.lanes.map((l) => {
          const kind = laneKind(l.kindId);
          return (
            <button
              key={l.id}
              className={`xs-lane ${selected?.id === l.id ? "active" : ""}`}
              style={{ flexGrow: l.widthM, background: laneRender(l.kindId).color }}
              role="option"
              aria-selected={selected?.id === l.id}
              title={`${kind.label} · ${ftLabel(l.widthM)}`}
              disabled={readOnly}
              onClick={() => setSelectedLaneId(selected?.id === l.id ? null : l.id)}
            >
              <span className="xs-lane-glyph">{kind.directional ? DIRECTION_GLYPH[l.direction] : ""}</span>
              <span className="xs-lane-width">{ftLabel(l.widthM)}</span>
            </button>
          );
        })}
      </div>
      <div className="xs-total">
        {profile.lanes.length} lanes · {ftLabel(profileWidthM(profile))} ({profileWidthM(profile).toFixed(1)} m) total
      </div>

      {!readOnly && selected && selectedKind && (
        <div className="xs-controls">
          <div className="opt-field">
            <span className="control-label">Lane</span>
            <select
              className="opt-select"
              value={selected.kindId}
              onChange={(e) => {
                const kindId = e.target.value;
                updateLane(selected.id, { kindId, widthM: laneKind(kindId).defaultWidthM });
              }}
            >
              {type.laneKindIds.map((id) => (
                <option key={id} value={id}>
                  {LANE_KINDS[id]?.label ?? id}
                </option>
              ))}
            </select>
          </div>

          <div className="chip-row" role="group" aria-label="Lane width">
            {selectedKind.widthPresetsM.map((w) => (
              <button
                key={w}
                className={`chip ${Math.abs(selected.widthM - w) < 0.01 ? "active" : ""}`}
                onClick={() => updateLane(selected.id, { widthM: w })}
              >
                {ftLabel(w)}
              </button>
            ))}
            <button className="chip" title="Narrower (1 ft)" onClick={() => updateLane(selected.id, { widthM: Math.max(FT, selected.widthM - FT) })}>
              −
            </button>
            <button className="chip" title="Wider (1 ft)" onClick={() => updateLane(selected.id, { widthM: selected.widthM + FT })}>
              +
            </button>
          </div>

          <div className="xs-lane-actions">
            {selectedKind.directional && (
              <button className="ghost-btn" onClick={cycleDirection} title="Cycle direction">
                {DIRECTION_GLYPH[selected.direction]} Direction
              </button>
            )}
            <button className="ghost-btn" disabled={selectedIndex <= 0} onClick={() => moveLane(-1)} title="Move left">
              ⟵
            </button>
            <button className="ghost-btn" disabled={selectedIndex >= profile.lanes.length - 1} onClick={() => moveLane(1)} title="Move right">
              ⟶
            </button>
            <button className="ghost-btn" disabled={profile.lanes.length <= 1} onClick={removeLane} title="Delete lane">
              <Icon name="plus" size={13} style={{ transform: "rotate(45deg)" }} />
            </button>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="xs-lane-actions">
          <button className="ghost-btn" onClick={addLane}>
            <Icon name="plus" size={13} /> Add lane
          </button>
          <button className="ghost-btn" onClick={() => setProfile(flipProfile(profile))} title="Reverse the whole cross-section">
            Flip
          </button>
          <button
            className="ghost-btn"
            onClick={() => setProfile(isOneWay(profile) ? makeTwoWay(profile) : makeOneWay(profile, "forward"))}
          >
            {isOneWay(profile) ? "Make two-way" : "Make one-way"}
          </button>
        </div>
      )}
    </>
  );
}
