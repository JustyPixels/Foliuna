import { useRef, type PointerEvent } from 'react';
export function swipeDirection(x: number, y: number, elapsed: number): 'previous' | 'next' | null {
  return elapsed <= 800 && Math.abs(x) >= 65 && Math.abs(x) > Math.abs(y) * 1.5 ? x < 0 ? 'next' : 'previous' : null;
}
export function useSwipe(previous?: () => void, next?: () => void, enabled = true) {
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || event.pointerType !== 'touch' || !event.isPrimary || (event.target as HTMLElement).closest('button,input,select')) { start.current = null; return; }
      start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const first = start.current; start.current = null;
      if (!first || !enabled) return;
      const direction = swipeDirection(event.clientX - first.x, event.clientY - first.y, event.timeStamp - first.time);
      if (direction === 'previous') previous?.(); else if (direction === 'next') next?.();
    },
    onPointerCancel() { start.current = null; },
  };
}
