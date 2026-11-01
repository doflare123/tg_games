import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { create2048, move2048 } from '../src/games/2048/engine.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium } = await import('@playwright/test');
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', '4175', '--strictPort'],
  { stdio: 'ignore', windowsHide: true },
);
const browser = await chromium.launch({ headless: true });
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:4175')).ok) break;
    } catch {}
    if (attempt >= 75) throw new Error('Animation test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.goto('http://127.0.0.1:4175/#game_2048', { waitUntil: 'domcontentloaded' });
  const fixture = [2, 2, 2, 2, ...Array<number>(12).fill(0)];
  async function reset() {
    await page.evaluate(
      (board) =>
        localStorage.setItem(
          'arcade:2048:v1',
          JSON.stringify({
            state: { version: 2, board, rng: 123, score: 0, moves: 0, status: 'playing' },
            run: null,
            pending: [],
            requestId: null,
            finished: false,
          }),
        ),
      fixture,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.puzzle-grid').waitFor();
  }
  await reset();
  const slide = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }));
    const flying = [...document.querySelectorAll<HTMLElement>('.puzzle-flying')];
    for (const tile of flying)
      for (const animation of tile.getAnimations()) {
        animation.pause();
        animation.currentTime = 55;
      }
    const moving = document.querySelector<HTMLElement>('.puzzle-flying[data-from="1"]');
    const origin = document.querySelectorAll('.puzzle-tile')[1];
    const target = document.querySelectorAll('.puzzle-tile')[0];
    return {
      count: flying.length,
      left: moving?.getBoundingClientRect().left,
      origin: origin?.getBoundingClientRect().left,
      target: target?.getBoundingClientRect().left,
      values: [...document.querySelectorAll('.puzzle-tile')].map((tile) => tile.textContent),
    };
  });
  assert.equal(slide.count, 4, 'Both tiles in each merge must travel');
  assert.ok(
    slide.left !== undefined &&
      slide.origin !== undefined &&
      slide.target !== undefined &&
      slide.left > slide.target &&
      slide.left < slide.origin,
    'The tile must visibly occupy an intermediate position',
  );
  assert.deepEqual(slide.values.slice(0, 2), ['4', '4']);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/2048-sliding.png', fullPage: true });
  await page.evaluate(() => {
    for (const tile of document.querySelectorAll('.puzzle-flying'))
      for (const animation of tile.getAnimations()) animation.finish();
  });
  await page.waitForFunction(() => document.querySelectorAll('.puzzle-flying').length === 0);
  const pops = await page.evaluate(() =>
    [...document.querySelectorAll('.puzzle-tile')].flatMap((cell) =>
      cell.getAnimations().map((animation) => {
        animation.pause();
        return (animation.effect as KeyframeEffect)
          .getKeyframes()
          .map((frame) => ({ transform: frame.transform, opacity: frame.opacity }));
      }),
    ),
  );
  assert.ok(
    pops.some((frames) => frames.some((frame) => frame.transform === 'scale(1.14)')),
    'Merged tiles must pulse',
  );
  assert.ok(
    pops.some((frames) => frames.some((frame) => frame.opacity === '0')),
    'The new tile must fade and grow in',
  );

  await reset();
  const expected = { ...create2048(123), board: [...fixture], rng: 123 };
  for (const direction of ['left', 'down', 'right', 'up', 'left'] as const)
    move2048(expected, direction);
  await page.evaluate(() => {
    for (const code of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'])
      window.dispatchEvent(new KeyboardEvent('keydown', { key: code, code }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.puzzle-flying').length === 0);
  const rapid = await page.evaluate(
    () => JSON.parse(localStorage.getItem('arcade:2048:v1') ?? '{}') as { state: unknown },
  );
  assert.deepEqual(rapid.state, expected, 'Rapid inputs must never be dropped or delayed');
  assert.equal(await page.locator('.puzzle-tile[data-moving]').count(), 0);
  await page.keyboard.press('ArrowDown');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll('.puzzle-flying').length === 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reset();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.puzzle-flying').count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.querySelector('.puzzle-grid')?.getAnimations({ subtree: true }).length,
    ),
    0,
  );
  assert.equal(await page.locator('.puzzle-tile').first().textContent(), '4');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  assert.equal(await page.locator('.puzzle-motion-layer').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    '2048 animation checks passed: slide positions, merges, spawn, rapid input, resize, reduced motion and disposal.',
  );
} finally {
  await browser.close();
  server.kill();
}
