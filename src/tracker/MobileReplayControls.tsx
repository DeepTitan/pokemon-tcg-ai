import { CaretLeft } from '@phosphor-icons/react/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/CaretRight';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createFrameHoldController } from './frame-hold-controller.js';
import type { FrameNavigationRequest } from './frame-animation-model.js';

function FrameStepButton({ direction, disabled, onStep }: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onStep: () => void;
}) {
  const [speed, setSpeed] = useState(0);
  const step = useRef(onStep);
  step.current = onStep;
  const suppressClick = useRef(false);
  const pointer = useRef<number | null>(null);
  const hold = useMemo(() => createFrameHoldController({ onRepeat: (rate) => {
    suppressClick.current = true;
    setSpeed(rate);
    step.current();
  } }), []);
  const stop = () => { hold.stop(); pointer.current = null; setSpeed(0); };
  useEffect(() => {
    const cancel = () => { hold.stop(); pointer.current = null; setSpeed(0); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      hold.stop();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [hold]);
  useEffect(() => {
    if (disabled) { hold.stop(); pointer.current = null; setSpeed(0); }
  }, [disabled, hold]);
  const next = direction === 'next';
  return <button type="button" className={next ? 'mobile-next-frame' : undefined}
    disabled={disabled} aria-label={next ? 'Next frame' : 'Previous frame'}
    aria-describedby="frame-hold-hint" title="Tap for one frame; hold to move faster"
    data-holding={speed > 0 || undefined}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      hold.start();
    }}
    onPointerUp={(event) => { if (pointer.current === event.pointerId) stop(); }}
    onPointerCancel={() => { suppressClick.current = true; stop(); }}
    onLostPointerCapture={stop} onBlur={stop}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={() => { suppressClick.current = false; stop(); }}
    onClick={() => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      onStep();
    }}>
    {!next && <CaretLeft size={22} weight="bold" aria-hidden="true" />}
    <span>{next ? 'Next' : 'Previous'}</span>
    {next && <CaretRight size={22} weight="bold" aria-hidden="true" />}
    {speed > 0 && <small className="frame-hold-speed" aria-hidden="true">{speed}×</small>}
  </button>;
}

/** A frame can contain several log events. Both primary buttons always move
 * exactly one captured board state; jumping belongs in the separate navigator. */
export function MobileReplayControls({ index, last, title, detail, onNavigate, onDetails }: {
  index: number;
  last: number;
  title: string;
  detail: string;
  onNavigate: (request: FrameNavigationRequest) => void;
  onDetails: () => void;
}) {
  return <section className="mobile-replay-controls" aria-label="Replay controls">
    <button type="button" className="mobile-action-caption" onClick={onDetails} aria-label={`Action details: ${title}`}>
      <span><strong>{title}</strong><small>{detail || 'View this action in the game log'}</small></span>
      <CaretRight size={18} aria-hidden="true" />
    </button>
    <label className="mobile-replay-scrubber">
      <span className="sr-only">Replay position</span>
      <input type="range" min={0} max={last} value={index}
        aria-valuetext={`Frame ${index} of ${last}. ${title}`}
        onChange={(event) => onNavigate(Number(event.target.value))} />
    </label>
    <span className="sr-only" id="frame-hold-hint">Tap for one frame. Hold to move faster; release to stop.</span>
    <div className="mobile-frame-buttons">
      <FrameStepButton direction="previous" disabled={index === 0} onStep={() => onNavigate((current) => current - 1)} />
      <FrameStepButton direction="next" disabled={index >= last} onStep={() => onNavigate((current) => current + 1)} />
    </div>
  </section>;
}
