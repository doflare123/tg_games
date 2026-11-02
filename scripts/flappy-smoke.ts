import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FlappyReplay } from '../src/shared/flappy.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const production = process.argv.includes('--production');
const origin = 'http://127.0.0.1:4176';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(production ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    '4176',
    '--strictPort',
  ],
  { stdio: 'ignore', windowsHide: true },
);
const browser = await chromium.launch({ headless: true });
await mkdir('.cache/screenshots', { recursive: true });
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Vite is starting. */
    }
    if (i === 99) throw Error('Vite failed to start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const tracked: HTMLAudioElement[] = [];
    Object.defineProperty(window, '__flappyAudio', { value: tracked });
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        tracked.push(this);
      }
    };
  });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  const errors: string[] = [];
  const replays: FlappyReplay[] = [];
  let createdRuns = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (req.url().endsWith('/createFlappyRun')) createdRuns++;
    if (req.url().endsWith('/submitFlappyReplay')) replays.push(req.postDataJSON() as FlappyReplay);
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Играть: Flappy Bird', exact: true }).click();
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
  await page.locator('.flappy-canvas').waitFor();
  const desktopField = await page.locator('.flappy-canvas').boundingBox();
  assert(desktopField && desktopField.width >= 410);
  const volume = page.getByRole('slider', { name: 'Громкость', exact: true });
  const mediaSettings = () =>
    page.evaluate(() =>
      (window as unknown as { __flappyAudio: HTMLAudioElement[] }).__flappyAudio.map((audio) => ({
        volume: audio.volume,
        muted: audio.muted,
      })),
    );
  await expect(volume).toHaveValue('100');
  await volume.press('Home');
  await expect(volume).toHaveValue('0');
  await page.getByRole('button', { name: 'Включить звук', exact: true }).click();
  await expect(volume).toHaveValue('100');
  await volume.press('Home');
  await volume.press('ArrowRight');
  await volume.press('ArrowRight');
  await expect(volume).toHaveValue('2');
  assert.deepEqual(
    await mediaSettings(),
    Array.from({ length: 4 }, () => ({ volume: 0.02, muted: false })),
  );
  await page.getByRole('button', { name: 'Выключить звук', exact: true }).click();
  assert.deepEqual(
    await mediaSettings(),
    Array.from({ length: 4 }, () => ({ volume: 0.02, muted: true })),
  );
  await page.reload();
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
  await expect(volume).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Включить звук', exact: true })).toBeVisible();
  assert.deepEqual(
    await mediaSettings(),
    Array.from({ length: 4 }, () => ({ volume: 0.02, muted: true })),
  );
  await page.getByRole('button', { name: 'Включить звук', exact: true }).click();
  await expect(volume).toHaveValue('2');
  assert.deepEqual(
    await mediaSettings(),
    Array.from({ length: 4 }, () => ({ volume: 0.02, muted: false })),
  );
  async function backToReady() {
    const before = createdRuns;
    await page.getByRole('button', { name: 'На главный экран', exact: true }).click();
    await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('.flappy-message')).toContainText('Нажми на поле');
    await expect(page.getByRole('button', { name: 'На главный экран', exact: true })).toBeHidden();
    await page.waitForTimeout(350);
    await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
    assert.equal(createdRuns, before, 'OK must not create a new ranked run');
  }
  await page.screenshot({ path: '.cache/screenshots/flappy-desktop-ready.png', fullPage: true });
  await page.getByRole('button', { name: 'Ночь', exact: true }).click();
  await page.screenshot({ path: '.cache/screenshots/flappy-night.png', fullPage: true });
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await page.locator('.flappy-canvas').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'playing');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: '.cache/screenshots/flappy-playing.png', fullPage: true });
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'over', {
    timeout: 15000,
  });
  if (!production) {
    await expect(page.locator('.flappy-message')).toContainText('Результат проверен и записан');
    assert(replays.some((replay) => replay.flaps.length >= 2));
    assert.equal(await page.evaluate(() => localStorage.getItem('arcade:flappy:pending:v1')), null);
  }
  await page.screenshot({ path: '.cache/screenshots/flappy-gameover.png', fullPage: true });
  if (!production) {
    let dropped = false;
    await page.route('**/__dev/rpc/submitFlappyReplay', async (route) => {
      if (dropped) {
        await route.continue();
        return;
      }
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    });
    await backToReady();
    await page.keyboard.press('Space');
    await expect(page.locator('.flappy-message')).toContainText('Полёт сохранён', {
      timeout: 15000,
    });
    assert(await page.evaluate(() => localStorage.getItem('arcade:flappy:pending:v1')));
    await page.unroute('**/__dev/rpc/submitFlappyReplay');
    await page.reload();
    await expect(page.locator('.flappy-message')).toContainText('Результат проверен и записан');
    assert.equal(await page.evaluate(() => localStorage.getItem('arcade:flappy:pending:v1')), null);
  }
  await backToReady();
  await page.keyboard.press('Space');
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'playing');
  await page.keyboard.press('Escape');
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('.flappy-message')).toContainText('теперь свободный');
  await page.getByRole('button', { name: 'Продолжить полёт', exact: true }).click();
  await expect(page.locator('.flappy-game')).toHaveAttribute('data-phase', 'playing');
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Рекорды', exact: true }).click();
  await page.getByLabel('Игра рейтинга', { exact: true }).selectOption('flappy');
  await expect(page.getByRole('heading', { name: 'FLAPPY BIRD / РЕКОРДЫ' })).toBeVisible();
  if (!production) {
    await expect(page.locator('.leaderboard tbody tr').first()).toBeVisible();
    const group = page.getByLabel('Группа рейтинга', { exact: true });
    await group.locator('option[value="-10001"]').waitFor({ state: 'attached' });
    await group.selectOption('-10001');
    await expect(page.locator('.leaderboard tbody tr').first()).toBeVisible();
  }
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await phone.goto(`${origin}/?startapp=game_flappy`);
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
  const phoneField = await phone.locator('.flappy-canvas').boundingBox();
  assert(phoneField && phoneField.width >= 340);
  await phone.screenshot({ path: '.cache/screenshots/flappy-phone-ready.png', fullPage: true });
  const phoneVolume = phone.getByRole('slider', { name: 'Громкость', exact: true });
  const phoneRange = await phoneVolume.boundingBox();
  assert(phoneRange && phoneRange.width >= 30);
  await phone.touchscreen.tap(
    phoneRange.x + phoneRange.width / 2,
    phoneRange.y + phoneRange.height / 2,
  );
  const phoneLevel = await phoneVolume.inputValue();
  assert(Number(phoneLevel) > 0 && Number(phoneLevel) < 100);
  await phone.getByRole('button', { name: 'Выключить звук', exact: true }).tap();
  await phone.reload();
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
  await expect(phoneVolume).toHaveValue(phoneLevel);
  await expect(phone.getByRole('button', { name: 'Включить звук', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Включить звук', exact: true }).tap();
  await expect(phoneVolume).toHaveValue(phoneLevel);
  await phone.locator('.flappy-canvas').tap();
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'playing');
  await phone.waitForTimeout(250);
  await phone.locator('.flappy-canvas').tap();
  await phone.screenshot({ path: '.cache/screenshots/flappy-phone-playing.png', fullPage: true });
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'over', {
    timeout: 15000,
  });
  if (!production)
    await expect(phone.locator('.flappy-message')).toContainText('Результат проверен и записан');
  await phone.getByRole('button', { name: 'На главный экран', exact: true }).tap();
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
  await phone.waitForTimeout(350);
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'ready');
  await phone.screenshot({
    path: '.cache/screenshots/flappy-phone-return-ready.png',
    fullPage: true,
  });
  await phone.locator('.flappy-canvas').tap();
  await expect(phone.locator('.flappy-game')).toHaveAttribute('data-phase', 'playing');
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await phone.setViewportSize(viewport);
    assert.equal(
      await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const field = await phone.locator('.flappy-canvas').boundingBox();
    assert(field && field.width > 0 && Math.abs(field.height / field.width - 512 / 288) < 0.01);
  }
  assert.deepEqual(errors, []);
  console.log(
    `Flappy ${production ? 'production guest' : 'local ranked'}: volume slider, instant mute and saved audio settings, enlarged field, OK → Tap Tap → new flight, sprites, day/night, keyboard, touch, pause, leaderboard${production ? '' : ', verification and lost-response recovery'} passed.`,
  );
} finally {
  await browser.close();
  server.kill();
}
