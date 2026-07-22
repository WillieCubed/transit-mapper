import { lazy, Suspense, useState } from "react";
import { useEditor } from "../../editor/EditorProvider";
import { MODE_ORDER, MODES, modesForWayType } from "@transitmapper/core/model/catalog";
import { formatKm, wayLengthMeters } from "@transitmapper/core/model/geo";
import type { Pattern, ScheduleDayScope, Station, Way } from "@transitmapper/core/model/system";
import { ColorField } from "../ColorField";
import { InspectorTabs, type InspectorTab } from "../InspectorTabs";
import { Panel } from "../Panel";
import { blurOnEnter } from "../formUtils";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";
import { GEOMETRY_OPTIONS, GradeChips, EmptyInspector, ServicesOnWay, Stat } from "./shared";

// Opened only via the "Edit full schedule" link, never on initial render —
// same lazy-loading rationale as the app-level dialogs in App.tsx.
const ScheduleDialog = lazy(() => import("../ScheduleDialog").then((m) => ({ default: m.ScheduleDialog })));

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

export interface ServiceInspectorProps {
  id: string;
}

export function ServiceInspector({ id }: ServiceInspectorProps) {
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
        <Suspense fallback={null}>
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
        </Suspense>
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
