import { useState } from "react";
import { useEditor } from "../../editor/EditorProvider";
import { GRADES, LANE_KINDS, WAY_FAMILIES, wayType } from "@transitmapper/core/model/catalog";
import { estimateWayCapitalCost, formatUsdCompact } from "@transitmapper/core/model/cost";
import { bearingDegrees, formatBearing, formatKm, wayLengthMeters } from "@transitmapper/core/model/geo";
import { getComponent } from "@transitmapper/core/model/components";
import { isOneWay, wayCapacity } from "@transitmapper/core/model/profile";
import { CrossSectionEditor } from "../CrossSectionEditor";
import { InspectorTabs, type InspectorTab } from "../InspectorTabs";
import { Panel } from "../Panel";
import { blurOnEnter } from "../formUtils";
import { Icon } from "../Icon";
import { useView } from "../ViewProvider";
import { GEOMETRY_OPTIONS, GradeChips, EmptyInspector, ServicesOnWay, Stat } from "./shared";

const MEDIAN_FT = 0.3048;
const medianFtLabel = (m: number) => `${Math.round(m / MEDIAN_FT)}′`;

interface MedianFieldProps {
  namedWayId: string;
  readOnly: boolean;
}

/** A NamedWay's captured median width (see model/system.ts's Median) —
 *  editable independent of how far apart the carriageways happen to be
 *  dragged, and preserved across separate/combine round-trips. */
function MedianField({ namedWayId, readOnly }: MedianFieldProps) {
  const median = useEditor((s) => getComponent(s.system.medians, namedWayId));
  const setMedianWidth = useEditor((s) => s.setMedianWidth);
  const widthM = median?.widthM ?? LANE_KINDS.median.defaultWidthM;
  return (
    <>
      <label className="field-label" id="median-width-label">Median</label>
      <div className="chip-row" role="group" aria-labelledby="median-width-label">
        {LANE_KINDS.median.widthPresetsM.map((w) => (
          <button
            key={w}
            className={`chip ${Math.abs(widthM - w) < 0.01 ? "active" : ""}`}
            aria-pressed={Math.abs(widthM - w) < 0.01}
            disabled={readOnly}
            onClick={() => setMedianWidth(namedWayId, w)}
          >
            {medianFtLabel(w)}
          </button>
        ))}
      </div>
    </>
  );
}

export interface WayInspectorProps {
  id: string;
}

