import { useEffect } from "react";
import { useEditor } from "../../editor/EditorProvider";
import {
  FACILITY_TYPES,
  WAY_FAMILIES,
  mode,
  modesForWayType,
  profilePresetsForWayType,
  wayType,
} from "@transitmapper/core/model/catalog";
import type { Tool } from "../../editor/store";
import { ColorField } from "../ColorField";
import { Panel } from "../Panel";
import { useView } from "../ViewProvider";
import { GEOMETRY_OPTIONS, GradeChips } from "./shared";

/**
 * When a drawing tool is armed (anything but Select), the sidebar shows
 * THAT tool's draft options instead of a selected object's details — the
 * right sidebar is the one dynamic/contextual surface in this app, and a
 * tool's own configuration is exactly that kind of content, same as a
 * selected object's properties are. This used to be a second version of
 * "dynamic panel," floating above the bottom tool dock as its own
 * `.tool-options` strip — confirmed by the user as the exact kind of
 * bundling this app keeps needing to be undone: one dynamic surface, not
 * two. The bottom dock's only job now is picking WHICH tool; this is where
 * that tool's own settings live, right where a selection's details would.
 */
export interface ToolDraftInspectorProps {
  tool: Tool;
}

export function ToolDraftInspector({ tool }: ToolDraftInspectorProps) {
  if (tool === "way") return <WayDraftInspector />;
  if (tool === "station") return <StationDraftInspector />;
  if (tool === "facility") return <FacilityDraftInspector />;
  return null;
}

/**
 * Network view is mode-first: you're drawing a LINE, so "Line type" (Bus,
 * Light rail, Subway, …) is the one real choice, chosen from the dock's own
 * tool menu — this panel only carries the REST of that choice's fallout
 * (which physical carrier when the mode allows more than one, grade, shape,
 * color). Infrastructure view stays way-type-first (rail, road, bike,
 * aerial, water, …), with class/cross-section/direction as real physical-
 * alignment facts that belong here too — but only there; see each field's
 * own comment for why they're Infrastructure-only.
 */
