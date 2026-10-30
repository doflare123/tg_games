import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  const errors: string[] = [];
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
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('heading', { name: 'ВЫБИРАЙ СВОЮ ИГРУ' }).waitFor();
  assert.deepEqual(await page.locator('.card-info h3').allTextContents(), ['Тетрис']);
  assert.doesNotMatch((await page.locator('body').textContent()) ?? '', /doom|mario|дум|марио/i);
  assert.doesNotMatch(
    (await page.locator('meta[name=description]').getAttribute('content')) ?? '',
    /doom|mario|дум|марио/i,
  );
  await page.screenshot({ path: '.cache/screenshots/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Играть: Тетрис', exact: true }).click();
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
  if (production) await page.getByText('Партия завершена. Ещё одну?').waitFor();
  else
    await page
      .getByText('Результат проверен. Рекорд учтён в рейтинге.')
      .waitFor({ timeout: 15000 });
  await page.screenshot({ path: '.cache/screenshots/tetris.png', fullPage: true });
  await page.getByRole('button', { name: 'Закрыть ×' }).click();
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
    await page.getByRole('button', { name: 'Закрыть ×' }).click();
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
    await page.getByRole('button', { name: 'Закрыть ×' }).click();
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
  await page
    .getByRole('button', { name: 'DROP', exact: true })
    .dispatchEvent('pointerdown', { pointerId: 1 });
  await page
    .getByRole('button', { name: 'DROP', exact: true })
    .dispatchEvent('pointerup', { pointerId: 1 });
  await page.screenshot({ path: '.cache/screenshots/mobile-tetris.png' });
  const rectangle = await page.locator('.tetris-canvas').boundingBox();
  assert.ok(
    rectangle && rectangle.y > 0 && rectangle.y + rectangle.height < 844,
    'Mobile board should fit in the viewport',
  );

  await page.getByRole('button', { name: 'Закрыть ×' }).click();
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
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
  if (hasMario) {
    await phone.goto('http://127.0.0.1:4173/?startapp=game_mario');
    await phone.getByRole('dialog', { name: 'Super Mario Bros.', exact: true }).waitFor();
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
    await phone.getByRole('button', { name: 'Закрыть ×' }).click();
  }
  if (hasWad) {
    await phone.goto('http://127.0.0.1:4173/?startapp=game_doom');
    await phone.getByRole('dialog', { name: 'DOOM', exact: true }).waitFor();
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
    await phone.getByRole('button', { name: 'Закрыть ×' }).click();
  }
  await phoneContext.close();

  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(
    `Browser checks passed: desktop/mobile, ranked Tetris → leaderboard, hidden game links${hasMario ? ', NES load/save' : ''}${hasWad ? ', Doom WASM launch' : ''}.`,
  );
} finally {
  await browser.close();
  server.kill();
}
