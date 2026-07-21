import * as RdxPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/**
 * The one trigger-driven popover shell for arbitrary interactive content
 * (checkboxes, a color picker) — as opposed to DropdownMenu.tsx, which is
 * specifically an action-item menu with roving keyboard focus. Built on
 * Radix's Popover instead of a hand-rolled useState(open) + useClickOutside
 * pair, for the same reasons as DropdownMenu: real focus handling and
 * collision-aware portal positioning instead of a static offset.
 */
interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  /** Preferred side — Radix still flips to whichever side actually fits if
   *  this one collides with the viewport edge. */
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  /** Omit both for the common case — Radix owns open state internally.
   *  Pass both when a caller needs to close the popover itself in response
   *  to something happening inside it (e.g. picking a value should close it,
   *  but toggling a sub-panel shouldn't) — see ColorField for that case. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ trigger, children, align = "end", side = "bottom", className = "", open, onOpenChange }: PopoverProps) {
  return (
    <RdxPopover.Root open={open} onOpenChange={onOpenChange}>
      <RdxPopover.Trigger asChild>{trigger}</RdxPopover.Trigger>
      <RdxPopover.Portal>
        <RdxPopover.Content className={className} align={align} side={side} sideOffset={8}>
          {children}
        </RdxPopover.Content>
      </RdxPopover.Portal>
    </RdxPopover.Root>
  );
}
