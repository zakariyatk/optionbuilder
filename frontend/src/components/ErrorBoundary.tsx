import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence: a rendering bug in one panel shows a recoverable
 * message instead of blanking the whole app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[AddStock] ${this.props.label ?? 'panel'} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-lg border border-[var(--border)] bg-[var(--critical-fill)] p-4 text-sm">
        <div className="font-semibold text-[var(--critical)]">Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.</div>
        <div className="mt-1 text-xs text-[var(--text-secondary)]">{this.state.error.message}</div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-3 rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--surface-raised)]"
        >
          Try again
        </button>
      </div>
    );
  }
}
