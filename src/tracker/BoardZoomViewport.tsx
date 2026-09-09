import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { boardZoomScroll, boardZoomShortcut, MAX_BOARD_ZOOM, MIN_BOARD_ZOOM, nextBoardZoom } from './board-zoom.js';

export function BoardZoomViewport({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
    <div className="board-zoom-viewport" ref={viewport} role="region" aria-label="Match board" tabIndex={0}>
      <div className="board-zoom-canvas" style={{ width: Math.max(size.width, size.width * zoom), height: Math.max(size.height, size.height * zoom) }}>
        <div className="board-zoom-surface" style={{ width: size.width, height: size.height, left: Math.max(0, size.width * (1 - zoom) / 2), top: Math.max(0, size.height * (1 - zoom) / 2), transform: `scale(${zoom})` }}>
          {children}
        </div>
      </div>
    </div>
    <div className="board-zoom-controls" role="group" aria-label="Board zoom">
      <button type="button" aria-label="Zoom board out" title="Zoom board out · Cmd/Ctrl −" disabled={zoom === MIN_BOARD_ZOOM} onClick={() => setZoom((value) => nextBoardZoom(value, 'out'))}>−</button>
      <button type="button" aria-label="Reset board zoom" title="Reset board zoom · Cmd/Ctrl 0" onClick={() => setZoom(1)}><output aria-live="polite">{Math.round(zoom * 100)}%</output></button>
      <button type="button" aria-label="Zoom board in" title="Zoom board in · Cmd/Ctrl +" disabled={zoom === MAX_BOARD_ZOOM} onClick={() => setZoom((value) => nextBoardZoom(value, 'in'))}>+</button>
    </div>
  </div>;
}
