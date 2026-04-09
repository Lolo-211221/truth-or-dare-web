import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card-panel" style={{ margin: '2rem auto', maxWidth: '28rem' }}>
          <h1 style={{ marginTop: 0 }}>Something went wrong</h1>
          <p className="error">{this.state.error.message}</p>
          <p className="muted">Try refreshing the page or going back home.</p>
          <p style={{ marginTop: '1.25rem' }}>
            <a href="/">Home</a>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
