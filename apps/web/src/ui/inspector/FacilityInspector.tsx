import { useEditor } from "../../editor/EditorProvider";
import { facilityType } from "@transitmapper/core/model/catalog";
import { Panel } from "../Panel";
import { blurOnEnter } from "../formUtils";
import { Icon } from "../Icon";
import { EmptyInspector } from "./shared";

export interface FacilityInspectorProps {
  id: string;
}

export function FacilityInspector({ id }: FacilityInspectorProps) {
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
