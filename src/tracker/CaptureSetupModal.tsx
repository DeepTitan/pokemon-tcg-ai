import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CardsThree, CircleNotch, Lightning, Sword } from '@phosphor-icons/react';
import { replayShortcut, replayShortcutFrame } from './replay-shortcuts.js';
import type { KeyMoment } from './key-moment-navigation.js';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getTrackerEnvironment, isTauri, requestCapturePermission, startTracking } from './tauri.js';
import type { CaptureStatus } from './types.js';
import { createSetupFlow, initialSetup, setupBusy, setupLabel, type SetupState } from './setup-flow.js';

const FRAMES = [
  { label: 'Draw a card', Icon: CardsThree }, { label: 'Play a Pokémon', Icon: CardsThree },
  { label: 'Attach Energy', Icon: Lightning }, { label: 'Attack', Icon: Sword },
  { label: 'Draw a card', Icon: CardsThree }, { label: 'Attach Energy', Icon: Lightning },
  { label: 'Next attack', Icon: Sword },
];
const MOMENTS: KeyMoment[] = [{ reviewIndex: 3, reasons: ['attack'] }, { reviewIndex: 6, reasons: ['attack'] }];
const TOUR = [{ frame: 1, key: 'd' }, { frame: 2, key: 'd' }, { frame: 3, key: 's' }, { frame: 6, key: 's' }];

function KeyboardGuide() {
  const [frame, setFrame] = useState(0);
  const [pressed, setPressed] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [automatic, setAutomatic] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const releaseKey = useRef<ReturnType<typeof setTimeout>>();
  const current = FRAMES[frame];

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (preference.matches) setAutomatic(false); };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (!automatic) return;
    // A short, finite demonstration: no looping or extra playback controls.
    const timers = TOUR.map((step, index) => window.setTimeout(() => {
      setFrame(step.frame); setPressed(step.key);
      clearTimeout(releaseKey.current);
      releaseKey.current = setTimeout(() => setPressed(''), 350);
    }, (index + 1) * 1050));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [automatic]);
  useEffect(() => () => clearTimeout(releaseKey.current), []);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const action = replayShortcut(event);
      if (!action || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault(); setAutomatic(false);
      const key = ({ arrowleft: 'a', arrowright: 'd', arrowup: 'w', arrowdown: 's' } as Record<string, string>)[event.key.toLowerCase()] || event.key.toLowerCase();
      setPressed(key);
      clearTimeout(releaseKey.current);
      releaseKey.current = setTimeout(() => setPressed(''), 350);
      const next = replayShortcutFrame(action, frame, FRAMES.length, MOMENTS);
      setFrame(next); setAnnouncement(`Frame ${next + 1}: ${FRAMES[next].label}`);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });

  const key = (letter: string, content: ReactNode) => <kbd className={pressed === letter ? 'is-pressed' : ''}>{content}</kbd>;
  return <section className="connect-keyboard-guide" aria-label="Replay keyboard shortcuts">
    <div className="connect-replay-preview" aria-label="Example replay">
      <div className="connect-replay-event" key={frame}><current.Icon size={21} weight="duotone" /><strong>{current.label}</strong></div>
      <span>Frame {frame + 1} / {FRAMES.length}</span>
      <div className="connect-frame-track" aria-hidden="true">{FRAMES.map((_, index) => <i key={index} className={`${index === frame ? 'is-current' : ''} ${index === 3 || index === 6 ? 'is-attack' : ''}`} />)}</div>
    </div>
    <div className="connect-shortcuts">
      <div><span className="connect-keys" aria-label="A and D, or Left and Right arrow keys">{key('a', 'A')}{key('d', 'D')}<small>or</small>{key('a', <ArrowLeft size={13} />)}{key('d', <ArrowRight size={13} />)}</span><span>Move frame by frame</span></div>
      <div><span className="connect-keys" aria-label="W and S, or Up and Down arrow keys">{key('w', 'W')}{key('s', 'S')}<small>or</small>{key('w', <ArrowUp size={13} />)}{key('s', <ArrowDown size={13} />)}</span><span>Jump to attacks & key moments</span></div>
    </div>
    <span className="sr-only">Left or A goes back one frame; Right or D advances one frame. Up or W goes to the previous key moment; Down or S goes to the next. Key moments include attacks, damage, knockouts, Prize cards, and game over.</span>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}

export function CaptureSetupModal({ onClose, onCapture }: { onClose: () => void; onCapture: (capture: CaptureStatus) => void }) {
  const [state, setState] = useState(initialSetup);
  const flow = useRef<ReturnType<typeof createSetupFlow>>();
  const captureCallback = useRef(onCapture);
  captureCallback.current = onCapture;
  useEffect(() => {
    const controller = createSetupFlow({
      environment: getTrackerEnvironment,
      check: async () => {
        if (!isTauri()) throw new Error('Open the installed Trace app to set up capture.');
        const update = await check({ timeout: 15_000 });
        return update && {
          download: () => update.download(undefined, { timeout: 10 * 60 * 1000 }),
          install: () => update.install(), close: () => update.close(),
        };
      },
      permission: requestCapturePermission, start: startTracking, restart: relaunch,
      capture: capture => captureCallback.current(capture),
    }, setState);
    flow.current = controller;
    return () => controller.dispose();
  }, []);
  return <CaptureSetupView state={state} onClose={onClose} onAction={() => void flow.current?.run()} />;
}

export function CaptureSetupView({ state, onClose, onAction }: { state: SetupState; onClose: () => void; onAction: () => void }) {
  const busy = setupBusy(state.phase);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="modal-backdrop capture-onboarding-backdrop"><section ref={dialog} className="setup-modal capture-onboarding" role="dialog" aria-modal="true" aria-labelledby="capture-setup-title" aria-describedby="capture-setup-description" tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (state.phase === 'ready') onClose(); }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || []);
    const first = buttons[0]; const last = buttons.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="capture-onboarding-header"><img src="/tracker-assets/trace-mascot.png" alt="" /><div><span>Your Trace</span><h2 id="capture-setup-title">{state.phase === 'ready' ? 'Trace is ready' : 'Set up Trace'}</h2></div></header>
    <p id="capture-setup-description" className="capture-onboarding-intro" role={state.phase === 'failed' ? 'alert' : 'status'} aria-live="polite">{state.message}</p>
    {state.phase === 'ready' ? <><h3 className="setup-demo-heading">How to review your games</h3><KeyboardGuide /></> : <p className="capture-privacy-disclosure">By connecting, Trace securely sends and stores captured match data, including player names and game actions.</p>}
    <div className="connect-actions setup-single-action"><button className="primary connect-capture-button" type="button" disabled={busy} onClick={state.phase === 'ready' ? onClose : onAction}>{busy && <CircleNotch size={16} className="capture-connect-spinner" />}{setupLabel(state.phase)}</button></div>
  </section></div>;
}
