import { useEffect } from "react";
import { useEditor } from "../editor/EditorProvider";
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  GRADE_ORDER,
  GRADES,
  MODE_ORDER,
  MODES,
  WAY_FAMILIES,
  mode,
  modesForWayType,
  profilePresetsForWayType,
  wayType,
  wayTypesByFamily,
  type WayFamily,
} from "../model/catalog";
import type { LineGeometry } from "../model/system";
import { facilityRender } from "../style/catalogStyle";
import { ColorField } from "./ColorField";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "./DropdownMenu";
import { Icon } from "./Icon";
import { useView } from "./ViewProvider";

const GEOMETRIES: { g: LineGeometry; label: string }[] = [
  { g: "straight", label: "Straight" },
  { g: "curved", label: "Curved" },
  { g: "freeform", label: "Freeform" },
];

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
      {tool === "way" && !locked && <WayOptions />}
      {tool === "station" && !locked && <StationOptions />}
      {tool === "facility" && !locked && <FacilityOptions />}

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
            drawing paths. */}
        <div className="tool-cluster" role="toolbar" aria-label="Places">
        <ToolButton icon="station" label="Station" hotkey="S" active={tool === "station"} disabled={locked} onClick={() => setTool("station")} />
        {!network && (
          // The Facility tool wears its current variant and places it on
          // click; "Complex" (draw a site boundary to build inside) is one
          // more variant, never a hidden default.
          <ToolButton
            icon={draftFacilityComplexMode ? "layers" : (facilityRender(draftFacilityTypeId).icon ?? "plus")}
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
  return (
    <div className={`tool-btn-group ${active ? "active" : ""}`}>
      <button
        className={`tool-btn ${active ? "active" : ""}`}
        disabled={disabled}
        aria-pressed={active}
        title={hotkey ? `${label} (${hotkey})` : label}
        onClick={onClick}
      >
        <Icon name={icon} size={18} />
        <span className="tool-btn-label">{label}</span>
      </button>
      {menu && menu.length > 0 && (
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

/**
 * Options for the Way tool.
 *
 * Network view is mode-first: you're drawing a LINE, so "Line type" (Bus,
 * Light rail, Subway, …) is the one real choice, and the physical way type
 * it rides on is inferred from the mode's own preferred carrier — the same
 * one-click experience rail always had (its way-type name happened to match
 * its mode name), now true for every mode, bus included. A mode compatible
 * with more than one way type (light rail/tram can run dedicated trackage OR
 * street-run on a road) gets a small secondary "Infrastructure" picker;
 * everything else is a single control.
 *
 * Infrastructure view stays way-type-first (rail, road, bike, aerial, water,
 * …) with the compatible Service as a follow-on choice — that view is
 * explicitly about the physical alignment, and it's the only place you can
 * draw bare infrastructure with no service riding it at all (a plain street,
 * an unused bike path).
 */
function WayOptions() {
  const draftWayTypeId = useEditor((s) => s.draftWayTypeId);
  const setDraftWayType = useEditor((s) => s.setDraftWayType);
  const draftModeId = useEditor((s) => s.draftModeId);
  const draftGeometry = useEditor((s) => s.draftGeometry);
  const setDraftGeometry = useEditor((s) => s.setDraftGeometry);
  const draftColor = useEditor((s) => s.draftColor);
  const setDraftColor = useEditor((s) => s.setDraftColor);
  const draftGrade = useEditor((s) => s.draftGrade);
  const setDraftGrade = useEditor((s) => s.setDraftGrade);
  const draftClassId = useEditor((s) => s.draftClassId);
  const setDraftClassId = useEditor((s) => s.setDraftClassId);
  const draftPresetId = useEditor((s) => s.draftPresetId);
  const setDraftPreset = useEditor((s) => s.setDraftPreset);
  const draftOneWay = useEditor((s) => s.draftOneWay);
  const setDraftOneWay = useEditor((s) => s.setDraftOneWay);
  const setDraftServiceEnabled = useEditor((s) => s.setDraftServiceEnabled);
  const palette = useEditor((s) => s.system.palette);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);
  const { viewMode } = useView();

  const type = wayType(draftWayTypeId);
  const compatibleModes = modesForWayType(draftWayTypeId);
  const networkFirst = viewMode === "network";

  // The whole separation of concerns, enforced: drawing in the
  // Infrastructure view NEVER creates a service; drawing in the Network view
  // (mode-first, "draw a line") always does. The store flag just mirrors
  // which view the Way tool is being used from.
  useEffect(() => {
    setDraftServiceEnabled(networkFirst);
  }, [networkFirst, setDraftServiceEnabled]);
  const currentMode = mode(draftModeId);

  // WHAT you're drawing is chosen in the dock (the Road/Track/Path tool
  // buttons and their variant flyouts, or the Line tool's mode flyout) —
  // this row only carries the active tool's contextual options.
  return (
    <div className="tool-options">
      {networkFirst && currentMode.wayTypeIds.length > 1 && (
        <div className="opt-field">
          <span className="control-label">Runs on</span>
          <select className="opt-select" value={draftWayTypeId} onChange={(e) => setDraftWayType(e.target.value)}>
            {currentMode.wayTypeIds.map((id) => (
              <option key={id} value={id}>{wayType(id).label}</option>
            ))}
          </select>
        </div>
      )}

      {!networkFirst && profilePresetsForWayType(draftWayTypeId).length > 0 && (
        <div className="opt-field">
          <span className="control-label">Cross-section</span>
          <select className="opt-select" value={draftPresetId ?? ""} onChange={(e) => setDraftPreset(e.target.value || null)}>
            <option value="">Default</option>
            {profilePresetsForWayType(draftWayTypeId).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Road classification is a physical-alignment fact, not a service
          one — the real question to ask while drawing the actual street in
          Infrastructure view, not while sketching where a bus line goes.
          Network view is mode-first, "the one real choice" (this
          component's own doc comment above) — a bus line's options row
          asking "Arterial or Local?" contradicted that outright. An armed
          preset already carries its own class the same way (below), so
          this follows the same "don't show a field whose answer is already
          decided elsewhere" rule. */}
      {type.classes.length > 0 && !draftPresetId && !networkFirst && (
        <div className="opt-field">
          <span className="control-label">Class</span>
          <select className="opt-select" value={draftClassId ?? ""} onChange={(e) => setDraftClassId(e.target.value)}>
            {type.classes.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="opt-field">
        <span className="control-label">Grade</span>
        <div className="segmented" role="group" aria-label="Grade">
          {GRADE_ORDER.map((g) => (
            <button key={g} className={`seg ${draftGrade === g ? "active" : ""}`} aria-pressed={draftGrade === g} onClick={() => setDraftGrade(g)}>
              {GRADES[g].label}
            </button>
          ))}
        </div>
      </div>

      <div className="opt-field">
        <span className="control-label">Shape</span>
        <div className="segmented" role="group" aria-label="Way shape">
          {GEOMETRIES.map((o) => (
            <button
              key={o.g}
              className={`seg ${draftGeometry === o.g ? "active" : ""}`}
              aria-pressed={draftGeometry === o.g}
              onClick={() => setDraftGeometry(o.g)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Same reasoning as Class above: one-way-ness is a fact about the
          physical street, decided when it's actually drawn in Infrastructure
          view — not a choice inherent to sketching a schematic line. */}
      {!networkFirst && (
        <div className="opt-field">
          <span className="control-label">Direction</span>
          <div className="segmented" role="group" aria-label="Direction" title="One-way runs the direction you draw (O toggles; D flips after). Tip: right-click an existing endpoint to branch a one-way segment off it.">
            <button className={`seg ${!draftOneWay ? "active" : ""}`} aria-pressed={!draftOneWay} onClick={() => setDraftOneWay(false)}>
              Two-way
            </button>
            <button className={`seg ${draftOneWay ? "active" : ""}`} aria-pressed={draftOneWay} onClick={() => setDraftOneWay(true)}>
              One-way
            </button>
          </div>
        </div>
      )}

      {networkFirst && compatibleModes.length > 0 && (
        <ColorField label="Color" value={draftColor} palette={palette} onChange={setDraftColor} onAddToPalette={addPaletteColor} />
      )}
    </div>
  );
}

/**
 * Options for the Facility tool. Two distinct clicks share it:
 *  - normal: click the map to start a new facility complex — a boundary
 *    drawn around the click, ready for bus bays/platforms/entrances placed
 *    inside it (see the Inspector once it's selected).
 *  - armed (via a complex's Inspector "Place inside"): the next click drops
 *    the chosen facility type straight into that complex instead.
 */
/** One honest sentence for the Station tool: drag DRAWS the station, click
 *  drops a quick stop. Network view is schematic, so stops only. */
function StationOptions() {
  const { viewMode } = useView();
  return (
    <div className="tool-options">
      {viewMode === "infrastructure" ? (
        <p className="panel-hint">Drag a rectangle — or click corner points, double-click to close — to define the station's land. Its border IS the station; draw structures (buildings, platforms, bus bays) on it.</p>
      ) : (
        <p className="panel-hint">Click to place a stop — it snaps onto the line under it. Draw full station footprints in the Infrastructure view.</p>
      )}
    </div>
  );
}

function FacilityOptions() {
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const complexMode = useEditor((s) => s.draftFacilityComplexMode);
  const placingFor = useEditor((s) => s.placingFacilityForGroupId);
  const groups = useEditor((s) => s.system.groups);
  const cancelPlacingFacility = useEditor((s) => s.cancelPlacingFacility);

  const placingGroup = placingFor ? groups.find((g) => g.id === placingFor) : undefined;
  const typeLabel = FACILITY_TYPES[draftFacilityTypeId]?.label.toLowerCase() ?? "facility";
  const article = /^[aeiou]/.test(typeLabel) ? "an" : "a";
  const isArea = FACILITY_TYPES[draftFacilityTypeId]?.geometryKind === "area";

  // One plain sentence that matches what a click actually does. The WHAT
  // (entrance/depot/… or Complex) is the tool's flyout variant, not a menu
  // buried here.
  return (
    <div className="tool-options">
      {placingGroup ? (
        <p className="panel-hint">
          Click the map to place {article} {typeLabel} in {placingGroup.name || "this complex"}.{" "}
          <button type="button" className="link-btn" onClick={cancelPlacingFacility}>
            Cancel
          </button>
        </p>
      ) : complexMode ? (
        <p className="panel-hint">Drag a rectangle — or click corner points and double-click to close — to outline the site.</p>
      ) : isArea ? (
        <p className="panel-hint">Drag to draw the {typeLabel}'s shape · on station land it joins that station automatically.</p>
      ) : (
        <p className="panel-hint">Click the map to place {article} {typeLabel} · on station land it joins that station automatically.</p>
      )}
    </div>
  );
}
