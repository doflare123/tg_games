import { telegram } from '../../platform/telegram.ts';
import { screenTilt, TiltInput } from './tilt-input.ts';

export interface TiltStatus {
  phase: 'off' | 'starting' | 'on' | 'suspended' | 'unavailable';
  message: string;
}

export function createDoodleTilt(changed: (status: TiltStatus) => void) {
  const input = new TiltInput();
  let wanted = false,
    running = false,
    disposed = false,
    preferBrowser = false;
  let generation = 0;
  let status: TiltStatus = {
    phase: 'off',
    message: 'На телефоне можно включить управление наклонами.',
  };
  let pending: Promise<boolean> | null = null;
  let settle: ((started: boolean) => void) | null = null;
  let nativeLease: { owned: boolean } | null = null;
  const cleanups: Array<() => void> = [];
  function update(phase: TiltStatus['phase'], message: string) {
    status = { phase, message };
    if (!disposed) changed(status);
  }
  function release() {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        /* A stopped sensor must not interrupt game cleanup. */
      }
    }
    running = false;
    input.reset();
  }
  function stop() {
    generation++;
    settle?.(false);
    settle = null;
    pending = null;
    release();
  }
  function angle(): number {
    const value: unknown =
      window.screen.orientation?.angle ?? Reflect.get(window, 'orientation') ?? 0;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  function start(): Promise<boolean> {
    if (disposed || !wanted) return Promise.resolve(false);
    if (running) return Promise.resolve(true);
    if (pending) return pending;
    const token = ++generation;
    update('starting', 'Держи телефон удобно и разреши доступ к датчику…');
    pending = new Promise<boolean>((resolve) => {
      let timer = 0;
      let sampled = false;
      const active = () => !disposed && wanted && generation === token;
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        settle = null;
        resolve(ok);
      };
      settle = finish;
      const fail = () => {
        if (!active()) return;
        wanted = false;
        release();
        update(
          'unavailable',
          'Датчик недоступен. Можно повторить или играть касаниями и кнопками.',
        );
        finish(false);
      };
      const timeout = (ms: number) => {
        clearTimeout(timer);
        timer = window.setTimeout(fail, ms);
      };
      cleanups.push(() => clearTimeout(timer));
      const sample = (beta: unknown, gamma: unknown) => {
        if (!active()) return;
        const value = screenTilt(beta, gamma, angle());
        if (value === null) return;
        input.sample(value, performance.now());
        if (!sampled) {
          sampled = true;
          running = true;
          update('on', 'Наклоны включены. Наклоняй телефон влево и вправо; кнопки тоже работают.');
          finish(true);
        }
      };
      const rotate = () => {
        input.reset();
        if (running)
          update('on', 'Положение экрана изменилось. Держи телефон удобно — калибруем центр.');
      };
      window.addEventListener('orientationchange', rotate);
      window.screen.orientation?.addEventListener('change', rotate);
      cleanups.push(() => {
        window.removeEventListener('orientationchange', rotate);
        window.screen.orientation?.removeEventListener('change', rotate);
      });
      const native = telegram?.DeviceOrientation;
      if (!preferBrowser && native && telegram?.onEvent && telegram.offEvent) {
        const read = () => {
          const beta: unknown = native.beta,
            gamma: unknown = native.gamma;
          if (typeof beta !== 'number' || typeof gamma !== 'number') return;
          sample((beta * 180) / Math.PI, (gamma * 180) / Math.PI);
        };
        const failed = () => {
          preferBrowser = true;
          fail();
        };
        telegram.onEvent('deviceOrientationChanged', read);
        telegram.onEvent('deviceOrientationFailed', failed);
        telegram.onEvent('deviceOrientationStopped', failed);
        const lease = { owned: !native.isStarted };
        nativeLease = lease;
        cleanups.push(() => {
          telegram?.offEvent?.('deviceOrientationChanged', read);
          telegram?.offEvent?.('deviceOrientationFailed', failed);
          telegram?.offEvent?.('deviceOrientationStopped', failed);
          if (nativeLease === lease) nativeLease = null;
          if (lease.owned) native.stop();
        });
        timeout(12000);
        try {
          native.start({ refresh_rate: 40, need_absolute: false }, (ok) => {
            if (!active()) {
              // Native startup may finish after closing the game. Stop that late
              // sensor, or transfer ownership to the new session already using it.
              if (lease.owned && native.isStarted) {
                if (nativeLease) nativeLease.owned = true;
                else native.stop();
              }
              return;
            }
            if (sampled) return;
            if (ok !== true) failed();
            else timeout(3000);
          });
        } catch {
          failed();
        }
        return;
      }
      const Orientation = window.DeviceOrientationEvent as
        | (typeof DeviceOrientationEvent & {
            requestPermission?: () => Promise<string>;
          })
        | undefined;
      if (!window.isSecureContext || !Orientation) {
        fail();
        return;
      }
      const listen = () => {
        if (!active()) return;
        const read = (event: DeviceOrientationEvent) => sample(event.beta, event.gamma);
        window.addEventListener('deviceorientation', read);
        cleanups.push(() => window.removeEventListener('deviceorientation', read));
        timeout(3000);
      };
      // Invoke permission synchronously from the player's click, before any await.
      try {
        if (typeof Orientation.requestPermission === 'function') {
          timeout(30000);
          void Orientation.requestPermission()
            .then((permission) => {
              if (permission === 'granted') listen();
              else fail();
            })
            .catch(fail);
        } else listen();
      } catch {
        fail();
      }
    });
    const result = pending;
    void result.finally(() => {
      if (generation === token) pending = null;
    });
    return result;
  }
  return {
    get wanted() {
      return wanted;
    },
    get status() {
      return status;
    },
    direction: () => (running ? input.direction(performance.now()) : 0),
    enable() {
      wanted = true;
      return start();
    },
    resume: start,
    calibrate() {
      input.calibrate();
      if (running) update('on', 'Центр установлен. Наклоняй телефон влево и вправо.');
    },
    suspend() {
      stop();
      if (wanted)
        update(
          'suspended',
          'Наклоны возобновятся вместе с игрой; положение центра настроится заново.',
        );
    },
    disable() {
      wanted = false;
      stop();
      update('off', 'Наклоны выключены. Касания, кнопки и клавиатура работают.');
    },
    dispose() {
      disposed = true;
      wanted = false;
      stop();
    },
  };
}
