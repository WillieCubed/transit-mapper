import * as RdxMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

/**
 * The one trigger-driven action menu used everywhere (File menu, the Export
 * split button's quick-export caret) — built on Radix's DropdownMenu instead
 * of a hand-rolled useState(open) + useClickOutside pair. Real arrow-key
 * navigation between items and Home/End come for free; positioning is
 * Radix's own Popper (collision-aware, portal-rendered) instead of a static
 * `top/left/right` offset that could run off-screen near a viewport edge.
 */
interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
}

export function DropdownMenu({ trigger, children, align = "end" }: DropdownMenuProps) {
  return (
    <RdxMenu.Root>
      <RdxMenu.Trigger asChild>{trigger}</RdxMenu.Trigger>
      <RdxMenu.Portal>
        <RdxMenu.Content className="dropdown-menu-content" align={align} sideOffset={8}>
          {children}
        </RdxMenu.Content>
      </RdxMenu.Portal>
    </RdxMenu.Root>
  );
}

interface DropdownMenuItemProps {
  onSelect: () => void;
  children: ReactNode;
}

export function DropdownMenuItem({ onSelect, children }: DropdownMenuItemProps) {
  return (
    <RdxMenu.Item className="dropdown-menu-item" onSelect={onSelect}>
      {children}
    </RdxMenu.Item>
  );
}

interface DropdownMenuLabelProps {
  children: ReactNode;
}

/** A non-interactive section heading — for menus whose entries fall into
 *  genuinely different kinds (e.g. the Facility tool's point markers vs.
 *  area footprints vs. the site complex). */
export function DropdownMenuLabel({ children }: DropdownMenuLabelProps) {
  return <RdxMenu.Label className="dropdown-menu-label">{children}</RdxMenu.Label>;
}

export function DropdownMenuSeparator() {
  return <RdxMenu.Separator className="dropdown-menu-separator" />;
}
