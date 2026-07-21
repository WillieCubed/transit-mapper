import { useEditor } from "../editor/EditorProvider";
import { exportFullSystemPng } from "../share/pngExport";
import { exportFullSystemSvg } from "../share/svgExport";
import { DropdownMenu, DropdownMenuItem } from "./DropdownMenu";
import { Icon } from "./Icon";
import { useUi } from "./UiProvider";
import { useView } from "./ViewProvider";

/** MD3 split (compound) button: the main segment opens the full export
 *  dialog (format + view + layer-visibility settings); the trailing caret
 *  opens a quick menu for the common case — export the current view as-is,
 *  no dialog. */
export function ExportSplitButton() {
  const system = useEditor((s) => s.system);
  const { viewMode, visibleModes, visibleWayTypes } = useView();
  const { openDialog } = useUi();

  const quickExport = (format: "png" | "svg") => {
    const filename = `${system.name || "transit-system"}.${format}`;
    const view = { viewMode, visibleModes, visibleWayTypes };
    // Quick export still shows the whole system (fits bounds, titles, and
    // legends itself) rather than just whatever's currently on screen — see
    // share/pngExport.ts's exportFullSystemPng for why.
    if (format === "png") exportFullSystemPng(system, view, filename);
    else exportFullSystemSvg(system, view, filename);
  };

  return (
    <div className="split-btn-root">
      <div className="split-btn">
        <button type="button" className="split-btn-main" onClick={() => openDialog("export")} title="Export…">
          <Icon name="download" size={18} /> <span className="btn-label">Export</span>
        </button>
        <DropdownMenu
          trigger={
            <button type="button" className="split-btn-caret" title="Quick export" aria-label="Quick export options">
              <Icon name="chevronDown" size={15} />
            </button>
          }
        >
          <DropdownMenuItem onSelect={() => quickExport("png")}>Export PNG</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => quickExport("svg")}>Export SVG</DropdownMenuItem>
        </DropdownMenu>
      </div>
    </div>
  );
}
