import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { object, text } from '../src/shared/errors.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect: baseExpect } = await import('@playwright/test');
const expect = baseExpect.configure({ timeout: 15000 });
const ownerOrigin = 'http://127.0.0.1:4181';
const guestOrigin = 'http://127.0.0.1:4182';
const servers = [true, false].map((owner, i) =>
  spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(4181 + i),
      '--strictPort',
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, TG_GAMES_DEV_OWNER: owner ? '1' : '0' },
    },
  ),
);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (const origin of [ownerOrigin, guestOrigin]) {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {
        /* Starting local Vite. */
      }
      if (i === 99) throw new Error('Local admin test server did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async function rpc(origin: string, name: string, input: unknown): Promise<unknown> {
    const result = object(
      await (
        await fetch(`${origin}/__dev/rpc/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).json(),
    );
    if (result.ok !== true) throw new Error(String(result.error));
    return result.result;
  }
  const created = object(
    await rpc(ownerOrigin, 'create2048Run', { requestId: crypto.randomUUID() }),
  );
  const runId = text(created.id, 1, 100);
  await rpc(ownerOrigin, 'submit2048Moves', { runId, revision: 0, moves: [], finish: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log('pageerror', error.message);
  });
  page.on('requestfailed', (request) => {
    console.log('request failed', request.url(), request.failure()?.errorText);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) console.log('HTTP', response.status(), response.url());
  });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.goto(`${ownerOrigin}/#admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'КАБИНЕТ ВЛАДЕЛЬЦА' })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole('heading', { name: 'АКТИВНОСТЬ ПО НЕДЕЛЯМ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Кабинет', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Обращения и рассылки в боте ↗' })).toHaveAttribute(
    'href',
    'https://t.me/local_arcade_bot?start=inbox',
  );
  await expect(page.getByRole('link', { name: 'Предложить улучшение ↗' })).toHaveAttribute(
    'href',
    'https://t.me/local_arcade_bot?start=feedback',
  );
  const broadcastFixture = `browser-broadcast-${crypto.randomUUID()}`;
  const threadFixture = `browser-thread-${crypto.randomUUID()}`;
  const threadPlayer = 900000000000 + Math.floor(Math.random() * 1000000000);
  const localDatabase = new DatabaseSync(resolve('.cache/arcade-admin-dev.sqlite'));
  try {
    localDatabase
      .prepare(`INSERT INTO communication_jobs(id,kind,player_id,chat_id,body,status,due_at,expires_at,attempts,lease_until,telegram_message_id,error,created_at)
      VALUES(?,'broadcast',0,-10001,'Сообщение группы в общем журнале','sent',1,10000,1,0,5068,NULL,1)`)
      .run(broadcastFixture);
    for (let i = 0; i < 3; i++) {
      localDatabase
        .prepare(
          'INSERT INTO support_threads(player_id,player_name,created_at,updated_at) VALUES(?,?,1,1)',
        )
        .run(threadPlayer + i, `${threadFixture}-${i}`);
      localDatabase
        .prepare("INSERT INTO support_messages VALUES(?,?,'player','Баг',1)")
        .run(`${threadFixture}:in:${i}`, threadPlayer + i);
      if (i > 0)
        localDatabase
          .prepare(
            `UPDATE support_threads SET read_order=(SELECT MAX(rowid) FROM support_messages WHERE player_id=?) WHERE player_id=?`,
          )
          .run(threadPlayer + i, threadPlayer + i);
      if (i === 2) {
        localDatabase
          .prepare("INSERT INTO support_messages VALUES(?,?,'owner','Исправлено',2)")
          .run(`${threadFixture}:out`, threadPlayer + i);
        localDatabase
          .prepare("UPDATE communication_jobs SET status='sent' WHERE id=?")
          .run(`${threadFixture}:out`);
        localDatabase
          .prepare('UPDATE support_threads SET closed=1 WHERE player_id=?')
          .run(threadPlayer + i);
      }
    }
  } finally {
    localDatabase.close();
  }
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Данные', exact: true }).click();
  await page.getByLabel('Таблица данных').selectOption('social_jobs');
  await page.getByLabel('Поиск по данным').fill(broadcastFixture);
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'Сообщение группы в общем журнале', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть доставку в боте ↗' })).toHaveAttribute(
    'href',
    'https://t.me/local_arcade_bot?start=delivery',
  );
  await expect(page.getByRole('button', { name: 'Отменить отправку', exact: true })).toHaveCount(0);
  await page.getByLabel('Таблица данных').selectOption('support_threads');
  await page.getByLabel('Поиск по данным').fill(threadFixture);
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  for (const label of ['🟢 Новое', '🟡 Ждёт ответа', '🔴 Ответ доставлен', '📁 Закрыто']) {
    await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Открыть диалог в боте ↗' }).first()).toHaveAttribute(
    'href',
    /^https:\/\/t.me\/local_arcade_bot\?start=dialog_\d+$/,
  );
  await page.getByLabel('Таблица данных').selectOption('puzzle2048_runs');
  await page.getByLabel('Поиск по данным').fill(runId);
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await page.getByRole('button', { name: 'Снять результат', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Причина изменения').fill('Browser test: revoke a local fixture');
  await dialog.getByRole('checkbox').check();
  let applyCalls = 0;
  await page.route('**/__dev/rpc/applyAdminAction', async (route) => {
    applyCalls++;
    if (applyCalls === 1) {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Изменение сохранено');
  assert.equal(applyCalls, 2);
  const audit = object(
    await rpc(ownerOrigin, 'getAdminRows', { table: 'admin_audit', page: 0, search: runId }),
  );
  assert(Array.isArray(audit.rows) && audit.rows.length === 1);
  await page.getByRole('button', { name: 'Журнал изменений', exact: true }).click();
  await expect(page.locator('caption')).toHaveText('Журнал изменений');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'АКТИВНОСТЬ ПО НЕДЕЛЯМ' })).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.cache/screenshots/admin-mobile.png', fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'АКТИВНОСТЬ ПО НЕДЕЛЯМ' })).toBeVisible();
  await page.getByRole('button', { name: 'Игры', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ВЫБИРАЙ СВОЮ ИГРУ' })).toBeVisible();
  await page.goto(`${guestOrigin}/#admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toContainText('только владельцу');
  await expect(page.getByRole('button', { name: 'Кабинет', exact: true })).toHaveCount(0);
  for (const method of [
    'getAdminStats',
    'getAdminRows',
    'previewAdminAction',
    'applyAdminAction',
  ]) {
    const response = object(
      await (
        await fetch(`${guestOrigin}/__dev/rpc/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: 930852883,
            actor_id: 930852883,
            table: 'groups',
            action: 'disable_notifications',
            target: '-10001',
          }),
        })
      ).json(),
    );
    assert.equal(response.ok, false);
    assert.match(String(response.error), /только владельцу/);
  }
  assert.deepEqual(errors, []);
  console.log(
    'Admin desktop/mobile, real local SQLite, revoked result, lost response + idempotent retry, audit, direct route, navigation, non-owner API denial: passed. No cloud requests or production changes.',
  );
} finally {
  await browser?.close();
  for (const server of servers) server.kill();
}
