/**
 * ErrorBoundary — generic React error boundary for the shell.
 *
 * Per SOP 13 §7 the shell uses two boundaries:
 *   - <TopLevelBoundary> wraps the whole app and renders <FatalBanner /> on
 *     boot/lib failures.
 *   - <PerViewBoundary> wraps the current view and renders a small retry card
 *     on render-time errors inside a single screen.
 *
 * This file ships a SHARED implementation (`ErrorBoundary`) that both names
 * compose via the `fallback` prop. The two SOP 13-named exports
 * (`TopLevelBoundary`, `PerViewBoundary`) live in the shell barrel later;
 * for now the single class is exported and consumers wrap as needed.
 *
 * Logging contract: every catch routes through `console.error('[boundary]', ...)`
 * so the logs the user can copy-paste are uniformly tagged.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export type ErrorBoundaryProps = {
  /** Rendered when an error has been caught. */
  fallback: ReactNode;
  /** Children that may throw during render or lifecycle. */
  children: ReactNode;
  /** Optional callback fired with the caught error (for telemetry / context). */
  onError?: (err: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

const INITIAL_STATE: ErrorBoundaryState = { hasError: false, error: null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  /**
   * React's static lifecycle: triggered by a thrown error during rendering,
   * lifecycle methods, or constructors. Returning a state delta swaps the
   * tree to render `fallback` on the next pass.
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /**
   * Side-effect mirror of `getDerivedStateFromError`. We log here (not in the
   * static method) because the static method is meant to be pure.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Uniform log tag per SOP 13 §7 — easier to grep across console transcripts.
    console.error("[boundary]", error, info);
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
