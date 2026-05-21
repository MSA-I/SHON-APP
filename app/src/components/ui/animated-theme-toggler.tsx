/**
 * AnimatedThemeToggler — sun↔moon morph for the AppBar.
 *
 * Replaces the curtain-style toggle in `AppBar.tsx` with a refined micro-interaction:
 *  - Sun rays shrink and rotate away.
 *  - Center circle swells; an SVG mask carves the crescent.
 *  - Spring physics throughout (skipped when `prefers-reduced-motion: reduce`).
 *
 * This component is presentation-only. It owns NO theme state — it reads from
 * `ThemeContext` (SOP 14 § 2) and dispatches via `setTheme(...)`, so the choice
 * persists to `meta.theme` and survives reload/backup roundtrips
 * (Behavioral Rule #12, Backup Policy v2).
 *
 * Stack note: imports from `framer-motion` (Constitution Tech Stack), NOT `motion/react`.
 */

import { useRef, useId, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnimatedThemeTogglerProps {
  /** Play a soft switch-click on toggle. Default `false` — meeting context. */
  sound?: boolean;
  /** Pixel size of the SVG. Default 20. */
  size?: number;
  /** Optional className passed to the root <button>. */
  className?: string;
}

// ─── Audio (lazy-init WebAudio click) ─────────────────────────────────────────
//
// Module-level singletons so a single AudioContext is reused across toggles.
// Buffer is regenerated only if the sample rate changes (rare; cross-device).

let _ctx: AudioContext | null = null;
let _buf: AudioBuffer | null = null;

function audioCtx(): AudioContext {
  if (!_ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    _ctx = new Ctor();
  }
  if (_ctx.state === 'suspended') void _ctx.resume();
  return _ctx;
}

function ensureBuf(ac: AudioContext): AudioBuffer {
  if (_buf && _buf.sampleRate === ac.sampleRate) return _buf;
  const rate = ac.sampleRate;
  const len = Math.floor(rate * 0.006); // 6 ms click
  const buf = ac.createBuffer(1, len, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const sine = Math.sin(2 * Math.PI * 3400 * t);
    const noise = Math.random() * 2 - 1;
    ch[i] = (sine * 0.6 + noise * 0.4) * (1 - t) ** 3;
  }
  _buf = buf;
  return buf;
}

function tick(last: React.RefObject<number>) {
  const now = performance.now();
  if (now - last.current < 80) return; // debounce repeated triggers
  last.current = now;
  try {
    const ac = audioCtx();
    const buf = ensureBuf(ac);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    src.buffer = buf;
    gain.gain.value = 0.08;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
  } catch {
    /* user-agent blocked WebAudio (e.g. autoplay policy) — silent */
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const buttonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'currentColor', // inherits from AppBar (cream on dark, ink on light)
  borderRadius: 8,
  outline: 'none',
  WebkitTapHighlightColor: 'transparent',
};

export function AnimatedThemeToggler({
  sound = false,
  size = 20,
  className,
}: AnimatedThemeTogglerProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  const rawId = useId();
  // SVG <mask> ids must be DOM-safe — strip the colon React injects.
  const maskId = `att${rawId.replace(/:/g, '')}`;

  const lastSnd = useRef(0);
  const prefersReducedMotion = useReducedMotion();

  const spring = prefersReducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 30 };

  const onClick = () => {
    setTheme(isDark ? 'light' : 'dark');
    if (sound && !prefersReducedMotion) tick(lastSnd);
  };

  const ariaLabel = isDark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={prefersReducedMotion ? undefined : { scale: 1.1 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={buttonStyle}
      className={className}
      aria-label={ariaLabel}
      aria-pressed={isDark}
      data-testid="theme-toggle"
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        initial={false}
        animate={{ rotate: isDark ? 270 : 0 }}
        transition={spring}
        style={{ overflow: 'visible' }}
      >
        {/* Mask carves the crescent from the center circle. */}
        <mask id={maskId}>
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <motion.circle
            initial={false}
            animate={{ cx: isDark ? 17 : 33, cy: isDark ? 8 : 0 }}
            transition={spring}
            r="9"
            fill="black"
          />
        </mask>

        {/* Center body — small sun or large crescent moon. */}
        <motion.circle
          cx="12"
          cy="12"
          fill="currentColor"
          stroke="none"
          mask={`url(#${maskId})`}
          initial={false}
          animate={{ r: isDark ? 9 : 5 }}
          transition={spring}
        />

        {/* Rays — shrink + rotate away when dark. */}
        <motion.g
          initial={false}
          animate={{
            opacity: isDark ? 0 : 1,
            scale: isDark ? 0 : 1,
            rotate: isDark ? -30 : 0,
          }}
          transition={spring}
          style={{ transformOrigin: '12px 12px' }}
        >
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="5.64" y1="5.64" x2="4.22" y2="4.22" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          <line x1="5.64" y1="18.36" x2="4.22" y2="19.78" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        </motion.g>
      </motion.svg>
    </motion.button>
  );
}

export default AnimatedThemeToggler;
