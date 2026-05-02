import * as React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.assign("/dashboard");
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-6">
        <div className="max-w-xl w-full text-center">
          <p className="text-eyebrow tracking-[0.18em] text-ink-muted mb-6">
            Something went wrong
          </p>
          <h1 className="text-display text-ink mb-4">
            We hit an unexpected snag.
          </h1>
          <p className="font-body text-ink-soft mb-10">
            The page crashed before it could render. Your in-progress work has
            been saved where possible. Reload to try again, or head back to the
            dashboard.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="text-left text-xs text-ink-muted bg-canvas-elevated border border-rule-strong rounded-[2px] p-4 mb-8 whitespace-pre-wrap break-words max-h-48 overflow-auto">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
            </pre>
          )}
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={this.handleReload}
              className="text-eyebrow tracking-[0.18em] text-ink underline-offset-4 hover:underline"
            >
              RELOAD
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="text-eyebrow tracking-[0.18em] text-ink-soft underline-offset-4 hover:underline"
            >
              GO TO DASHBOARD →
            </button>
          </div>
        </div>
      </div>
    );
  }
}
