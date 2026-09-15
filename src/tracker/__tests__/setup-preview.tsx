import React from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureSetupModal } from '../CaptureSetupModal.js';
import '../tracker.css';
createRoot(document.getElementById('root')!).render(<CaptureSetupModal onClose={() => {}} onCapture={() => {}} />);
