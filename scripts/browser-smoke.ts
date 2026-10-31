import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMines } from '../src/games/minesweeper/engine.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import type { TetrisState } from '../src/games/tetris/types.ts';
import { CATALOG } from '../src/shared/contracts.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium } = await import('@playwright/test');
const production = process.argv.includes('--production');
const hasMario = CATALOG.some((game) => game.available && game.id === 'mario');
await mkdir('.cache/screenshots', { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', ...(production ? ['preview'] : []), '--port', '4173'],
  {
    stdio: 'ignore',
    windowsHide: true,
  },
);
const browser = await chromium.launch({ headless: true });
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4173')).ok) break;
    } catch {}
    if (i === 99) throw new Error('Dev server did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  // Guest/dev checks do not use Telegram auth; avoid a network-dependent blocking SDK script.
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  const errors: string[] = [];
  let releaseUploads: (() => void) | undefined;
  let abandoned = 0;
  let submissions = 0;
  if (!production) {
    const gate = new Promise<void>((resolve) => {
      releaseUploads = resolve;
    });
    page.on('request', (request) => {
      if (request.url().endsWith('/abandonRun')) abandoned++;
    });
    await page.route('**/__dev/rpc/submitReplay', async (route) => {
      submissions++;
      await gate;
      await route.continue();
    });
  }
  page.on('response', async (response) => {
    if (response.status() >= 400)
      console.log(
        'http-error',
        response.status(),
        response.url(),
        (await response.text()).slice(0, 1800),
      );
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error')
      console.log('browser:', message.text());
  });
  const navigationRequests = new Set<string>();
  page.on('request', (request) => navigationRequests.add(request.url()));
  page.on('requestfinished', (request) => navigationRequests.delete(request.url()));
  page.on('requestfailed', (request) => navigationRequests.delete(request.url()));
  await page
    .goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 15000 })
    .catch((error: unknown) => {
      console.error('Pending navigation requests:', [...navigationRequests]);
      throw error;
    });
  await page.getByRole('heading', { name: 'ВЫБИРАЙ СВОЮ ИГРУ' }).waitFor();
  assert.deepEqual(await page.locator('.card-info h3').allTextContents(), ['Тетрис', 'Сапёр']);
  assert.doesNotMatch((await page.locator('body').textContent()) ?? '', /doom|mario|дум|марио/i);
  assert.doesNotMatch(
    (await page.locator('meta[name=description]').getAttribute('content')) ?? '',
    /doom|mario|дум|марио/i,
  );
  await page.screenshot({ path: '.cache/screenshots/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Играть: Сапёр', exact: true }).click();
  await page.locator('.mine-grid').waitFor();
  assert.equal(new URL(page.url()).hash, '#game_minesweeper');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.mine-grid').waitFor();
  for (const [size, count] of [
    ['9x9', 81],
    ['16x16', 256],
    ['30x16', 480],
  ] as const) {
    await page.getByLabel('Уровень сапёра', { exact: true }).selectOption(size);
    assert.equal(await page.locator('.mine-cell').count(), count);
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 932 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `Minesweeper ${size} must fit width ${width}`,
      );
    }
  }
  await page.getByLabel('Уровень сапёра', { exact: true }).selectOption('9x9');
  await page.getByRole('button', { name: 'Свободная игра', exact: true }).click();
  const initialFlag = page.locator('.mine-cell[data-cell="1"]');
  await initialFlag.click({ button: 'right' });
  assert.equal(await initialFlag.getAttribute('data-value'), '-3');
  assert.equal(await page.locator('.mine-cell.revealed').count(), 0);
  assert.equal(await page.locator('.mine-timer').textContent(), '00:00.00');
  await page.locator('.mine-cell').first().click();
  assert.equal(await page.locator('.mine-cell').first().getAttribute('data-value'), '0');
  assert.equal(await initialFlag.getAttribute('data-value'), '-3');
  await initialFlag.click({ button: 'right' });
  assert.equal(await initialFlag.getAttribute('data-value'), '-2');
  await initialFlag.click();
  assert.ok(Number(await initialFlag.getAttribute('data-value')) >= 0);
  assert.ok((await page.locator('.mine-cell.revealed').count()) > 1);
  await page.locator('.mine-cell[data-value="-2"]').first().click({ button: 'right' });
  assert.equal(await page.locator('.mine-cell[data-value="-3"]').count(), 1);
  await page.locator('.mine-cell[data-value="-3"]').press('f');
  assert.equal(await page.locator('.mine-cell[data-value="-3"]').count(), 0);
  assert.equal(await page.locator('.mine-cell[data-value="-3"]').count(), 0);
  await page.screenshot({ path: '.cache/screenshots/minesweeper.png', fullPage: true });
  if (!production) {
    await page.evaluate(() => {
      Reflect.set(window, '__mineOriginalNow', performance.now.bind(performance));
      Reflect.set(window, '__mineClock', 1000);
      performance.now = () => Number(Reflect.get(window, '__mineClock'));
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        value: (array: Uint32Array) => {
          array[0] = 42;
          return array;
        },
      });
    });
    const mineRequests: string[] = [];
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname.split('/').pop() ?? '';
      if (['createMineRun', 'moveMineRun', 'submitMineResult'].includes(endpoint))
        mineRequests.push(endpoint);
    });
    let releaseMineResult: (() => void) | undefined;
    const mineResultGate = new Promise<void>((resolve) => {
      releaseMineResult = resolve;
    });
    let resultAttempts = 0;
    await page.route('**/__dev/rpc/submitMineResult', async (route) => {
      resultAttempts++;
      const reported: unknown = route.request().postDataJSON();
      assert.ok(reported && typeof reported === 'object' && 'elapsedMs' in reported);
      assert.equal(reported.elapsedMs, 30000);
      if (resultAttempts === 1) {
        // Simulate a lost response after the result has already been saved.
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort();
      } else {
        await mineResultGate;
        await route.continue();
      }
    });
    await page.getByRole('button', { name: 'Рейтинговая игра', exact: true }).click();
    await page.locator('.mine-cell').first().click();
    await page
      .getByText('Рейтинговая партия · открой все клетки без мин.', { exact: true })
      .waitFor();
    await page.evaluate(() => {
      Reflect.set(window, '__mineClock', 31000);
    });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.mine-timer').textContent(), '00:30.00');
    const flagCell = await page
      .locator('.mine-cell[data-value="-2"]')
      .first()
      .getAttribute('data-cell');
    const flagTarget = page.locator(`.mine-cell[data-cell="${flagCell}"]`);
    for (let i = 0; i < 5; i++) {
      await flagTarget.click({ button: 'right' });
      await page.locator('.mine-cell').first().click();
      assert.equal(
        await page.locator('.mine-timer').textContent(),
        '00:30.00',
        'Clicks must not add elapsed time',
      );
      assert.equal(await flagTarget.getAttribute('data-value'), i % 2 === 0 ? '-3' : '-2');
    }
    await flagTarget.click({ button: 'right' });
    assert.deepEqual(mineRequests, [], 'Playing and flagging must not send requests');
    const mineSolution = createMines('9x9', 42, 0);
    for (let cell = 0; cell < mineSolution.cells.length; cell++) {
      if (mineSolution.cells[cell] === -1) continue;
      const target = page.locator(`.mine-cell[data-cell="${cell}"]`);
      if (Number(await target.getAttribute('data-value')) === -2) await target.click();
    }
    await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).waitFor();
    assert.match((await page.locator('.mine-status').textContent()) ?? '', /^Победа!/);
    assert.equal(await page.locator('.mine-hud strong').textContent(), '⚑ 0');
    assert.equal(await page.locator('.mine-cell[data-value="-3"]').count(), 10);
    assert.equal(await page.locator('.mine-cell[data-value="-2"]').count(), 0);
    await page.evaluate(() => {
      Reflect.set(window, '__mineClock', 91000);
    });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.mine-timer').textContent(), '00:30.00');
    await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
    await page.waitForTimeout(650);
    assert.equal(
      await page.locator('.mine-timer').textContent(),
      '00:30.00',
      'Saving or retrying must not change the finishing time',
    );
    await page.getByRole('button', { name: 'Новая партия', exact: true }).click();
    assert.equal(await page.locator('.mine-timer').textContent(), '00:00.00');
    await page.locator('.mine-cell').first().click();
    await page.locator('.mine-cell[data-value="-2"]').first().click({ button: 'right' });
    const pendingResponse = page.waitForResponse((response) =>
      response.url().endsWith('/submitMineResult'),
    );
    releaseMineResult?.();
    await pendingResponse;
    await page.evaluate(() => {
      Reflect.set(window, '__mineClock', 95000);
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.locator('.mine-timer').textContent(),
      '00:04.00',
      'A previous result response must not change the new timer',
    );
    assert.equal(await page.locator('.mine-cell[data-value="-3"]').count(), 1);
    assert.equal(
      await page.locator('.mine-status').textContent(),
      'Рейтинговая партия · открой все клетки без мин.',
    );
    assert.deepEqual(mineRequests, ['submitMineResult', 'submitMineResult']);
    await page.unroute('**/__dev/rpc/submitMineResult');
    await page.evaluate(() => {
      performance.now = Reflect.get(window, '__mineOriginalNow') as () => number;
      Reflect.deleteProperty(crypto, 'getRandomValues');
    });
  } else
    assert.equal(
      await page.getByRole('button', { name: 'Рейтинговая игра', exact: true }).isDisabled(),
      true,
    );
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('heading', { name: 'ВЫБИРАЙ СВОЮ ИГРУ' }).waitFor();
  await page.getByRole('button', { name: 'Рекорды', exact: true }).click();
  await page.getByLabel('Игра рейтинга', { exact: true }).selectOption('minesweeper');
  for (const size of ['9x9', '16x16', '30x16']) {
    const response = production
      ? null
      : page.waitForResponse((response) => {
          if (!response.url().endsWith('/getMineLeaderboard')) return false;
          const input: unknown = response.request().postDataJSON();
          return (
            input !== null && typeof input === 'object' && 'size' in input && input.size === size
          );
        });
    await page.getByLabel('Уровень рейтинга сапёра', { exact: true }).selectOption(size);
    if (response) {
      const board = await (await response).json();
      assert.equal(board.result.size, size);
      if (size === '9x9') assert.ok(board.result.me?.elapsedMs <= 30000);
    }
  }
  await page.getByRole('button', { name: 'Игры', exact: true }).click();
  await page.getByRole('button', { name: 'Играть: Тетрис', exact: true }).click();
  await page.getByRole('region', { name: 'Тетрис', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#game_tetris_marathon');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Games must use a page');
  assert.equal(await page.locator('.hero').count(), 0, 'Catalog must be replaced');
  await page.goBack();
  await page.getByRole('heading', { name: 'ВЫБИРАЙ СВОЮ ИГРУ' }).waitFor();
  await page.goForward();
  await page.getByRole('region', { name: 'Тетрис', exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tetris-canvas').waitFor();
  const assertGameLayout = async () => {
    const board = await page.locator('.tetris-canvas').boundingBox();
    const hud = await page.locator('.tetris-hud').boundingBox();
    const viewport = page.viewportSize();
    assert.ok(viewport);
    assert.ok(board && hud && hud.x >= board.x + board.width, 'HUD must sit beside the board');
    assert.ok(
      board.y >= 0 && board.y + board.height <= viewport.height,
      'Full board must fit in the viewport',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      'Game page must not overflow horizontally',
    );
    const next = page.getByRole('group', { name: 'Следующие фигуры по порядку' });
    assert.equal(await next.getByRole('img').count(), 3);
    assert.equal(
      await next
        .locator('canvas')
        .first()
        .evaluate((node) => {
          if (!(node instanceof HTMLCanvasElement)) return false;
          return node
            .getContext('2d')
            ?.getImageData(0, 0, node.width, node.height)
            .data.some((value) => value > 0);
        }),
      true,
      'Next piece must be drawn',
    );
  };
  await assertGameLayout();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await assertGameLayout();
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  if (production) {
    assert.ok(
      await page.getByRole('button', { name: 'Играть в рейтинг', exact: true }).isDisabled(),
    );
    await page.getByRole('button', { name: 'Свободная игра', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Играть в рейтинг', exact: true }).click();
    await page.getByText('Рейтинговая партия · пауза завершает попытку').waitFor();
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(65);
  }
  if (!production) {
    await page.getByText('Партия завершена. Проверяем результат…', { exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(abandoned, 0, 'Blur must preserve a completed game awaiting upload');
    releaseUploads?.();
  }
  if (production)
    await page
      .getByText('Свободная партия завершена. Этот результат не попадает в рейтинг.')
      .waitFor();
  else
    await page
      .getByText('Результат проверен. Рекорд учтён в рейтинге.')
      .waitFor({ timeout: 15000 });
  assert.ok(submissions < 10, 'Checkpoint sync must not flood the server');
  await page.screenshot({ path: '.cache/screenshots/tetris.png', fullPage: true });
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Рекорды', exact: true }).click();
  if (production)
    await page.getByText('Открой Arcade внутри Telegram, чтобы увидеть рейтинги.').waitFor();
  else {
    await page.locator('tbody tr').first().waitFor();
    assert.ok((await page.locator('tbody tr').count()) >= 1);
  }

  if (!production) {
    const groupSelect = page.getByLabel('Группа рейтинга');
    await groupSelect.locator('option[value="-10001"]').waitFor({ state: 'attached' });
    await groupSelect.selectOption('-10001');
    const notifications = page.getByRole('button', { name: /Уведомления:/ });
    await notifications.waitFor();
    const original = await notifications.textContent();
    await notifications.click();
    await page.waitForFunction(
      (previous) => document.querySelector('.leaderboard-section button')?.textContent !== previous,
      original,
    );
    await notifications.click();
    await page.waitForFunction(
      (previous) => document.querySelector('.leaderboard-section button')?.textContent === previous,
      original,
    );
    await page.screenshot({ path: '.cache/screenshots/group-leaderboard.png', fullPage: true });
  }

  await page.getByRole('button', { name: 'Игры', exact: true }).click();
  const rom = Buffer.alloc(16 + 32768 + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 1]);
  rom.set([0x4c, 0, 0x80], 16);
  for (let i = 0; i < 3; i++) rom.set([0, 0x80], 16 + 32762 + i * 2);
  if (hasMario) {
    await page.getByRole('button', { name: 'Играть: Super Mario Bros.', exact: true }).click();
    await page
      .getByLabel('Загрузить ROM Super Mario Bros.')
      .setInputFiles({ name: 'synthetic.nes', mimeType: 'application/octet-stream', buffer: rom });
    await page.getByText(/Нажми START/).waitFor();
    await page.locator('.nes-screen canvas').waitFor();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByText('Сохранено на устройстве.').waitFor();
    await page.getByRole('button', { name: 'Загрузить сохранение', exact: true }).click();
    await page.getByText('Сохранение восстановлено.').waitFor();
    await page.getByRole('button', { name: '← Назад', exact: true }).click();
  }
  const wad = resolve('.cache/freedoom/freedoom-0.13.0/freedoom1.wad');
  let hasWad = false;
  try {
    await access(wad);
    await access('public/engines/doom/manifest.json');
    hasWad = CATALOG.some((game) => game.available && game.id === 'doom');
  } catch {}
  if (hasWad) {
    await page.getByRole('button', { name: 'Играть: DOOM', exact: true }).click();
    await page.getByLabel('Загрузить WAD Doom').setInputFiles(wad);
    await page
      .getByText(/Движок запущен/)
      .waitFor({ timeout: 30000 })
      .catch(async (error: unknown) => {
        console.error(await page.locator('.game-status').allTextContents(), errors);
        await page.screenshot({ path: '.cache/screenshots/doom-failure.png', fullPage: true });
        throw error;
      });
    const frame = page.frameLocator('.doom-frame');
    await frame.locator('canvas').click();
    await frame.locator('canvas').press('Enter');
    await page.waitForTimeout(500);
    await frame.locator('canvas').press('Enter');
    await page.waitForTimeout(500);
    await frame.locator('canvas').press('Enter');
    await page.waitForTimeout(500);
    await frame.locator('canvas').press('Enter');
    await page.waitForTimeout(2000);
    const dimensions = await frame.locator('canvas').evaluate((c) => {
      if (!(c instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
      return [c.width, c.height];
    });
    assert.deepEqual(dimensions, [640, 400], 'Doom framebuffer must match SDL renderer');
    await page.screenshot({ path: '.cache/screenshots/doom.png', fullPage: true });
    await page.getByRole('button', { name: '← Назад', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/screenshots/mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Mobile horizontal overflow',
  );
  await page.getByRole('button', { name: 'Играть: Тетрис', exact: true }).click();
  await page.getByRole('button', { name: 'Свободная игра', exact: true }).click();
  await page.getByText('Свободная игра · сохранение на устройстве').waitFor();
  await assertGameLayout();
  assert.equal(
    await page.locator('.touch-controls').count(),
    0,
    'Old control grid must be removed',
  );
  await page.locator('.tetris-canvas').click();
  await page.locator('.tetris-canvas').press('Space');
  await page.screenshot({ path: '.cache/screenshots/mobile-tetris.png' });
  const rectangle = await page.locator('.tetris-canvas').boundingBox();
  assert.ok(
    rectangle && rectangle.y > 0 && rectangle.y + rectangle.height < 844,
    'Mobile board should fit in the viewport',
  );

  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await phoneContext.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  const phone = await phoneContext.newPage();
  phone.on('pageerror', (error) => errors.push(error.message));
  const touch = await phoneContext.newCDPSession(phone);
  const point = async (selector: string, id: number) => {
    const box = await phone.locator(selector).boundingBox();
    assert.ok(box);
    return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  for (const hidden of ['game_doom', 'game_mario']) {
    await phone.goto(`http://127.0.0.1:4173/?startapp=${hidden}`);
    await phone.getByRole('heading', { name: 'ВЫБИРАЙ СВОЮ ИГРУ' }).waitFor();
    assert.equal(await phone.getByRole('dialog').count(), 0);
    assert.doesNotMatch((await phone.locator('body').textContent()) ?? '', /doom|mario|дум|марио/i);
  }
  await phone.goto('http://127.0.0.1:4173/?startapp=game_tetris_sprint');
  await phone.getByRole('region', { name: 'Тетрис', exact: true }).waitFor();
  assert.equal(
    await phone.getByLabel('Режим Тетриса').inputValue(),
    'sprint',
    'Record link must select Sprint',
  );
  await phone.getByRole('button', { name: 'Свободная игра', exact: true }).click();
  const snapshot = async () => {
    await phone.getByRole('button', { name: 'Пауза', exact: true }).click();
    await phone.waitForTimeout(80);
    const saved = await phone.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('tg-games', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const request = database.transaction('saves').objectStore('saves').get('tetris-practice');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    await phone.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await phone.locator('.tetris-canvas').scrollIntoViewIfNeeded();
    assert.equal(
      await phone.locator('.tetris-canvas').evaluate((node) => document.activeElement === node),
      true,
      'Resuming must return keyboard focus to the board',
    );
    assert.ok(saved && typeof saved === 'object' && 'active' in saved && 'board' in saved);
    return saved as TetrisState;
  };
  let initial = await snapshot();
  await phone.keyboard.press('f');
  await phone.waitForTimeout(60);
  const heldWithF = await snapshot();
  assert.equal(heldWithF.hold, initial.active.kind, 'F must hold the active piece');
  assert.equal(heldWithF.canHold, false);
  await phone.keyboard.press('Space');
  await phone.waitForTimeout(60);
  const beforeC = await snapshot();
  await phone.keyboard.press('c');
  await phone.waitForTimeout(60);
  const heldWithC = await snapshot();
  assert.equal(heldWithC.hold, beforeC.active.kind, 'C must remain a hold shortcut');
  assert.equal(heldWithC.active.kind, beforeC.hold);
  await phone.keyboard.press('Space');
  await phone.waitForTimeout(60);
  const beforeMouseHold = await snapshot();
  await phone.getByRole('button', { name: 'HOLD', exact: true }).click();
  assert.equal(
    await phone.locator('.tetris-canvas').evaluate((node) => document.activeElement === node),
    true,
    'Clicking HOLD must return keyboard focus to the board',
  );
  await phone.keyboard.press('ArrowLeft');
  await phone.waitForTimeout(60);
  const afterMouseHold = await snapshot();
  assert.equal(afterMouseHold.hold, beforeMouseHold.active.kind);
  assert.equal(
    afterMouseHold.active.x,
    2,
    'Arrows must move the piece immediately after mouse HOLD',
  );
  await phone.getByRole('button', { name: /Звук:/ }).click();
  assert.equal(
    await phone.locator('.tetris-canvas').evaluate((node) => document.activeElement === node),
    true,
    'Clicking sound must return keyboard focus without scrolling to the board',
  );
  const afterSoundClickScroll = await phone.evaluate(() => window.scrollY);
  await phone.keyboard.press('ArrowRight');
  await phone.waitForTimeout(60);
  assert.equal(
    await phone.evaluate(() => window.scrollY),
    afterSoundClickScroll,
    'Gameplay arrows must not scroll the page after clicking a control',
  );
  const afterSoundClick = await snapshot();
  assert.equal(afterSoundClick.active.x, 3, 'Arrows must keep working after clicking sound');
  await phone.getByRole('button', { name: 'Свободная игра', exact: true }).click();
  initial = await snapshot();
  if (initial.active.kind === 'O') {
    await phone.getByRole('button', { name: 'HOLD', exact: true }).click();
    await phone.waitForTimeout(60);
    initial = await snapshot();
  }
  const center = await point('.tetris-canvas', 11);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForTimeout(50);
  const rotated = await snapshot();
  assert.equal(
    rotated.active.rotation,
    (initial.active.rotation + 1) % 4,
    'Tap must rotate exactly once',
  );
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...center, x: center.x + 45 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForTimeout(60);
  const moved = await snapshot();
  assert.ok(moved.active.x > rotated.active.x, 'Horizontal swipe must move the piece');
  assert.equal(moved.active.rotation, rotated.active.rotation, 'Drag must not also rotate');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
  await phone.waitForTimeout(360);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const accelerated = await snapshot();
  assert.ok(accelerated.score > moved.score, 'Hold must perform scored soft drops');
  await phone.waitForTimeout(180);
  const released = await snapshot();
  assert.equal(released.score, accelerated.score, 'Release must stop soft drop');
  const scrollBefore = await phone.evaluate(() => window.scrollY);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...center, y: center.y + 90 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForTimeout(50);
  const scrollAfter = await phone.evaluate(() => window.scrollY);
  assert.equal(scrollAfter, scrollBefore, 'Board gestures must not scroll the page');
  const dropped = await snapshot();
  assert.ok(
    dropped.board.some((row) => row.some((cell) => cell !== null)),
    'Fast down swipe must lock a piece',
  );
  await phone.screenshot({ path: '.cache/screenshots/mobile-tetris-gestures.png' });
  await phone.getByRole('button', { name: '← Назад', exact: true }).click();
  const loadFixture = async (fixture: TetrisState) => {
    await phone.goto('http://127.0.0.1:4173/?startapp=game_tetris');
    await phone.getByRole('region', { name: 'Тетрис', exact: true }).waitFor();
    await phone.evaluate(async (value) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('tg-games', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saves');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('saves', 'readwrite');
          transaction.objectStore('saves').put(value, 'tetris-practice');
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    }, fixture);
    await phone.getByRole('button', { name: 'Продолжить сохранённую', exact: true }).click();
    await phone.getByText('Свободная партия восстановлена.', { exact: true }).waitFor();
    await phone.locator('.tetris-canvas').press('Space');
  };
  const four = createTetris(1, 'marathon');
  for (let y = 18; y < 22; y++)
    four.board[y] = Array.from({ length: 10 }, (_, x) => (x === 5 ? null : 'J'));
  four.active = { kind: 'I', x: 3, y: 18, rotation: 1 };
  await loadFixture(four);
  await phone.getByText('ТЕТРИС!', { exact: true }).waitFor();
  assert.equal(
    await phone
      .locator('.tetris-clear-effect')
      .evaluate((node) => getComputedStyle(node).pointerEvents),
    'none',
  );
  assert.ok(
    await phone.locator('.tetris-canvas').evaluate((node) => {
      const r = node.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node;
    }),
    'Celebration must not intercept gestures',
  );
  await phone.screenshot({ path: '.cache/screenshots/mobile-tetris-four-lines.png' });
  await phone.locator('.tetris-clear-effect').waitFor({ state: 'hidden', timeout: 2000 });
  const single = createTetris(1, 'marathon');
  single.board[21] = Array.from({ length: 10 }, (_, x) => (x >= 3 && x <= 6 ? null : 'J'));
  single.active = { kind: 'I', x: 3, y: 20, rotation: 0 };
  await loadFixture(single);
  assert.equal(
    await phone.locator('.tetris-clear-effect').isVisible(),
    false,
    'Single line must not trigger Tetris effect',
  );
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  await loadFixture(four);
  await phone.getByText('ТЕТРИС!', { exact: true }).waitFor();
  assert.equal(
    await phone.locator('.tetris-clear-flash').evaluate((node) => getComputedStyle(node).display),
    'none',
  );
  await phone.getByRole('button', { name: '← Назад', exact: true }).click();
  await phone.emulateMedia({ reducedMotion: 'no-preference' });

  if (hasMario) {
    await phone.goto('http://127.0.0.1:4173/?startapp=game_mario');
    await phone.getByRole('region', { name: 'Super Mario Bros.', exact: true }).waitFor();
    await phone
      .getByLabel('Загрузить ROM Super Mario Bros.')
      .setInputFiles({ name: 'synthetic.nes', mimeType: 'application/octet-stream', buffer: rom });
    await phone.getByText(/Нажми START/).waitFor();
    await phone.locator('.mario-gamepad').scrollIntoViewIfNeeded();
    const marioStick = await point('.mario-gamepad .stick-0', 1);
    const marioB = await point('.mario-gamepad .nes-b', 2);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [marioStick] });
    const marioMoved = { ...marioStick, x: marioStick.x + 38 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [marioMoved] });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [marioMoved, marioB],
    });
    await phone.screenshot({ path: '.cache/screenshots/mobile-mario-joystick.png' });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [marioB] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.getByRole('button', { name: '← Назад', exact: true }).click();
  }
  if (hasWad) {
    await phone.goto('http://127.0.0.1:4173/?startapp=game_doom');
    await phone.getByRole('region', { name: 'DOOM', exact: true }).waitFor();
    await phone.getByLabel('Загрузить WAD Doom').setInputFiles(wad);
    await phone.getByText(/Движок запущен/).waitFor({ timeout: 30000 });
    const doomFrame = phone.frameLocator('.doom-frame');
    await doomFrame.locator('canvas').evaluate(() => {
      const events: Array<{ key: number; pressed: boolean }> = [];
      Reflect.set(window, '__testKeys', events);
      window.addEventListener('message', (event) => {
        const value: unknown = event.data;
        if (
          value &&
          typeof value === 'object' &&
          'type' in value &&
          value.type === 'doom:key' &&
          'keyCode' in value &&
          typeof value.keyCode === 'number' &&
          'pressed' in value &&
          typeof value.pressed === 'boolean'
        )
          events.push({ key: value.keyCode, pressed: value.pressed });
      });
    });
    await phone.locator('.doom-gamepad').scrollIntoViewIfNeeded();
    const stick = await point('.doom-gamepad .stick-0', 1);
    const fire = await point('.doom-gamepad .fire-button', 2);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
    const moved = { ...stick, x: stick.x + 38 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [moved, fire],
    });
    await phone.waitForTimeout(100);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [fire] });
    await phone.waitForTimeout(100);
    const keys = await doomFrame
      .locator('canvas')
      .evaluate(
        () => Reflect.get(window, '__testKeys') as Array<{ key: number; pressed: boolean }>,
      );
    assert.ok(
      keys.some((e) => e.key === 190 && e.pressed),
      'Joystick must strafe right',
    );
    assert.ok(
      keys.some((e) => e.key === 17 && e.pressed) && keys.some((e) => e.key === 17 && !e.pressed),
      'Fire must press and release independently',
    );
    assert.equal(
      keys.some((e) => e.key === 190 && !e.pressed),
      false,
      'Releasing fire must keep movement held',
    );
    await phone.screenshot({ path: '.cache/screenshots/mobile-doom-joystick.png' });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForTimeout(100);
    const released = await doomFrame
      .locator('canvas')
      .evaluate(
        () => Reflect.get(window, '__testKeys') as Array<{ key: number; pressed: boolean }>,
      );
    assert.ok(
      released.some((e) => e.key === 190 && !e.pressed),
      'Releasing joystick must stop movement',
    );
    await phone.getByRole('button', { name: '← Назад', exact: true }).click();
  }
  await phone.goto('http://127.0.0.1:4173/?startapp=game_minesweeper');
  await phone.locator('.mine-grid').waitFor();
  await phone.getByRole('button', { name: 'Свободная игра', exact: true }).tap();
  const holdMine = async (selector: string) => {
    await phone.locator(selector).scrollIntoViewIfNeeded();
    const contact = await point(selector, 51);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact] });
    await phone.waitForTimeout(650);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForTimeout(80);
  };
  const firstFlag = '.mine-cell[data-cell="1"]';
  await holdMine(firstFlag);
  assert.equal(await phone.locator(firstFlag).getAttribute('data-value'), '-3');
  assert.equal(
    await phone.locator('.mine-cell.revealed').count(),
    0,
    'A long press must not reveal or start the game',
  );
  assert.equal(await phone.locator('.mine-timer').textContent(), '00:00.00');
  await phone.locator('.mine-cell').first().tap();
  await phone.getByText('Свободная партия · открой все клетки без мин.', { exact: true }).waitFor();
  assert.equal(
    await phone.locator(firstFlag).getAttribute('data-value'),
    '-3',
    'First reveal must preserve existing flags',
  );
  await phone.locator(firstFlag).tap();
  assert.equal(
    await phone.locator(firstFlag).getAttribute('data-value'),
    '-3',
    'A short tap must not remove a flag',
  );
  await holdMine(firstFlag);
  assert.equal(
    await phone.locator(firstFlag).getAttribute('data-value'),
    '-2',
    'Unflagging must not also reveal',
  );
  await phone.locator(firstFlag).tap();
  assert.ok(
    Number(await phone.locator(firstFlag).getAttribute('data-value')) >= 0,
    'A short tap must reveal',
  );
  const coveredCell = await phone
    .locator('.mine-cell[data-value="-2"]')
    .first()
    .getAttribute('data-cell');
  const coveredSelector = `.mine-cell[data-cell="${coveredCell}"]`;
  await holdMine(coveredSelector);
  assert.equal(await phone.locator('.mine-cell[data-value="-3"]').count(), 1);
  await phone.screenshot({ path: '.cache/screenshots/mobile-minesweeper.png', fullPage: true });
  await holdMine(coveredSelector);
  assert.equal(await phone.locator(coveredSelector).getAttribute('data-value'), '-2');
  // Sliding, a cancelled contact and a second finger must not place a flag or open a cell.
  const beforeCancelledGestures = await phone
    .locator('.mine-cell')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.value));
  const cancelledContact = await point(coveredSelector, 52);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [cancelledContact],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...cancelledContact, x: cancelledContact.x + 35 }],
  });
  await phone.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [cancelledContact],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await phone.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [cancelledContact],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [cancelledContact, { ...cancelledContact, id: 53, x: cancelledContact.x + 35 }],
  });
  await phone.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(
    await phone
      .locator('.mine-cell')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.value)),
    beforeCancelledGestures,
  );
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [cancelledContact],
  });
  await phone.getByRole('button', { name: 'Новая партия', exact: true }).click();
  await phone.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(
    await phone.locator('.mine-cell[data-value="-3"]').count(),
    0,
    'A reset must cancel the pending hold',
  );
  assert.equal(await phone.locator('.mine-cell.revealed').count(), 0);
  await phone.getByLabel('Уровень сапёра', { exact: true }).selectOption('30x16');
  const scrollArea = phone.locator('.mine-scroll');
  assert.ok(await scrollArea.evaluate((node) => node.scrollWidth > node.clientWidth));
  const scrollContact = await point('.mine-cell[data-cell="5"]', 54);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [scrollContact],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...scrollContact, x: scrollContact.x - 80 }],
  });
  await phone.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(
    await phone.locator('.mine-cell[data-value="-3"]').count(),
    0,
    'Panning the expert board must not flag cells',
  );
  assert.ok(
    await scrollArea.evaluate((node) => node.scrollLeft > 0),
    'Expert board must still scroll by touch',
  );
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  for (const [size, count] of [
    ['9x9', 81],
    ['16x16', 256],
    ['30x16', 480],
  ] as const) {
    await phone.goto(`http://127.0.0.1:4173/?startapp=game_minesweeper_${size}`);
    await phone.locator('.mine-grid').waitFor();
    assert.equal(await phone.getByLabel('Уровень сапёра', { exact: true }).inputValue(), size);
    assert.equal(await phone.locator('.mine-cell').count(), count);
  }
  await phoneContext.close();

  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(
    `Browser checks passed: desktop/mobile, Minesweeper sizes/flags/rankings/retry, ranked Tetris → leaderboard, touch gestures, four-line celebration, mode links, hidden game links${hasMario ? ', NES load/save' : ''}${hasWad ? ', Doom WASM launch' : ''}.`,
  );
} finally {
  await browser.close();
  server.kill();
}