function WayDraftInspector() {
  const draftWayTypeId = useEditor((s) => s.draftWayTypeId);
  const setDraftWayType = useEditor((s) => s.setDraftWayType);
  const draftModeId = useEditor((s) => s.draftModeId);
  const draftGeometry = useEditor((s) => s.draftGeometry);
  const setDraftGeometry = useEditor((s) => s.setDraftGeometry);
  const draftColor = useEditor((s) => s.draftColor);
  const setDraftColor = useEditor((s) => s.setDraftColor);
  const draftGrade = useEditor((s) => s.draftGrade);
  const setDraftGrade = useEditor((s) => s.setDraftGrade);
  const draftClassId = useEditor((s) => s.draftClassId);
  const setDraftClassId = useEditor((s) => s.setDraftClassId);
  const draftPresetId = useEditor((s) => s.draftPresetId);
  const setDraftPreset = useEditor((s) => s.setDraftPreset);
  const draftOneWay = useEditor((s) => s.draftOneWay);
  const setDraftOneWay = useEditor((s) => s.setDraftOneWay);
  const setDraftServiceEnabled = useEditor((s) => s.setDraftServiceEnabled);
  const palette = useEditor((s) => s.system.palette);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);
  const { viewMode } = useView();

  const type = wayType(draftWayTypeId);
  const compatibleModes = modesForWayType(draftWayTypeId);
  const networkFirst = viewMode === "network";
  const currentMode = mode(draftModeId);

  // The whole separation of concerns, enforced: drawing in the
  // Infrastructure view NEVER creates a service; drawing in the Network view
  // (mode-first, "draw a line") always does. The store flag just mirrors
  // which view the Way tool is being used from.
  useEffect(() => {
    setDraftServiceEnabled(networkFirst);
  }, [networkFirst, setDraftServiceEnabled]);

  return (
    <Panel slot="right" aria-label="Drawing options">
      <div className="insp-head">
        {networkFirst && <span className="dot" style={{ background: draftColor }} />}
        <span className="insp-name static">{networkFirst ? currentMode.label : WAY_FAMILIES[type.family].toolLabel}</span>
      </div>
      <div className="insp-kind">Drawing tool · options apply to what you draw next</div>
      <div className="insp-section">
        {networkFirst && currentMode.wayTypeIds.length > 1 && (
          <>
            <label className="field-label">Runs on</label>
            <select className="opt-select" value={draftWayTypeId} onChange={(e) => setDraftWayType(e.target.value)}>
              {currentMode.wayTypeIds.map((id) => (
                <option key={id} value={id}>{wayType(id).label}</option>
              ))}
            </select>
          </>
        )}

        {!networkFirst && profilePresetsForWayType(draftWayTypeId).length > 0 && (
          <>
            <label className="field-label">Cross-section</label>
            <select className="opt-select" value={draftPresetId ?? ""} onChange={(e) => setDraftPreset(e.target.value || null)}>
              <option value="">Default</option>
              {profilePresetsForWayType(draftWayTypeId).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </>
        )}

        {/* Road classification is a physical-alignment fact, not a service
            one — the real question to ask while drawing the actual street
            in Infrastructure view, not while sketching where a bus line
            goes. An armed preset already carries its own class, so this
            follows the same "don't show a field whose answer is already
            decided elsewhere" rule. */}
        {type.classes.length > 0 && !draftPresetId && !networkFirst && (
          <>
            <label className="field-label">Class</label>
            <div className="chip-row" role="group" aria-label="Class">
              {type.classes.map((c) => (
                <button key={c.id} className={`chip ${draftClassId === c.id ? "active" : ""}`} aria-pressed={draftClassId === c.id} onClick={() => setDraftClassId(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}

        <GradeChips value={draftGrade} disabled={false} onChange={setDraftGrade} />

        <label className="field-label" id="draft-shape-label">Shape</label>
        <div className="chip-row" role="group" aria-labelledby="draft-shape-label">
          {GEOMETRY_OPTIONS.map(([g, label]) => (
            <button key={g} className={`chip ${draftGeometry === g ? "active" : ""}`} aria-pressed={draftGeometry === g} onClick={() => setDraftGeometry(g)}>
              {label}
            </button>
          ))}
        </div>

        {/* Same reasoning as Class above: one-way-ness is a fact about the
            physical street, decided when it's actually drawn in
            Infrastructure view — not a choice inherent to sketching a
            schematic line. */}
        {!networkFirst && (
          <>
            <label className="field-label" id="draft-direction-label">Direction</label>
            <div
              className="chip-row"
              role="group"
              aria-labelledby="draft-direction-label"
              title="One-way runs the direction you draw (O toggles; D flips after). Tip: right-click an existing endpoint to branch a one-way segment off it."
            >
              <button className={`chip ${!draftOneWay ? "active" : ""}`} aria-pressed={!draftOneWay} onClick={() => setDraftOneWay(false)}>
                Two-way
              </button>
              <button className={`chip ${draftOneWay ? "active" : ""}`} aria-pressed={draftOneWay} onClick={() => setDraftOneWay(true)}>
                One-way
              </button>
            </div>
          </>
        )}

        {networkFirst && compatibleModes.length > 0 && (
          <ColorField label="Color" value={draftColor} palette={palette} onChange={setDraftColor} onAddToPalette={addPaletteColor} />
        )}
      </div>
    </Panel>
  );
}

/** One honest sentence for the Station tool: drag DRAWS the station, click
 *  drops a quick stop. Network view is schematic, so stops only. */
function StationDraftInspector() {
  const { viewMode } = useView();
  return (
    <Panel slot="right" aria-label="Drawing options">
      <div className="insp-head">
        <span className="insp-name static">Station</span>
      </div>
      <div className="insp-kind">Drawing tool</div>
      <div className="insp-section">
        {viewMode === "infrastructure" ? (
          <p className="panel-hint">Drag a rectangle — or click corner points, double-click to close — to define the station's land. Its border IS the station; draw structures (buildings, platforms, bus bays) on it.</p>
        ) : (
          <p className="panel-hint">Click to place a stop — it snaps onto the line under it. Draw full station footprints in the Infrastructure view.</p>
        )}
      </div>
    </Panel>
  );
}

/**
 * Options for the Facility tool. Two distinct clicks share it:
 *  - normal: click the map to start a new facility complex — a boundary
 *    drawn around the click, ready for bus bays/platforms/entrances placed
 *    inside it (see the Inspector once it's selected).
 *  - armed (via a complex's Inspector "Place inside"): the next click drops
 *    the chosen facility type straight into that complex instead.
 */
function FacilityDraftInspector() {
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const complexMode = useEditor((s) => s.draftFacilityComplexMode);
  const placingFor = useEditor((s) => s.placingFacilityForGroupId);
  const groups = useEditor((s) => s.system.groups);
  const cancelPlacingFacility = useEditor((s) => s.cancelPlacingFacility);

  const placingGroup = placingFor ? groups.find((g) => g.id === placingFor) : undefined;
  const typeLabel = FACILITY_TYPES[draftFacilityTypeId]?.label.toLowerCase() ?? "facility";
  const article = /^[aeiou]/.test(typeLabel) ? "an" : "a";
  const isArea = FACILITY_TYPES[draftFacilityTypeId]?.geometryKind === "area";

  // One plain sentence that matches what a click actually does. The WHAT
  // (entrance/depot/… or Complex) is the tool's flyout variant, not a menu
  // buried here.
  return (
    <Panel slot="right" aria-label="Drawing options">
      <div className="insp-head">
        <span className="insp-name static">Facility</span>
      </div>
      <div className="insp-kind">Drawing tool</div>
      <div className="insp-section">
        {placingGroup ? (
          <p className="panel-hint">
            Click the map to place {article} {typeLabel} in {placingGroup.name || "this complex"}.{" "}
            <button type="button" className="link-btn" onClick={cancelPlacingFacility}>
              Cancel
            </button>
          </p>
        ) : complexMode ? (
          <p className="panel-hint">Drag a rectangle — or click corner points and double-click to close — to outline the site.</p>
        ) : isArea ? (
          <p className="panel-hint">Drag to draw the {typeLabel}'s shape · on station land it joins that station automatically.</p>
        ) : (
          <p className="panel-hint">Click the map to place {article} {typeLabel} · on station land it joins that station automatically.</p>
        )}
      </div>
    </Panel>
  );
}
