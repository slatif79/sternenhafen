import { Component, type ReactNode } from 'react';

/** Fängt unerwartete Fehler ab, damit nie nur eine leere Seite bleibt. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Sternenhafen-Fehler', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="setup">
        <div className="setup-card">
          <h1>🛰️ Funkstörung</h1>
          <p className="muted">Da ist leider etwas schiefgelaufen. Das Spiel muss neu gestartet werden.</p>
          <p className="small muted"><code>{this.state.error.message}</code></p>
          <button className="primary wide" onClick={() => location.reload()}>Neu starten</button>
        </div>
      </div>
    );
  }
}
