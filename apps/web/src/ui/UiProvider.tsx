import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type DialogName = "import" | "gtfs" | "export" | "share" | "systems";

/** A background import's live status — surfaced as a small non-blocking
 *  indicator (see ImportProgressPill) rather than a modal, so a long import
 *  (GTFS: dozens of routes streamed in over several seconds) never traps the
 *  user behind a dialog they can't interact past. */
export interface ImportProgress {
  label: string;
  done: number;
  total: number;
  state: "loading" | "done" | "error";
}

// Ephemeral UI state (dialogs, overlays), kept separate from the editor/domain
// store so view concerns don't leak into the model.
interface UiState {
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  /** Figma-style "hide all chrome" — the map keeps working underneath, just
   *  the floating panels/top bar/tool dock disappear for a clean view. */
  uiHidden: boolean;
  toggleUi: () => void;
  /** At most one app-level modal dialog open at a time — centralized here
   *  (rather than local state on whichever button happens to trigger it) so
   *  a trigger can live anywhere (the file menu is in the left panel; the
   *  quick-export menu is in the top bar) while App renders the dialog once. */
  activeDialog: DialogName | null;
  openDialog: (name: DialogName) => void;
  closeDialog: () => void;
}

const UiContext = createContext<UiState | null>(null);

// A background import's live status ticks once per GTFS batch — dozens of
// times per import — and lives in its OWN context, separate from UiState
// above. React re-renders every consumer of a Provider when its value
// identity changes, regardless of which field a consumer actually reads, so
// bundling this into the main UiContext used to re-render every always-
// mounted useUi() caller (top bar, file menu, export button, the map canvas)
// on every single tick even though none of them read it. Only
// ImportProgressPill and GtfsImportDialog need this.
interface ImportProgressState {
  importProgress: ImportProgress | null;
  setImportProgress: (p: ImportProgress | null) => void;
}

const ImportProgressContext = createContext<ImportProgressState | null>(null);

interface UiProviderProps {
  children: ReactNode;
}

export function UiProvider({ children }: UiProviderProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [activeDialog, setActiveDialog] = useState<DialogName | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const toggleUi = useCallback(() => setUiHidden((h) => !h), []);
  const openDialog = useCallback((name: DialogName) => setActiveDialog(name), []);
  const closeDialog = useCallback(() => setActiveDialog(null), []);
  const value = useMemo<UiState>(
    () => ({ shortcutsOpen, openShortcuts, closeShortcuts, uiHidden, toggleUi, activeDialog, openDialog, closeDialog }),
    [shortcutsOpen, openShortcuts, closeShortcuts, uiHidden, toggleUi, activeDialog, openDialog, closeDialog],
  );
  const importProgressValue = useMemo<ImportProgressState>(() => ({ importProgress, setImportProgress }), [importProgress]);
  return (
    <UiContext.Provider value={value}>
      <ImportProgressContext.Provider value={importProgressValue}>{children}</ImportProgressContext.Provider>
    </UiContext.Provider>
  );
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used within <UiProvider>");
  return ctx;
}

export function useImportProgress(): ImportProgressState {
  const ctx = useContext(ImportProgressContext);
  if (!ctx) throw new Error("useImportProgress must be used within <UiProvider>");
  return ctx;
}
