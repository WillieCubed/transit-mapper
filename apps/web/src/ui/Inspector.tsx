import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor } from "../editor/EditorProvider";
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  GRADE_ORDER,
  GRADES,
  LANE_KINDS,
  MODE_ORDER,
  MODES,
  WAY_FAMILIES,
  facilityType,
  mode,
  modesForWayType,
  profilePresetsForWayType,
  wayType,
  type Grade,
} from "@transitmapper/core/model/catalog";
import type { MultiSelectItem, Selection, Tool } from "../editor/store";
import { estimateWayCapitalCost, formatUsdCompact } from "@transitmapper/core/model/cost";
import { INTERCHANGE_METERS, bearingDegrees, formatBearing, formatKm, servedWayIds, serviceWayIds, wayLengthMeters } from "@transitmapper/core/model/geo";
import { getComponent } from "@transitmapper/core/model/components";
import { isOneWay, wayCapacity } from "@transitmapper/core/model/profile";
import type { LineGeometry, Pattern, ScheduleDayScope, Station, TransitSystem, Way } from "@transitmapper/core/model/system";
import { ColorField } from "./ColorField";
import { CrossSectionEditor } from "./CrossSectionEditor";
import { InspectorTabs, type InspectorTab } from "./InspectorTabs";
import { NodeInspector } from "./NodeInspector";
import { Panel } from "./Panel";
import { ScheduleDialog } from "./ScheduleDialog";
import { blurOnEnter } from "./formUtils";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { useDelayedUnmount } from "./useDelayedUnmount";
import { useView } from "./ViewProvider";

const GEOMETRY_OPTIONS: [LineGeometry, string][] = [
  ["straight", "Straight"],
  ["curved", "Curved"],
  ["freeform", "Freeform"],
];

// Turnkey presets so setting up a working schedule is a click, not typing —
// matches store.ts's DEFAULT_FREQUENCY_MINUTES/DEFAULT_SPAN_* (a fresh
// line's frequency/span always lands on one of these chips, never in the
// "Custom" fallback). "Custom" reveals the raw number/time inputs this
// section used to be, for anything a preset can't express.
const FREQUENCY_PRESETS = [5, 10, 15, 20, 30, 60];

interface SpanPreset {
  label: string;
  start: string;
  end: string;
}

const SPAN_PRESETS: SpanPreset[] = [
  { label: "Daytime", start: "06:00", end: "23:00" },
  { label: "Early–late", start: "05:00", end: "01:00" },
  { label: "24/7", start: "00:00", end: "23:59" },
];

const DAY_SCOPE_LABEL: Record<ScheduleDayScope, string> = { daily: "Every day", weekday: "Weekdays", weekend: "Weekends" };

function formatSpan(start: string, end: string): string {
  return `${start}–${end}`;
}

interface GradeChipsProps {
  value: Grade;
  disabled: boolean;
  onChange: (g: Grade) => void;
}

function GradeChips({ value, disabled, onChange }: GradeChipsProps) {
  return (
    <>
      <label className="field-label" id="grade-chips-label">Grade</label>
      <div className="chip-row" role="group" aria-labelledby="grade-chips-label">
        {GRADE_ORDER.map((g) => (
          <button key={g} className={`chip ${value === g ? "active" : ""}`} aria-pressed={value === g} disabled={disabled} onClick={() => onChange(g)}>
            {GRADES[g].label}
          </button>
        ))}
      </div>
    </>
  );
}

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
interface ToolDraftInspectorProps {
  tool: Tool;
}

