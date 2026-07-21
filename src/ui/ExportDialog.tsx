import { useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useEditor } from "../editor/EditorProvider";
import { MODE_ORDER, MODES, WAY_TYPE_ORDER, WAY_TYPES } from "../model/catalog";
import { legendEntriesFor } from "../share/exportLegend";
import { exportPngFromMap } from "../share/pngExport";
import { exportSvgFromMap } from "../share/svgExport";
import { ExportPreviewMap, resetFraming } from "./ExportPreviewMap";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import type { ViewMode } from "./ViewProvider";

type ExportFormat = "png" | "svg";

/**
 * Export dialog: a dedicated, pannable/zoomable preview (see
 * ExportPreviewMap) framed to the whole system by default — not whatever the
 * live map happens to be showing — plus an editable title and an
 * auto-generated line-color legend, so an export reads as a finished map
 * (MTA-wayfinding-map style) rather than a viewport screenshot. Fixed size:
 * nothing here changes the dialog's footprint, only its contents.
 */
interface ExportDialogProps {
  onClose: () => void;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const system = useEditor((s) => s.system);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [viewMode, setViewMode] = useState<ViewMode>("network");
  const [visibleModes, setVisibleModes] = useState<Set<string>>(new Set(MODE_ORDER));
  const [visibleWayTypes, setVisibleWayTypes] = useState<Set<string>>(new Set(WAY_TYPE_ORDER));
  const [title, setTitle] = useState(system.name || "Transit system");
  const [exporting, setExporting] = useState(false);
  const mapRef = useRef<MLMap | null>(null);

  const view = useMemo(() => ({ viewMode, visibleModes, visibleWayTypes }), [viewMode, visibleModes, visibleWayTypes]);
  const legend = useMemo(() => legendEntriesFor(system, view), [system, view]);

  const toggleMode = (id: string) =>
    setVisibleModes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleWayType = (id: string) =>
    setVisibleWayTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    const map = mapRef.current;
    if (!map) return;
    const filename = `${system.name || "transit-system"}.${format}`;
    setExporting(true);
    if (format === "svg") {
      exportSvgFromMap(system, view, map, { title, legend }, filename);
      setExporting(false);
      onClose();
      return;
    }
    exportPngFromMap(map, { title, legend }, filename);
    // exportPngFromMap waits for the next idle frame internally — close once
    // that's had a moment to fire, so the download always actually starts.
    window.setTimeout(() => {
      setExporting(false);
      onClose();
    }, 250);
  };

  return (
    <Modal
      title="Export"
      description="Export the system as a PNG or SVG map, framed and titled however you like."
      onClose={onClose}
      className="export-modal"
      footer={
        <button className="primary-btn export-run-btn" disabled={exporting} onClick={run}>
          <Icon name="download" size={18} /> {exporting ? "Exporting…" : `Export ${format.toUpperCase()}`}
        </button>
      }
    >
        <div className="export-body">
          <div className="export-controls">
            <div className="opt-field">
              <label className="field-label" htmlFor="export-title">Map title</label>
              <input
                id="export-title"
                className="opt-select"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Transit system"
              />
            </div>

            <label className="field-label">Format</label>
            <div className="segmented" role="group" aria-label="Format">
              <button className={`seg ${format === "png" ? "active" : ""}`} aria-pressed={format === "png"} onClick={() => setFormat("png")}>
                PNG
              </button>
              <button className={`seg ${format === "svg" ? "active" : ""}`} aria-pressed={format === "svg"} onClick={() => setFormat("svg")}>
                SVG
              </button>
            </div>

            <label className="field-label">View</label>
            <div className="segmented" role="group" aria-label="View">
              <button
                className={`seg ${viewMode === "network" ? "active" : ""}`}
                aria-pressed={viewMode === "network"}
                onClick={() => setViewMode("network")}
              >
                Network
              </button>
              <button
                className={`seg ${viewMode === "infrastructure" ? "active" : ""}`}
                aria-pressed={viewMode === "infrastructure"}
                onClick={() => setViewMode("infrastructure")}
              >
                Infrastructure
              </button>
            </div>

            <div className="export-layers">
              <div className="lp-col">
                <div className="lp-col-head">
                  <span className="panel-section-label" style={{ marginBottom: 0 }}>Services</span>
                  <button type="button" className="lp-all" onClick={() => setVisibleModes(new Set(MODE_ORDER))}>All</button>
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
                  <button type="button" className="lp-all" onClick={() => setVisibleWayTypes(new Set(WAY_TYPE_ORDER))}>All</button>
                </div>
                {WAY_TYPE_ORDER.map((id) => (
                  <label key={id} className="lp-row">
                    <input type="checkbox" checked={visibleWayTypes.has(id)} onChange={() => toggleWayType(id)} />
                    {WAY_TYPES[id].label}
                  </label>
                ))}
              </div>
            </div>

            {format === "svg" && (
              <p className="panel-hint">
                SVG is a scalable vector export of the schematic. Facilities render as plain colored markers rather
                than their on-map icons; PNG captures full visual fidelity.
              </p>
            )}
          </div>

          <div className="export-preview-col">
            <div className="export-preview-wrap">
              <ExportPreviewMap system={system} view={view} onReady={(map) => (mapRef.current = map)} />
              {title.trim() && <div className="export-preview-title">{title}</div>}
              {legend.length > 0 && (
                <div className="export-preview-legend">
                  {legend.map((e, i) => (
                    <span key={i} className="export-legend-row">
                      <span className="export-legend-swatch" style={{ background: e.color }} />
                      {e.label}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="export-reset-btn"
                onClick={() => mapRef.current && resetFraming(mapRef.current, system)}
              >
                <Icon name="layers" size={15} /> Reset framing
              </button>
            </div>
            <p className="panel-hint">Drag to pan, scroll to zoom — this frames exactly what gets exported.</p>
          </div>
        </div>
    </Modal>
  );
}
