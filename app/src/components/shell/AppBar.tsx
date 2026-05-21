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
import { AnimatedThemeToggler } from "../ui/animated-theme-toggler";

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

const BAR_HEIGHT = 60;

const barStyle: CSSProperties = {
  height: BAR_HEIGHT,
  // Use logical paddings so the bar respects RTL.
  paddingInline: "1.5rem",
};

export function AppBar({ breadcrumb, showThemeToggle = true, onLogoClick }: AppBarProps) {
  return (
    <header
      data-testid="app-bar"
      className="
        flex items-center justify-between
        bg-ink-raised text-cream
        border-b border-border-subtle
      "
      style={barStyle}
    >
      {/* ── Inline-start (visual left): Theme toggle ──────────────────────── */}
      <div className="flex items-center">
        {showThemeToggle && <AnimatedThemeToggler size={20} />}
      </div>

      {/* ── Center: Breadcrumb chips ──────────────────────────────────────── */}
      {breadcrumb && breadcrumb.length > 0 && (
        <nav
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
        </nav>
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
// Renders `/logo-light.svg` (cream variant for the dark UI). The asset is
// mounted under `app/public/`. If the file is missing at runtime, the `<img>`
// fallback degrades to a glyph — no layout shift, no console error thrown by
// React itself.
//
// When `onClick` is supplied, the logo is wrapped in a <button> so it acts as
// the "home" affordance (Constitution § Identity — clicking the logo returns
// the user to the main menu). When omitted, the logo renders as a plain image.
//
function BrandLogo({ onClick }: { onClick?: () => void }) {
  const [errored, setErrored] = useState(false);

  const inner = errored ? (
    <span
      aria-hidden="true"
      className="font-serif text-gold"
      style={{ fontSize: "20px", lineHeight: 1 }}
    >
      ❖
    </span>
  ) : (
    <img
      src="/logo-light.svg"
      alt="שון בלאיש — חזרה לתפריט הראשי"
      width={32}
      height={32}
      style={{ display: "block", height: 32, width: "auto" }}
      onError={() => setErrored(true)}
    />
  );

  if (!onClick) return inner;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="brand-logo-home"
      aria-label="חזרה לתפריט הראשי"
      className="
        flex items-center justify-center
        bg-transparent border-0 cursor-pointer p-1
        rounded-md
        transition-transform duration-150
        hover:scale-105 active:scale-95
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold
      "
    >
      {inner}
    </button>
  );
}
