import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const origin = 'http://127.0.0.1:4177';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4177', '--strictPort'],
  { stdio: 'ignore', windowsHide: true },
);
const browser = await chromium.launch({ headless: true });
await mkdir('.cache/screenshots', { recursive: true });
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
  const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  const errors: string[] = [],
    rankedRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/(createDoodleRun|submitDoodleReplay)$/.test(request.url()))
      rankedRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const native = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: ArrayBufferView<ArrayBuffer>) => {
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = 12;
          return array;
        }
        return native(array);
      },
    });
    localStorage.setItem(
      'arcade:doodle:pending:v1',
      JSON.stringify({ runId: 'old-run', state: {}, events: [] }),
    );
  });
  await page.goto(origin);
  await page.locator('.doodle-preview').scrollIntoViewIfNeeded();
  await expect(page.locator('.doodle-cover')).toHaveJSProperty('naturalWidth', 955);
  await page.locator('.doodle-cover').evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Cover image missing');
    await image.decode();
  });
  await page.locator('.doodle-preview').screenshot({ path: '.cache/screenshots/doodle-cover.png' });
  await page.getByRole('button', { name: 'Играть: Doodle Jump', exact: true }).click();
  const root = page.locator('.doodle-game');
  await expect(root).toHaveAttribute('data-phase', 'ready');
  await expect(page.getByLabel('Тип партии Doodle Jump')).toHaveValue('ranked');
  await page.getByLabel('Тип партии Doodle Jump').selectOption('free');
  const box = await page.locator('.doodle-canvas').boundingBox();
  assert(box && box.width >= 300 && Math.abs(box.height / box.width - 1.5) < 0.01);
  const startBox = await page.getByRole('button', { name: 'Начать', exact: true }).boundingBox();
  assert(startBox && startBox.y >= 0 && startBox.y + startBox.height <= box.y);
  await page.screenshot({ path: '.cache/screenshots/doodle-desktop-ready.png', fullPage: true });
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(root).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('.doodle-canvas')).toBeFocused();
  await expect(page.locator('.doodle-canvas')).toHaveCSS('outline-style', 'none');
  await page.keyboard.down('Space');
  await expect(root).toHaveAttribute('data-last-shot', /^[0-9]+$/);
  await page.keyboard.up('Space');
  await page.keyboard.down('ArrowRight');
  await page.screenshot({ path: '.cache/screenshots/doodle-desktop-playing.png', fullPage: true });
  await expect(root).toHaveAttribute('data-phase', 'over', { timeout: 45000 });
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('.doodle-message')).toContainText('Высота:');
  assert.deepEqual(rankedRequests, []);
  assert.equal(await page.evaluate(() => localStorage.getItem('arcade:doodle:pending:v1')), null);
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await expect(root).toHaveAttribute('data-phase', 'playing');
  await page.keyboard.press('Escape');
  await expect(root).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('.doodle-message')).toContainText('Пауза.');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).last().click();
  await expect(root).toHaveAttribute('data-phase', 'playing');
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Рекорды', exact: true }).click();
  await page.getByLabel('Игра рейтинга', { exact: true }).selectOption('doodle');
  await expect(page.getByRole('heading', { name: 'DOODLE JUMP / РЕКОРДЫ' })).toBeVisible();
  await expect(page.getByLabel('Версия рейтинга Doodle Jump')).toHaveValue('doodle-v3');
  await page.getByLabel('Версия рейтинга Doodle Jump').selectOption('doodle-v1');
  await expect(page.getByLabel('Версия рейтинга Doodle Jump')).toHaveValue('doodle-v1');
  await page.getByLabel('Версия рейтинга Doodle Jump').selectOption('doodle-v2');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const phone = await context.newPage();
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await phone.goto(`${origin}/?startapp=game_doodle`);
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'ready');
  await phone.getByLabel('Тип партии Doodle Jump').selectOption('free');
  const phoneStart = await phone.getByRole('button', { name: 'Начать', exact: true }).boundingBox();
  const phoneCanvas = await phone.locator('.doodle-canvas').boundingBox();
  assert(
    phoneStart &&
      phoneCanvas &&
      phoneStart.y >= 0 &&
      phoneStart.y + phoneStart.height <= phoneCanvas.y &&
      phoneStart.y + phoneStart.height <= 844,
  );
  await phone.getByRole('button', { name: 'Начать', exact: true }).tap();
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'playing');
  await expect(phone.locator('.doodle-canvas')).toHaveCSS('outline-style', 'none');
  const mobileBox = await phone.locator('.doodle-canvas').boundingBox();
  assert(mobileBox && mobileBox.width >= 200);
  await phone.touchscreen.tap(
    mobileBox.x + mobileBox.width * 0.8,
    mobileBox.y + mobileBox.height / 2,
  );
  const touch = await context.newCDPSession(phone);
  const leftBox = await phone.getByLabel('Двигаться влево', { exact: true }).boundingBox();
  assert(leftBox);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const fireBox = await phone.getByRole('button', { name: 'Стрелять', exact: true }).boundingBox();
  assert(fireBox);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fireBox.x + fireBox.width / 2, y: fireBox.y + fireBox.height / 2 }],
  });
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-last-shot', /^[0-9]+$/);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await phone.getByRole('button', { name: 'Пауза', exact: true }).tap();
  await expect(phone.locator('.doodle-game')).toHaveAttribute('data-phase', 'paused');
  await phone.screenshot({ path: '.cache/screenshots/doodle-phone.png', fullPage: true });
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(rankedRequests, []);
  const ranked = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  ranked.on('pageerror', (error) => errors.push(error.message));
  await ranked.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  let lostReceipt = false;
  await ranked.route('**/__dev/rpc/submitDoodleReplay', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (!lostReceipt && body.ok && body.result.status === 'verified') {
      lostReceipt = true;
      await route.fulfill({ status: 503, json: { ok: false, error: 'Тестовая потеря ответа' } });
    } else await route.fulfill({ response });
  });
  await ranked.goto(`${origin}/?startapp=game_doodle`);
  const rankedRoot = ranked.locator('.doodle-game');
  await expect(ranked.getByLabel('Тип партии Doodle Jump')).toHaveValue('ranked');
  await ranked.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(rankedRoot).toHaveAttribute('data-ranked', 'true');
  await ranked.keyboard.down('ArrowRight');
  await ranked.keyboard.down('Space');
  await expect(rankedRoot).toHaveAttribute('data-phase', 'over', { timeout: 45000 });
  await ranked.keyboard.up('ArrowRight');
  await ranked.keyboard.up('Space');
  await expect(
    ranked.getByRole('button', { name: 'Повторить отправку', exact: true }),
  ).toBeVisible();
  assert(lostReceipt);
  const saved = await ranked.evaluate(() =>
    JSON.parse(localStorage.getItem('arcade:doodle:pending:v3') ?? 'null'),
  );
  assert(saved?.runId && saved.state.status === 'over');
  await ranked.reload();
  await expect(rankedRoot).toHaveAttribute('data-verified', 'true', { timeout: 15000 });
  await expect(ranked.locator('.doodle-message')).toContainText(
    `Результат проверен и записан: ${saved.state.score}.`,
  );
  assert.equal(await ranked.evaluate(() => localStorage.getItem('arcade:doodle:pending:v3')), null);
  const board = await ranked.evaluate(async () => {
    const response = await fetch('/__dev/rpc/getDoodleLeaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: 'all', ruleset: 'doodle-v3' }),
    });
    return response.json();
  });
  assert(board.ok);
  assert.equal(board.result.me.runId, saved.runId);
  assert.equal(board.result.me.score, saved.state.score);
  await ranked.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  await expect(rankedRoot).toHaveAttribute('data-ranked', 'true');
  await ranked.keyboard.press('Escape');
  await expect(rankedRoot).toHaveAttribute('data-ranked', 'false');
  await expect(ranked.locator('.doodle-message')).toContainText('не попадёт в рейтинг');
  await ranked.close();
  const scene = await browser.newPage({ viewport: { width: 500, height: 750 } });
  await scene.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await scene.goto(origin);
  await scene.evaluate(async () => {
    const enginePath = '/src/games/doodle/adventure.ts',
      rendererPath = '/src/client/games/doodle/renderer.ts',
      spritesPath = '/src/client/games/doodle/sprites.ts';
    const engine = (await import(enginePath)) as typeof import('../src/games/doodle/adventure.ts');
    const renderer = (await import(
      rendererPath
    )) as typeof import('../src/client/games/doodle/renderer.ts');
    const sprites = (await import(
      spritesPath
    )) as typeof import('../src/client/games/doodle/sprites.ts');
    const atlas = await sprites.loadDoodleSprites();
    const canvas = document.createElement('canvas');
    canvas.id = 'adventure-scene';
    canvas.style.width = '360px';
    document.body.replaceChildren(canvas);
    document.body.style.cssText = 'margin: 20px;background:#e6f4ef;display:grid;place-items:center';
    const s = engine.createAdventure(12);
    s.camera = 250000;
    s.y = 505000;
    s.ticks = 120;
    s.power = 'jetpack';
    s.powerUntil = 260;
    s.shieldUntil = 720;
    s.vy = 18000;
    s.kills = 3;
    s.score = 455;
    s.platforms.push({
      id: 999,
      x: 100000,
      y: 330000,
      kind: 'trampoline',
      phase: 0,
      bouncedAt: 116,
      brokenAt: null,
    });
    s.monsters = [
      { id: 1000, x: 70000, y: 600000, kind: 'wing', phase: 30, hp: 1, hitAt: -100, deadAt: null },
      {
        id: 1001,
        x: 280000,
        y: 670000,
        kind: 'rotor',
        phase: 80,
        hp: 2,
        hitAt: -100,
        deadAt: null,
      },
      { id: 1002, x: 290000, y: 350000, kind: 'spike', phase: 0, hp: 1, hitAt: -100, deadAt: null },
    ];
    s.bullets = [{ id: 1003, x: 180000, y: 610000, vx: 0, vy: 14500, bornAt: 115 }];
    s.effects = [{ id: 1004, x: 250000, y: 450000, tick: 110, kind: 'pop' }];
    const draw = renderer.doodleRenderer(canvas, atlas);
    draw(s, 'playing', 1000, 1280);
    const first = canvas.toDataURL();
    s.ticks += 8;
    draw(s, 'playing', 1133, 1280);
    if (first === canvas.toDataURL()) throw new Error('Animation did not change frame');
  });
  await scene
    .locator('#adventure-scene')
    .screenshot({ path: '.cache/screenshots/doodle-adventure-showcase.png' });
  await scene.close();
  assert.deepEqual(errors, []);
  console.log(
    'Doodle Jump: desktop and phone, free play without ranked writes, authoritative ranked result, lost receipt recovery after reload, leaderboard, pause downgrade, keyboard, touch and archived versions passed.',
  );
  await context.close();
} finally {
  await browser.close();
  server.kill();
}
