import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type DialogName = "import" | "export" | "share" | "systems";

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

interface UiProviderProps {
  children: ReactNode;
}

export function UiProvider({ children }: UiProviderProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [activeDialog, setActiveDialog] = useState<DialogName | null>(null);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const toggleUi = useCallback(() => setUiHidden((h) => !h), []);
  const openDialog = useCallback((name: DialogName) => setActiveDialog(name), []);
  const closeDialog = useCallback(() => setActiveDialog(null), []);
  const value = useMemo<UiState>(
    () => ({ shortcutsOpen, openShortcuts, closeShortcuts, uiHidden, toggleUi, activeDialog, openDialog, closeDialog }),
    [shortcutsOpen, openShortcuts, closeShortcuts, uiHidden, toggleUi, activeDialog, openDialog, closeDialog],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used within <UiProvider>");
  return ctx;
}
