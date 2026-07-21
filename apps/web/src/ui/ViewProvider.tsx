import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { MODE_ORDER, WAY_TYPE_ORDER } from "@transitmapper/core/model/catalog";

// Level-of-detail state: Network (stylized, service-focused), Infrastructure
// (physical, catalog-styled), or Diagram (schematic, octolinear, read-only)
// — plus per-mode/per-way-type visibility, derived from the catalogs so a new
// catalog entry is visible by default with no code change here. Kept as its
// own React context (not the zustand domain store) because it's view/
// presentation state, not part of the transit system model.
export type ViewMode = "network" | "infrastructure" | "diagram";

interface ViewState {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  visibleModes: Set<string>;
  visibleWayTypes: Set<string>;
  toggleMode: (id: string) => void;
  toggleWayType: (id: string) => void;
  showAllModes: () => void;
  showAllWayTypes: () => void;
  /** Hand-placed reference points (the Strip, UNLV, …) — context, not part
   *  of the system, so its own toggle rather than a mode/way-type filter. */
  showLandmarks: boolean;
  toggleLandmarks: () => void;
}

const ViewContext = createContext<ViewState | null>(null);

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface ViewProviderProps {
  children: ReactNode;
}

export function ViewProvider({ children }: ViewProviderProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("network");
  const [visibleModes, setVisibleModes] = useState<Set<string>>(() => new Set(MODE_ORDER));
  const [visibleWayTypes, setVisibleWayTypes] = useState<Set<string>>(() => new Set(WAY_TYPE_ORDER));
  const [showLandmarks, setShowLandmarks] = useState(true);

  const value = useMemo<ViewState>(
    () => ({
      viewMode,
      setViewMode,
      visibleModes,
      visibleWayTypes,
      toggleMode: (id) => setVisibleModes((prev) => toggleInSet(prev, id)),
      toggleWayType: (id) => setVisibleWayTypes((prev) => toggleInSet(prev, id)),
      showAllModes: () => setVisibleModes(new Set(MODE_ORDER)),
      showAllWayTypes: () => setVisibleWayTypes(new Set(WAY_TYPE_ORDER)),
      showLandmarks,
      toggleLandmarks: () => setShowLandmarks((v) => !v),
    }),
    [viewMode, visibleModes, visibleWayTypes, showLandmarks],
  );
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error("useView must be used within <ViewProvider>");
  return ctx;
}
