import type { MineAction } from '../../../games/minesweeper/engine.ts';

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;
export function mountMineInput(
  grid: HTMLElement,
  options: { enabled(): boolean; action(cell: number, action: MineAction): void },
): { reset(): void; dispose(): void } {
  const abort = new AbortController();
  const listener = { signal: abort.signal };
  let active: {
    id: number;
    cell: number;
    node: HTMLButtonElement;
    x: number;
    y: number;
    held: boolean;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTouch = -Infinity;
  function reset(): void {
    clearTimeout(timer);
    timer = undefined;
    active = null;
  }
  function target(event: Event): { node: HTMLButtonElement; cell: number } | null {
    const node =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('.mine-cell')
        : null;
    if (!node || !grid.contains(node) || node.disabled) return null;
    const cell = Number(node.dataset.cell);
    return Number.isInteger(cell) && cell >= 0 && cell < 480 ? { node, cell } : null;
  }
  grid.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse') {
        lastTouch = -Infinity;
        return;
      }
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      lastTouch = performance.now();
      if (active || !event.isPrimary) {
        reset();
        return;
      }
      const hit = target(event);
      if (!options.enabled() || !hit) return;
      active = { ...hit, id: event.pointerId, x: event.clientX, y: event.clientY, held: false };
      timer = setTimeout(() => {
        if (!active || !options.enabled()) {
          reset();
          return;
        }
        active.held = true;
        options.action(active.cell, 'flag');
      }, HOLD_MS);
    },
    listener,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (active && active.id !== event.pointerId) reset();
    },
    listener,
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (active?.id !== event.pointerId) return;
      lastTouch = performance.now();
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > MOVE_TOLERANCE) reset();
    },
    listener,
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen')
        lastTouch = performance.now();
      if (active?.id !== event.pointerId) return;
      lastTouch = performance.now();
      const touch = active;
      reset();
      const bounds = touch.node.getBoundingClientRect();
      if (
        !touch.held &&
        options.enabled() &&
        !touch.node.disabled &&
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      )
        options.action(touch.cell, 'reveal');
    },
    listener,
  );
  for (const name of ['pointercancel', 'lostpointercapture'] as const)
    document.addEventListener(
      name,
      (event) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen')
          lastTouch = performance.now();
        if (active?.id === event.pointerId) {
          lastTouch = performance.now();
          reset();
        }
      },
      listener,
    );
  // Touch actions are dispatched above; ignore the browser's compatibility click/menu.
  grid.addEventListener(
    'click',
    (event) => {
      if (
        (event instanceof PointerEvent && ['touch', 'pen'].includes(event.pointerType)) ||
        (event.detail > 0 && performance.now() - lastTouch < 1000)
      ) {
        event.preventDefault();
        return;
      }
      const hit = target(event);
      if (event.button === 0 && options.enabled() && hit) options.action(hit.cell, 'reveal');
    },
    listener,
  );
  grid.addEventListener(
    'contextmenu',
    (event) => {
      event.preventDefault();
      if (
        (event instanceof PointerEvent && ['touch', 'pen'].includes(event.pointerType)) ||
        performance.now() - lastTouch < 1000
      )
        return;
      const hit = target(event);
      if (options.enabled() && hit) options.action(hit.cell, 'flag');
    },
    listener,
  );
  window.addEventListener('blur', reset, listener);
  document.addEventListener('visibilitychange', reset, listener);
  document.addEventListener('scroll', reset, { ...listener, capture: true });
  return {
    reset,
    dispose() {
      reset();
      abort.abort();
    },
  };
}
