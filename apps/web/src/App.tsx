import { useEffect, useRef, useState } from "react";
import { MapCanvas } from "./map/MapCanvas";
import { getMap } from "./map/mapRef";
import { useEditor, useEditorStore } from "./editor/EditorProvider";
import { createEmptySystem } from "@transitmapper/core/model/serialize";
import { fetchShare } from "./share/api";
import { getActiveId, listLibrary, loadSystemById, migrateLegacySingleSlot, saveToLibrary, setActiveId } from "./storage/localStore";
import { ExportDialog } from "./ui/ExportDialog";
import { Icon } from "./ui/Icon";
import { ImportDialog } from "./ui/ImportDialog";
import { Inspector } from "./ui/Inspector";
import { LinesPanel } from "./ui/LinesPanel";
import { ShareDialog } from "./ui/ShareDialog";
import { ShortcutsDialog } from "./ui/ShortcutsDialog";
import { SystemsDialog } from "./ui/SystemsDialog";
import { Toolbar } from "./ui/Toolbar";
import { TopBarActions, TopBarBrand, ViewSwitch } from "./ui/TopBar";
import { useDelayedUnmount } from "./ui/useDelayedUnmount";
import { useUi } from "./ui/UiProvider";
import { useView } from "./ui/ViewProvider";
import { Workbench } from "./ui/Workbench";
import "./ui/app.css";

const SHARE_PREFIX = "/s/";

export function App() {
  const store = useEditorStore();
  const name = useEditor((s) => s.system.name);
  const { shortcutsOpen, closeShortcuts, uiHidden, toggleUi, activeDialog, closeDialog } = useUi();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bootstrap: shared link → read-only load; otherwise local autosave or fresh.
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith(SHARE_PREFIX)) {
      const id = path.slice(SHARE_PREFIX.length).replace(/\/$/, "");
      fetchShare(id)
        .then((system) => store.getState().setSystem(system, { readOnly: true }))
        .catch((e: Error) => setLoadError(e.message))
        .finally(() => setReady(true));
      return;
    }
    // Load whichever system was last open; migrate the old single-slot
    // autosave if this is the first run since the library existed; fall back
    // to any saved system if the active-id pointer is stale; otherwise start
    // a brand-new one (and only then default the tool to Way, matching the
    // very first run's old behavior).
    const activeId = getActiveId();
    let system = activeId ? loadSystemById(activeId) : null;
    if (!system) system = migrateLegacySingleSlot();
    if (!system) {
      const entries = listLibrary();
      if (entries.length > 0) system = loadSystemById(entries[0].id);
    }
    let isBrandNew = false;
    if (!system) {
      system = createEmptySystem();
      isBrandNew = true;
    }
    saveToLibrary(system);
    setActiveId(system.id);
    store.getState().setSystem(system, { readOnly: false });
    if (isBrandNew) store.getState().setTool("way");
    setReady(true);
  }, [store]);

  // Autosave the working copy into its own library entry (never a read-only
  // shared view). Switching to a different system's id updates the active
  // pointer immediately — no reason to debounce that, only the content save.
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.readOnly) return;
      if (s.system === prev.system) return;
      if (s.system.id !== prev.system.id) setActiveId(s.system.id);
      window.clearTimeout(saveTimer.current);
      const snapshot = s.system;
      saveTimer.current = window.setTimeout(() => saveToLibrary(snapshot), 400);
    });
  }, [store]);

  // Dev-only: expose the map for debugging (the store is exposed by EditorProvider).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __getMap?: unknown }).__getMap = getMap;
    }
  }, []);

  // Hiding the UI used to unmount the whole chrome instantly; now it stays
  // mounted (fading/rising out) for the CSS exit transition, and the restore
  // button only appears once that's actually finished — avoiding an instant
  // snap AND the two overlapping in the same top-left corner mid-transition.
  const { mounted: chromeMounted, closing: chromeClosing } = useDelayedUnmount(!uiHidden, 160);
  const selection = useEditor((s) => s.selection);
  const multiSelection = useEditor((s) => s.multiSelection);
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => s.readOnly);
  const { viewMode } = useView();
  // The right sidebar is the one dynamic surface for "what's relevant right
  // now" — a selected object's details, OR (when a drawing tool is armed)
  // that tool's own draft options, never a second bottom-bar popup for the
  // latter. Diagram/read-only both disable drawing tools outright (see
  // Toolbar's own `locked`), so an armed tool from before switching there
  // shouldn't still claim this slot.
  const hasSupplementalContent = selection !== null || multiSelection.length > 0 || (tool !== "select" && !readOnly && viewMode !== "diagram");

  const errorBanner = loadError && <div className="load-error">Couldn’t open shared system: {loadError}</div>;

  return (
    <div className="app">
      {ready && <MapCanvas />}
      {chromeMounted && (
        <div data-ui-state={chromeClosing ? "closed" : "open"} className="app-chrome">
          <Workbench
            loadError={errorBanner}
            brand={<TopBarBrand />}
            menuPanel={<LinesPanel />}
            supplementalPanel={<Inspector />}
            hasSupplementalContent={hasSupplementalContent}
            primaryToolbar={<TopBarActions />}
            viewSwitcher={<ViewSwitch />}
            modeToolbar={<Toolbar />}
          />
        </div>
      )}
      {!chromeMounted && uiHidden && (
        <button type="button" className="ui-restore" onClick={toggleUi} title="Show UI (\\)" aria-label={`Show UI — ${name}`}>
          <Icon name="sidebar" size={16} />
          <span className="ui-restore-name">{name}</span>
        </button>
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={closeShortcuts} />}
      {activeDialog === "import" && <ImportDialog onClose={closeDialog} />}
      {activeDialog === "export" && <ExportDialog onClose={closeDialog} />}
      {activeDialog === "share" && <ShareDialog onClose={closeDialog} />}
      {activeDialog === "systems" && <SystemsDialog onClose={closeDialog} />}
    </div>
  );
}
