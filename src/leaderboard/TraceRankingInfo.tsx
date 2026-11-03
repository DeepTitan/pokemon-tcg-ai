import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from '@phosphor-icons/react';

/** Hover on desktop, focus with a keyboard, or tap on touch screens. */
export default function TraceRankingInfo() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelClose = () => clearTimeout(closeTimer.current);
  const show = () => {
    cancelClose();
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.right - 300, window.innerWidth - 312)) });
    setOpen(true);
  };
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const height = tooltip.current.getBoundingClientRect().height;
    if (anchor.bottom + 8 + height > window.innerHeight - 12) {
      setPosition(previous => ({ ...previous, top: Math.max(12, anchor.top - height - 8) }));
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  return <>
    <button type="button" ref={trigger} className="trace-ranking-info" aria-label="About Trace rankings"
      aria-describedby={open ? 'trace-ranking-explanation' : undefined}
      onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={show} onBlur={scheduleClose} onClick={show}>
      <Info size={17} aria-hidden="true"/>
    </button>
    {open && createPortal(<span ref={tooltip} id="trace-ranking-explanation" role="tooltip" className="trace-ranking-explanation"
      style={position} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      Trace keeps your rating across Live ladder resets using a modified Elo system. Only recorded ranked matches in Arceus with both players’ Live ratings count.
    </span>, document.body)}
  </>;
}
