// Launches public practice play; never calls a player API or creates a ranked run.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DoomEvent } from '../src/client/games/doom/protocol.ts';
import { MINI_APP_URL } from '../src/server/platform/mini-app-config.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const playerRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) playerRequests.push(request.url());
  });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.addInitScript(() => {
    Reflect.set(window, 'events', []);
    window.addEventListener('message', (event) => {
      if (
        event.origin === location.origin &&
        event.data &&
        typeof event.data.type === 'string' &&
        event.data.type.startsWith('doom:')
      )
        (Reflect.get(window, 'events') as DoomEvent[]).push(event.data);
    });
  });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('requestfailed', (request) =>
    failures.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  let requests = 0,
    received = 0;
  page.on('response', (response) => {
    if (!response.url().endsWith('/freedoom1.wad')) return;
    requests++;
    if (requests % 7 === 0) console.log(`WAD ranges received: ${requests}/28`);
    if (response.status() !== 206) failures.push(`WAD HTTP ${response.status()}`);
    const range = response.headers()['content-range'];
    if (!range) failures.push('WAD range header missing');
    else
      received +=
        Number(range.split('-')[1]?.split('/')[0]) - Number(range.split(' ')[1]?.split('-')[0]) + 1;
  });
  await page.goto(MINI_APP_URL, { waitUntil: 'domcontentloaded' });
  const launch = page.getByRole('button', { name: 'Играть: Freedoom', exact: true });
  await expect(launch).toBeVisible({ timeout: 20000 });
  await launch.click();
  await page.getByRole('button', { name: 'Новый забег', exact: true }).click();
  try {
    await page.waitForFunction(
      () => {
        const events = Reflect.get(window, 'events') as DoomEvent[];
        return events.some(
          (event) =>
            event.type === 'doom:error' ||
            (event.type === 'doom:commands' && event.activeTicks >= 35),
        );
      },
      undefined,
      { timeout: 180000 },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        requests,
        received,
        failures,
        frames: page.frames().map((frame) => frame.url()),
        events: await page.evaluate(() => Reflect.get(window, 'events')),
      }),
    );
    throw error;
  }
  const events = await page.evaluate(() => Reflect.get(window, 'events') as DoomEvent[]);
  assert.deepEqual(
    events.filter((event) => event.type === 'doom:error'),
    [],
  );
  assert.ok(events.some((event) => event.type === 'doom:running'));
  assert.ok(events.some((event) => event.type === 'doom:commands' && event.activeTicks >= 35));
  assert.ok(requests >= 28);
  assert.equal(received, 28795076);
  assert.deepEqual(failures, []);
  assert.deepEqual(playerRequests, []);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/doom-live-start.png', fullPage: true });
  console.log(
    `Published Freedoom started and advanced in Chromium: ${requests} bounded WAD responses; no player APIs called.`,
  );
} finally {
  await browser.close();
}
