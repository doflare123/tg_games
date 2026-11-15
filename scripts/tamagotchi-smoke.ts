import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Route } from '@playwright/test';
import { newPet } from '../src/games/tamagotchi/engine.ts';
import { SqlPetRepository } from '../src/server/platform/sql-tamagotchi.ts';
import { decodePetView, type PetMutation, type PetView } from '../src/shared/tamagotchi.ts';
import { localRepository } from './local-api.ts';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const filename = `pet-smoke-${Date.now()}.sqlite`;
const database = localRepository(resolve('.cache', filename));
const now = Date.now() - 10_000;
const state = newPet(1, now);
state.xp = 180;
state.needs = { food: 75, joy: 40, energy: 40, clean: 40 };
state.owned = ['wardrobe', 'plant', 'rug', 'lamp', 'bed'];
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
  const placeOnSurface = async (item: string, parent: string, slot: number) => {
    await page.getByRole('button', { name: 'На поверхность', exact: true }).click();
    await page
      .locator('.pet-surface-destinations')
      .getByRole('button', { name: `Поставить ${item} на ${parent}: место ${slot}`, exact: true })
      .click();
    await expect(page.locator('.pet-surface-destinations')).toHaveCount(0);
  };
  const checkThumbnails = async (context: string) => {
    const contained = await page.locator('.pet-item-picture img').evaluateAll(async (nodes) => {
      await Promise.all(nodes.map((node) => (node as HTMLImageElement).decode()));
      return nodes.every((node) => {
        const image = node.getBoundingClientRect();
        const box = node.parentElement?.getBoundingClientRect();
        if (!box || box.width === 0) return true;
        return (
          image.left >= box.left - 0.5 &&
          image.right <= box.right + 0.5 &&
          image.top >= box.top - 0.5 &&
          image.bottom <= box.bottom + 0.5
        );
      });
    });
    assert(contained, `Thumbnail exceeds its frame: ${context}`);
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
  const careRpcPattern = '**/__dev/rpc/actPet';
  const careRequests: PetMutation[] = [];
  let activeCareRequests = 0;
  let maxActiveCareRequests = 0;
  let holdNextCare = true;
  let dropNextCare = false;
  let releaseCare: (() => void) | undefined;
  const releaseHeldCare = () => {
    releaseCare?.();
  };
  const careRoute = async (route: Route) => {
    const mutation = route.request().postDataJSON() as PetMutation;
    if (mutation.action.type !== 'care') {
      await route.continue();
      return;
    }
    careRequests.push(mutation);
    activeCareRequests++;
    maxActiveCareRequests = Math.max(maxActiveCareRequests, activeCareRequests);
    try {
      if (holdNextCare) {
        holdNextCare = false;
        await new Promise<void>((resolve) => {
          releaseCare = resolve;
        });
      }
      const response = await route.fetch();
      if (dropNextCare) {
        dropNextCare = false;
        await route.abort('failed');
      } else await route.fulfill({ response });
    } finally {
      activeCareRequests--;
    }
  };
  await page.route(careRpcPattern, careRoute);
  const originalScene = await page.locator('.pet-scene').elementHandle();
  if (!originalScene) throw new Error('Pet scene missing');
  const beforeCare = await profile();
  await page.locator('.pet-mascot-button').click();
  await expect.poll(() => releaseCare !== undefined).toBe(true);
  await expect(page.locator('.pet-scene')).toHaveClass(/petting/);
  const petCareButton = page.getByRole('button', { name: '♡ Погладить', exact: true });
  for (let i = 0; i < 4; i++) await petCareButton.click();
  await expect(page.getByRole('button', { name: '◌ Искупать', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '☾ Отдохнуть', exact: true })).toBeEnabled();
  assert.equal(await petCareButton.evaluate((node) => getComputedStyle(node).opacity), '1');
  await expect(page.locator('.pet-status')).not.toContainText('Сохраняем');
  assert.equal((await profile()).state.needs.joy, beforeCare.state.needs.joy);
  await page.getByRole('button', { name: '◌ Искупать', exact: true }).click();
  await expect(page.locator('.pet-scene')).toHaveClass(/washing/);
  await page.getByRole('button', { name: '☾ Отдохнуть', exact: true }).click();
  await expect(page.locator('.pet-scene')).toHaveClass(/sleepy/);
  assert.equal(careRequests.length, 1, 'Repeated taps must not send duplicate care writes');
  // Another device updates this same pet while the first care request is still delayed.
  const external = await page.request.post(`${origin}/__dev/rpc/actPet`, {
    data: {
      requestId: 'other_device_care_conflict',
      revision: beforeCare.revision,
      action: { type: 'rename', name: beforeCare.state.name },
    },
  });
  assert.equal(external.status(), 200);
  releaseHeldCare();
  await expect
    .poll(async () => (await profile()).state.needs)
    .toEqual({ food: 75, joy: 52, energy: 65, clean: 65 });
  await expect(page.locator('.need-energy progress')).toHaveJSProperty('value', 65);
  assert.equal(careRequests.length, 4, 'One rejected stale request, its retry, wash, and rest');
  assert.equal(maxActiveCareRequests, 1);
  assert(
    await originalScene.evaluate(
      (node) => node.isConnected && node === document.querySelector('.pet-scene'),
    ),
    'Care must preserve the existing scene',
  );
  assert.equal((await profile()).state.xp, 180);
  const savedCareCount = careRequests.length;
  await petCareButton.click();
  await expect(petCareButton).toBeFocused();
  await expect(page.locator('.pet-scene')).toHaveClass(/petting/);
  assert.equal(careRequests.length, savedCareCount);
  await expect(page.locator('.pet-care-actions [data-care="pet"] small')).toHaveText(
    'можно позаботиться',
    { timeout: 20000 },
  );
  // Server commits the next petting, but its response is lost. Retry must reuse the key.
  dropNextCare = true;
  const beforeLostCare = await profile();
  await petCareButton.click();
  await expect.poll(() => careRequests.length).toBe(savedCareCount + 2);
  await expect(page.locator('.need-joy progress')).toHaveJSProperty('value', 64);
  const lostRequest = careRequests[savedCareCount];
  const retriedRequest = careRequests[savedCareCount + 1];
  assert.equal(retriedRequest?.requestId, lostRequest?.requestId);
  assert.equal(retriedRequest?.revision, lostRequest?.revision);
  assert.equal((await profile()).revision, beforeLostCare.revision + 1);
  await expect(page.locator('.pet-status')).not.toContainText('Сохраняем');
  assert(
    await originalScene.evaluate(
      (node) => node.isConnected && node === document.querySelector('.pet-scene'),
    ),
  );
  // A purchase made during care waits for its confirmed revision, then spends once.
  await page.getByRole('button', { name: 'Магазин', exact: true }).click();
  holdNextCare = true;
  releaseCare = undefined;
  await page.getByRole('button', { name: '◌ Искупать', exact: true }).click();
  await expect.poll(() => releaseCare !== undefined).toBe(true);
  const beforeConcurrentPurchase = (await profile()).wallet['block-blast'].sparks;
  await page
    .locator('.pet-shop-item')
    .filter({ has: page.getByRole('heading', { name: 'Банан', exact: true }) })
    .getByRole('button', { name: 'Угостить', exact: true })
    .click();
  releaseHeldCare();
  await expect
    .poll(async () => (await profile()).wallet['block-blast'].sparks)
    .toBe(beforeConcurrentPurchase - 10);
  await expect(page.locator('.pet-status')).toContainText('Дома стало');
  await page.unroute(careRpcPattern, careRoute);
  await page.getByRole('button', { name: 'Желания', exact: true }).click();
  await expect(page.locator('.pet-wish')).toHaveCount(3);
  await mkdir('.cache/screenshots', { recursive: true });
  await page.screenshot({ path: '.cache/screenshots/tamagotchi-desktop.png', fullPage: true });
  await page.locator('.pet-home').screenshot({ path: '.cache/screenshots/tamagotchi-room.png' });
  await page.getByText('Палитра и имя питомца', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя питомца' }).fill('Листик');
  await page.getByRole('button', { name: 'Назвать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Листик', exact: true })).toBeVisible();
  await page.locator('.furniture-wardrobe').click({ force: true });
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await expect(page.locator('.pet-decoration')).toBeHidden();
  // Choosing furniture is separate from choosing its new location.
  await page.getByRole('button', { name: '✦ Обустроить', exact: true }).click();
  await page.getByRole('button', { name: 'Шкаф с секретом: выбрать предмет', exact: true }).click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Переместить', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Убрать', exact: true })).toBeVisible();
  const beforeCancel = await profile();
  await page.getByRole('button', { name: 'Переместить', exact: true }).click();
  await expect(page.locator('.pet-placement-cell')).toHaveCount(18);
  await expect(
    page.getByRole('button', { name: 'Занято Шкаф с секретом: ряд 1, место 6', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  assert.equal((await profile()).revision, beforeCancel.revision);
  assert.deepEqual((await profile()).state.placements, beforeCancel.state.placements);
  // Starter furniture uses the same editor and persists through the server.
  await expect(page.locator('.pet-starter-furnishing')).toHaveCount(8);
  await expect(page.locator('.furniture-starter-console img')).toHaveAttribute(
    'src',
    /cabinetTelevision_SW/,
  );
  const assembly = async () =>
    page.locator('.pet-iso-world').evaluate((world) => {
      const bounds = (selector: string) => {
        const node = world.querySelector(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const rect = node.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width };
      };
      return {
        console: bounds('.furniture-starter-console'),
        radio: bounds('.furniture-starter-radio'),
        pot: bounds('.furniture-starter-pot'),
      };
    });
  const beforeAssembly = await assembly();
  const starterRequests: PetMutation[] = [];
  await page.route('**/__dev/rpc/actPet', async (route) => {
    const mutation = route.request().postDataJSON() as PetMutation;
    starterRequests.push(mutation);
    const response = await route.fetch();
    if (starterRequests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page
    .getByRole('button', { name: 'Деревянная тумба: выбрать предмет', exact: true })
    .click();
  await page.getByRole('button', { name: 'Переместить', exact: true }).click();
  await page
    .getByRole('button', { name: 'Поставить Деревянная тумба: ряд 1, место 4', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Повторить действие', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Повторить действие', exact: true }).click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await page.unroute('**/__dev/rpc/actPet');
  assert.deepEqual(starterRequests[0], starterRequests[1]);
  const afterAssembly = await assembly();
  for (const key of ['radio', 'pot'] as const) {
    assert(
      Math.abs(
        afterAssembly[key].x -
          afterAssembly.console.x -
          (beforeAssembly[key].x - beforeAssembly.console.x),
      ) < 0.1,
    );
    assert(
      Math.abs(
        afterAssembly[key].y -
          afterAssembly.console.y -
          (beforeAssembly[key].y - beforeAssembly.console.y),
      ) < 0.1,
    );
  }
  const movedStarters = (await profile()).state.starterPlacements;
  for (const item of ['starter-console', 'starter-radio', 'starter-pot'])
    assert(movedStarters.some((p) => p.item === item && p.x === 3 && p.y === 2));
  await page.reload();
  await expect(page.locator('.furniture-starter-console')).toBeVisible();
  assert.deepEqual((await profile()).state.starterPlacements, movedStarters);
  await page.getByRole('button', { name: '✦ Обустроить', exact: true }).click();
  await page.getByRole('button', { name: /^Радио · Гостиная/ }).click();
  await page.getByRole('button', { name: 'Переместить', exact: true }).click();
  await page.getByRole('button', { name: 'Поставить Радио: ряд 3, место 1', exact: true }).click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  assert.equal(
    (await profile()).state.starterPlacements.find((p) => p.item === 'starter-radio')?.on,
    undefined,
  );
  await page.getByRole('button', { name: /^Радио · Гостиная/ }).click();
  await placeOnSurface('Радио', 'Деревянная тумба', 1);
  await expect(page.locator('.furniture-starter-radio')).toHaveAttribute(
    'data-support',
    'starter-console',
  );
  await page.getByRole('button', { name: /^Маленький горшок · Гостиная/ }).click();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(page.locator('.furniture-starter-pot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Маленький горшок · Кладовка', exact: true }).click();
  await placeOnSurface('Маленький горшок', 'Деревянная тумба', 2);
  await expect(page.locator('.furniture-starter-pot')).toHaveAttribute(
    'data-support',
    'starter-console',
  );
  // Surface placement is a player action on different pieces of furniture.
  await page.getByRole('button', { name: /^Радио · Гостиная/ }).click();
  await page.getByRole('button', { name: 'На поверхность', exact: true }).click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await expect(
    page.locator('.pet-surface-destinations').getByRole('button', {
      name: 'Поставить Радио на Деревянная тумба: место 2 · занято',
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Место 1 на Журнальный столик', exact: true }).click();
  await expect(page.locator('.furniture-starter-radio')).toHaveAttribute(
    'data-support',
    'starter-table',
  );
  await page.getByRole('button', { name: /^Маленький горшок · Гостиная/ }).click();
  await placeOnSurface('Маленький горшок', 'Журнальный столик', 2);
  await page.getByRole('button', { name: /^Стопка книг · Гостиная/ }).click();
  await page.getByRole('button', { name: 'На поверхность', exact: true }).click();
  const occupiedTable = page
    .locator('.pet-surface-destinations')
    .getByRole('button', { name: /Поставить Стопка книг на Журнальный столик/ });
  await expect(occupiedTable).toHaveCount(2);
  await expect(occupiedTable.nth(0)).toBeDisabled();
  await expect(occupiedTable.nth(1)).toBeDisabled();
  const beforeSurfaceCancel = await profile();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal((await profile()).revision, beforeSurfaceCancel.revision);
  await page.getByRole('button', { name: /^Журнальный столик · Гостиная/ }).click();
  await expect(page.getByRole('button', { name: 'На поверхность', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Переместить', exact: true }).click();
  await page
    .getByRole('button', { name: 'Поставить Журнальный столик: ряд 2, место 4', exact: true })
    .click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  for (const item of ['starter-table', 'starter-radio', 'starter-pot'])
    assert(
      (await profile()).state.starterPlacements.some(
        (p) => p.item === item && p.x === 3 && p.y === 1,
      ),
    );
  await page.getByRole('button', { name: /^Журнальный столик · Гостиная/ }).click();
  await page.getByRole('button', { name: 'Переместить', exact: true }).click();
  await page.getByRole('button', { name: 'Спальня', exact: true }).click();
  await page
    .getByRole('button', { name: 'Поставить Журнальный столик: ряд 2, место 4', exact: true })
    .click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  for (const item of ['starter-radio', 'starter-pot']) {
    await expect(page.locator(`.furniture-${item}`)).toHaveAttribute(
      'data-support',
      'starter-table',
    );
    assert(
      await page.locator(`.furniture-${item}`).evaluate((node) => {
        const child = node.getBoundingClientRect();
        const parent = document.querySelector('.furniture-starter-table')?.getBoundingClientRect();
        return (
          parent !== undefined &&
          child.bottom > parent.top &&
          child.bottom < parent.bottom &&
          child.left > parent.left - 20 &&
          child.right < parent.right + 20
        );
      }),
      `Surface contents follow bedroom rendering: ${item}`,
    );
  }
  await page.getByRole('button', { name: /^Журнальный столик · Спальня/ }).click();
  await page.getByRole('button', { name: 'Переместить', exact: true }).click();
  await page.getByRole('button', { name: 'Гостиная', exact: true }).click();
  await page
    .getByRole('button', { name: 'Поставить Журнальный столик: ряд 2, место 4', exact: true })
    .click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.furniture-starter-radio')).toHaveAttribute(
    'data-support',
    'starter-table',
  );
  await expect(page.locator('.furniture-starter-pot')).toHaveAttribute(
    'data-support',
    'starter-table',
  );
  await page.getByRole('button', { name: '✦ Обустроить', exact: true }).click();
  await page.getByRole('button', { name: /^Журнальный столик · Гостиная/ }).click();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(page.locator('.furniture-starter-radio')).toHaveCount(0);
  await expect(page.locator('.furniture-starter-pot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Журнальный столик · Кладовка', exact: true }).click();
  await page.getByRole('button', { name: 'Поставить', exact: true }).click();
  await page
    .getByRole('button', { name: 'Поставить Журнальный столик: ряд 3, место 3', exact: true })
    .click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await page.getByRole('button', { name: 'Радио · Кладовка', exact: true }).click();
  await placeOnSurface('Радио', 'Деревянная тумба', 1);
  await page.getByRole('button', { name: 'Маленький горшок · Кладовка', exact: true }).click();
  await placeOnSurface('Маленький горшок', 'Деревянная тумба', 2);
  assert.equal((await profile()).state.xp, beforeCancel.state.xp);
  assert.deepEqual((await profile()).state.spent, beforeCancel.state.spent);
  await page.getByRole('button', { name: /Облачный ковёр · Кладовка/ }).click();
  await page.getByRole('button', { name: 'Поставить', exact: true }).click();
  // A move remains selected when choosing the destination room.
  await page.getByRole('button', { name: 'Спальня', exact: true }).click();
  await expect(page.locator('.room-bedroom')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Занято Облачный ковёр: ряд 1, место 5', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Поставить Облачный ковёр: ряд 3, место 3', exact: true })
    .click();
  await expect
    .poll(async () => (await profile()).state.placements.find((p) => p.item === 'rug')?.room)
    .toBe('bedroom');
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await expect(page.locator('.pet-furniture-actions')).toHaveCount(0);
  await page.getByRole('button', { name: /Облачный ковёр · Спальня/ }).click();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect
    .poll(async () => (await profile()).state.placements.some((p) => p.item === 'rug'))
    .toBe(false);
  await expect(page.locator('.pet-furniture-actions')).toHaveCount(0);
  assert((await profile()).state.owned.includes('rug'), 'Storage preserves ownership');
  await page.getByRole('button', { name: /Кровать-облако · Кладовка/ }).click();
  await page.getByRole('button', { name: 'Поставить', exact: true }).click();
  // An uncertain placement keeps its request key; successful retry closes the grid.
  const lostPlaceRoute = '**/__dev/rpc/actPet';
  const placeRequests: PetMutation[] = [];
  await page.route(lostPlaceRoute, async (route) => {
    const mutation = route.request().postDataJSON() as PetMutation;
    placeRequests.push(mutation);
    const response = await route.fetch();
    if (placeRequests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page
    .getByRole('button', { name: 'Поставить Кровать-облако: ряд 3, место 2', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Повторить действие', exact: true })).toBeEnabled();
  const afterLostPlace = await profile();
  await page.getByRole('button', { name: 'Повторить действие', exact: true }).click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  await page.unroute(lostPlaceRoute);
  assert.deepEqual(placeRequests[0], placeRequests[1]);
  assert.equal((await profile()).revision, afterLostPlace.revision);
  await expect(page.locator('.pet-built-in-bed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.locator('.furniture-bed').click();
  await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
  const bedroomScene = await page.locator('.pet-scene').elementHandle();
  const lightSwitch = page.getByRole('switch', { name: 'Свет в спальне', exact: true });
  await expect(lightSwitch).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Уложить спать', exact: true }).click();
  await expect(lightSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.pet-scene')).toHaveClass(/is-sleeping/);
  // Sleep outlives the temporary care reaction and survives room navigation.
  await expect
    .poll(() => page.locator('.pet-scene').evaluate((node) => !node.classList.contains('sleepy')))
    .toBe(true);
  await expect(page.locator('.pet-scene')).toHaveClass(/is-sleeping/);
  assert(await bedroomScene?.evaluate((node) => node.isConnected));
  await page
    .locator('.pet-home')
    .screenshot({ path: '.cache/screenshots/tamagotchi-bedroom-night.png' });
  await page.getByRole('button', { name: 'Гостиная', exact: true }).click();
  await expect(page.locator('.pet-scene')).not.toHaveClass(/is-sleeping|lights-off/);
  await expect(page.locator('.pet-iso-world')).toBeVisible();
  await expect(page.locator('.pet-mascot-button .moti-toy')).toBeVisible();
  assert(
    await page.locator('.pet-iso-world img').evaluateAll((nodes) =>
      nodes.every((node) => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    ),
    'All isometric sprite assets must load',
  );
  await page.getByRole('button', { name: 'Спальня', exact: true }).click();
  await expect(page.locator('.pet-scene')).toHaveClass(/is-sleeping/);
  await lightSwitch.click();
  await expect(lightSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.pet-scene')).not.toHaveClass(/is-sleeping|lights-off/);
  await page
    .locator('.pet-home')
    .screenshot({ path: '.cache/screenshots/tamagotchi-bedroom-day.png' });
  await page.getByRole('button', { name: 'Гостиная', exact: true }).click();
  await page.getByRole('button', { name: 'Покормить', exact: true }).click();
  await expect(page.locator('.pet-shop-item')).toHaveCount(5);
  await page.getByRole('button', { name: 'Показать весь магазин', exact: true }).click();
  await expect(page.locator('.pet-shop-item')).toHaveCount(15);
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
    await page.getByRole('button', { name: 'Спальня', exact: true }).click();
    await page.getByRole('switch', { name: 'Свет в спальне', exact: true }).click();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Bedroom overflow at ${width}px`,
    );
    if (width === 390)
      await page
        .locator('.pet-home')
        .screenshot({ path: '.cache/screenshots/tamagotchi-bedroom-mobile.png' });
    await page.getByRole('button', { name: '✦ Обустроить', exact: true }).click();
    await checkThumbnails(`inventory at ${width}px`);
    await page.getByRole('button', { name: /Облачный ковёр · Кладовка/ }).click();
    await page.getByRole('button', { name: 'Поставить', exact: true }).click();
    await expect(page.locator('.pet-placement-cell')).toHaveCount(18);
    assert(
      await page.locator('.pet-placement-grid').evaluate((node) => {
        const home = node.closest('.pet-home')?.getBoundingClientRect();
        const grid = node.getBoundingClientRect();
        return home !== undefined && grid.left >= home.left && grid.right <= home.right;
      }),
      `Placement cells clipped at ${width}px`,
    );
    assert(
      await page
        .locator('.pet-placement-cell')
        .first()
        .evaluate((node) => node.getBoundingClientRect().height >= 44),
    );
    if (width === 390)
      await page
        .locator('.pet-home')
        .screenshot({ path: '.cache/screenshots/tamagotchi-decorating-mobile.png' });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Decoration overflow at ${width}px`,
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.getByRole('button', { name: 'Гостиная', exact: true }).click();
    // The same server cells project onto the floor, including on narrow screens.
    await page.getByRole('button', { name: '✦ Обустроить', exact: true }).click();
    await page.getByRole('button', { name: /Облачный ковёр · Кладовка/ }).click();
    await page.getByRole('button', { name: 'Поставить', exact: true }).click();
    await expect(page.locator('.pet-iso-placement-grid .pet-placement-cell')).toHaveCount(18);
    assert(
      await page.locator('.pet-iso-placement-grid .pet-placement-cell').evaluateAll((nodes) =>
        nodes.every((node) => {
          const rect = node.getBoundingClientRect();
          const scene = node.closest('.pet-scene')?.getBoundingClientRect();
          return (
            scene !== undefined &&
            rect.left >= scene.left &&
            rect.right <= scene.right &&
            rect.top >= scene.top &&
            rect.bottom <= scene.bottom &&
            rect.height >= 44
          );
        }),
      ),
      `Isometric placement bounds at ${width}px`,
    );
    if (width === 390)
      await page
        .locator('.pet-home')
        .screenshot({ path: '.cache/screenshots/tamagotchi-iso-decorating-mobile.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Стопка книг · Гостиная/ }).click();
    await page.getByRole('button', { name: 'На поверхность', exact: true }).click();
    await expect(page.locator('.pet-surface-point')).toHaveCount(5);
    assert(
      await page.locator('.pet-surface-destinations button').evaluateAll((nodes) =>
        nodes.every((node) => {
          const rect = node.getBoundingClientRect();
          const home = node.closest('.pet-home')?.getBoundingClientRect();
          return (
            home !== undefined &&
            rect.width >= 44 &&
            rect.height >= 44 &&
            rect.left >= home.left &&
            rect.right <= home.right
          );
        }),
      ),
      `Surface choice touch targets at ${width}px`,
    );
    if (width === 390)
      await page
        .locator('.pet-home')
        .screenshot({ path: '.cache/screenshots/tamagotchi-surfaces-mobile.png' });
    await page
      .locator('.pet-surface-destinations')
      .getByRole('button', {
        name: 'Поставить Стопка книг на Журнальный столик: место 1',
        exact: true,
      })
      .click();
    await expect(page.locator('.furniture-starter-books')).toHaveAttribute(
      'data-support',
      'starter-table',
    );
    await page.getByRole('button', { name: /^Стопка книг · Гостиная/ }).click();
    await page.getByRole('button', { name: 'Переместить', exact: true }).click();
    await page
      .getByRole('button', { name: 'Поставить Стопка книг: ряд 3, место 6', exact: true })
      .click();
    await expect(page.locator('.pet-placement-grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Магазин', exact: true }).click();
  await checkThumbnails('shop');
  await page.getByRole('button', { name: 'Желания', exact: true }).click();
  await checkThumbnails('wishes');
  assert.equal(
    await page
      .locator('.pet-mascot-button .moti')
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await page
    .locator('.pet-room-activities')
    .getByRole('button', { name: 'Block Blast ↗', exact: true })
    .click();
  await expect(page.getByRole('group', { name: 'Поле Block Blast 8 на 8' })).toBeVisible();
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Листик', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.pet-wish.complete')).toHaveCount(1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Pet browser checks passed: care and retries, explicit decoration, move/store/cancel, occupied cells, room transfers, lost placement replies, bedroom light/sleep, living food/play, persistence, ranking, 320/390/768px and reduced motion.',
  );
} finally {
  await browser.close();
  server.kill();
}
