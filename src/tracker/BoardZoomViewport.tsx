import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { Hand } from '@phosphor-icons/react';
import { boardPanPosition, boardZoomScroll, boardZoomShortcut, MAX_BOARD_ZOOM, MIN_BOARD_ZOOM, nextBoardZoom, type BoardPanStart } from './board-zoom.js';

export function BoardZoomViewport({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pan = useRef<(BoardPanStart & { pointerId: number; dragging: boolean }) | null>(null);
  const suppressClick = useRef(false);
  const [panning, setPanning] = useState(false);
  const canPan = zoom > 1;

  const finishPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useLayoutEffect(() => {
    const node = host.current!;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = boardZoomShortcut(event);
      if (!action || event.defaultPrevented) return;
      event.preventDefault();
      setZoom((current) => nextBoardZoom(current, action));
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  useLayoutEffect(() => {
    const node = viewport.current!;
    node.scrollLeft = boardZoomScroll(node.scrollLeft, size.width, previousZoom.current, zoom);
    node.scrollTop = boardZoomScroll(node.scrollTop, size.height, previousZoom.current, zoom);
    previousZoom.current = zoom;
  }, [zoom, size.width, size.height]);

  return <div className="board-zoom" ref={host}>
    <div className={`board-zoom-viewport ${canPan ? 'is-pannable' : ''} ${panning ? 'is-panning' : ''}`} ref={viewport} role="region" aria-label="Match board" tabIndex={0}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (!canPan || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
        pan.current = { pointerId: event.pointerId, dragging: false, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
      }}
      onPointerMove={(event) => {
        const start = pan.current;
        if (!start || start.pointerId !== event.pointerId) return;
        if (!canPan || !(event.buttons & 1)) { finishPan(event); return; }
        const node = event.currentTarget;
        const position = boardPanPosition(start, event.clientX, event.clientY, node.scrollWidth - node.clientWidth, node.scrollHeight - node.clientHeight, start.dragging);
        if (!position) return;
        if (!start.dragging) {
          start.dragging = true;
          suppressClick.current = true;
          setPanning(true);
          node.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        node.scrollLeft = position.left;
        node.scrollTop = position.top;
      }}
      onPointerUp={finishPan} onPointerCancel={finishPan} onLostPointerCapture={finishPan}
      onDragStart={(event) => { if (canPan) event.preventDefault(); }}
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}>
      <div className="board-zoom-canvas" style={{ width: Math.max(size.width, size.width * zoom), height: Math.max(size.height, size.height * zoom) }}>
        <div className="board-zoom-surface" style={{ width: size.width, height: size.height, left: Math.max(0, size.width * (1 - zoom) / 2), top: Math.max(0, size.height * (1 - zoom) / 2), transform: `scale(${zoom})` }}>
          {children}
        </div>
      </div>
    </div>
    <div className="board-zoom-controls" role="group" aria-label="Board zoom">
      {canPan && <span className="board-pan-hint"><Hand size={14} aria-hidden="true" />Drag to pan</span>}
      <button type="button" aria-label="Zoom board out" title="Zoom board out · Cmd/Ctrl −" disabled={zoom === MIN_BOARD_ZOOM} onClick={() => setZoom((value) => nextBoardZoom(value, 'out'))}>−</button>
      <button type="button" aria-label="Reset board zoom" title="Reset board zoom · Cmd/Ctrl 0" onClick={() => setZoom(1)}><output aria-live="polite">{Math.round(zoom * 100)}%</output></button>
      <button type="button" aria-label="Zoom board in" title="Zoom board in · Cmd/Ctrl +" disabled={zoom === MAX_BOARD_ZOOM} onClick={() => setZoom((value) => nextBoardZoom(value, 'in'))}>+</button>
    </div>
  </div>;
}
