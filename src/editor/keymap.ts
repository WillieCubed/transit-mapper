// Declarative keyboard system. One table is the single source of truth for
// every shortcut; a pure matcher decides whether an event fires a binding; and
// commands run against an injected context (store + map) so they can be tested
// without the DOM. Pointer-gesture keys (space-to-pan) are a modifier, handled
// by the controller rather than as a discrete command.
import type { Map as MLMap } from "maplibre-gl";
import { MODE_ORDER, WAY_TYPE_ORDER, profilePresetsForWayType, wayTypesByFamily, type WayFamily } from "../model/catalog";
import { flipProfile, isOneWay, makeOneWay, makeTwoWay, wayCapacity } from "../model/profile";
import { exportFullSystemPng } from "../share/pngExport";
import type { EditorStore } from "./store";

export interface KeyContext {
  map: MLMap;
  editor: EditorStore;
  /** Called on space down/up so the pointer layer can pan on space+drag. */
  setPanKeyHeld: (held: boolean) => void;
  /** Open the keyboard-shortcuts dialog. */
  openShortcuts: () => void;
  /** Show/hide all floating chrome, leaving just the map. */
  toggleUi: () => void;
}

export interface KeyBinding {
  /** Group label, for a future shortcuts panel. */
  group: string;
  /** Key aliases that trigger this binding, e.g. ["z", "+", "PageUp"]. */
  keys: string[];
  description: string;
  /** Optional guard; the binding is skipped when it returns false. */
  when?: (ctx: KeyContext) => boolean;
  run: (ctx: KeyContext) => void;
  /** Requires Ctrl (Win/Linux) or Cmd (Mac) held — the one deliberate
   *  exception to "ctrl/cmd combos belong to the browser," reserved for
   *  undo/redo, which users expect to work regardless. */
  mod?: boolean;
  /** Only meaningful alongside mod: true — distinguishes Redo (Ctrl+Shift+Z)
   *  from Undo (Ctrl+Z); plain bindings ignore Shift entirely (unchanged). */
  shift?: boolean;
}

const PAN_STEP_PX = 120;
const ZOOM_STEP = 0.6;

const editable = (c: KeyContext) => !c.editor.getState().readOnly;

const panBy = (c: KeyContext, dx: number, dy: number) => c.map.panBy([dx, dy], { duration: 0 });
const zoom = (c: KeyContext, d: number) => c.map.zoomTo(c.map.getZoom() + d, { duration: 130 });

// Esc backs out one level at a time, like a nested menu. The armed
// "place inside" / "add existing" flows (Inspector's GroupInspector) are the
// most in-progress state of all — a single Escape should drop out of them
// without also losing the current tool or selection.
function backOut(c: KeyContext): void {
  const s = c.editor.getState();
  if (s.routeDraft) {
    s.cancelRouteDraft();
  } else if (s.placingFacilityForGroupId) {
    s.cancelPlacingFacility();
  } else if (s.pickingMemberForGroupId) {
    s.cancelPickingMember();
  } else if (s.activeWayId) {
    s.finishWay();
  } else if (s.multiSelection.length > 0) {
    s.clearMultiSelection();
  } else if (s.tool !== "select") {
    s.setTool("select");
  } else if (s.selection) {
    s.select(null);
  }
}

function commitDraw(c: KeyContext): void {
  const s = c.editor.getState();
  if (s.routeDraft) s.commitRouteDraft();
  else if (s.activeWayId) s.finishWay();
}

function deleteSelection(c: KeyContext): void {
  const s = c.editor.getState();
  if (s.multiSelection.length > 0) {
    s.deleteMultiSelection();
    return;
  }
  const sel = s.selection;
  if (!sel) return;
  if (sel.kind === "way") s.deleteWay(sel.id);
  else if (sel.kind === "service") s.deleteService(sel.id);
  else if (sel.kind === "station") s.deleteStation(sel.id);
  else if (sel.kind === "facility") s.deleteFacility(sel.id);
  else if (sel.kind === "group") s.deleteGroup(sel.id);
}

// The way lane shortcuts operate on: the one being drawn right now, else the
// selected one — mirrors what the cross-section editor is showing.
function laneTargetWay(c: KeyContext) {
  const s = c.editor.getState();
  const id = s.activeWayId ?? (s.selection?.kind === "way" ? s.selection.id : null);
  return id ? (s.system.ways.find((w) => w.id === id) ?? null) : null;
}