function ToolDraftInspector({ tool }: ToolDraftInspectorProps) {
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

function EmptyInspector() {
  return (
    <Panel slot="right" aria-label="Selection details">
      <p className="panel-hint">Select a service, way, or station to edit it.</p>
    </Panel>
  );
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

function lengthOfWays(ways: Way[], wayIds: string[]): number {
  return wayIds.reduce((sum, wid) => {
    const w = ways.find((x) => x.id === wid);
    return sum + (w ? wayLengthMeters(w) : 0);
  }, 0);
}

// The rider's mental model of a line — "calls at: Downtown, Arts District,
// Sahara, Airport" — has nowhere else to live (LinesPanel shows raw way
// segments, not ride order). Ordered by each station's position along this
// ONE pattern's ways, in wayIds order then by arc-length t within a way — a
// branch pattern only lists stops on its own ways, not a shared trunk's
// (reconstructing "which trunk stops feed this branch" needs graph
// traversal through junctions, out of scope for this derived display).
function orderedStopsForPattern(stations: Station[], pattern: Pattern): Station[] {
  return stations
    .filter((st): st is Station & { anchor: NonNullable<Station["anchor"]> } => !!st.anchor && pattern.wayIds.includes(st.anchor.wayId))
    .slice()
    .sort((a, b) => {
      const wayDelta = pattern.wayIds.indexOf(a.anchor.wayId) - pattern.wayIds.indexOf(b.anchor.wayId);
      return wayDelta !== 0 ? wayDelta : a.anchor.t - b.anchor.t;
    });
}

interface ServiceInspectorProps {
  id: string;
}

function ServiceInspector({ id }: ServiceInspectorProps) {
  const service = useEditor((s) => s.system.services.find((sv) => sv.id === id));
  // Narrow selectors, not the whole `system` — that object is a fresh
  // reference on EVERY store mutation (any drag frame, any unrelated edit
  // elsewhere, a GTFS batch merging in), so selecting it wholesale re-rendered
  // this panel on every single one of those instead of only when something it
  // actually reads (ways/services/palette) changed. Confirmed live: with a
  // service selected, dragging an unrelated way re-rendered this at drag-
  // frame rate.
  const ways = useEditor((s) => s.system.ways);
  const services = useEditor((s) => s.system.services);
  const stations = useEditor((s) => s.system.stations);
  const palette = useEditor((s) => s.system.palette);
  const readOnly = useEditor((s) => s.readOnly);
  const setServiceName = useEditor((s) => s.setServiceName);
  const setServiceMode = useEditor((s) => s.setServiceMode);
  const setServiceColor = useEditor((s) => s.setServiceColor);
  const setServiceFrequency = useEditor((s) => s.setServiceFrequency);
  const setServiceSpan = useEditor((s) => s.setServiceSpan);
  const setServiceSchedule = useEditor((s) => s.setServiceSchedule);
  const setWayGeometry = useEditor((s) => s.setWayGeometry);
  const setWayGrade = useEditor((s) => s.setWayGrade);
  const deleteService = useEditor((s) => s.deleteService);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const addingPatternForServiceId = useEditor((s) => s.addingPatternForServiceId);
  const startAddingPattern = useEditor((s) => s.startAddingPattern);
  const cancelAddingPattern = useEditor((s) => s.cancelAddingPattern);
  const deletePattern = useEditor((s) => s.deletePattern);
  const mergeServiceInto = useEditor((s) => s.mergeServiceInto);
  const adoptExistingInfrastructure = useEditor((s) => s.adoptExistingInfrastructure);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [tab, setTab] = useState<string>("line");
  // Derived once at mount (this component remounts on service switch — see
  // its key={id} call site) from whether the CURRENT value already matches
  // a preset chip: an imported/hand-set value that doesn't hit one still
  // needs to be visible and editable, not silently unrepresented by any chip.
  const [freqCustomOpen, setFreqCustomOpen] = useState(
    () => service?.frequencyMinutes !== undefined && !FREQUENCY_PRESETS.includes(service.frequencyMinutes),
  );
  const [spanCustomOpen, setSpanCustomOpen] = useState(
    () =>
      (service?.spanStart !== undefined || service?.spanEnd !== undefined) &&
      !SPAN_PRESETS.some((p) => p.start === service?.spanStart && p.end === service?.spanEnd),
  );

  if (!service) return <EmptyInspector />;
  const singlePattern = service.patterns.length === 1 ? service.patterns[0] : null;
  const singleWay = singlePattern?.wayIds.length === 1 ? ways.find((w) => w.id === singlePattern.wayIds[0]) : undefined;
  const length = service.patterns.reduce((sum, p) => sum + lengthOfWays(ways, p.wayIds), 0);
  const patternStops = service.patterns.map((p) => ({ pattern: p, stops: orderedStopsForPattern(stations, p) }));
  const totalStops = new Set(patternStops.flatMap(({ stops }) => stops.map((st) => st.id))).size;
  const isAddingBranch = addingPatternForServiceId === id;
  const hasFullSchedule = !!service.schedule && service.schedule.length > 0;
  // A mode may span several way types (e.g. tram: dedicated track or street-running
  // road) — offer every mode compatible with the way this service currently rides.
  const modeOptions = singleWay ? modesForWayType(singleWay.typeId) : MODE_ORDER.map((m) => MODES[m]);

  const tabs: InspectorTab[] = [
    { id: "line", label: "Line" },
    { id: "schedule", label: "Schedule" },
    { id: "route", label: "Route" },
  ];

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot" style={{ background: service.color }} />
        <input className="insp-name" aria-label="Service name" value={service.name} disabled={readOnly} onChange={(e) => setServiceName(id, e.target.value)} onKeyDown={blurOnEnter} />
      </div>
      <div className="insp-kind">
        {(MODES[service.modeId]?.label ?? "Service")} · {formatKm(length)} · {totalStops} stop{totalStops === 1 ? "" : "s"}
      </div>

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "line" && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label">Mode</label>
          <div className="chip-row" role="group" aria-label="Mode">
            {modeOptions.map((m) => (
              <button key={m.id} className={`chip ${service.modeId === m.id ? "active" : ""}`} aria-pressed={service.modeId === m.id} disabled={readOnly} onClick={() => setServiceMode(id, m.id)}>
                {m.label}
              </button>
            ))}
          </div>

          <div className="insp-field">
            <ColorField value={service.color} palette={palette} disabled={readOnly} onChange={(c) => setServiceColor(id, c)} onAddToPalette={addPaletteColor} />
          </div>

          <div className="stats">
            <Stat label="Length" value={formatKm(length)} />
            <Stat label="Stops" value={String(totalStops)} />
          </div>

          {singleWay && <ServicesOnWay wayId={singleWay.id} activeServiceId={id} readOnly={readOnly} />}
        </div>
      )}

      {tab === "schedule" && (
        <div className="insp-section" role="tabpanel">
          {renderScheduleSection()}
        </div>
      )}

      {tab === "route" && (
        <div className="insp-section" role="tabpanel">
          {renderRouteSection()}
        </div>
      )}

      {scheduleOpen && (
        <ScheduleDialog
          serviceName={service.name}
          schedule={service.schedule}
          frequencyMinutes={service.frequencyMinutes}
          spanStart={service.spanStart}
          spanEnd={service.spanEnd}
          readOnly={readOnly}
          onSave={(periods) => setServiceSchedule(id, periods)}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteService(id)}>
            <Icon name="trash" size={18} /> Delete service
          </button>
        </div>
      )}
    </Panel>
  );

  function renderScheduleSection() {
    if (!service) return null;
    return hasFullSchedule ? (
        <>
          <label className="field-label">Schedule</label>
          <ul className="pattern-list">
            {service.schedule!.map((p) => (
              <li key={p.id} className="pattern-row">
                <button type="button" className="pattern-open" onClick={() => setScheduleOpen(true)}>
                  <span className="dot ring" />
                  <span className="pattern-name">{p.label}</span>
                  <span className="pattern-meta">
                    {DAY_SCOPE_LABEL[p.days]} · every {p.frequencyMinutes} min · {formatSpan(p.spanStart, p.spanEnd)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 12 }} onClick={() => setScheduleOpen(true)}>
            <Icon name="clock" size={17} /> {readOnly ? "View full schedule" : "Edit full schedule"}
          </button>
        </>
      ) : (
        <>
          <label className="field-label" id="freq-chips-label">Peak headway</label>
          <div className="chip-row" role="group" aria-labelledby="freq-chips-label">
            {FREQUENCY_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${!freqCustomOpen && service.frequencyMinutes === m ? "active" : ""}`}
                aria-pressed={!freqCustomOpen && service.frequencyMinutes === m}
                disabled={readOnly}
                onClick={() => {
                  setFreqCustomOpen(false);
                  setServiceFrequency(id, m);
                }}
              >
                {m} min
              </button>
            ))}
            <button type="button" className={`chip ${freqCustomOpen ? "active" : ""}`} aria-pressed={freqCustomOpen} disabled={readOnly} onClick={() => setFreqCustomOpen(true)}>
              Custom
            </button>
          </div>
          {freqCustomOpen && (
            <div className="freq-row">
              <input
                type="number"
                min={1}
                className="freq-input"
                aria-label="Custom peak headway in minutes"
                value={service.frequencyMinutes ?? ""}
                disabled={readOnly}
                placeholder="Not set"
                onChange={(e) => setServiceFrequency(id, e.target.value === "" ? undefined : Math.max(1, Math.round(Number(e.target.value))))}
                onKeyDown={blurOnEnter}
              />
              <span className="freq-suffix">min between vehicles, peak</span>
            </div>
          )}

          <label className="field-label" id="span-chips-label">Span of service</label>
          <div className="chip-row" role="group" aria-labelledby="span-chips-label">
            {SPAN_PRESETS.map((p) => {
              const active = !spanCustomOpen && service.spanStart === p.start && service.spanEnd === p.end;
              return (
                <button
                  key={p.label}
                  type="button"
                  className={`chip ${active ? "active" : ""}`}
                  aria-pressed={active}
                  disabled={readOnly}
                  onClick={() => {
                    setSpanCustomOpen(false);
                    setServiceSpan(id, p.start, p.end);
                  }}
                >
                  {p.label}
                </button>
              );
            })}
            <button type="button" className={`chip ${spanCustomOpen ? "active" : ""}`} aria-pressed={spanCustomOpen} disabled={readOnly} onClick={() => setSpanCustomOpen(true)}>
              Custom
            </button>
          </div>
          {spanCustomOpen && (
            <div className="freq-row">
              <input
                type="time"
                className="freq-input freq-time"
                aria-label="First departure"
                value={service.spanStart ?? ""}
                disabled={readOnly}
                onChange={(e) => setServiceSpan(id, e.target.value || undefined, service.spanEnd)}
              />
              <span className="freq-suffix">to</span>
              <input
                type="time"
                className="freq-input freq-time"
                aria-label="Last departure"
                value={service.spanEnd ?? ""}
                disabled={readOnly}
                onChange={(e) => setServiceSpan(id, service.spanStart, e.target.value || undefined)}
              />
            </div>
          )}

          {!readOnly && (
            <button type="button" className="link-btn" style={{ display: "block", marginBottom: 12 }} onClick={() => setScheduleOpen(true)}>
              Use a full schedule instead
            </button>
          )}
        </>
      );
  }

  function renderRouteSection() {
    if (!service) return null;
    const mergeTargets = services.filter((sv) => sv.id !== id && sv.modeId === service.modeId);
    return (
      <>
      {!readOnly && (
        <>
          <button
            type="button"
            className="ghost-btn"
            style={{ width: "100%", justifyContent: "center", marginBottom: 4 }}
            title="Re-route this line onto already-built ways near its sketch (streets, track) and remove the redundant sketch geometry"
            onClick={() => {
              const n = adoptExistingInfrastructure(id);
              if (n === 0) window.alert("No adoptable infrastructure found near this line's endpoints — build or import the ways it should ride first.");
            }}
          >
            Adopt existing infrastructure
          </button>
          <p className="insp-sub" style={{ marginBottom: 12 }}>
            Re-binds each pattern onto nearby built ways, following the sketched corridor; stations move with it.
          </p>
        </>
      )}
      {singleWay && (
        <>
          <label className="field-label">Way shape</label>
          {!readOnly && <p className="insp-sub">Drag a handle (or an end) to reshape · click the line to add a point · Ctrl-drag an end to extend it · Alt-drag to erase a section · Ctrl-click a point to split the way there</p>}
          <div className="chip-row" role="group" aria-label="Way shape">
            {GEOMETRY_OPTIONS.map(([g, label]) => (
              <button
                key={g}
                className={`chip ${singleWay.geometry === g ? "active" : ""}`}
                aria-pressed={singleWay.geometry === g}
                disabled={readOnly || (g === "freeform" && singleWay.geometry !== "freeform")}
                onClick={() => setWayGeometry(singleWay.id, g)}
              >
                {label}
              </button>
            ))}
          </div>
          <GradeChips value={singleWay.grade} disabled={readOnly} onChange={(g) => setWayGrade(singleWay.id, g)} />
        </>
      )}

      <label className="field-label">Patterns</label>
      {!readOnly && <p className="insp-sub">Each pattern is one path this service runs — add a branch to model a line that splits.</p>}
      <ul className="pattern-list">
        {service.patterns.map((p, i) => {
          const pWay = ways.find((w) => w.id === p.wayIds[0]);
          return (
            <li key={p.id} className="pattern-row">
              <button type="button" className="pattern-open" disabled={!pWay} onClick={() => pWay && selectAndFocus({ kind: "way", id: pWay.id })}>
                <span className="dot ring" />
                <span className="pattern-name">{p.name || (i === 0 ? "Main" : `Branch ${i}`)}</span>
                <span className="pattern-meta">{formatKm(lengthOfWays(ways, p.wayIds))} · {p.wayIds.length} way{p.wayIds.length === 1 ? "" : "s"}</span>
              </button>
              {!readOnly && service.patterns.length > 1 && (
                <IconButton icon="trash" size={15} label="Delete this pattern" onClick={() => deletePattern(id, p.id)} />
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <>
          {isAddingBranch ? (
            <>
              <p className="insp-sub">Draw the branch's path on the map — it joins this line once you finish.</p>
              <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 12 }} onClick={cancelAddingPattern}>
                Cancel adding branch
              </button>
            </>
          ) : (
            <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 12 }} onClick={() => startAddingPattern(id)}>
              <Icon name="plus" size={17} /> Add branch
            </button>
          )}
          {mergeTargets.length > 0 && (
            <>
              <label className="field-label" htmlFor="merge-into-select">
                Merge into another line
              </label>
              <p className="insp-sub">Combines this line's patterns into another line of the same mode as its own branch(es), then removes this line.</p>
              <select
                id="merge-into-select"
                className="opt-select"
                style={{ width: "100%", marginBottom: 12 }}
                defaultValue=""
                onChange={(e) => {
                  const targetId = e.target.value;
                  if (targetId) {
                    mergeServiceInto(id, targetId);
                    e.target.value = "";
                  }
                }}
              >
                <option value="" disabled>
                  Choose a line to merge into…
                </option>
                {mergeTargets.map((sv) => (
                  <option key={sv.id} value={sv.id}>
                    {sv.name || "Unnamed line"}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}

      {patternStops.map(({ pattern, stops }, i) =>
        stops.length > 0 ? (
          <div key={pattern.id}>
            <label className="field-label">
              Stop sequence{service.patterns.length > 1 ? ` — ${pattern.name || (i === 0 ? "Main" : `Branch ${i}`)}` : ""}
            </label>
            <ol className="stop-list">
              {stops.map((st, j) => (
                <li key={st.id}>
                  <button type="button" className="stop-item" onClick={() => selectAndFocus({ kind: "station", id: st.id })}>
                    <span className="stop-index">{j + 1}</span>
                    <span className="stop-name">{st.name || "Unnamed station"}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null,
      )}

      </>
    );
  }
}

interface WayInspectorProps {
  id: string;
}

// Task-based, context-dependent: the panel shows ONE concern at a time,
// chosen by an MD3 segmented tab row, and which tasks exist depends on the
// current view — Lanes (the physical cross-section) only exists in the
// Infrastructure view, where lane geometry actually renders; Network view
// gets Identity/Alignment only. The old everything-stacked form (and its
// capacity stepper, which the lane strip made redundant) is gone.
function WayInspector({ id }: WayInspectorProps) {
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

interface ServicesOnWayProps {
  wayId: string;
  activeServiceId?: string;
  readOnly: boolean;
}

function ServicesOnWay({ wayId, activeServiceId, readOnly }: ServicesOnWayProps) {
  const allServices = useEditor((s) => s.system.services);
  const way = useEditor((s) => s.system.ways.find((w) => w.id === wayId));
  const services = allServices.filter((sv) => serviceWayIds(sv).includes(wayId));
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const addServiceToWay = useEditor((s) => s.addServiceToWay);

  // A way type with no compatible modes (e.g. bike) carries no service.
  const canAddService = way ? modesForWayType(way.typeId).length > 0 : false;
  if (services.length === 0 && !canAddService) return null;

  return (
    <>
      <label className="field-label">Services on this way</label>
      <div className="svc-list">
        {services.length === 0 && <span className="panel-hint">None yet</span>}
        {services.map((sv) => (
          <button
            key={sv.id}
            className={`svc-chip ${sv.id === activeServiceId ? "active" : ""}`}
            onClick={() => selectAndFocus({ kind: "service", id: sv.id })}
          >
            <span className="dot sm" style={{ background: sv.color }} /> {sv.name}
          </button>
        ))}
      </div>
      {!readOnly && canAddService && (
        <button className="add-btn" onClick={() => addServiceToWay(wayId)}>
          <Icon name="plus" size={17} /> Add a service here
        </button>
      )}
    </>
  );
}

interface StationInspectorProps {
  id: string;
}

// Task-based like the way/service inspectors: Stop (what serves it),
// Physical (footprint/platforms — Infrastructure-view detail), Complex
// (transfer grouping). One concern at a time.
function StationInspector({ id }: StationInspectorProps) {
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

interface FacilityInspectorProps {
  id: string;
}

function FacilityInspector({ id }: FacilityInspectorProps) {
  const facility = useEditor((s) => s.system.facilities.find((f) => f.id === id));
  const complex = useEditor((s) => s.system.groups.find((g) => g.memberIds.includes(id)));
  const readOnly = useEditor((s) => s.readOnly);
  const setFacilityName = useEditor((s) => s.setFacilityName);
  const deleteFacility = useEditor((s) => s.deleteFacility);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);

  if (!facility) return <EmptyInspector />;
  const type = facilityType(facility.typeId);

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot ring" />
        <input
          className="insp-name"
          aria-label="Facility name"
          placeholder={type.label}
          value={facility.name ?? ""}
          disabled={readOnly}
          onChange={(e) => setFacilityName(id, e.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">Facility · {type.label.toLowerCase()}</div>
      <p className="insp-sub">Drag to reposition — visible in the Infrastructure view</p>

      {complex && (
        <>
          <label className="field-label">Part of</label>
          <div className="svc-list">
            <button className="svc-chip" onClick={() => selectAndFocus({ kind: "group", id: complex.id })}>
              {complex.name || "Facility complex"}
            </button>
          </div>
        </>
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteFacility(id)}>
            <Icon name="trash" size={18} /> Delete facility
          </button>
        </div>
      )}
    </Panel>
  );
}

// A group member can be a station, a facility, or (transfer complexes formed
// from LinesPanel) a service — resolve both its display name AND its real
// selection kind, so clicking a row selects the right kind of thing instead
// of always assuming "station".
interface MemberLookup {
  stations: Station[];
  facilities: TransitSystem["facilities"];
  services: TransitSystem["services"];
}

function memberInfo({ stations, facilities, services }: MemberLookup, memberId: string): { selection: Selection; label: string } | null {
  const station = stations.find((s) => s.id === memberId);
  if (station) return { selection: { kind: "station", id: memberId }, label: station.name || "Unnamed station" };
  const facility = facilities.find((f) => f.id === memberId);
  if (facility) return { selection: { kind: "facility", id: memberId }, label: facility.name || facilityType(facility.typeId).label };
  const service = services.find((sv) => sv.id === memberId);
  if (service) return { selection: { kind: "service", id: memberId }, label: service.name };
  return null;
}

interface GroupInspectorProps {
  id: string;
}

// Task-based: Members (what's bundled + adding more) vs Site (the physical
// boundary and its color). Same shell as every other inspector.
function GroupInspector({ id }: GroupInspectorProps) {
  const group = useEditor((s) => s.system.groups.find((g) => g.id === id));
  // Narrow selectors, not the whole `system` — see ServiceInspector's note.
  const stations = useEditor((s) => s.system.stations);
  const facilities = useEditor((s) => s.system.facilities);
  const services = useEditor((s) => s.system.services);
  const palette = useEditor((s) => s.system.palette);
  const readOnly = useEditor((s) => s.readOnly);
  const renameGroup = useEditor((s) => s.renameGroup);
  const setGroupColor = useEditor((s) => s.setGroupColor);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);
  const removeGroupMember = useEditor((s) => s.removeGroupMember);
  const deleteGroup = useEditor((s) => s.deleteGroup);
  const selectAndFocus = useEditor((s) => s.selectAndFocus);
  const [tab, setTab] = useState<string>("members");

  if (!group) return <EmptyInspector />;
  const isComplex = !!group.footprint;

  const tabs: InspectorTab[] = [
    { id: "members", label: "Members" },
    { id: "site", label: "Site" },
  ];

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        {group.color ? <span className="dot" style={{ background: group.color }} /> : <span className="dot ring" />}
        <input
          className="insp-name"
          aria-label="Group name"
          placeholder={isComplex ? "Facility complex" : "Complex"}
          value={group.name ?? ""}
          disabled={readOnly}
          onChange={(e) => renameGroup(id, e.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">{isComplex ? "Facility complex · a real physical site" : "Group · bundles objects into one unit"}</div>

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "members" && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label">Members</label>
          <div className="svc-list">
            {group.memberIds.length === 0 && <span className="panel-hint">No members yet</span>}
            {group.memberIds.map((mid) => {
              const info = memberInfo({ stations, facilities, services }, mid);
              return (
                <div key={mid} className="svc-chip chip-removable">
                  {info ? (
                    <button className="chip-removable-label" onClick={() => selectAndFocus(info.selection)}>{info.label}</button>
                  ) : (
                    <span className="chip-removable-label">Unknown</span>
                  )}
                  {!readOnly && (
                    <button className="chip-remove-btn" aria-label="Remove member" onClick={() => removeGroupMember(id, mid)}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <GroupPlacement groupId={id} readOnly={readOnly} />
        </div>
      )}

      {tab === "site" && (
        <div className="insp-section" role="tabpanel">
          {isComplex && group.color && (
            <div className="insp-field">
              <ColorField value={group.color} palette={palette} disabled={readOnly} onChange={(c) => setGroupColor(id, c)} onAddToPalette={addPaletteColor} />
            </div>
          )}
          <GroupFootprint groupId={id} readOnly={readOnly} />
        </div>
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteGroup(id)}>
            <Icon name="trash" size={18} /> Delete {isComplex ? "complex" : "group"}
          </button>
        </div>
      )}
    </Panel>
  );
}

// A facility complex's physical site — same draw/reshape pattern as a
// station's footprint (see StationFootprint above), just owned by the Group.
interface GroupFootprintProps {
  groupId: string;
  readOnly: boolean;
}

function GroupFootprint({ groupId, readOnly }: GroupFootprintProps) {
  const group = useEditor((s) => s.system.groups.find((g) => g.id === groupId));
  const addGroupFootprint = useEditor((s) => s.addGroupFootprint);
  const deleteGroupFootprint = useEditor((s) => s.deleteGroupFootprint);
  const { setViewMode } = useView();
  if (!group) return null;

  // Same reasoning as StationFootprint's drawFootprint — a group footprint
  // only ever renders in the Infrastructure view.
  const drawBoundary = () => {
    addGroupFootprint(groupId);
    setViewMode("infrastructure");
  };

  return (
    <>
      <label className="field-label">Site boundary</label>
      {!group.footprint ? (
        <>
          <p className="insp-sub">
            Draw a boundary to turn this into a facility complex — visible &amp; editable in the Infrastructure view
          </p>
          {!readOnly && (
            <button className="add-btn" onClick={drawBoundary}>
              <Icon name="plus" size={17} /> Draw boundary
            </button>
          )}
        </>
      ) : (
        <>
          {!readOnly && <p className="insp-sub">Drag a corner in the Infrastructure view to reshape · Alt-click to erase one</p>}
          <div className="stats">
            <Stat label="Corners" value={String(group.footprint.length)} />
          </div>
          {!readOnly && (
            <button className="danger-btn" onClick={() => deleteGroupFootprint(groupId)}>
              <Icon name="trash" size={18} /> Remove boundary
            </button>
          )}
        </>
      )}
    </>
  );
}

// The turnkey way to build up a facility complex: place a new, catalog-typed
// facility straight into this group (arms the Facility tool for one click),
// or add something already on the map (arms Select to pick the next click).
interface GroupPlacementProps {
  groupId: string;
  readOnly: boolean;
}

function GroupPlacement({ groupId, readOnly }: GroupPlacementProps) {
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const setDraftFacilityType = useEditor((s) => s.setDraftFacilityType);
  const placingFor = useEditor((s) => s.placingFacilityForGroupId);
  const pickingFor = useEditor((s) => s.pickingMemberForGroupId);
  const startPlacingFacility = useEditor((s) => s.startPlacingFacility);
  const cancelPlacingFacility = useEditor((s) => s.cancelPlacingFacility);
  const startPickingMember = useEditor((s) => s.startPickingMember);
  const cancelPickingMember = useEditor((s) => s.cancelPickingMember);

  if (readOnly) return null;
  const placing = placingFor === groupId;
  const picking = pickingFor === groupId;

  return (
    <>
      <label className="field-label">Add to this complex</label>
      {placing ? (
        <div className="insp-row-actions">
          <span className="panel-hint">Click the map to place a {FACILITY_TYPES[draftFacilityTypeId].label.toLowerCase()}…</span>
          <button className="ghost-btn" onClick={cancelPlacingFacility}>Cancel</button>
        </div>
      ) : picking ? (
        <div className="insp-row-actions">
          <span className="panel-hint">Click a station or facility on the map to add it…</span>
          <button className="ghost-btn" onClick={cancelPickingMember}>Cancel</button>
        </div>
      ) : (
        <>
          <div className="insp-row-actions">
            <select className="opt-select" value={draftFacilityTypeId} onChange={(e) => setDraftFacilityType(e.target.value)}>
              {FACILITY_TYPE_ORDER.map((tid) => (
                <option key={tid} value={tid}>{FACILITY_TYPES[tid].label}</option>
              ))}
            </select>
            <button className="add-btn" onClick={() => startPlacingFacility(groupId)}>
              <Icon name="plus" size={17} /> Place inside
            </button>
          </div>
          <button className="add-btn" style={{ marginTop: 8 }} onClick={() => startPickingMember(groupId)}>
            <Icon name="cursor" size={16} /> Add existing…
          </button>
        </>
      )}
    </>
  );
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
