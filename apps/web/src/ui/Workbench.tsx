import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useEditor } from "../editor/EditorProvider";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Panel } from "./Panel";

export interface WorkbenchProps {
  loadError: ReactNode;
  /** File menu / system name / Hide-UI toggle. Docks into the menu panel's
   *  own header on desktop; mobile has nowhere else for it to live, since
   *  the menu panel itself becomes a bottom sheet there, so it renders in
   *  the top bar instead. One prop, two positions — Workbench decides
   *  which via Tailwind's md: breakpoint, not the caller. */
  brand: ReactNode;
  /** The Objects list — desktop wraps it in a collapsible card with `brand`
   *  above it; mobile wraps it in the bottom sheet instead. */
  menuPanel: ReactNode;
  /** The one dynamic, contextual surface: a selected object's details, OR
   *  (when a drawing tool is armed) that tool's own draft options — never
   *  both at once, and never a second version of either elsewhere. Desktop
   *  docks it as its own card on the right; mobile swaps the sheet over to
   *  it. Null when there's nothing to show. */
  supplementalPanel: ReactNode;
  /** Whether supplementalPanel actually has something to show right now —
   *  drives the mobile sheet's List⇄Details toggle. */
  hasSupplementalContent: boolean;
  /** Undo/redo/export/share/issues/layers/keyboard — the transient-action
   *  cluster, distinct from viewSwitcher (persistent canvas state). */
  primaryToolbar: ReactNode;
  /** Network/Infrastructure/Diagram — a persistent view state, not a
   *  transient action, so it's its own slot rather than folded into
   *  primaryToolbar (desktop only has room to show this distinction). */
  viewSwitcher: ReactNode;
  /** Select/Way/Station/Facility — the drawing-tool palette. */
  modeToolbar: ReactNode;
  /** A background import's live status (ImportProgressPill) — stacked
   *  directly above modeToolbar in the same centered column, sharing its
   *  responsive positioning (the mobile pb-14 lift above the bottom sheet,
   *  the sheet-expanded fade) rather than guessing its own fixed offset.
   *  Null/undefined when nothing's importing. */
  importStatus?: ReactNode;
}

/**
 * THE single owner of where every floating card sits over the full-bleed
 * map, at every viewport width — desktop's docked corner cards and
 * mobile's bottom sheet are two Tailwind-responsive renderings of the same
 * seven slots above, not two competing components independently guessing
 * each other's sizes. (This replaced an earlier version of this idea split
 * across App.tsx + a separate AppShell.tsx + this file, coordinating
 * through matching classNames a card had to remember to carry — confirmed
 * live, that indirection was exactly how a panel ended up rendered nowhere
 * near the edge it was supposed to dock to, no compiler error anywhere.
 * Callers hand this component fully-formed pieces (a toolbar, a view
 * switcher, …); it never reaches back into what any of them mean.
 *
 * Deliberately NOT given the map itself as a prop: App.tsx's Hide-UI toggle
 * fades this whole component out (see its own data-ui-state wrapper), and
 * the map must never be part of that — it stays fully visible/interactive
 * with the chrome hidden, not fade with it. So the map renders as this
 * component's own sibling in App.tsx, unaffected by whatever this does.
 */