const hasLaneTarget = (c: KeyContext) => editable(c) && laneTargetWay(c) !== null;

function stepLanes(c: KeyContext, delta: number): void {
  const way = laneTargetWay(c);
  if (way) c.editor.getState().setWayCapacity(way.id, wayCapacity(way) + delta);
}

// One-key drawing tools, straight from the catalog's way families — the
// keyboard mirror of the dock's Road/Track/Path buttons.
function drawFamily(family: WayFamily): (c: KeyContext) => void {
  return (c) => {
    const entry = wayTypesByFamily().find((e) => e.family === family);
    if (!entry) return;
    const s = c.editor.getState();
    s.setDraftWayType(entry.typeIds[0]);
    s.setTool("way");
  };
}

export const KEY_BINDINGS: KeyBinding[] = [
  { group: "Tools", keys: ["v"], description: "Select & edit", run: (c) => c.editor.getState().setTool("select") },
  { group: "Tools", keys: ["l"], description: "Draw way / line (last kind)", when: editable, run: (c) => c.editor.getState().setTool("way") },
  { group: "Tools", keys: ["r"], description: "Draw road", when: editable, run: drawFamily("roadway") },
  { group: "Tools", keys: ["t"], description: "Draw track", when: editable, run: drawFamily("guideway") },
  { group: "Tools", keys: ["p"], description: "Draw path", when: editable, run: drawFamily("path") },
  { group: "Tools", keys: ["s"], description: "Add station", when: editable, run: (c) => c.editor.getState().setTool("station") },
  { group: "Tools", keys: ["f"], description: "Place facility", when: editable, run: (c) => c.editor.getState().setTool("facility") },

  { group: "Camera", keys: ["ArrowUp"], description: "Pan up", run: (c) => panBy(c, 0, -PAN_STEP_PX) },
  { group: "Camera", keys: ["ArrowDown"], description: "Pan down", run: (c) => panBy(c, 0, PAN_STEP_PX) },
  { group: "Camera", keys: ["ArrowLeft"], description: "Pan left", run: (c) => panBy(c, -PAN_STEP_PX, 0) },
  { group: "Camera", keys: ["ArrowRight"], description: "Pan right", run: (c) => panBy(c, PAN_STEP_PX, 0) },
  { group: "Camera", keys: ["z", "+", "=", "PageUp"], description: "Zoom in", run: (c) => zoom(c, ZOOM_STEP) },
  { group: "Camera", keys: ["x", "-", "_", "PageDown"], description: "Zoom out", run: (c) => zoom(c, -ZOOM_STEP) },

  { group: "Edit", keys: ["Escape"], description: "Stop drawing / back out", run: backOut },
  { group: "Edit", keys: ["Enter"], description: "Commit the current line or road", run: commitDraw },
  { group: "Edit", keys: ["Delete", "Backspace"], description: "Delete selection", when: editable, run: deleteSelection },
  {
    group: "Edit",
    keys: ["z"],
    description: "Undo",
    mod: true,
    when: (c) => editable(c) && c.editor.getState().canUndo,
    run: (c) => c.editor.getState().undo(),
  },
  {
    group: "Edit",
    keys: ["z"],
    description: "Redo",
    mod: true,
    shift: true,
    when: (c) => editable(c) && c.editor.getState().canRedo,
    run: (c) => c.editor.getState().redo(),
  },
  {
    group: "Edit",
    keys: ["y"],
    description: "Redo",
    mod: true,
    when: (c) => editable(c) && c.editor.getState().canRedo,
    run: (c) => c.editor.getState().redo(),
  },

  {
    group: "Export",
    keys: ["c"],
    description: "Capture PNG",
    // No live view-filter context is reachable from the keymap (that lives in
    // React's ViewProvider) — a quick keyboard capture shows the whole system
    // with everything visible, network view, same "show something of
    // substance" default as the quick-export menu.
    run: (c) =>
      exportFullSystemPng(c.editor.getState().system, {
        viewMode: "network",
        visibleModes: new Set(MODE_ORDER),
        visibleWayTypes: new Set(WAY_TYPE_ORDER),
      }),
  },

  { group: "Lanes", keys: ["["], description: "Remove a lane", when: hasLaneTarget, run: (c) => stepLanes(c, -1) },
  { group: "Lanes", keys: ["]"], description: "Add a lane", when: hasLaneTarget, run: (c) => stepLanes(c, 1) },
  {
    group: "Lanes",
    keys: ["d"],
    description: "Flip direction (reverse the cross-section)",
    when: hasLaneTarget,
    run: (c) => {
      const way = laneTargetWay(c)!;
      c.editor.getState().setWayProfile(way.id, flipProfile(way.profile));
    },
  },
  {
    group: "Lanes",
    keys: ["o"],
    description: "Toggle one-way ⇄ two-way (or arm it for the next draw)",
    when: (c) => editable(c) && (laneTargetWay(c) !== null || c.editor.getState().tool === "way"),
    run: (c) => {
      const s = c.editor.getState();
      const way = laneTargetWay(c);
      // With a way in hand, toggle IT; with just the drawing tool armed,
      // toggle the draft Direction so the NEXT way draws one-way.
      if (way) s.setWayProfile(way.id, isOneWay(way.profile) ? makeTwoWay(way.profile) : makeOneWay(way.profile, "forward"));
      else s.setDraftOneWay(!s.draftOneWay);
    },
  },
  // 1–9 pick the numbered cross-section preset (the same chips the toolbar
  // shows): with a way selected/being drawn they apply to it directly, else
  // they arm the Way tool's draft preset.
  ...Array.from({ length: 9 }, (_, i): KeyBinding => ({
    group: "Lanes",
    keys: [String(i + 1)],
    description: `Cross-section preset ${i + 1}`,
    when: (c) => {
      if (!editable(c)) return false;
      const s = c.editor.getState();
      const typeId = laneTargetWay(c)?.typeId ?? (s.tool === "way" ? s.draftWayTypeId : null);
      return !!typeId && profilePresetsForWayType(typeId).length > i;
    },
    run: (c) => {
      const s = c.editor.getState();
      const way = laneTargetWay(c);
      const typeId = way?.typeId ?? s.draftWayTypeId;
      const preset = profilePresetsForWayType(typeId)[i];
      if (!preset) return;
      if (way) s.applyProfilePreset(way.id, preset.id);
      else s.setDraftPreset(preset.id);
    },
  })),

  { group: "Help", keys: ["?"], description: "Show keyboard shortcuts", run: (c) => c.openShortcuts() },
  { group: "View", keys: ["\\"], description: "Show/hide UI", run: (c) => c.toggleUi() },
];

