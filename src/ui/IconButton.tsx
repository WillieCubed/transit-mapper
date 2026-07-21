import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Icon } from "./Icon";

/** MD3-style emphasis, loudest last — see app.css's ".btn" comment for what
 *  each one looks like and when to reach for it. */
export type ButtonVariant = "plain" | "tonal" | "bordered" | "primary";

/**
 * The one icon-only button used everywhere in the app's chrome — toolbar
 * actions, panel-collapse toggles, popover triggers. Before this existed,
 * three near-identical hand-rolled versions had drifted apart (two of them
 * never reset the native button border, so real OS button chrome was
 * showing through — see app.css's button reset comment). One component
 * means one place to get size/border/hover/focus right, ever.
 *
 * Defaults to "plain" (no border, no fill until hovered) — most icon buttons
 * in this app are high-frequency utility actions (a chevron, a menu trigger,
 * undo/redo) that shouldn't compete visually with the one or two real calls
 * to action nearby; reach for a louder variant only when a button genuinely
 * needs to stand apart from its neighbors.
 *
 * forwardRef is required, not optional: Radix's <Popover.Trigger asChild>
 * and <DropdownMenu.Trigger asChild> clone this element and attach their
 * own ref to it to measure its position — without forwardRef, React drops
 * that ref silently (only a console warning), and Radix's Popper never gets
 * a real element to anchor to, so the menu/popover renders off-screen at
 * its unmeasured placeholder position instead of next to the button.
 */
type IconButtonProps = {
  icon: string;
  size?: number;
  /** e.g. a rotate transform for a chevron that flips open/closed. */
  iconStyle?: CSSProperties;
  /** Both the tooltip and the accessible name — every icon-only button needs one. */
  label: string;
  active?: boolean;
  variant?: ButtonVariant;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label" | "children">;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 18, iconStyle, label, active = false, variant = "plain", className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn-${variant} icon-only ${active ? "active" : ""} ${className}`.trim()}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} size={size} style={iconStyle} />
    </button>
  );
});
