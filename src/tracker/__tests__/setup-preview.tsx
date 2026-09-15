import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureSetupView } from '../CaptureSetupModal.js';
import { initialSetup } from '../setup-flow.js';
import '../tracker.css';
function Preview() {
  const [ready, setReady] = useState(false);
  return <><div style={{ position: 'fixed', top: 16, left: 0, right: 0, zIndex: 30, textAlign: 'center', fontSize: 12 }}>Design preview · No capture is enabled · Click through both stages</div><CaptureSetupView
    state={ready ? { phase: 'ready', message: 'Open Pokémon TCG Live. Your next match will appear automatically.' } : initialSetup}
    onAction={() => setReady(true)} onClose={() => setReady(false)}
  /></>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
