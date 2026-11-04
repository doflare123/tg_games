import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BLOCK_SHAPES,
  type BlockMove,
  type BlockState,
  blockPlacements,
  canPlaceBlock,
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
  await page
    .locator('.block-blast-preview')
    .screenshot({ path: '.cache/screenshots/block-blast-cover-desktop.png' });
  await page.getByRole('button', { name: 'Играть: Block Blast', exact: true }).click();
  await expect(page.locator('.blast-cell')).toHaveCount(64);
  await expect(page.locator('.blast-piece').first()).toBeEnabled();
  for (const piece of await page.locator('.blast-piece').all()) {
    await expect(piece).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(piece).toHaveCSS('border-top-width', '0px');
  }
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
  // Moving beyond the board hides its snapped projection, keeping the held figure visible.
  await page.mouse.move(
    target.x + 8 - unit + (shape.width / 2) * unit,
    target.y + 8 + (shape.height / 2) * unit,
  );
  await expect(page.locator('.blast-preview, .blast-clear-preview')).toHaveCount(0);
  await expect(page.locator('.blast-drag-ghost')).toBeVisible();
  await page.mouse.move(
    target.x + 8 + (first.x + shape.width / 2) * unit,
    target.y + 8 + (first.y + shape.height / 2) * unit,
  );
  await expect(page.locator('.blast-preview')).toHaveCount(shape.cells.length);
  await page.mouse.up();
  assert(moveBlockBlast(simulated, first));
  assert.deepEqual((await snapshot()).state, simulated);
  // Keyboard selection + click placement, including one rejected move.
  const second = moves[1];
  assert(second);
  const secondId = simulated.tray[second.slot];
  assert(secondId !== null && secondId !== undefined);
  const secondShape = BLOCK_SHAPES[secondId];
  assert(secondShape);
  const blocked = Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8) })).find(
    (p) =>
      p.x + secondShape.width <= 8 &&
      p.y + secondShape.height <= 8 &&
      !canPlaceBlock(simulated.board, secondId, p.x, p.y),
  );
  assert(blocked);
  const secondSource = await page.locator('.blast-piece').nth(second.slot).boundingBox();
  assert(secondSource);
  await page.mouse.move(
    secondSource.x + secondSource.width / 2,
    secondSource.y + secondSource.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + 8 + (blocked.x + secondShape.width / 2) * unit,
    target.y + 8 + (blocked.y + secondShape.height / 2) * unit,
    { steps: 6 },
  );
  await expect(page.locator('.blast-preview, .blast-clear-preview')).toHaveCount(0);
  await page.mouse.up();
  assert.deepEqual((await snapshot()).state, simulated);
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
  await phone.goto(origin);
  await phone
    .locator('.block-blast-preview')
    .screenshot({ path: '.cache/screenshots/block-blast-cover-mobile.png' });
  await phone.getByRole('button', { name: 'Играть: Block Blast', exact: true }).click();
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
  const cellRects = await phone.locator('.blast-cell').evaluateAll((cells) =>
    [0, 1, 8].map((i) => {
      const rect = cells[i]?.getBoundingClientRect();
      if (!rect) throw new Error('Missing board cell');
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  const [firstCell, secondCell, belowCell] = cellRects;
  assert(firstCell && secondCell && belowCell);
  const pitchX = secondCell.x - firstCell.x;
  const pitchY = belowCell.y - firstCell.y;
  const shapeHeight = (s.height - 1) * pitchY + firstCell.height;
  const ghost = phone.locator('.blast-drag-ghost');
  // Pickup is immediate; upward travel increases the separation from the finger.
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await expect(ghost).toBeVisible();
  const pickup = await ghost.boundingBox();
  assert(pickup && start.y - pickup.y - pickup.height >= 39);
  const heldBlock = await ghost.locator('i').first().elementHandle();
  assert(heldBlock);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x, y: start.y - 40 }],
  });
  await expect.poll(async () => (await ghost.boundingBox())?.y).toBeLessThan(pickup.y - 55);
  const lifted = await ghost.boundingBox();
  assert(lifted && pickup.y - lifted.y < 65);
  assert(
    await heldBlock.evaluate((block) => block.isConnected),
    'Dragging must reuse the held blocks',
  );
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(ghost).toBeHidden();
  await expect(
    phone.locator('.blast-preview, .blast-clear-preview, .blast-piece.dragging'),
  ).toHaveCount(0);
  assert.deepEqual(
    JSON.parse(await phone.evaluate(() => localStorage.getItem('arcade:block-blast:v1') ?? '{}'))
      .state,
    mobile.state,
  );
  // Move to the actual snapped cell with a shorter finger gesture than the old 1:1 mapping.
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  const freshPickup = await ghost.boundingBox();
  assert(freshPickup);
  const targetX = firstCell.x + position.x * pitchX;
  const targetY = firstCell.y + position.y * pitchY;
  const upDistance = freshPickup.y - targetY;
  assert(upDistance > 0 && upDistance < 9 * pitchY);
  const end = {
    x: start.x + (targetX - freshPickup.x) / 1.2,
    y: start.y - upDistance / 1.5,
  };
  const legacyTravel = start.y - (targetY + shapeHeight + pitchY * 0.7);
  assert(
    start.y - end.y < legacyTravel * 0.8,
    'The top row should need substantially less finger travel',
  );
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await expect(phone.locator('.blast-preview')).toHaveCount(s.cells.length);
  const placedGhost = await ghost.boundingBox();
  assert(
    placedGhost && Math.abs(placedGhost.x - targetX) < 1 && Math.abs(placedGhost.y - targetY) < 1,
  );
  await phone.screenshot({
    path: '.cache/screenshots/block-blast-mobile-drag.png',
  });
  await expect(ghost).toBeVisible();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(ghost).toBeHidden();
  assert(moveBlockBlast(mobile.state, { slot: 0, ...position }));
  assert.deepEqual(
    JSON.parse(await phone.evaluate(() => localStorage.getItem('arcade:block-blast:v1') ?? '{}'))
      .state,
    mobile.state,
  );
  await phone.screenshot({ path: '.cache/screenshots/block-blast-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `Block Blast browser checks passed (${production ? 'production free play' : 'local authoritative API'}): drag, accelerated touch with growing lift, cancellation, click, keyboard selection, solvable refill, persistence, responsive layout${production ? '' : ', retry after lost response, global/group/week rankings'}.`,
  );
} finally {
  await browser.close();
  server.kill();
}
