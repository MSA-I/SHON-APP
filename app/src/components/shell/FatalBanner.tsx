/**
 * FatalBanner — dead-end fatal screen.
 *
 * Per SOP 13 §7 + SOP 08 § Failure Modes: this is the canonical surface for
 * unrecoverable lib-layer panics (failed `openDb`, missing project root,
 * Tauri capability denial). Consumers — typically `<TopLevelBoundary>` —
 * pass `title` + `body` from the LibError they caught, and an optional
 * `onRetry` to wire a "נסה שוב" button (which usually reloads the window).
 *
 * Visual brief:
 *  - Full-screen `bg-ink` overlay (no AppBar, no theme toggle — this is the
 *    dead end).
 *  - Centered card: 1px gold border, 48px padding, max-width 600px, sharp
 *    corners (radius 0 per SOP 09 §6 — Luxury Editorial rejects rounding).
 *  - Title: Frank Ruhl Libre 28px, gold.
 *  - Body: Heebo, cream.
 *  - Optional retry button: gold border + cream text, primary variant per
 *    SOP 09 §9.3 (Button.tsx ships in 3B alongside this; we inline the
 *    primary look here so FatalBanner is self-contained — when Button.tsx
 *    lands, swap the inline button for `<Button variant="primary" />`).
 *
 * Test-id: `fatal-banner` (root).
 */

import type { CSSProperties } from "react";

export type FatalBannerProps = {
  /** Headline copy in Hebrew, e.g. "ספריית התמונות לא נמצאה". */
  title: string;
  /** Body copy in Hebrew, e.g. "נא להריץ מחדש את ההתקנה". */
  body: string;
  /** Optional retry handler. When provided, renders a "נסה שוב" button. */
  onRetry?: () => void;
};

const cardStyle: CSSProperties = {
  // Sharp corners + 1px gold hairline + generous editorial padding.
  border: "1px solid var(--gold, #C9A961)",
  padding: "48px",
  maxWidth: "600px",
  width: "100%",
  background: "var(--ink-raised, #1A1714)",
};

const titleStyle: CSSProperties = {
  fontFamily: "'Frank Ruhl Libre', 'David Libre', 'Times New Roman', serif",
  fontSize: "28px",
  fontWeight: 500,
  lineHeight: 1.15,
  color: "var(--gold, #C9A961)",
};

const bodyStyle: CSSProperties = {
  fontFamily: "'Heebo', 'Assistant', 'Segoe UI', 'Arial', sans-serif",
  fontSize: "16px",
  fontWeight: 400,
  lineHeight: 1.6,
  color: "var(--cream, #F5F0E8)",
  marginTop: "24px",
};

export function FatalBanner({ title, body, onRetry }: FatalBannerProps) {
  return (
    <div
      data-testid="fatal-banner"
      role="alert"
      className="
        fixed inset-0 z-[60]
        flex items-center justify-center
        bg-ink
      "
      style={{ paddingInline: "24px" }}
    >
      <div style={cardStyle}>
        <h2 style={titleStyle}>{title}</h2>
        <p style={bodyStyle}>{body}</p>

        {onRetry && (
          <div className="mt-8 flex justify-end">
            <RetryButton onClick={onRetry}>נסה שוב</RetryButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline primary button ────────────────────────────────────────────────────
//
// Mirrors SOP 09 §9.3 primary surface: 1px gold border, cream text, sharp
// corners, gold hover. Replace with `<Button variant="primary" />` when
// `components/ui/Button.tsx` ships (Phase 3B per SOP 15 §7).
//
function RetryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        font-sans text-body text-cream
        transition-colors duration-150
        hover:text-gold
        focus-visible:outline-none
      "
      style={{
        border: "1px solid var(--gold, #C9A961)",
        paddingBlock: "10px",
        paddingInline: "24px",
        background: "transparent",
        // Sharp corners — Luxury Editorial rule (SOP 09 §6).
        borderRadius: 0,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
