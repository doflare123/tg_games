import type { TetrisAction } from '../../../games/tetris/types.ts';
import { type GesturePoint, TetrisGestures } from './gestures.ts';
export interface GestureInput {
  update(time: number): void;
  reset(): void;
  dispose(): void;
}
export function mountTetrisGestures(
  canvas: HTMLCanvasElement,
  options: {
    enabled(): boolean;
    action(action: TetrisAction): void;
    softDrop(pressed: boolean): void;
  },
): GestureInput {
  const abort = new AbortController();
  const gestures = new TetrisGestures(options.action, options.softDrop);
  const point = (event: PointerEvent): GesturePoint => ({
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  });
  const reset = () => {
    const id = gestures.pointerId;
    gestures.cancel();
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (!options.enabled() || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (!gestures.begin(point(event), canvas.getBoundingClientRect().width / 10)) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
    },
    { signal: abort.signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerId !== gestures.pointerId) return;
      event.preventDefault();
      if (!options.enabled()) reset();
      else gestures.move(point(event));
    },
    { signal: abort.signal },
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerId !== gestures.pointerId) return;
      event.preventDefault();
      if (options.enabled()) gestures.end(point(event));
      else reset();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    },
    { signal: abort.signal },
  );
  for (const name of ['pointercancel', 'lostpointercapture'] as const)
    canvas.addEventListener(name, (event) => gestures.cancel(event.pointerId), {
      signal: abort.signal,
    });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault(), {
    signal: abort.signal,
  });
  return {
    update(time) {
      if (options.enabled()) gestures.update(time);
      else reset();
    },
    reset,
    dispose() {
      reset();
      abort.abort();
    },
  };
}
