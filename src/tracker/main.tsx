import React from 'react';
import ReactDOM from 'react-dom/client';
import TrackerApp from './TrackerApp.js';

interface FatalBoundaryState { error: Error | null }

class FatalBoundary extends React.Component<React.PropsWithChildren, FatalBoundaryState> {
  state: FatalBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): FatalBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('Trace render failure', error);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return <FatalScreen error={this.state.error} />;
  }
}

function FatalScreen({ error }: { error: Error }): React.ReactElement {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui', color: '#3d4650' }}>
      <h1>Trace could not finish loading</h1>
      <p>Your raw match capture is safe. Restart Trace to retry.</p>
      <pre style={{ padding: 16, overflow: 'auto', borderRadius: 8, background: '#fff' }}>{error.stack || error.message}</pre>
    </main>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><FatalBoundary><TrackerApp /></FatalBoundary></React.StrictMode>);
