import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DoomEngine } from '../src/shared/doom-engine.ts';
import { doomTestWad } from './doom-test-fixture.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const origin = 'http://127.0.0.1:4179';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
  {
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      TG_GAMES_DEV_OWNER: '1',
      TG_GAMES_DEV_DATABASE: `doom-smoke-${Date.now()}.sqlite`,
    },
  },
);
const guestOrigin = 'http://127.0.0.1:4180';
const guest = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4180', '--strictPort'],
  {
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      TG_GAMES_DEV_OWNER: '0',
      TG_GAMES_DEV_DATABASE: `doom-guest-${Date.now()}.sqlite`,
    },
  },
);
guest.stderr.on('data', () => {});
let output = '';
server.stderr.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});
const browser = await chromium.launch({ headless: true });
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* starting */
    }
    if (i === 99) throw new Error(`Vite failed: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(guestOrigin)).ok) break;
    } catch {
      /* starting */
    }
    if (i === 99) throw new Error('Guest server did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.goto(guestOrigin);
  await expect(page.getByRole('button', { name: 'Играть: Тетрис', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Играть: Freedoom', exact: true })).toHaveCount(0);
  for (const name of [
    'createDoomRun',
    'getDoomProgress',
    'appendDoomCommands',
    'interruptDoomRun',
    'verifyDoomRun',
    'getDoomLeaderboard',
  ]) {
    const response = await page.request.post(`${guestOrigin}/__dev/rpc/${name}`, {
      data: { playerId: 930852883, isAdmin: true },
    });
    const data = (await response.json()) as { ok: boolean; code: string };
    assert.equal(data.ok, false);
    assert.equal(data.code, 'UNAUTHORIZED');
  }
  await page.goto(`${guestOrigin}/?startapp=game_doom`);
  await expect(page.getByText('Freedoom пока доступен только владельцу.')).toBeVisible();
  assert.equal(await page.locator('.doom-frame').count(), 0);
  const errors: string[] = [];
  const uploadBodies: string[] = [];
  let lostUpload = false;
  await page.route('**/__dev/rpc/appendDoomCommands', async (route) => {
    uploadBodies.push(route.request().postData() ?? '');
    if (!lostUpload) {
      lostUpload = true;
      await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.abort('failed');
    } else await route.continue();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?startapp=game_doom`);
  await expect(page.getByRole('button', { name: 'Новый забег', exact: true })).toBeVisible();
  assert.equal(await page.locator('input[type=file]').count(), 0);
  await page.getByRole('button', { name: 'Новый забег', exact: true }).click();
  await expect(page.getByText(/^Игра идёт/)).toBeVisible({ timeout: 30000 });
  const canvas = page.frameLocator('.doom-frame').locator('canvas');
  await canvas.click();
  await canvas.press('ArrowUp');
  await expect(page.getByText(/Автосохранение: 0:(?:0[5-9]|[1-5][0-9])/)).toBeVisible({
    timeout: 20000,
  });
  assert.ok(uploadBodies.length >= 2);
  assert.equal(
    uploadBodies[0],
    uploadBodies[1],
    'A lost upload response must retry the exact payload while play continues',
  );
  const rpc = async (name: string, input: unknown) => {
    const response = await page.request.post(`${origin}/__dev/rpc/${name}`, { data: input });
    const data = (await response.json()) as { ok: boolean; result: unknown };
    assert.equal(data.ok, true);
    return data.result;
  };
  const initial = (await rpc('getDoomProgress', {})) as {
    run: { id: string; acceptedTicks: number; continuous: boolean };
  };
  let held = false;
  await page.route('**/__dev/rpc/verifyDoomRun', async (route) => {
    held = true;
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });
  await page.evaluate((runId) => {
    void fetch('/__dev/rpc/verifyDoomRun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
  }, initial.run.id);
  await expect.poll(() => held).toBe(true);
  await expect
    .poll(
      async () => {
        const progress = (await rpc('getDoomProgress', {})) as { run: { acceptedTicks: number } };
        return progress.run.acceptedTicks;
      },
      { timeout: 7000 },
    )
    .toBeGreaterThan(initial.run.acceptedTicks + 100);
  await page.unroute('**/__dev/rpc/verifyDoomRun');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect
    .poll(async () => {
      const progress = (await rpc('getDoomProgress', {})) as { run: { continuous: boolean } };
      return progress.run.continuous;
    })
    .toBe(false);
  await page.reload();
  const restore = page.getByRole('button', { name: 'Продолжить сохранённую игру', exact: true });
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(page.getByText(/^Игра идёт/)).toBeVisible({ timeout: 30000 });
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/doom-ranked.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.cache/screenshots/doom-ranked-mobile.png', fullPage: true });
  await page.goto(origin);
  // Compare the real SDL/browser engine against the independently built headless engine.
  const wad = doomTestWad(await readFile('public/engines/doom/freedoom1.wad'), true);
  await page.route('**/__doom-test.wad', (route) =>
    route.fulfill({ body: Buffer.from(wad), contentType: 'application/octet-stream' }),
  );
  const actual = await page.evaluate(async () => {
    const engineUrl = '/engines/doom/play.js';
    const create = (await import(engineUrl)).default as (options: unknown) => Promise<DoomEngine>;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    document.body.append(canvas);
    const engine = await create({
      canvas,
      noInitialRun: true,
      locateFile: (name: string) => `/engines/doom/${name}`,
      print: () => {},
      printErr: () => {},
    });
    engine.FS.writeFile(
      '/doom.wad',
      new Uint8Array(await (await fetch('/__doom-test.wad')).arrayBuffer()),
    );
    engine.callMain(['-iwad', '/doom.wad', '-warp', '1', '1', '-skill', '3', '-nosound']);
    const snapshots: number[][] = [];
    for (let tick = 0; tick < 15000 && !engine._arcade_get(4); tick++) {
      engine._arcade_step(tick % 4 === 0 ? 384 : 0);
      engine._arcade_draw();
      if (tick % 35 === 0 || engine._arcade_get(4))
        snapshots.push(Array.from({ length: 11 }, (_, i) => engine._arcade_get(i)));
    }
    return {
      snapshots,
      complete: engine._arcade_get(4),
      splits: Array.from({ length: engine._arcade_get(5) }, (_, i) =>
        Array.from({ length: 8 }, (_, j) => engine._arcade_split(i, j)),
      ),
    };
  });
  const factory = (await import(pathToFileURL(resolve('public/engines/doom/verify.js')).href))
    .default as (options: unknown) => Promise<DoomEngine>;
  const engine = await factory({ noInitialRun: true, print: () => {}, printErr: () => {} });
  engine.FS.writeFile('/doom.wad', wad);
  engine.callMain(['-iwad', '/doom.wad', '-warp', '1', '1', '-skill', '3', '-nosound']);
  const snapshots: number[][] = [];
  for (let tick = 0; tick < 15000 && !engine._arcade_get(4); tick++) {
    engine._arcade_step(tick % 4 === 0 ? 384 : 0);
    if (tick % 35 === 0 || engine._arcade_get(4))
      snapshots.push(Array.from({ length: 11 }, (_, i) => engine._arcade_get(i)));
  }
  assert.equal(actual.complete, 1);
  assert.deepEqual(actual.snapshots, snapshots);
  assert.deepEqual(
    actual.splits,
    Array.from({ length: engine._arcade_get(5) }, (_, i) =>
      Array.from({ length: 8 }, (_, j) => engine._arcade_split(i, j)),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Doom smoke passed: no uploads, automatic resume, background verification, mobile layout and browser/headless replay through all 9 synthetic test maps.',
  );
} finally {
  await browser.close();
  server.kill();
  guest.kill();
}
