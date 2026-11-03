import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BLOCK_SHAPES,
  type BlockMove,
  type BlockState,
  blockPlacements,
  moveBlockBlast,
  placeBlock,
} from '../src/games/block-blast/engine.ts';
import type { BlockRun } from '../src/shared/block-blast.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const production = process.argv.includes('--production');
const port = production ? '4178' : '4177';
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(production ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    port,
    '--strictPort',
  ],
  { stdio: 'ignore', windowsHide: true },
);
const browser = await chromium.launch({ headless: true });
await mkdir('.cache/screenshots', { recursive: true });
type Snapshot = {
  state: BlockState;
  run: BlockRun | null;
  pending: BlockMove[];
  finished: boolean;
};
function solution(board: number[], tray: (number | null)[]): BlockMove[] | null {
  if (tray.every((id) => id === null)) return [];
  for (let slot = 0; slot < 3; slot++) {
    const id = tray[slot];
    if (id === null || id === undefined) continue;
    for (const p of blockPlacements(board, id)) {
      const next = [...board];
      placeBlock(next, id, p.x, p.y);
      const remaining = [...tray];
      remaining[slot] = null;
      const rest = solution(next, remaining);
      if (rest) return [{ slot, ...p }, ...rest];
    }
  }
  return null;
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Startup. */
    }
    if (i === 99) throw new Error('Vite failed to start');
    await new Promise((done) => setTimeout(done, 100));
  }
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  page.on('pageerror', (error) => console.error(error.message));
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  const snapshot = async (): Promise<Snapshot> =>
    JSON.parse(
      await page.evaluate(() => localStorage.getItem('arcade:block-blast:v1') ?? '{}'),
    ) as Snapshot;
  await page.goto(origin);
  await page.getByRole('button', { name: 'Играть: Block Blast', exact: true }).click();
  await expect(page.locator('.blast-cell')).toHaveCount(64);
  await expect(page.locator('.blast-piece').first()).toBeEnabled();
  assert.equal(new URL(page.url()).hash, '#game_block-blast');
  await expect(page.locator('.blast-mode')).toContainText(production ? 'СВОБОДНАЯ' : 'РЕЙТИНГОВАЯ');
  const initial = await snapshot();
  const moves = solution(initial.state.board, initial.state.tray);
  assert(moves && moves.length === 3);
  const simulated = structuredClone(initial.state);
  // Desktop drag with the same centre anchor as the rendered board.
  const first = moves[0];
  assert(first);
  const pieceId = simulated.tray[first.slot];
  assert(pieceId !== null && pieceId !== undefined);
  const shape = BLOCK_SHAPES[pieceId];
  assert(shape);
  const source = await page.locator('.blast-piece').nth(first.slot).boundingBox();
  const target = await page.locator('.blast-board').boundingBox();
  assert(source && target);
  const unit = (target.width - 16) / 8;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + 8 + (first.x + shape.width / 2) * unit,
    target.y + 8 + (first.y + shape.height / 2) * unit,
    { steps: 12 },
  );
  await expect(page.locator('.blast-preview')).toHaveCount(shape.cells.length);
  await page.mouse.up();
  assert(moveBlockBlast(simulated, first));
  assert.deepEqual((await snapshot()).state, simulated);
  // Keyboard selection + click placement, including one rejected move.
  const second = moves[1];
  assert(second);
  await page.locator('.blast-piece').nth(second.slot).click();
  const beforeInvalid = await snapshot();
  await page.locator('.blast-cell').nth(63).click();
  assert.deepEqual((await snapshot()).state, beforeInvalid.state);
  for (const move of moves.slice(1)) {
    await page.locator('.blast-piece').nth(move.slot).focus();
    await page.keyboard.press(String(move.slot + 1));
    await page
      .locator('.blast-cell')
      .nth(move.y * 8 + move.x)
      .click();
    assert(moveBlockBlast(simulated, move));
  }
  assert.deepEqual((await snapshot()).state, simulated);
  assert((await snapshot()).state.tray.every((id) => id !== null));
  await page.reload();
  await expect(page.locator('.blast-piece').first()).toBeEnabled();
  assert.deepEqual((await snapshot()).state, simulated);
  // Fit at narrow widths, with minimum tap target checked on the tray.
  for (const width of [320, 375, 390, 768, 1360]) {
    await page.setViewportSize({ width, height: 1050 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Horizontal overflow at ${width}`,
    );
    const p = await page.locator('.blast-piece').first().boundingBox();
    assert(p && p.width >= 44 && p.height >= 44);
  }
  await page.screenshot({ path: '.cache/screenshots/block-blast-desktop.png', fullPage: true });
  if (!production) {
    // Lose a response after the server accepted it, then reload and retry the receipt.
    let fail = true;
    await page.route('**/__dev/rpc/submitBlockMoves', async (route) => {
      const response = await route.fetch();
      if (fail) {
        fail = false;
        await route.abort('failed');
      } else await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Завершить и записать очки', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Повторить отправку', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator('.blast-mode')).toContainText('РЕЗУЛЬТАТ ЗАПИСАН');
    assert.equal((await snapshot()).state.score, simulated.score);
    await page.getByRole('button', { name: '← Назад', exact: true }).click();
    await page.getByRole('button', { name: 'Рекорды', exact: true }).click();
    await page.getByLabel('Игра рейтинга', { exact: true }).selectOption('block-blast');
    await expect(
      page.getByRole('heading', { name: 'BLOCK BLAST / РЕКОРДЫ', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.personal-record')).toContainText('Твоё место:');
    await expect(page.getByLabel('Группа рейтинга', { exact: true }).locator('option')).toHaveCount(
      2,
    );
    await page.getByLabel('Группа рейтинга', { exact: true }).selectOption('-10001');
    await expect(page.locator('.personal-record')).toContainText('Твоё место:');
    await page.getByLabel('Период рейтинга Block Blast', { exact: true }).selectOption('week');
    await expect(page.locator('.personal-record')).toContainText('Твоё место:');
    await page.screenshot({
      path: '.cache/screenshots/block-blast-group-ranking.png',
      fullPage: true,
    });
  }
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await phone.goto(`${origin}/#game_block-blast`);
  await expect(phone.locator('.blast-piece').first()).toBeEnabled();
  const mobile = JSON.parse(
    await phone.evaluate(() => localStorage.getItem('arcade:block-blast:v1') ?? '{}'),
  ) as Snapshot;
  const id = mobile.state.tray[0];
  assert(id !== null && id !== undefined);
  const s = BLOCK_SHAPES[id];
  const position = blockPlacements(mobile.state.board, id)[0];
  assert(s && position);
  const src = await phone.locator('.blast-piece').first().boundingBox();
  const dest = await phone.locator('.blast-board').boundingBox();
  assert(src && dest);
  const touch = await phone.context().newCDPSession(phone);
  const start = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
  const mobileUnit = (dest.width - 16) / 8;
  const end = {
    x: dest.x + 8 + (position.x + s.width / 2) * mobileUnit,
    y: dest.y + 8 + (position.y + s.height + 0.7) * mobileUnit,
  };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await expect(phone.locator('.blast-preview')).toHaveCount(s.cells.length);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(moveBlockBlast(mobile.state, { slot: 0, ...position }));
  assert.deepEqual(
    JSON.parse(await phone.evaluate(() => localStorage.getItem('arcade:block-blast:v1') ?? '{}'))
      .state,
    mobile.state,
  );
  await phone.screenshot({ path: '.cache/screenshots/block-blast-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `Block Blast browser checks passed (${production ? 'production free play' : 'local authoritative API'}): drag, touch, click, keyboard selection, solvable refill, persistence, responsive layout${production ? '' : ', retry after lost response, global/group/week rankings'}.`,
  );
} finally {
  await browser.close();
  server.kill();
}