// Task-based, context-dependent: the panel shows ONE concern at a time,
// chosen by an MD3 segmented tab row, and which tasks exist depends on the
// current view — Lanes (the physical cross-section) only exists in the
// Infrastructure view, where lane geometry actually renders; Network view
// gets Identity/Alignment only. The old everything-stacked form (and its
// capacity stepper, which the lane strip made redundant) is gone.
export function WayInspector({ id }: WayInspectorProps) {
  const way = useEditor((s) => s.system.ways.find((w) => w.id === id));
  const readOnly = useEditor((s) => s.readOnly);
  const setWayGeometry = useEditor((s) => s.setWayGeometry);
  const setWayGrade = useEditor((s) => s.setWayGrade);
  const setWayClassId = useEditor((s) => s.setWayClassId);
  const deleteWay = useEditor((s) => s.deleteWay);
  const nameWay = useEditor((s) => s.nameWay);
  const namedWay = useEditor((s) => s.system.namedWays.find((n) => n.wayIds.includes(id)));
  const separateCarriageways = useEditor((s) => s.separateCarriageways);
  const combineCarriageways = useEditor((s) => s.combineCarriageways);
  const mergeWaysAction = useEditor((s) => s.mergeWays);
  const straightenWayAction = useEditor((s) => s.straightenWay);
  const nodes = useEditor((s) => s.system.nodes);
  const allWays = useEditor((s) => s.system.ways);
  const select = useEditor((s) => s.select);
  const { viewMode } = useView();
  const [tab, setTab] = useState<string>(viewMode === "infrastructure" ? "lanes" : "identity");

  if (!way) return <EmptyInspector />;
  const type = wayType(way.typeId);
  const length = wayLengthMeters(way);
  const bearing = bearingDegrees(way.points[0], way.points[way.points.length - 1]);
  const cost = estimateWayCapitalCost(way);
  const identityNoun = WAY_FAMILIES[type.family].identityNoun;

  const infra = viewMode === "infrastructure";
  const tabs: InspectorTab[] = [
    ...(infra ? [{ id: "lanes", label: "Lanes" }] : []),
    { id: "identity", label: "Identity" },
    { id: "alignment", label: "Alignment" },
  ];
  // The current tab can vanish when the view changes (Lanes is
  // Infrastructure-only) — fall back rather than showing an empty panel.
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  // A way is end-to-end mergeable with a neighbor when a 2-way node joins
  // one of its OPEN ends to another same-type way's open end — the exact
  // shape splitWayAt leaves behind.
  const endIndexes = new Set([0, way.points.length - 1]);
  const mergeCandidate = nodes
    .filter((n) => n.refs.length === 2 && n.refs.some((r) => r.wayId === id && endIndexes.has(r.pointIndex)))
    .map((n) => n.refs.find((r) => r.wayId !== id))
    .map((ref) => (ref ? allWays.find((w) => w.id === ref.wayId) : undefined))
    .find((w) => !!w && w.typeId === way.typeId);

  // Straighten only has something to do when a non-junction control point
  // sits strictly between the endpoints — junction points stay put so
  // connected ways don't desync.
  const junctionIndexes = new Set(nodes.flatMap((n) => n.refs.filter((r) => r.wayId === id).map((r) => r.pointIndex)));
  const canStraighten = way.points.some((_, i) => i !== 0 && i !== way.points.length - 1 && !junctionIndexes.has(i));

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot ring" />
        <span className="insp-name static">{namedWay?.name || type.label}</span>
      </div>
      <div className="insp-kind">
        {namedWay?.name ? `${type.label} · ` : ""}
        {wayCapacity(way)} {type.capacityLabel} · {formatKm(length)}
      </div>
      {way.source?.startsWith("osm:") && <div className="badge">Imported from OpenStreetMap</div>}

      <InspectorTabs tabs={tabs} active={active} onChange={setTab} />

      {active === "lanes" && (
        <div className="insp-section" role="tabpanel">
          <CrossSectionEditor wayId={id} readOnly={readOnly} />
          {!readOnly && (
            <div className="insp-actions">
              {!isOneWay(way.profile) && way.profile.lanes.length > 1 && (
                <button
                  className="ghost-btn"
                  title="Split into two one-way carriageways around a median gap — both stay one named street"
                  onClick={() => {
                    const newId = separateCarriageways(id);
                    if (newId) select({ kind: "way", id });
                  }}
                >
                  Separate carriageways
                </button>
              )}
              {namedWay && namedWay.wayIds.length === 2 && (
                <button
                  className="ghost-btn"
                  title="Merge the two one-way carriageways back into one two-way street"
                  onClick={() => combineCarriageways(namedWay.id)}
                >
                  Combine carriageways
                </button>
              )}
            </div>
          )}
          {namedWay && namedWay.wayIds.length === 2 && <MedianField namedWayId={namedWay.id} readOnly={readOnly} />}
          {!readOnly && <p className="insp-sub">Shortcuts: [ ] lanes · D flip · O one-way · 1–9 presets</p>}
        </div>
      )}

      {active === "identity" && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label">{identityNoun} name</label>
          <input
            key={`${id}:${namedWay?.id ?? "none"}`}
            className="insp-name-input"
            placeholder={`Unnamed ${identityNoun.toLowerCase()}`}
            defaultValue={namedWay?.name ?? ""}
            readOnly={readOnly}
            onBlur={(e) => nameWay(id, e.target.value)}
            onKeyDown={blurOnEnter}
          />
          {!readOnly && namedWay && namedWay.wayIds.length > 1 && (
            <p className="insp-sub">Shared by {namedWay.wayIds.length} segments — renaming here renames the whole {identityNoun.toLowerCase()}</p>
          )}

          {type.classes.length > 0 && (
            <>
              <label className="field-label">Class</label>
              <div className="chip-row" role="group" aria-label="Class">
                {type.classes.map((c) => (
                  <button key={c.id} className={`chip ${way.classId === c.id ? "active" : ""}`} aria-pressed={way.classId === c.id} disabled={readOnly} onClick={() => setWayClassId(id, c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <ServicesOnWay wayId={id} readOnly={readOnly} />

          {cost && (
            <div className="cost-estimate">
              <label className="field-label">Est. capital cost</label>
              <div className="cost-range">{formatUsdCompact(cost.totalLowUsd)}–{formatUsdCompact(cost.totalHighUsd)}</div>
              <p className="insp-sub">
                {formatUsdCompact(cost.perMileLowUsd)}–{formatUsdCompact(cost.perMileHighUsd)} per mile, {type.label.toLowerCase()} · {GRADES[way.grade].label.toLowerCase()}.
                A rough order-of-magnitude bucket, not a feasibility estimate.
              </p>
            </div>
          )}
        </div>
      )}

      {active === "alignment" && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label">Shape</label>
          <div className="chip-row" role="group" aria-label="Shape">
            {GEOMETRY_OPTIONS.map(([g, label]) => (
              <button
                key={g}
                className={`chip ${way.geometry === g ? "active" : ""}`}
                aria-pressed={way.geometry === g}
                disabled={readOnly || (g === "freeform" && way.geometry !== "freeform")}
                onClick={() => setWayGeometry(id, g)}
              >
                {label}
              </button>
            ))}
          </div>

          <GradeChips value={way.grade} disabled={readOnly} onChange={(g) => setWayGrade(id, g)} />

          <div className="stats">
            <Stat label="Length" value={formatKm(length)} />
            <Stat label="Bearing" value={formatBearing(bearing)} />
            <Stat label="Points" value={String(way.points.length)} />
          </div>

          {!readOnly && (mergeCandidate || canStraighten) && (
            <div className="insp-actions">
              {mergeCandidate && (
                <button
                  className="ghost-btn"
                  title="Join this way end-to-end with the connected way (inverse of split)"
                  onClick={() => mergeWaysAction(id, mergeCandidate.id)}
                >
                  Merge with connected way
                </button>
              )}
              {canStraighten && (
                <button
                  className="ghost-btn"
                  title="Drop every control point that isn't a junction, leaving a straight line end to end"
                  onClick={() => straightenWayAction(id)}
                >
                  Straighten
                </button>
              )}
            </div>
          )}

          {!readOnly && <p className="insp-sub">Drag a handle to reshape · Ctrl-drag an end to extend · Alt-drag to erase · Ctrl-click a point to split</p>}
        </div>
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteWay(id)}>
            <Icon name="trash" size={18} /> Delete way
          </button>
        </div>
      )}
    </Panel>
  );
}
