import { useEditor } from "../editor/EditorProvider";
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  MODE_ORDER,
  MODES,
  WAY_FAMILIES,
  profilePresetsForWayType,
  wayType,
  wayTypesByFamily,
  type WayFamily,
} from "@transitmapper/core/model/catalog";
import { facilityRender } from "../style/catalogStyle";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "./DropdownMenu";
import { Icon } from "./Icon";
import { useView } from "./ViewProvider";

// One dock icon per way family; unknown families fall back to the plain line.
const FAMILY_TOOL_ICON: Record<WayFamily, string> = {
  guideway: "line",
  roadway: "road",
  path: "bike",
  aerial: "geoCurved",
  water: "geoFreeform",
};

// Sticky per-family variant: pressing the Track tool again gives you the
// same track standard you last drew, not always the catalog's first one.
const lastTypeByFamily: Partial<Record<WayFamily, string>> = {};

/**
 * The floating tool dock — Figma-style: every button is a MODE (what the
 * cursor does), and variants live behind each tool's chevron as a MENU
 * (pick and dismiss). The drawing tools are generated from the catalog's
 * way-type families, so "just draw a road" / "just draw a track" is one
 * click, and a new catalog family gets a tool with no UI code.
 *
 * Context-dependent by view: Infrastructure shows the physical tools
 * (Road, Track, Path, … + Station, Facility); Network shows the Line tool
 * (mode-first service drawing) + Station. Diagram is read-only.
 */
export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const readOnly = useEditor((s) => s.readOnly);
  const draftWayTypeId = useEditor((s) => s.draftWayTypeId);
  const setDraftWayType = useEditor((s) => s.setDraftWayType);
  const draftModeId = useEditor((s) => s.draftModeId);
  const setDraftMode = useEditor((s) => s.setDraftMode);
  const setDraftPreset = useEditor((s) => s.setDraftPreset);
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const setDraftFacilityType = useEditor((s) => s.setDraftFacilityType);
  const draftFacilityComplexMode = useEditor((s) => s.draftFacilityComplexMode);
  const setDraftFacilityComplexMode = useEditor((s) => s.setDraftFacilityComplexMode);
  const { viewMode } = useView();
  // Diagram is a schematic projection, not the real system — nothing drawn
  // on it can be dragged or clicked back into a real edit (see
  // map/interactions.ts's isDiagramMode gating), so drawing/editing tools are
  // disabled here too, same treatment as a read-only shared view.
  const locked = readOnly || viewMode === "diagram";
  const network = viewMode === "network";
  const activeFamily = tool === "way" ? wayType(draftWayTypeId).family : null;

  const activateFamily = (family: WayFamily, typeId?: string) => {
    const fallback = wayTypesByFamily().find((e) => e.family === family)?.typeIds[0];
    const resolved = typeId ?? lastTypeByFamily[family] ?? fallback;
    if (!resolved) return;
    lastTypeByFamily[family] = resolved;
    setDraftWayType(resolved);
    setTool("way");
  };

  return (
    <div className="toolbar-dock">
      <div className="tool-row">
        {/* Cluster 1: selection — neither a path nor a place. */}
        <div className="tool-cluster" role="toolbar" aria-label="Select">
          <ToolButton icon="cursor" label="Select" hotkey="V" active={tool === "select"} disabled={false} onClick={() => setTool("select")} />
        </div>

        {/* Cluster 2: PATHS — linear infrastructure (or lines in Network). */}
        <div className="tool-cluster" role="toolbar" aria-label="Draw paths">
        {network ? (
          // Network view: you draw LINES (services). One tool; its variants
          // are the modes.
          <ToolButton
            icon="line"
            label={MODES[draftModeId]?.label ?? "Line"}
            hotkey="L"
            active={tool === "way"}
            disabled={locked}
            onClick={() => setTool("way")}
            menu={[
              {
                entries: MODE_ORDER.map((id) => ({
                  id,
                  label: MODES[id].label,
                  checked: draftModeId === id,
                  onSelect: () => {
                    setDraftMode(id);
                    setTool("way");
                  },
                })),
              },
            ]}
          />
        ) : (
          // Infrastructure view: one drawing tool per way family — click
          // Road and you're drawing a road. The chevron menu picks the
          // variant (track standard, path kind, or a road cross-section).
          wayTypesByFamily().map(({ family, typeIds }) => {
            const info = WAY_FAMILIES[family];
            const isActive = tool === "way" && activeFamily === family;
            const presets = family === "roadway" ? profilePresetsForWayType(typeIds[0]) : [];
            const menu =
              typeIds.length > 1
                ? [
                    {
                      entries: typeIds.map((id) => ({
                        id,
                        label: wayType(id).label,
                        checked: draftWayTypeId === id,
                        onSelect: () => activateFamily(family, id),
                      })),
                    },
                  ]
                : presets.length > 0
                  ? [
                      {
                        label: "Cross-section",
                        entries: [
                          {
                            id: "",
                            label: "Default",
                            checked: false,
                            onSelect: () => {
                              activateFamily(family, typeIds[0]);
                              setDraftPreset(null);
                            },
                          },
                          ...presets.map((p) => ({
                            id: p.id,
                            label: p.label,
                            checked: false,
                            onSelect: () => {
                              activateFamily(family, typeIds[0]);
                              setDraftPreset(p.id);
                            },
                          })),
                        ],
                      },
                    ]
                  : undefined;
            return (
              <ToolButton
                key={family}
                icon={FAMILY_TOOL_ICON[family] ?? "line"}
                label={info.toolLabel}
                active={isActive}
                disabled={locked}
                onClick={() => activateFamily(family)}
                menu={menu}
              />
            );
          })
        )}
        </div>

        {/* Cluster 3: PLACES — region/building-like things with real
            footprints (stations, facilities), a different mental verb from
            drawing paths. In Infrastructure view the Station tool draws the
            station's LAND (a click-points or drag-rectangle boundary, same
            grammar as a facility complex — see interactions.ts's
            startStationLandDraw), not a schematic pin, so it wears the same
            "boundary" glyph as Facility's site-boundary mode; Network view
            keeps the plain stop icon, since there the tool really is a
            quick click-to-place stop. The invisible spacer balances the
            cluster's card when Facility's menu caret is present (Infra view
            only) — same width as .tool-btn-caret's own footprint — so the
            pair reads as centered rather than lopsided toward the caret. */}
        <div className="tool-cluster" role="toolbar" aria-label="Places">
        {!network && <span className="tool-caret-spacer" aria-hidden="true" />}
        <ToolButton icon={network ? "station" : "boundary"} label="Station" hotkey="S" active={tool === "station"} disabled={locked} onClick={() => setTool("station")} />
        {!network && (
          // The Facility tool wears its current variant and places it on
          // click; "Complex" (draw a site boundary to build inside) is one
          // more variant, never a hidden default.
          <ToolButton
            icon={draftFacilityComplexMode ? "boundary" : (facilityRender(draftFacilityTypeId).icon ?? "plus")}
            label="Facility"
            hotkey="F"
            active={tool === "facility"}
            disabled={locked}
            onClick={() => setTool("facility")}
            menu={[
              {
                label: "Access points (placed)",
                entries: FACILITY_TYPE_ORDER.filter((id) => FACILITY_TYPES[id].geometryKind === "point").map((id) => ({
                  id,
                  label: FACILITY_TYPES[id].label,
                  checked: !draftFacilityComplexMode && draftFacilityTypeId === id,
                  onSelect: () => {
                    setDraftFacilityType(id);
                    setTool("facility");
                  },
                })),
              },
              {
                label: "Structures (drawn to shape)",
                entries: FACILITY_TYPE_ORDER.filter((id) => FACILITY_TYPES[id].geometryKind === "area").map((id) => ({
                  id,
                  label: FACILITY_TYPES[id].label,
                  checked: !draftFacilityComplexMode && draftFacilityTypeId === id,
                  onSelect: () => {
                    setDraftFacilityType(id);
                    setTool("facility");
                  },
                })),
              },
              {
                label: "Land",
                entries: [
                  {
                    id: "complex",
                    label: "Site boundary (a complex\u2019s land)",
                    checked: draftFacilityComplexMode,
                    onSelect: () => {
                      setDraftFacilityComplexMode(true);
                      setTool("facility");
                    },
                  },
                ],
              },
            ]}
          />
        )}
        </div>
      </div>
    </div>
  );
}

