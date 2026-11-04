import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { TelegramOrientation } from '../src/client/platform/telegram.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const origin = 'http://127.0.0.1:4178';
interface MockSensor {
  emit(beta: number | null, gamma: number | null): void;
  failNext: boolean;
  deferStart: boolean;
  completeStart(): void;
  starts: number;
  stops: number;
  listenerCount(): number;
}
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4178', '--strictPort'],
  { stdio: 'ignore', windowsHide: true },
);
const browser = await chromium.launch({ headless: true });
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Starting. */
    }
    if (i === 99) throw new Error('Vite failed to start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  const errors: string[] = [],
    rankedRequests: string[] = [];
  phone.on('pageerror', (error) => errors.push(error.message));
  phone.on('request', (request) => {
    if (/\/(createDoodleRun|submitDoodleReplay)$/.test(request.url()))
      rankedRequests.push(request.url());
  });
  await phone.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await phone.addInitScript(() => {
    const nativeRandom = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: ArrayBufferView<ArrayBuffer>) => {
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = 12;
          return array;
        }
        return nativeRandom(array);
      },
    });
    const listeners = new Map<string, Set<() => void>>();
    const notify = (event: string) => {
      for (const handler of listeners.get(event) ?? []) handler();
    };
    let deferredStart: (() => void) | null = null;
    const mock: MockSensor = {
      failNext: false,
      deferStart: false,
      completeStart() {
        deferredStart?.();
        deferredStart = null;
      },
      starts: 0,
      stops: 0,
      emit(beta, gamma) {
        device.beta = beta === null ? null : (beta * Math.PI) / 180;
        device.gamma = gamma === null ? null : (gamma * Math.PI) / 180;
        notify('deviceOrientationChanged');
      },
      listenerCount() {
        return [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
      },
    };
    const device: TelegramOrientation = {
      isStarted: false,
      beta: null,
      gamma: null,
      start(params, callback) {
        mock.starts++;
        if (params.refresh_rate !== 40 || params.need_absolute !== false)
          throw new Error('Unexpected sensor parameters');
        if (mock.failNext) {
          callback(false);
          return;
        }
        const complete = () => {
          device.isStarted = true;
          callback(true);
          queueMicrotask(() => {
            if (device.isStarted) mock.emit(35, 0);
          });
        };
        if (mock.deferStart) deferredStart = complete;
        else complete();
      },
      stop() {
        mock.stops++;
        device.isStarted = false;
        notify('deviceOrientationStopped');
      },
    };
    Reflect.set(window, '__doodleSensor', mock);
    Reflect.set(window, 'Telegram', {
      WebApp: {
        initData: '',
        initDataUnsafe: {},
        DeviceOrientation: device,
        onEvent(event: string, handler: () => void) {
          const handlers = listeners.get(event) ?? new Set<() => void>();
          handlers.add(handler);
          listeners.set(event, handlers);
        },
        offEvent(event: string, handler: () => void) {
          listeners.get(event)?.delete(handler);
        },
      },
    });
  });
  await phone.goto(`${origin}/?startapp=game_doodle`);
  await phone.getByLabel('Тип партии Doodle Jump').selectOption('free');
  assert.equal(
    await phone.evaluate(() => (Reflect.get(window, '__doodleSensor') as MockSensor).starts),
    0,
  );
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Наклоны включены');
  await phone.getByRole('button', { name: 'Начать', exact: true }).tap();
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'playing');
  const pump = async () => {
    await phone.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  };
  await phone.evaluate(() => {
    const sensor = Reflect.get(window, '__doodleSensor') as MockSensor;
    for (let i = 0; i < 8; i++) sensor.emit(35, 20);
  });
  await pump();
  await phone.keyboard.down('ArrowLeft');
  await pump();
  await phone.keyboard.up('ArrowLeft');
  await phone.evaluate(() => {
    const sensor = Reflect.get(window, '__doodleSensor') as MockSensor;
    for (let i = 0; i < 8; i++) sensor.emit(35, -20);
  });
  await pump();
  // Keep emitting so the stale-data guard correctly permits held tilt input.
  const samples = setInterval(() => {
    void phone
      .evaluate(() => {
        (Reflect.get(window, '__doodleSensor') as MockSensor).emit(35, 20);
      })
      .catch(() => {});
  }, 40);
  try {
    await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'over', {
      timeout: 45000,
    });
    await expect(phone.locator('.doodle-message')).toContainText('Высота:', {
      timeout: 15000,
    });
  } finally {
    clearInterval(samples);
  }
  assert.deepEqual(rankedRequests, []);
  assert.equal(
    await phone.evaluate(() =>
      (Reflect.get(window, '__doodleSensor') as MockSensor).listenerCount(),
    ),
    0,
  );
  assert.equal(
    await phone.evaluate(() => (Reflect.get(window, '__doodleSensor') as MockSensor).stops),
    1,
  );
  await phone.getByRole('button', { name: 'Выключить наклоны', exact: true }).tap();
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Наклоны включены');
  await phone.getByRole('button', { name: 'Настроить центр', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Центр установлен');
  await phone.getByRole('button', { name: '← Назад', exact: true }).tap();
  assert.equal(
    await phone.evaluate(() =>
      (Reflect.get(window, '__doodleSensor') as MockSensor).listenerCount(),
    ),
    0,
  );
  assert.equal(
    await phone.evaluate(() => (Reflect.get(window, '__doodleSensor') as MockSensor).stops),
    2,
  );
  await phone.goto(`${origin}/?startapp=game_doodle`);
  await phone.getByLabel('Тип партии Doodle Jump').selectOption('free');
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'ready');
  await phone.evaluate(() => {
    (Reflect.get(window, '__doodleSensor') as MockSensor).failNext = true;
  });
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Датчик недоступен');
  assert.equal(
    await phone.evaluate(() =>
      (Reflect.get(window, '__doodleSensor') as MockSensor).listenerCount(),
    ),
    0,
  );
  await phone.evaluate(() => {
    Object.defineProperty(window.DeviceOrientationEvent, 'requestPermission', {
      configurable: true,
      value: () => Promise.resolve('denied'),
    });
  });
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Датчик недоступен');
  await expect(
    phone.getByRole('button', { name: 'Включить наклоны', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await phone.evaluate(() => {
    Object.defineProperty(window.DeviceOrientationEvent, 'requestPermission', {
      configurable: true,
      value: () => Promise.resolve('granted'),
    });
  });
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await phone.evaluate(() => {
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientation', { beta: null, gamma: null }),
    );
  });
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Держи телефон');
  await phone.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: 35, gamma: 0 }));
  });
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Наклоны включены');
  await phone.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Положение экрана изменилось');
  await phone.getByRole('button', { name: 'Выключить наклоны', exact: true }).tap();
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Держи телефон');
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Датчик недоступен', {
    timeout: 5000,
  });
  await expect(phone.getByLabel('Тип партии Doodle Jump')).toHaveValue('free');
  await phone.getByRole('button', { name: 'Начать', exact: true }).tap();
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'playing');
  await phone.getByRole('button', { name: 'Пауза', exact: true }).tap();
  await phone.goto(`${origin}/?startapp=game_doodle`);
  await phone.getByLabel('Тип партии Doodle Jump').selectOption('free');
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'ready');
  await phone.evaluate(() => {
    (Reflect.get(window, '__doodleSensor') as MockSensor).deferStart = true;
  });
  await phone.getByRole('button', { name: 'Включить наклоны', exact: true }).tap();
  await expect(phone.locator('.doodle-tilt-status')).toContainText('Держи телефон');
  await phone.getByRole('button', { name: '← Назад', exact: true }).tap();
  await phone.evaluate(() => {
    (Reflect.get(window, '__doodleSensor') as MockSensor).completeStart();
  });
  assert.equal(
    await phone.evaluate(() => window.Telegram?.WebApp?.DeviceOrientation?.isStarted),
    false,
  );
  assert.equal(
    await phone.evaluate(() =>
      (Reflect.get(window, '__doodleSensor') as MockSensor).listenerCount(),
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Doodle tilt: simulated Telegram radians and browser permissions, free-only play, keyboard override, calibration, rotation, null data, timeout, denial fallback and sensor cleanup passed. Physical phone sensors require device testing.',
  );
  await context.close();
} finally {
  await browser.close();
  server.kill();
}
