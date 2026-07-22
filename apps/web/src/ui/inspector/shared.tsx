import { useEditor } from "../../editor/EditorProvider";
import { GRADE_ORDER, GRADES, modesForWayType, type Grade } from "@transitmapper/core/model/catalog";
import { serviceWayIds } from "@transitmapper/core/model/geo";
import type { LineGeometry } from "@transitmapper/core/model/system";
import { Icon } from "../Icon";
import { Panel } from "../Panel";

// Building blocks shared by 2+ of the per-selection-kind inspector files —
// each is used across ServiceInspector/WayInspector/StationInspector/
// FacilityInspector/GroupInspector in some combination, so none of them owns
// it more than the others.

export const GEOMETRY_OPTIONS: [LineGeometry, string][] = [
  ["straight", "Straight"],
  ["curved", "Curved"],
  ["freeform", "Freeform"],
];

export interface GradeChipsProps {
  value: Grade;
  disabled: boolean;
  onChange: (g: Grade) => void;
}

export function GradeChips({ value, disabled, onChange }: GradeChipsProps) {
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

export function EmptyInspector() {
  return (
    <Panel slot="right" aria-label="Selection details">
      <p className="panel-hint">Select a service, way, or station to edit it.</p>
    </Panel>
  );
}

export interface ServicesOnWayProps {
  wayId: string;
  activeServiceId?: string;
  readOnly: boolean;
}

export function ServicesOnWay({ wayId, activeServiceId, readOnly }: ServicesOnWayProps) {
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

export interface StatProps {
  label: string;
  value: string;
}

export function Stat({ label, value }: StatProps) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
