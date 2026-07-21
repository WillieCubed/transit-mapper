import { useState } from "react";
import { useEditor } from "../editor/EditorProvider";
import { getMap } from "../map/mapRef";
import { IMPORT_CATEGORY_LABELS, IMPORT_CATEGORY_ORDER, importOsmWays, type ImportCategory } from "@transitmapper/core/model/import";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

// Below this zoom the visible area is too large for a responsible Overpass
// query (slow, or likely to time out / return an unreasonable amount of data).
const MIN_IMPORT_ZOOM = 13;

interface ImportDialogProps {
  onClose: () => void;
}

export function ImportDialog({ onClose }: ImportDialogProps) {
  const importWays = useEditor((s) => s.importWays);
  const [categories, setCategories] = useState<Set<ImportCategory>>(() => new Set(["road", "bike"]));
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");

  const toggle = (c: ImportCategory) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const zoom = getMap()?.getZoom() ?? 0;
  const zoomedInEnough = zoom >= MIN_IMPORT_ZOOM;

  const run = async () => {
    const map = getMap();
    if (!map || categories.size === 0) return;
    setStatus("loading");
    setError("");
    try {
      const b = map.getBounds();
      const ways = await importOsmWays(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        [...categories],
      );
      importWays(ways);
      setCount(ways.length);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
      setStatus("error");
    }
  };

  return (
    <Modal
      title="Import real streets"
      description="Pull OpenStreetMap infrastructure within the current map view into ways you can build services over."
      onClose={onClose}
      footer={
        <button
          className="primary-btn"
          style={{ marginTop: 16, width: "100%", justifyContent: "center" }}
          disabled={!zoomedInEnough || categories.size === 0 || status === "loading"}
          onClick={run}
        >
          <Icon name="download" size={18} /> {status === "loading" ? "Importing…" : "Import into this system"}
        </button>
      }
    >
      <p className="panel-hint">
        Pulls OpenStreetMap infrastructure within the current map view into ways you can build
        services over — real streets, rail, and bike routes as a starting point.
      </p>

      <div className="chip-row" role="group" aria-label="Categories to import" style={{ marginTop: 8 }}>
        {IMPORT_CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            className={`chip ${categories.has(c) ? "active" : ""}`}
            aria-pressed={categories.has(c)}
            onClick={() => toggle(c)}
          >
            {IMPORT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {!zoomedInEnough && (
        <p className="error-text" style={{ marginTop: 8 }}>
          Zoom in closer to import — the current view is too large for a responsible query.
        </p>
      )}

      {status === "error" && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
      {status === "done" && (
        <p className="panel-hint" style={{ marginTop: 8 }}>
          Imported {count} way{count === 1 ? "" : "s"}. They start as bare infrastructure — draw a
          service over any of them from the Way inspector.
        </p>
      )}
    </Modal>
  );
}
