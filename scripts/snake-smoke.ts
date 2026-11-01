import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SnakeReplay } from '../src/shared/snake.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium } = await import('@playwright/test');
const hosted = process.argv.includes('--hosted');
const production = hosted || process.argv.includes('--production');
const origin = hosted ? 'https://app8745166402.tgcloud.ai' : 'http://127.0.0.1:4175';
const server = hosted
  ? null
  : spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        ...(production ? ['preview'] : []),
        '--host',
        '127.0.0.1',
        '--port',
        '4175',
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
      /* Wait for Vite. */
    }
    if (i === 99) throw new Error('Vite failed to start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  page.on('pageerror', (e) => errors.push(e.message));
  const replays: SnakeReplay[] = [];
  page.on('request', (req) => {
    if (req.url().endsWith('/submitSnakeReplay')) replays.push(req.postDataJSON() as SnakeReplay);
  });
  await page.goto(`${origin}/#game_snake_24`);
  await page.locator('.snake-canvas').waitFor();
  const arenas = page.getByRole('group', { name: 'Арена змейки', exact: true });
  assert.deepEqual(await arenas.getByRole('button').allTextContents(), ['16×16', '20×20', '24×24']);
  assert.equal(
    await arenas.getByRole('button', { name: '24×24', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page
      .locator('input[type=range], input[type=checkbox], .snake-stick, .snake-badge')
      .count(),
    0,
  );
  const launch = () =>
    page
      .getByRole('button', {
        name: production ? 'Свободная игра' : 'Рейтинговая игра',
        exact: true,
      })
      .click();
  await page.screenshot({ path: '.cache/screenshots/snake-desktop-ready.png', fullPage: true });
  await arenas.getByRole('button', { name: '20×20', exact: true }).click();
  assert.equal(await page.getByLabel('Размер поля рейтинга змейки').inputValue(), '20');
  await arenas.getByRole('button', { name: '16×16', exact: true }).click();
  await launch();
  await page.locator('.snake-overlay').waitFor({ state: 'hidden' });
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(230);
  await page.screenshot({ path: '.cache/screenshots/snake-desktop-playing.png', fullPage: true });
  if (!production) {
    await page.getByText(/Результат проверен и записан:/).waitFor();
    assert.ok(replays.some((r) => r.directions.includes('up')));
    assert.equal(await page.evaluate(() => localStorage.getItem('arcade:snake:pending:v1')), null);
    assert.match((await page.locator('.personal-record').textContent()) ?? '', /Твоё место/);
    // A response lost after the server committed must be recovered through getSnake.
    let loseOnce = true;
    await page.route('**/__dev/rpc/submitSnakeReplay', async (route) => {
      if (!loseOnce) {
        await route.continue();
        return;
      }
      loseOnce = false;
      await route.fetch();
      await route.abort('failed');
    });
    await launch();
    await page.getByText(/Результат ждёт отправки/).waitFor();
    await page.reload();
    await page.getByText(/Результат проверен и записан:/).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('arcade:snake:pending:v1')), null);
  } else {
    await page.getByText('Свободная партия завершена. Сыграем ещё?', { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Свободная игра', exact: true }).click();
  await page.locator('.snake-overlay').waitFor({ state: 'hidden' });
  await page.getByText('Свободная партия завершена. Сыграем ещё?', { exact: true }).waitFor();
  await launch();
  await page.locator('.snake-overlay').waitFor({ state: 'hidden' });
  await page.keyboard.press('Space');
  assert.match(
    (await page.locator('.snake-message').textContent()) ?? '',
    production ? /Свободная игра/ : /теперь свободная/,
  );
  assert.equal(await page.locator('.snake-overlay strong').textContent(), 'ПАУЗА');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: '← Назад' }).click();
  await page.getByRole('button', { name: 'Рекорды', exact: true }).click();
  await page.getByLabel('Игра рейтинга', { exact: true }).selectOption('snake');
  await page.getByRole('heading', { name: 'ЗМЕЙКА / РЕКОРДЫ' }).waitFor();

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await phone.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  phone.on('pageerror', (e) => errors.push(e.message));
  const phoneReplays: SnakeReplay[] = [];
  phone.on('request', (req) => {
    if (req.url().endsWith('/submitSnakeReplay'))
      phoneReplays.push(req.postDataJSON() as SnakeReplay);
  });
  await phone.goto(`${origin}/?startapp=game_snake`);
  await phone.locator('.snake-canvas').waitFor();
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await phone
    .getByRole('button', { name: production ? 'Свободная игра' : 'Рейтинговая игра', exact: true })
    .click();
  await phone.locator('.snake-overlay').waitFor({ state: 'hidden' });
  const field = await phone.locator('.snake-canvas').boundingBox();
  assert.ok(field);
  const playArea = await phone.locator('.snake-play').boundingBox();
  assert.ok(playArea);
  assert.ok(
    Math.abs(field.width + 10 - playArea.width) <= 1,
    'Mobile board must fill the play area',
  );
  const client = await phone.context().newCDPSession(phone);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });
  await touch('touchStart', field.x + field.width / 2, field.y + field.height / 2);
  await touch('touchMove', field.x + field.width / 2, field.y + field.height / 2 - 50);
  await touch('touchEnd', 0, 0);
  await phone.waitForTimeout(210);
  const pad = phone.getByRole('group', { name: 'Управление змейкой', exact: true });
  assert.equal(await pad.getByRole('button').count(), 4);
  const bounds = await pad.boundingBox();
  assert.ok(bounds);
  assert.ok(bounds.y >= field.y + field.height, 'Arrow controls belong below the full-width board');
  await phone.getByRole('button', { name: 'Двигаться влево', exact: true }).tap();
  await phone.screenshot({ path: '.cache/screenshots/snake-phone-swipe.png', fullPage: true });
  if (!production) {
    await phone.getByText(/Результат проверен и записан:/).waitFor();
    assert.ok(
      phoneReplays.some((r) => r.directions.includes('up') && r.directions.includes('left')),
    );
  } else
    await phone.getByText('Свободная партия завершена. Сыграем ещё?', { exact: true }).waitFor();
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 534, height: 584 },
    { width: 320, height: 568 },
  ]) {
    await phone.setViewportSize(viewport);
    const board = await phone.locator('.snake-field').boundingBox();
    const area = await phone.locator('.snake-play').boundingBox();
    assert.ok(board && area);
    assert.ok(Math.abs(board.width - area.width) <= 1, 'Short screens must not shrink the board');
    assert.ok(Math.abs(board.width - board.height) <= 1, 'Board must remain square');
    assert.equal(
      await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await phone.screenshot({
      path: `.cache/screenshots/snake-phone-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    `Snake ${hosted ? 'hosted guest' : production ? 'production guest' : 'local ranked'}: arenas, ranked/free buttons, keyboard, swipe, arrow pad, pause, leaderboard${production ? '' : ', verification and lost-response recovery'} passed.`,
  );
} finally {
  await browser.close();
  server?.kill();
}
