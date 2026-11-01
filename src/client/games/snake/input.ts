import type { SnakeDirection } from '../../../games/snake/engine.ts';

export function directionFromVector(x: number, y: number): SnakeDirection | null {
  if (Math.hypot(x, y) < 12) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
}
export function snakeInput(
  board: HTMLElement,
  turn: (direction: SnakeDirection) => void,
  pause: () => void,
): () => void {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const keys: Record<string, SnakeDirection> = {
    ArrowUp: 'up',
    ArrowRight: 'right',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    KeyW: 'up',
    KeyD: 'right',
    KeyS: 'down',
    KeyA: 'left',
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)
      )
        return;
      const direction = keys[e.code];
      if (direction) {
        e.preventDefault();
        if (!e.repeat) turn(direction);
      } else if ((e.code === 'Space' || e.code === 'Escape') && !e.repeat) {
        e.preventDefault();
        pause();
      }
    },
    options,
  );
  let swipe: { id: number; x: number; y: number } | null = null;
  board.addEventListener(
    'pointerdown',
    (e) => {
      if (swipe) return;
      board.setPointerCapture(e.pointerId);
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    options,
  );
  board.addEventListener(
    'pointermove',
    (e) => {
      if (swipe?.id !== e.pointerId) return;
      const direction = directionFromVector(e.clientX - swipe.x, e.clientY - swipe.y);
      if (direction) {
        turn(direction);
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    },
    options,
  );
  const releaseSwipe = (e: PointerEvent) => {
    if (swipe?.id === e.pointerId) swipe = null;
  };
  board.addEventListener('pointerup', releaseSwipe, options);
  board.addEventListener('pointercancel', releaseSwipe, options);
  return () => listeners.abort();
}
