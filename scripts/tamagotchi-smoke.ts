import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { newPet } from '../src/games/tamagotchi/engine.ts';
import { SqlPetRepository } from '../src/server/platform/sql-tamagotchi.ts';
import { decodePetView, type PetView } from '../src/shared/tamagotchi.ts';
import { localRepository } from './local-api.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const filename = `pet-smoke-${Date.now()}.sqlite`;
const database = localRepository(resolve('.cache', filename));
const now = Date.now() - 10_000;
const state = newPet(1, now);
state.xp = 180;
state.owned = ['wardrobe', 'plant', 'rug', 'lamp'];
state.placements = [
  { item: 'wardrobe', room: 'living', x: 0, y: 2 },
  { item: 'plant', room: 'living', x: 5, y: 2 },
  { item: 'lamp', room: 'bedroom', x: 4, y: 2 },
];
// Isolated UI fixtures. No debug reward endpoint is exposed to the app.
await new SqlPetRepository(database.db).append(
  {
    id: '1:pet:0',
    playerId: 1,
    playerName: 'Локальный игрок',
    revision: 0,
    requestId: 'adopt',
    receipt: '',
    state,
    createdAt: now,
    order: 0,
    socialProcessed: true,
  },
  -1,
);
for (let i = 0; i < 5; i++) {
  await database.db.run(
    `INSERT INTO runs(id,player_id,player_name,mode,ruleset,revision,status,state_json,score,ticks,lines,created_at,expires_at,verified_at,social_processed)
    VALUES(:id,1,'Локальный игрок','marathon','tetris-arcade-v1',1,'verified','{}',5000,600,1,:now,:expiry,:now,1)`,
    { ':id': `ui-tetris-${i}`, ':now': now + 1, ':expiry': now + 1000000 },
  );
  await database.db.run(
    `INSERT INTO block_blast_runs(id,player_id,player_name,ruleset,revision,state_json,status,score,created_at,expires_at,verified_at,social_processed)
    VALUES(:id,1,'Локальный игрок','block-blast-v1',1,'{"moves":30}','verified',5000,:now,:expiry,:now,1)`,
    { ':id': `ui-block-${i}`, ':now': now + 1, ':expiry': now + 1000000 },
  );
  await database.db.run(
    `INSERT INTO snake_runs(id,player_id,player_name,ruleset,size,revision,state_json,status,score,created_at,expires_at,verified_at,social_processed)
    VALUES(:id,1,'Локальный игрок','snake-v1',16,1,'{"ticks":100}','verified',50,:now,:expiry,:now,1)`,
    { ':id': `ui-snake-${i}`, ':now': now + 1, ':expiry': now + 1000000 },
  );
}
database.close();
const origin = 'http://127.0.0.1:4181';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4181', '--strictPort'],
  {
    env: { ...process.env, TG_GAMES_DEV_DATABASE: filename },
    stdio: 'ignore',
    windowsHide: true,
  },
);
const browser = await chromium.launch({ headless: true });
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Server startup. */
    }
    if (i === 99) throw new Error('Vite failed to start');
    await new Promise((done) => setTimeout(done, 100));
  }
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
      window.Telegram={WebApp:{initData:'local-browser-test',initDataUnsafe:{},ready(){},expand(){},
        Serverless:{call(name,input,callback){
          const check=(value)=>{if(value===null||typeof value!=='object')return;
            if(!Array.isArray(value)&&Object.keys(value).some(key=>/^(0|[1-9][0-9]*)$/.test(key))) throw new Error('Cannot convert: v8::Object key is not a string');
            Object.values(value).forEach(check);};
          fetch('/__dev/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
          .then(r=>r.json()).then(r=>{if(!r.ok){callback({message:r.error,parameters:{code:r.code}},null);return;}
            check(r.result);callback(null,r.result);}).catch(e=>callback({message:e.message},null));
        }}
      }};
    `,
    }),
  );
  const profile = async (): Promise<PetView> => {
    const response = await page.request.post(`${origin}/__dev/rpc/getPet`, { data: {} });
    return decodePetView(((await response.json()) as { result: unknown }).result);
  };
  await page.goto(`${origin}/#pet`);
  await expect(page.getByRole('heading', { name: 'Кто поселится у тебя дома?' })).toBeVisible();
  await expect(page.locator('.pet-species-card')).toHaveCount(6);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({
    path: '.cache/screenshots/tamagotchi-animals-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: '.cache/screenshots/tamagotchi-animals-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Выбрать: Лиса', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Хорошо, что ты здесь.' })).toBeVisible();
  await expect(page.locator('.pet-mascot-button .species-fox')).toBeVisible();
  await page.reload();
  await expect(page.locator('.pet-mascot-button .species-fox')).toBeVisible();
  await expect(page.getByRole('button', { name: /Сменить зверька/ })).toHaveCount(0);
  const current = await profile();
  const rejectedChange = await page.request.post(`${origin}/__dev/rpc/actPet`, {
    data: {
      requestId: 'forbidden_pet_change_request',
      revision: current.revision,
      action: { type: 'species', species: 'panda' },
    },
  });
  assert.equal(((await rejectedChange.json()) as { code: string }).code, 'CONFLICT');
  assert.equal((await profile()).state.species, 'fox');
  assert.equal((await profile()).state.xp, 180);
  await page.setViewportSize({ width: 1360, height: 1100 });
  await expect(page.locator('.pet-wish')).toHaveCount(3);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/tamagotchi-desktop.png', fullPage: true });
  await page.locator('.pet-home').screenshot({ path: '.cache/screenshots/tamagotchi-room.png' });
  if ((await page.locator('.pet-decoration').getAttribute('open')) === null)
    await page.getByText('Обустроить дом и изменить имя', { exact: false }).click();
  await page.getByRole('textbox', { name: 'Имя питомца' }).fill('Листик');
  await page.getByRole('button', { name: 'Назвать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Листик', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Спальня', exact: true }).click();
  await expect(page.locator('.room-bedroom')).toBeVisible();
  if ((await page.locator('.pet-decoration').getAttribute('open')) === null)
    await page.getByText('Обустроить дом и изменить имя', { exact: false }).click();
  await page.getByRole('button', { name: '☁️ Облачный ковёр', exact: true }).click();
  await page
    .getByRole('button', { name: 'Поставить Облачный ковёр: ряд 3, место 3', exact: true })
    .click();
  await expect
    .poll(async () => (await profile()).state.placements.find((p) => p.item === 'rug')?.room)
    .toBe('bedroom');
  await page.getByRole('button', { name: 'Закончить перестановку', exact: true }).click();
  await page.getByRole('button', { name: 'Магазин', exact: true }).click();
  const before = (await profile()).wallet['block-blast'].sparks;
  await page
    .locator('.pet-shop-item')
    .filter({ has: page.getByRole('heading', { name: 'Банан', exact: true }) })
    .getByRole('button', { name: 'Угостить', exact: true })
    .click();
  await expect.poll(async () => (await profile()).wallet['block-blast'].sparks).toBe(before - 10);
  const mutationRoute = '**/__dev/rpc/actPet';
  await page.route(mutationRoute, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await page.unroute(mutationRoute);
    await route.abort('failed');
  });
  await page
    .locator('.pet-shop-item')
    .filter({ has: page.getByRole('heading', { name: 'Банан', exact: true }) })
    .getByRole('button', { name: 'Угостить', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Повторить действие', exact: true })).toBeEnabled();
  await expect.poll(async () => (await profile()).wallet['block-blast'].sparks).toBe(before - 20);
  await page.reload();
  await page.getByRole('button', { name: 'Повторить действие', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить действие', exact: true })).toHaveCount(
    0,
  );
  assert.equal((await profile()).wallet['block-blast'].sparks, before - 20);
  await page.getByRole('button', { name: 'Желания', exact: true }).click();
  const first = page
    .locator('.pet-wish')
    .first()
    .getByRole('button', { name: 'Исполнить желание ♡', exact: true });
  await expect(first).toBeEnabled();
  await first.click();
  await expect(page.locator('.pet-wish.complete')).toHaveCount(1);
  assert.equal((await profile()).state.xp, 225);
  await page.getByRole('button', { name: 'Рейтинг', exact: true }).click();
  await expect(page.locator('.pet-board-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Желания', exact: true }).click();
  await page.getByRole('button', { name: 'Гостиная', exact: true }).click();
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.pet-scene')).toBeVisible();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Horizontal overflow at ${width}px`,
    );
    if (width === 390)
      await page.screenshot({ path: '.cache/screenshots/tamagotchi-mobile.png', fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.pet-mascot-button .moti')
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await page.getByRole('button', { name: 'Block Blast ↗', exact: true }).first().click();
  await expect(page.getByRole('group', { name: 'Поле Block Blast 8 на 8' })).toBeVisible();
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Листик', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.pet-wish.complete')).toHaveCount(1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Pet browser checks passed: purchases, wishes, rooms, persistence, ranking, navigation, 320/390/768px and reduced motion.',
  );
} finally {
  await browser.close();
  server.kill();
}