interface ToolMenuEntry {
  id: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}

/** Variant menus can be sectioned when their entries are different KINDS of
 *  thing (the Facility tool's markers vs. footprints vs. site complex) — a
 *  labeled group per kind, not one undifferentiated list. */
interface ToolMenuSection {
  label?: string;
  entries: ToolMenuEntry[];
}

interface ToolButtonProps {
  icon: string;
  label: string;
  hotkey?: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  /** Variant menu behind the chevron — a MENU (pick, dismiss), never a mode. */
  menu?: ToolMenuSection[];
}

function ToolButton({ icon, label, hotkey, active, disabled, onClick, menu }: ToolButtonProps) {
  // The button itself is always the same square (size-14 = 56×56, Tailwind's
  // own scale — no hand-tracked width/height pair to keep in sync in
  // app.css) whether or not it carries a menu; the caret is what's free to
  // add its own width when there's one to show (see .tool-btn-caret below).
  const hasMenu = !!menu && menu.length > 0;
  return (
    <div className={`tool-btn-group ${active ? "active" : ""}`}>
      <button
        className={`tool-btn size-14 ${active ? "active" : ""}`}
        disabled={disabled}
        aria-pressed={active}
        title={hotkey ? `${label} (${hotkey})` : label}
        onClick={onClick}
      >
        <Icon name={icon} size={20} />
        <span className="tool-btn-label">{label}</span>
      </button>
      {hasMenu && (
        <DropdownMenu
          align="center"
          trigger={
            <button className="tool-btn-caret" disabled={disabled} aria-label={`${label} options`} title={`${label} options`}>
              <Icon name="chevronDown" size={12} />
            </button>
          }
        >
          {menu.map((section, si) => (
            <div key={section.label ?? si}>
              {si > 0 && <DropdownMenuSeparator />}
              {section.label && <DropdownMenuLabel>{section.label}</DropdownMenuLabel>}
              {section.entries.map((entry) => (
                <DropdownMenuItem key={entry.id || "default"} onSelect={entry.onSelect}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {entry.checked ? <Icon name="check" size={14} /> : <span style={{ width: 14 }} />}
                    {entry.label}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}

