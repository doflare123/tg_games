import { element } from '../../ui/dom.ts';
export function mountFourLineEffect(board: HTMLElement): {
  play(): void;
  reset(): void;
  dispose(): void;
} {
  const layer = element('div', 'tetris-clear-effect');
  layer.hidden = true;
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  layer.setAttribute('aria-atomic', 'true');
  const flash = element('div', 'tetris-clear-flash');
  flash.setAttribute('aria-hidden', 'true');
  const toast = element('div', 'tetris-clear-toast');
  const badge = element('div', 'tetris-clear-badge');
  badge.append(element('strong', '', 'ТЕТРИС!'), element('span', '', '+4 ЛИНИИ'));
  toast.append(badge);
  layer.append(flash, toast);
  board.append(layer);
  let animations: Animation[] = [];
  let generation = 0;
  const reset = () => {
    generation++;
    for (const animation of animations) animation.cancel();
    animations = [];
    layer.hidden = true;
  };
  return {
    play() {
      reset();
      const current = generation;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      layer.classList.toggle('reduced-motion', reduced);
      layer.hidden = false;
      if (!reduced)
        animations.push(
          flash.animate([{ opacity: 0 }, { opacity: 0.2, offset: 0.12 }, { opacity: 0 }], {
            duration: 360,
            easing: 'ease-out',
          }),
        );
      const notice = badge.animate(
        reduced
          ? [
              { opacity: 0 },
              { opacity: 1, offset: 0.12 },
              { opacity: 1, offset: 0.8 },
              { opacity: 0 },
            ]
          : [
              { opacity: 0, transform: 'translateY(10px) scale(0.85)' },
              { opacity: 1, transform: 'translateY(0) scale(1.04)', offset: 0.18 },
              { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.65 },
              { opacity: 0, transform: 'translateY(-10px) scale(0.98)' },
            ],
        { duration: reduced ? 600 : 850, easing: 'ease-out' },
      );
      animations.push(notice);
      notice.onfinish = () => {
        if (generation === current) {
          layer.hidden = true;
          animations = [];
        }
      };
    },
    reset,
    dispose() {
      reset();
      layer.remove();
    },
  };
}
