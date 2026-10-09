import { useEffect, useRef, type RefObject } from 'react';

/** Keep keyboard focus in the active sheet, then return it to its opener. */
export function useReplayDialogFocus(active: boolean, container: RefObject<HTMLElement>, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = container.current;
    if (!node) return;
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select, [tabindex="0"]'))
      .filter((element) => element.getClientRects().length > 0);
    (focusable()[0] || node).focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); dismiss.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); node.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [active, container]);
}
