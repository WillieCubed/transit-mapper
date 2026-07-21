// Document-level driving-side setting (see model/system.ts's DrivingSide) —
// a regional/jurisdictional property, one value for the whole system, not
// a per-mode/per-way-type view filter, so it lives in its own small popover
// rather than folded into LayersPopover (which is pure view state).
import { useEditor } from "../editor/EditorProvider";
import type { DrivingSide } from "@transitmapper/core/model/system";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";

const DRIVING_SIDES: { value: DrivingSide; label: string }[] = [
  { value: "right", label: "Right (US default)" },
  { value: "left", label: "Left" },
];

export function DrivingSidePopover() {
  const drivingSide = useEditor((s) => s.system.drivingSide);
  const setDrivingSide = useEditor((s) => s.setDrivingSide);
  const readOnly = useEditor((s) => s.readOnly);

  return (
    <Popover trigger={<IconButton icon="road" label="Driving side" active={drivingSide === "left"} />}>
      <div className="lp-popover" role="group" aria-label="Driving side">
        <div className="lp-col">
          <div className="lp-col-head">
            <span className="panel-section-label" style={{ marginBottom: 0 }}>Driving side</span>
          </div>
          <p className="insp-sub">Which side of the road forward traffic keeps to — affects new carriageway separation and lane splits.</p>
          <div className="chip-row" role="group" aria-label="Driving side">
            {DRIVING_SIDES.map((d) => (
              <button
                key={d.value}
                className={`chip ${drivingSide === d.value ? "active" : ""}`}
                aria-pressed={drivingSide === d.value}
                disabled={readOnly}
                onClick={() => setDrivingSide(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Popover>
  );
}
