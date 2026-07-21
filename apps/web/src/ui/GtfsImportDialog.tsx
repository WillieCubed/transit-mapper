import { useEditor } from "../editor/EditorProvider";
import { streamRtcGtfsBatches } from "@transitmapper/core/model/gtfsImport";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { useImportProgress } from "./UiProvider";

interface GtfsImportDialogProps {
  onClose: () => void;
}

/** RTC Southern Nevada's real, current bus network — imported whole (no
 *  bbox/category picker like street import: it's one fixed feed) as a
 *  comparison baseline next to whatever's being proposed. Confirming here
 *  closes this dialog immediately and hands off to ImportProgressPill: a
 *  feed this size (dozens of routes, thousands of stops) streams in over
 *  several seconds, and nothing about that should trap the user behind a
 *  modal — see streamRtcGtfsBatches for why it's batched at all. */
export function GtfsImportDialog({ onClose }: GtfsImportDialogProps) {
  const importGtfs = useEditor((s) => s.importGtfs);
  const { setImportProgress } = useImportProgress();

  const run = () => {
    onClose();
    (async () => {
      try {
        let routesTotal = 0;
        for await (const { pieces, routesDone, routesTotal: total } of streamRtcGtfsBatches()) {
          importGtfs(pieces);
          routesTotal = total;
          setImportProgress({ label: "Importing RTC system", done: routesDone, total, state: "loading" });
        }
        setImportProgress({ label: `Imported RTC's ${routesTotal} routes`, done: routesTotal, total: routesTotal, state: "done" });
      } catch (e) {
        setImportProgress({ label: e instanceof Error ? e.message : "RTC import failed.", done: 0, total: 0, state: "error" });
      } finally {
        setTimeout(() => setImportProgress(null), 4000);
      }
    })();
  };

  return (
    <Modal
      title="Import RTC's real system"
      description="Pull RTC Southern Nevada's current published bus network in as a comparison baseline."
      onClose={onClose}
      footer={
        <button
          className="primary-btn"
          style={{ marginTop: 16, width: "100%", justifyContent: "center" }}
          onClick={run}
        >
          <Icon name="download" size={18} /> Import into this system
        </button>
      }
    >
      <p className="panel-hint">
        Pulls RTC Southern Nevada&rsquo;s published GTFS feed — every current bus route, its stops,
        and its alignment — in as real routes and stations. It streams in live on the map, a few
        routes at a time, so you can keep working while it comes in — watch for the progress pill
        above the tool dock.
      </p>
    </Modal>
  );
}
