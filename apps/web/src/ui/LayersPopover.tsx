import { MODE_ORDER, MODES, WAY_TYPE_ORDER, WAY_TYPES } from "@transitmapper/core/model/catalog";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";
import { useView } from "./ViewProvider";

/**
 * Per-mode / per-way-type visibility, generated straight from the catalogs —
 * a new catalog entry appears here automatically, no UI change required.
 */
export function LayersPopover() {
  const { visibleModes, visibleWayTypes, toggleMode, toggleWayType, showAllModes, showAllWayTypes } = useView();

  const anyHidden = visibleModes.size < MODE_ORDER.length || visibleWayTypes.size < WAY_TYPE_ORDER.length;

  return (
    <Popover trigger={<IconButton icon="layers" label="Layers" active={anyHidden} />}>
      <div className="lp-popover" role="group" aria-label="Layer visibility">
        <div className="lp-col">
          <div className="lp-col-head">
            <span className="panel-section-label" style={{ marginBottom: 0 }}>Services</span>
            <button type="button" className="lp-all" onClick={showAllModes}>All</button>
          </div>
          {MODE_ORDER.map((id) => (
            <label key={id} className="lp-row">
              <input type="checkbox" checked={visibleModes.has(id)} onChange={() => toggleMode(id)} />
              {MODES[id].label}
            </label>
          ))}
        </div>
        <div className="lp-col">
          <div className="lp-col-head">
            <span className="panel-section-label" style={{ marginBottom: 0 }}>Infrastructure</span>
            <button type="button" className="lp-all" onClick={showAllWayTypes}>All</button>
          </div>
          {WAY_TYPE_ORDER.map((id) => (
            <label key={id} className="lp-row">
              <input type="checkbox" checked={visibleWayTypes.has(id)} onChange={() => toggleWayType(id)} />
              {WAY_TYPES[id].label}
            </label>
          ))}
        </div>
      </div>
    </Popover>
  );
}