export function Workbench({ loadError, brand, menuPanel, supplementalPanel, hasSupplementalContent, primaryToolbar, viewSwitcher, modeToolbar, importStatus }: WorkbenchProps) {
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const clearSelection = useEditor((s) => s.select);
  const backToSelectTool = useEditor((s) => s.setTool);

  useEffect(() => {
    if (hasSupplementalContent) setSheetExpanded(true);
  }, [hasSupplementalContent]);

  const showingSupplemental = hasSupplementalContent;

  return (
    <>
      {/* The overlay grid: empty cells (most of the map) let clicks fall
          straight through to it; only cells with a real card in them
          intercept — the standard "controls float over a canvas" trick. */}
      <div
        className="pointer-events-none absolute inset-2 md:grid md:gap-2"
        style={{ gridTemplateColumns: "auto 1fr auto", gridTemplateRows: `auto 1fr var(--controls-clearance)` }}
      >
        {/* ---- mobile-only top bar (desktop folds brand into the menu
            panel's own header, and viewSwitcher/primaryToolbar into their
            own docked cards instead — see below). A flex row divides the
            width between the two clusters instead of guessing a max-width
            constant for the right one — the same trap the old AppShell hit.
            The right cluster scrolls horizontally rather than wrapping,
            since it has more buttons than a phone's width can ever show in
            one row. ---- */}
        {/* Mobile renders the SAME brand/viewSwitcher/primaryToolbar slots as
            desktop — narrower is a LAYOUT problem: the left card stacks
            title over navigation (CSS hides the brand's non-title pieces);
            the right column is `.actions-collapsed`, whose CSS keeps only
            the primary actions and reveals the ⋯ overflow that carries the
            rest (see TopBarActions). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 md:hidden">
          <div className="pointer-events-auto min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 shadow-[var(--shadow)]">
            <div className="mobile-topleft">
              <div className="mobile-topleft-row">{brand}</div>
              {viewSwitcher}
            </div>
          </div>
          <div className="actions-collapsed pointer-events-auto flex shrink-0 flex-col items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[var(--shadow)]">
            {primaryToolbar}
          </div>
        </div>

        {/* ---- desktop-only docked cards. Only the LEFT/RIGHT columns live
            in the grid — a 3-column "auto 1fr auto" track only centers
            something within the leftover middle track, which sits dead
            center only when both side columns happen to be equal width.
            They almost never are (the left Objects card is wide; the right
            column is empty until something's selected), so anything
            justify-self-center'd in that middle track drifted off the
            actual screen center. viewSwitcher/modeToolbar below are pulled
            out of the grid entirely and centered on the whole overlay
            instead, the same way the mobile top bar/tool dock always have
            been — confirmed live, that's what "centered" needs to mean
            here: centered on the map, not on a leftover grid track. ---- */}
        <div className="pointer-events-auto hidden self-stretch justify-self-start md:flex" style={{ gridArea: "1 / 1 / 4 / 2" }}>
          <MenuCard brand={brand}>{menuPanel}</MenuCard>
        </div>
        <div
          className="actions-full pointer-events-auto hidden max-w-[900px] flex-wrap items-center justify-end gap-2 self-start justify-self-end rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 shadow-[var(--shadow)] md:flex"
          style={{ gridArea: "1 / 3 / 2 / 4" }}
        >
          {primaryToolbar}
        </div>
        {showingSupplemental && (
          <div className="pointer-events-auto hidden self-stretch justify-self-end md:flex" style={{ gridArea: "2 / 3 / 3 / 4" }}>
            {supplementalPanel}
          </div>
        )}

        {/* ---- the view switch: a full-width flex row centers it on the
            map at every width via justify-content, not a grid track (whose
            "center" only lines up with the real center when both side
            columns happen to match width) or a left-50%/translate hack. ---- */}
        <div className="pointer-events-none absolute inset-x-0 top-0 hidden md:flex md:justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 shadow-[var(--shadow)]">
            {loadError}
            {viewSwitcher}
          </div>
        </div>

        {/* ---- tool dock: same flex-centering as the view switch above.
            The fade-while-expanded below is a MOBILE-only concern (so the
            dock doesn't sit under the sheet's own content) — sheetExpanded
            itself isn't mobile-gated (any selection sets it, desktop
            included, so the Details sheet is already open if the user
            later shrinks the window), so the md: overrides here are load-
            bearing: without them the dock silently vanishes on desktop the
            moment anything gets selected. Confirmed live — this exact
            regression is why they're called out instead of assumed. ---- */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-14 md:pb-0">
          {importStatus && <div className="pointer-events-auto">{importStatus}</div>}
          <div
            className={`transition-opacity duration-150 md:pointer-events-auto md:opacity-100 ${
              sheetExpanded ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
            }`}
          >
            {modeToolbar}
          </div>
        </div>
      </div>

      {/* ---- mobile-only bottom sheet — the menu/supplemental panels'
          other rendering, swapped in via Tailwind display utilities
          instead of a second component tree. ---- */}
      <div
        className={`absolute inset-x-0 bottom-0 z-[5] flex flex-col rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_rgba(25,26,23,0.12)] transition-[max-height] duration-200 ease-[cubic-bezier(0.2,0.7,0.3,1)] md:hidden ${
          sheetExpanded ? "max-h-[62vh]" : "max-h-14 overflow-hidden"
        }`}
      >
        <SheetHandle expanded={sheetExpanded} setExpanded={setSheetExpanded} title={showingSupplemental ? "Details" : "Objects"} />
        {showingSupplemental && (
          // Whichever put supplementalPanel here — a selection, an armed
          // tool, or (rarely) both — clears both. Each is a no-op on
          // whichever wasn't actually active, so this works regardless of
          // which case is showing right now.
          <button
            type="button"
            className="sheet-back"
            onClick={() => {
              clearSelection(null);
              backToSelectTool("select");
            }}
          >
            <Icon name="chevronDown" size={15} style={{ transform: "rotate(90deg)" }} /> Objects
          </button>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{showingSupplemental ? supplementalPanel : menuPanel}</div>
      </div>
    </>
  );
}

interface MenuCardProps {
  brand: ReactNode;
  children: ReactNode;
}

/** Desktop's menu card: brand header + collapsible Objects body — sized to
 *  its content (not stretched full-height) so collapsing Objects actually
 *  shrinks the card instead of leaving a tall empty rectangle below it. */
function MenuCard({ brand, children }: MenuCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Panel slot="left" aria-label="System objects">
      <div className="panel-brand">
        <div className="panel-brand-row">{brand}</div>
      </div>
      <div className="panel-head">
        <IconButton
          icon="chevronDown"
          size={16}
          iconStyle={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
          label={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className="panel-head-title">Objects</span>
      </div>
      <div className={`collapsible ${collapsed ? "collapsed" : ""}`}>
        <div className="collapsible-inner">{children}</div>
      </div>
    </Panel>
  );
}

interface SheetHandleProps {
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  title: string;
}

function SheetHandle({ expanded, setExpanded, title }: SheetHandleProps) {
  const dragStartY = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const startY = dragStartY.current;
    dragStartY.current = null;
    if (startY === null) return;
    const dy = e.clientY - startY;
    // A real drag (past a small slop) sets the state explicitly by
    // direction and swallows the click that follows; a short tap falls
    // through to onClick so keyboard activation keeps working too.
    if (Math.abs(dy) > 24) {
      setExpanded(dy < 0);
      suppressClick.current = true;
    }
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setExpanded((v) => !v);
  };

  return (
    <button
      type="button"
      className="sheet-handle"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse panel" : "Expand panel"}
    >
      <span className="sheet-grip" />
      <span className="sheet-title">{title}</span>
      <Icon name="chevronDown" size={16} style={{ transform: expanded ? undefined : "rotate(180deg)" }} />
    </button>
  );
}
