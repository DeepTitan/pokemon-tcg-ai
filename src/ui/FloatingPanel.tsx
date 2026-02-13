import { useState, useRef, useCallback, useEffect } from 'react';

export interface FloatingPanelProps {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
  className?: string;
}

/**
 * A draggable floating panel. Drag by the title bar to move.
 */
export function FloatingPanel({
  title,
  children,
  onClose,
  defaultPosition = { x: 80, y: 80 },
  defaultSize = { width: 420, height: 380 },
  minWidth = 280,
  minHeight = 200,
  className = '',
}: FloatingPanelProps) {
  const [position, setPosition] = useState(defaultPosition);
  const [size] = useState(defaultSize);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: position.x,
      startTop: position.y,
    };
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    setPosition({
      x: dragRef.current.startLeft + (e.clientX - dragRef.current.startX),
      y: Math.max(0, dragRef.current.startTop + (e.clientY - dragRef.current.startY)),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div
      className={`absolute rounded-xl border border-gray-600 bg-gray-900 shadow-2xl flex flex-col overflow-hidden z-50 ${className}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        minWidth,
        minHeight,
      }}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing bg-gray-800 border-b border-gray-700 select-none"
        onMouseDown={handleMouseDown}
      >
        <span className="text-xs font-bold text-amber-400 truncate">{title}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 ml-2 w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