/**
 * Does a keyboard event fire this key alias? Single-character keys match
 * case-insensitively; named keys ("ArrowUp", "Escape") match exactly.
 *
 * Plain bindings (mod unset): Ctrl/⌘ combos never match — those belong to
 * the browser and OS, and Shift is left for `e.key` to have already resolved
 * (e.g. "?" only ever arrives via Shift+/, so nothing extra to check).
 *
 * mod: true bindings require Ctrl (Win/Linux) or Cmd (Mac) — the one
 * deliberate exception, for undo/redo — and additionally require Shift to
 * match `shift` exactly, since the case-insensitive match above can't
 * otherwise tell Ctrl+Z from Ctrl+Shift+Z apart.
 */
export function matchesKey(e: KeyboardEvent, key: string, mod = false, shift = false): boolean {
  const modHeld = e.metaKey || e.ctrlKey;
  if (mod) {
    if (!modHeld || !!e.shiftKey !== shift) return false;
  } else if (modHeld) {
    return false;
  }
  return key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** First binding whose key matches and whose guard passes, else null. */
export function resolveBinding(
  bindings: KeyBinding[],
  e: KeyboardEvent,
  ctx: KeyContext,
): KeyBinding | null {
  for (const b of bindings) {
    if (b.keys.some((k) => matchesKey(e, k, b.mod, b.shift)) && (!b.when || b.when(ctx))) return b;
  }
  return null;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** Attach the keymap to the window. Returns a detach function. */
export function attachKeyboard(ctx: KeyContext, bindings: KeyBinding[] = KEY_BINDINGS): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    // Space is a held pan modifier, not a discrete command.
    if (e.code === "Space") {
      ctx.setPanKeyHeld(true);
      e.preventDefault();
      return;
    }
    const binding = resolveBinding(bindings, e, ctx);
    if (!binding) return;
    e.preventDefault();
    binding.run(ctx);
  };
  const onUp = (e: KeyboardEvent) => {
    if (e.code === "Space") ctx.setPanKeyHeld(false);
  };
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  return () => {
    window.removeEventListener("keydown", onDown);
    window.removeEventListener("keyup", onUp);
  };
}
