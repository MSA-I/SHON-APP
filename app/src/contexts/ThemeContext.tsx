// SOP: architecture/14-theme-toggle.md
// SOP: architecture/13-app-shell-routing.md § 6 (theme state at top-level)
// SOP: claude.md § Behavioral Rules #12
//
// Top-level Light/Dark theme context. Single source of truth for the active
// theme. Persists user toggles to `meta.theme` via `lib/db.setMeta`. Hydrates
// from `meta.theme` on mount; an absent row defaults to 'dark' WITHOUT
// auto-writing (SOP 14 § 2 Default semantics — implicit migration is forbidden).
//
// DOM application surface (SOP 14 § 3): both `<html data-theme="...">` AND
// the `dark` class on `<html>` are mutated in the same effect. CSS variables
// in `tokens.css` key off the data-attribute; Tailwind v4 `darkMode: 'class'`
// keys off the class. Both must agree.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

import { getMeta, setMeta } from '../lib/db';

export type Theme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  /** True during the first render before db read completes. */
  hydrating: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMeta<Theme>('theme')
      .then((stored) => {
        if (cancelled) return;
        if (stored === 'light' || stored === 'dark') {
          setThemeState(stored);
        }
        setHydrating(false);
      })
      .catch((err) => {
        // SOP 14 § 7 — failure to read is NOT the same as the user choosing
        // dark; we keep the default applied locally but DO NOT setMeta.
        console.error('[theme] hydrate failed', err);
        setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply to <html> on every theme change (SOP 14 § 3 — both surfaces agree).
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    // Persist is fire-and-forget per SOP 13 § 6 (2): failure is logged but the
    // theme stays applied for the session — next boot reverts.
    void setMeta('theme', next).catch((err) => {
      console.error('[theme] persist failed', err);
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, hydrating }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
