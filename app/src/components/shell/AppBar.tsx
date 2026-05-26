/**
 * AppBar — top chrome for the editor surfaces (Home, ClientDetail, EventTabs, Settings).
 *
 * Per SOP 13 § 10 + SOP 15 § 6, AppBar is mounted by the parent shell on every
 * non-tagging non-boot view. TaggingPass renders its own full-screen UI without
 * AppBar (Behavioral Rule #11 + SOP 14 §3).
 *
 * Visual brief: 60px tall, ink-raised background, hairline bottom border.
 *  - Inline-end (visual right under RTL): SB monogram + brand wordmark
 *  - Center: optional breadcrumb chips, hairline-separated, with the
 *    most-recent segment closest to the brand (visually leftmost)
 *  - Inline-start (visual left): theme toggle (curtain icon variant)
 *
 * RTL note: every direction-sensitive utility uses logical properties
 * (`ms-` / `me-`, `start-` / `end-`). The AppBar lives inside `<html dir="rtl">`,
 * so flexbox order proceeds end → start visually (right → left).
 *
 * Test-id: `app-bar` (root). The theme toggle button inherits its own test-id
 * via `data-testid="theme-toggle"` (SOP 15 §6 locked list).
 */

import { useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AnimatedThemeToggler } from "../ui/animated-theme-toggler";
import { useEntrance } from "../../lib/motion/useEntrance";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BreadcrumbSegment = {
  label: string;
  onClick?: () => void;
};

export type AppBarProps = {
  /** Breadcrumb chips. First entry is closest to the brand mark (deepest context). */
  breadcrumb?: BreadcrumbSegment[];
  /** Hide the theme toggle on screens that don't want it. Default `true`. */
  showThemeToggle?: boolean;
  /**
   * Click handler for the brand mark. Wired by the parent shell to navigate
   * back to Home (SOP 13 § AppView). When omitted, the logo renders as a
   * non-interactive `<img>` (e.g. on Home itself, where "go to Home" is a
   * no-op).
   */
  onLogoClick?: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

// Maintenance Log 2026-05-26-pm: bar height bumped 60 → 80 to accommodate
// the enlarged brand mark (the SB monogram + crown reads as a tiny dot at
// 32px; the user asked for it to be visible at proper size).
const BAR_HEIGHT = 80;

const barStyle: CSSProperties = {
  height: BAR_HEIGHT,
  // Use logical paddings so the bar respects RTL.
  paddingInline: "1.5rem",
};

export function AppBar({ breadcrumb, showThemeToggle = true, onLogoClick }: AppBarProps) {
  const reduce = useReducedMotion();
  // Breadcrumb fades in slightly after the bar's hairline finishes drawing.
  const breadcrumbEntrance = useEntrance({ delay: 0.18 });
  return (
    <header
      data-testid="app-bar"
      className="
        flex items-center justify-between
        bg-ink-raised text-cream
        relative
      "
      style={barStyle}
    >
      {/* ── Hairline bottom border, scale-X reveal on first mount ─────────
          Plan §B.8 — replaces the static `border-b` so the bar feels like
          it's being drawn in. 320ms total, signature ease, RTL-agnostic
          (scaleX from center reads naturally in either direction). */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-border-subtle origin-center"
        initial={reduce ? { scaleX: 1 } : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: reduce ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* ── Inline-start (visual left): Theme toggle ──────────────────────── */}
      <div className="flex items-center">
        {showThemeToggle && <AnimatedThemeToggler size={20} />}
      </div>

      {/* ── Center: Breadcrumb chips ──────────────────────────────────────── */}
      {breadcrumb && breadcrumb.length > 0 && (
        <motion.nav
          {...breadcrumbEntrance}
          aria-label="פירורי לחם"
          className="flex items-center gap-3 font-sans text-small text-cream-muted"
        >
          {breadcrumb.map((segment, idx) => {
            const isLast = idx === breadcrumb.length - 1;
            const ChipTag = segment.onClick ? "button" : "span";
            return (
              <span key={`${segment.label}-${idx}`} className="flex items-center gap-3">
                <ChipTag
                  type={segment.onClick ? "button" : undefined}
                  onClick={segment.onClick}
                  className={
                    "font-sans text-small transition-colors duration-150 " +
                    (segment.onClick
                      ? "cursor-pointer hover:text-cream"
                      : "cursor-default") +
                    (isLast ? " text-cream" : " text-cream-muted")
                  }
                >
                  {segment.label}
                </ChipTag>
                {!isLast && (
                  // Hebrew RTL caret — points leftward visually under dir="rtl".
                  <span
                    aria-hidden="true"
                    className="text-cream-muted/70 select-none"
                  >
                    ‹
                  </span>
                )}
              </span>
            );
          })}
        </motion.nav>
      )}

      {/* ── Inline-end (visual right): Brand mark ─────────────────────────
          Logo-only: the SVG already renders "שון בלאיש · הפקות". Wordmark
          text was removed 2026-05-21 to eliminate redundancy. */}
      <div className="flex items-center">
        <BrandLogo onClick={onLogoClick} />
      </div>
    </header>
  );
}

// ─── Brand mark ───────────────────────────────────────────────────────────────
//
// Renders `/logo.svg` (the canonical SB monogram, dark on white). The asset is
// mounted under `app/public/`. Maintenance Log 2026-05-26: the `logo-light.svg`
// cream variant was retired — the user wants the same black-on-white mark in
// both themes. If the file is missing at runtime, the `<img>` fallback degrades
// to a glyph — no layout shift, no console error thrown by React itself.
//
// When `onClick` is supplied, the logo is wrapped in a <button> so it acts as
// the "home" affordance (Constitution § Identity — clicking the logo returns
// the user to the main menu). When omitted, the logo renders as a plain image.
//
// Maintenance Log 2026-05-26-pm: the SB monogram is dark-ink-on-transparent,
// so on the dark-mode `bg-ink-raised` AppBar canvas it became almost
// invisible. The user wants the logo enlarged AND placed on an intentional
// white plate so it's legible in both themes (the white panel is part of
// the brand presentation, not an accident). 32px → 56px image; the wrapper
// adds 8px of white padding on each side.
const LOGO_SIZE = 56;
const LOGO_PLATE_PADDING = 8;

function BrandLogo({ onClick }: { onClick?: () => void }) {
  const [errored, setErrored] = useState(false);

  const inner = errored ? (
    <span
      aria-hidden="true"
      className="font-serif"
      style={{ fontSize: "32px", lineHeight: 1, color: "#1A1A1A" }}
    >
      ❖
    </span>
  ) : (
    <img
      src="/logo.svg"
      alt="שון בלאיש — חזרה לתפריט הראשי"
      width={LOGO_SIZE}
      height={LOGO_SIZE}
      style={{ display: "block", height: LOGO_SIZE, width: LOGO_SIZE }}
      onError={() => setErrored(true)}
    />
  );

  // White plate makes the dark-ink monogram readable in both themes.
  // Inline `backgroundColor` instead of a Tailwind class so it stays
  // pinned to white regardless of `--color-*` token flips.
  const plateStyle: CSSProperties = {
    backgroundColor: "#FFFFFF",
    padding: LOGO_PLATE_PADDING,
    borderRadius: 4,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (!onClick) {
    return <span style={plateStyle}>{inner}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="brand-logo-home"
      aria-label="חזרה לתפריט הראשי"
      className="
        bg-transparent border-0 cursor-pointer p-0
        transition-transform duration-150
        hover:scale-105 active:scale-95
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2
      "
      style={{ borderRadius: 0 }}
    >
      <span style={plateStyle}>{inner}</span>
    </button>
  );
}
