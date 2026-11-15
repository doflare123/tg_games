import { petCostProgress } from '../../../games/tamagotchi/engine.ts';
import {
  decodePetMutation,
  isPetSmallItem,
  isPetStarter,
  isPetSurface,
  PET_CARE_COOLDOWN_MS,
  PET_CARE_KINDS,
  PET_GAME_INFO,
  PET_GAMES,
  PET_ITEMS,
  PET_ROOM_INFO,
  PET_ROOMS,
  PET_SPECIES,
  PET_SPECIES_INFO,
  PET_STARTER_IDS,
  PET_STARTER_INFO,
  type PetAction,
  type PetCare,
  type PetCost,
  type PetGame,
  type PetItem,
  type PetMutation,
  type PetRoom,
  type PetSpecies,
  type PetView,
  petCellOccupied,
  petItem,
  petLevel,
  petSurfaceTargets,
} from '../../../shared/tamagotchi.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import { leaderboardGroups } from '../../ui/leaderboard-groups.ts';
import {
  layoutRoomSurfaces,
  livingItemImage,
  livingRoom,
  locateLivingCell,
  locateLivingFurniture,
  locateLivingPet,
  locateLivingSurface,
} from './living-room.ts';
import './tamagotchi.css';
import './living-room.css';

function toyCreature(species: PetSpecies = 'cat'): HTMLElement {
  const pet = element('div', `moti moti-toy toy-${species} species-${species}`);
  pet.setAttribute('aria-hidden', 'true');
  return pet;
}

function itemPicture(item: PetItem): HTMLElement {
  const image = item.kind === 'furniture' ? livingItemImage(item.id) : undefined;
  const picture = element(
    'span',
    `pet-item-icon ${image ? 'pet-item-picture' : ''}`,
    image ? '' : item.icon,
  );
  if (image) picture.append(image);
  return picture;
}
function furnishingInfo(id: string) {
  return isPetStarter(id) ? PET_STARTER_INFO[id] : petItem(id);
}
function surfaceLocation(id: string): string {
  switch (id) {
    case 'starter-console':
      return 'на тумбе';
    case 'starter-table':
      return 'на столике';
    case 'wardrobe':
      return 'на шкафу';
    default:
      return 'на книжном шкафу';
  }
}
function isFurnitureAction(action: PetAction): boolean {
  return (
    action.type === 'place' ||
    action.type === 'store' ||
    action.type === 'place-starter' ||
    action.type === 'store-starter' ||
    action.type === 'attach-starter' ||
    action.type === 'place-on-surface'
  );
}

function creature(species: PetSpecies = 'cat'): HTMLElement {
  const pet = element('div', `moti species-${species}`);
  pet.setAttribute('aria-hidden', 'true');
  for (const part of [
    'shadow',
    'tail',
    'gill left',
    'gill right',
    'ear left',
    'ear right',
    'body',
    'belly',
    'patch left',
    'patch right',
    'foot left',
    'foot right',
    'snout',
    'nose',
    'eye left',
    'eye right',
    'cheek left',
    'cheek right',
    'mouth',
    'leaf',
  ])
    pet.append(element('i', `moti-${part}`));
  return pet;
}
function costLabel(cost: PetCost): string {
  if (cost.metric === 'attempts')
    return `${cost.amount} попытки${cost.distinct > 1 ? ` · от ${cost.distinct} игр` : ''}`;
  const only = cost.games.length === 1 ? cost.games[0] : undefined;
  return only
    ? `${cost.amount * PET_GAME_INFO[only].unit} очков · ${PET_GAME_INFO[only].title}`
    : `${cost.amount} искр${cost.distinct > 1 ? ` · от ${cost.distinct} игр` : ''}`;
}
export function mountTamagotchi(host: HTMLElement, play: (game: PetGame) => void): () => void {
  let disposed = false;
  let busy = false;
  let view: PetView | undefined;
  let tab: 'wishes' | 'shop' | 'board' = 'wishes';
  let room: PetRoom = 'living';
  let selected: string | undefined;
  let decorating = false;
  let moving = false;
  let placingSurface = false;
  let roomResizeObserver: ResizeObserver | undefined;
  let bedroomDark = false;
  let showGames = false;
  let shopFilter: 'all' | 'food' = 'all';
  let message = '';
  let expression = '';
  let pending: PetMutation | undefined;
  let boardCleanup: (() => void) | undefined;
  let mutationFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let careWriting: Promise<void> | null = null;
  const careQueue = new Set<PetCare>();
  let careRetries = 0;
  let careRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let receivedAt = performance.now();
  let reaction = 0;
  const shell = element('div', 'pet-app');
  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && decorating && selected) {
      event.preventDefault();
      cancelPlacement();
    }
  });
  host.append(shell);
  const storageKey = () => `arcade:pet:pending:${view?.state.bornAt ?? 0}`;
  const status = element('p', 'pet-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  function acceptView(result: PetView): void {
    view = result;
    receivedAt = performance.now();
  }
  function rememberPending(mutation: PetMutation | undefined): void {
    pending = mutation;
    try {
      if (mutation) sessionStorage.setItem(storageKey(), JSON.stringify(mutation));
      else sessionStorage.removeItem(storageKey());
    } catch {
      /* Session storage is optional. */
    }
  }
  function careRemaining(care: PetCare): number {
    if (!view) return 0;
    const now = view.serverNow + Math.max(0, performance.now() - receivedAt);
    return Math.max(0, view.state.careAt[care] + PET_CARE_COOLDOWN_MS - now);
  }
  function speechText(): string {
    if (room === 'bedroom' && bedroomDark) return 'Спокойной ночи… z z z';
    if (expression === 'sleepy') return 'Пять минуточек… zzz';
    if (expression === 'washing') return 'Пузырьки! Теперь я буду сиять ✧';
    if (expression) return 'С тобой так хорошо ♡';
    if (room === 'bedroom') return 'Здесь так тихо. Выключишь свет перед сном?';
    return (
      view?.state.wishes.find((wish) => !view?.state.completed.includes(wish.id))?.text ??
      'Все мечты на сегодня сбылись. Посидишь со мной?'
    );
  }
  function patchExpression(): void {
    const scene = shell.querySelector<HTMLElement>('.pet-scene');
    if (!scene) return;
    scene.classList.remove('petting', 'washing', 'sleepy', 'happy');
    scene.classList.toggle(
      'wistful',
      !expression && !!view && Math.min(...Object.values(view.state.needs)) < 40,
    );
    if (expression) scene.classList.add(expression);
    scene.classList.toggle('is-sleeping', room === 'bedroom' && bedroomDark);
    const speech = scene.querySelector('.pet-speech');
    if (speech) speech.textContent = speechText();
  }
  function reactToCare(care: PetCare): void {
    expression = care === 'rest' ? 'sleepy' : care === 'wash' ? 'washing' : 'petting';
    patchExpression();
    const scene = shell.querySelector<HTMLElement>('.pet-scene');
    if (scene) {
      scene.dataset.reaction = String(++reaction);
      scene.querySelector('.pet-care-particle')?.remove();
      const particle = element(
        'span',
        `pet-care-particle particle-${care}`,
        care === 'wash' ? '◌ ✧ ◌' : care === 'rest' ? 'z z z' : '♡ ♡',
      );
      particle.setAttribute('aria-hidden', 'true');
      scene.append(particle);
    }
    clearTimeout(mutationFeedbackTimer);
    mutationFeedbackTimer = setTimeout(() => {
      expression = '';
      shell.querySelector('.pet-care-particle')?.remove();
      if (!disposed) patchExpression();
    }, 2200);
  }
  function updateCareControls(): void {
    if (!view || disposed) return;
    for (const care of PET_CARE_KINDS) {
      const note = shell.querySelector<HTMLElement>(
        `.pet-care-actions [data-care="${care}"] small`,
      );
      if (!note) continue;
      const seconds = Math.ceil(careRemaining(care) / 1000);
      const text = seconds > 0 ? `восстановление через ${seconds} с` : 'можно позаботиться';
      if (note.textContent !== text) note.textContent = text;
    }
  }
  function updateCareNeeds(): void {
    if (!view || disposed) return;
    for (const key of ['food', 'joy', 'energy', 'clean'] as const) {
      const progress = shell.querySelector<HTMLProgressElement>(`.need-${key} progress`);
      const value = shell.querySelector(`.need-${key} small`);
      if (progress) progress.value = view.state.needs[key];
      if (value) value.textContent = `${view.state.needs[key]}%`;
    }
    const mood = shell.querySelector('.pet-name-row span');
    if (mood)
      mood.textContent =
        Math.min(...Object.values(view.state.needs)) < 40
          ? 'Немного соскучился'
          : 'Твой маленький домашний космос';
    updateCareControls();
  }
  function updateCareRetry(): void {
    if (disposed) return;
    const previous = shell.querySelector<HTMLButtonElement>('.pet-retry');
    if (!pending) {
      previous?.remove();
      return;
    }
    if (pending.action.type !== 'care') return;
    const utilities = shell.querySelector('.pet-utilities');
    if (!utilities) return;
    const retry =
      previous ??
      button('Повторить действие', () => void mutate(), 'pet-button pet-button-primary pet-retry');
    retry.disabled = careWriting !== null || busy;
    if (!previous) utilities.append(retry);
  }
  function careNeedsFullRender(previous: PetView | undefined, next: PetView): boolean {
    if (!previous) return true;
    const {
      needs: _oldNeeds,
      careAt: _oldCare,
      lastCare: _oldLast,
      updatedAt: _oldTime,
      ...before
    } = previous.state;
    const {
      needs: _newNeeds,
      careAt: _newCare,
      lastCare: _newLast,
      updatedAt: _newTime,
      ...after
    } = next.state;
    return (
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(previous.wallet) !== JSON.stringify(next.wallet)
    );
  }
  async function sendCare(mutation: PetMutation): Promise<void> {
    if (mutation.action.type !== 'care') return;
    const care = mutation.action.care;
    let request = mutation;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await api.actPet(request);
        if (disposed) return;
        const previous = view;
        acceptView(result);
        rememberPending(undefined);
        careRetries = 0;
        message = '';
        status.textContent = '';
        if (careNeedsFullRender(previous, result)) render();
        else updateCareNeeds();
        return;
      } catch (error) {
        if (disposed) return;
        if (error instanceof Error && 'code' in error && error.code !== 'UNAVAILABLE') {
          rememberPending(undefined);
          careRetries = 0;
          if (error.code === 'CONFLICT' || error.code === 'RATE_LIMIT') {
            try {
              const previous = view;
              const fresh = await api.pet();
              if (disposed) return;
              acceptView(fresh);
              if (careNeedsFullRender(previous, fresh)) render();
              else updateCareNeeds();
              if (error.code === 'CONFLICT' && attempt === 0 && careRemaining(care) === 0) {
                request = {
                  requestId: crypto.randomUUID(),
                  revision: fresh.revision,
                  action: { type: 'care', care },
                };
                rememberPending(request);
                continue;
              }
              message = '';
            } catch {
              message = 'Не удалось обновить заботу. Попробуй ещё раз, когда появится связь.';
            }
          } else message = errorMessage(error);
          status.textContent = message;
          return;
        }
        // A lost response must repeat the exact same mutation, never grant care twice.
        message = 'Связь прервалась. Заботу сохраним после восстановления соединения.';
        status.textContent = message;
        if (careRetries < 2) {
          const delay = careRetries++ === 0 ? 2000 : 6000;
          clearTimeout(careRetryTimer);
          careRetryTimer = setTimeout(() => {
            void pumpCare(true);
          }, delay);
        }
        return;
      }
    }
  }
  function pumpCare(retry = false): Promise<void> | null {
    if (disposed || busy || !view) return null;
    if (careWriting) return careWriting;
    if (pending && (pending.action.type !== 'care' || !retry)) return null;
    let mutation = pending;
    if (!mutation) {
      let next: PetCare | undefined;
      for (const care of careQueue) {
        careQueue.delete(care);
        if (careRemaining(care) === 0) {
          next = care;
          break;
        }
      }
      if (!next) return null;
      mutation = {
        requestId: crypto.randomUUID(),
        revision: view.revision,
        action: { type: 'care', care: next },
      };
      careRetries = 0;
      rememberPending(mutation);
    }
    careWriting = sendCare(mutation).finally(() => {
      careWriting = null;
      if (disposed) return;
      updateCareControls();
      updateCareRetry();
      if (!pending && !busy) void pumpCare();
    });
    return careWriting;
  }
  function interactCare(care: PetCare): void {
    if (!view?.state.speciesChosen || disposed) return;
    if (room === 'bedroom') {
      bedroomDark = care === 'rest';
      updateBedroom();
    }
    reactToCare(care);
    if (
      careRemaining(care) > 0 ||
      (pending?.action.type === 'care' && pending.action.care === care)
    )
      return;
    careQueue.add(care);
    void pumpCare();
  }

  function updateBedroom(): void {
    if (room !== 'bedroom') return;
    const scene = shell.querySelector('.pet-scene');
    scene?.classList.toggle('lights-off', bedroomDark);
    const light = shell.querySelector('.pet-light-switch');
    light?.setAttribute('aria-checked', String(!bedroomDark));
    if (light) light.textContent = bedroomDark ? '☾ Включить свет' : '☀ Выключить свет';
    const sleep = shell.querySelector('.pet-sleep-button');
    if (sleep) sleep.textContent = bedroomDark ? 'Проснуться' : 'Уложить спать';
    const mascot = shell.querySelector('.pet-mascot-button');
    mascot?.setAttribute(
      'aria-label',
      `${bedroomDark ? 'Разбудить' : 'Погладить'}: ${view?.state.name ?? ''}`,
    );
    patchExpression();
  }

  function toggleBedroomLight(): void {
    if (bedroomDark) {
      bedroomDark = false;
      expression = '';
      shell.querySelector('.pet-care-particle')?.remove();
      updateBedroom();
    } else interactCare('rest');
  }

  function cancelPlacement(): void {
    selected = undefined;
    moving = false;
    placingSurface = false;
    render();
    shell.querySelector<HTMLButtonElement>('.pet-decorate-toggle')?.focus({ preventScroll: true });
  }

  async function load(): Promise<void> {
    if (busy || careWriting) return;
    busy = true;
    try {
      const result = await api.pet();
      if (disposed) return;
      acceptView(result);
      try {
        const saved = sessionStorage.getItem(storageKey());
        pending = saved ? decodePetMutation(JSON.parse(saved)) : undefined;
      } catch {
        pending = undefined;
      }
      message = pending
        ? 'Есть неподтверждённое действие. Нажми «Повторить действие», чтобы узнать результат.'
        : '';
    } catch (error) {
      message = /server error|internal/i.test(errorMessage(error))
        ? 'Не получилось открыть дом. Попробуй ещё раз чуть позже.'
        : errorMessage(error);
    } finally {
      busy = false;
      if (!disposed) render();
      if (pending?.action.type === 'care') {
        careRetries = 0;
        void pumpCare(true);
      } else void pumpCare();
    }
  }
  async function mutate(action?: PetAction): Promise<void> {
    if (action?.type === 'care') {
      interactCare(action.care);
      return;
    }
    if (!view || busy) return;
    if (!action && pending?.action.type === 'care') {
      clearTimeout(careRetryTimer);
      careRetries = 0;
      await pumpCare(true);
      return;
    }
    if (careWriting) {
      // Purchases wait for the current care write, preserving revision and spending safety.
      busy = true;
      message = 'Сохраняем…';
      render();
      await careWriting;
      busy = false;
      if (disposed) return;
    }
    if (pending && action) {
      message = 'Сначала повтори неподтверждённое действие.';
      render();
      return;
    }
    const mutation =
      pending ??
      (action ? { requestId: crypto.randomUUID(), revision: view.revision, action } : undefined);
    if (!mutation) return;
    pending = mutation;
    try {
      sessionStorage.setItem(storageKey(), JSON.stringify(mutation));
    } catch {
      /* Session storage may be disabled. */
    }
    busy = true;
    message = 'Сохраняем…';
    render();
    try {
      const result = await api.actPet(mutation);
      if (disposed) return;
      acceptView(result);
      if (isFurnitureAction(mutation.action)) {
        selected = undefined;
        moving = false;
        placingSurface = false;
      }
      pending = undefined;
      try {
        sessionStorage.removeItem(storageKey());
      } catch {
        /* Optional persistence. */
      }
      expression =
        mutation.action.type === 'care' && mutation.action.care === 'rest' ? 'sleepy' : 'happy';
      const replies = {
        species: 'Вот мы и нашли друг друга! Дом и дружба остаются с нами ♡',
        claim: 'Это всё мне? Я самый счастливый комочек! ♡',
        buy: 'Дома стало чуть уютнее. Спасибо тебе ♡',
        place: 'Идеальное место!',
        store: 'Убрали в кладовку.',
        'place-starter': 'Идеальное место!',
        'store-starter': 'Убрали в кладовку.',
        'attach-starter': 'Поставили на тумбу.',
        'place-on-surface': 'Поставили на поверхность.',
        care: 'Хорошо, что ты рядом ♡',
        rename: 'Мне очень идёт это имя!',
        theme: 'Какой красивый свет!',
      };
      message = replies[mutation.action.type];
      clearTimeout(mutationFeedbackTimer);
      mutationFeedbackTimer = setTimeout(() => {
        expression = '';
        if (!disposed) patchExpression();
      }, 2200);
    } catch (error) {
      message = errorMessage(error);
      // Definitive rejections are safe to discard; uncertain transport failures keep the same key.
      if (error instanceof Error && 'code' in error && error.code !== 'UNAVAILABLE') {
        pending = undefined;
        try {
          sessionStorage.removeItem(storageKey());
        } catch {
          /* Optional persistence. */
        }
        try {
          acceptView(await api.pet());
        } catch {
          /* Keep the last known state visible. */
        }
      }
    } finally {
      busy = false;
      if (!disposed) render();
      if (!disposed && !pending && !selected && isFurnitureAction(mutation.action))
        shell
          .querySelector<HTMLButtonElement>('.pet-decorate-toggle')
          ?.focus({ preventScroll: true });
      void pumpCare();
    }
  }
  function actionButton(
    label: string,
    action: PetAction,
    className = 'pet-button',
  ): HTMLButtonElement {
    const node = button(label, () => void mutate(action), className);
    node.disabled = busy || pending !== undefined;
    return node;
  }
  function gameLinks(games: readonly PetGame[]): HTMLElement {
    const links = element('div', 'pet-game-links');
    for (const game of games) {
      const link = button(`${PET_GAME_INFO[game].title} ↗`, () => play(game), 'pet-game-link');
      links.append(link);
    }
    return links;
  }
  function render(): void {
    if (disposed) return;
    roomResizeObserver?.disconnect();
    boardCleanup?.();
    boardCleanup = undefined;
    shell.replaceChildren();
    if (!view) {
      const loading = element('div', 'pet-loading');
      loading.append(
        toyCreature(),
        element('h1', '', 'Кто-то очень ждёт тебя дома'),
        element('p', '', message || 'Знакомимся с питомцем…'),
      );
      if (message) loading.append(button('Попробовать ещё раз', () => void load(), 'pet-button'));
      if (!hasApi)
        loading.append(element('p', '', 'Открой Arcade через Telegram, чтобы сохранить питомца.'));
      shell.append(loading);
      return;
    }
    const { state, wallet } = view;
    if (!state.speciesChosen) {
      const picker = element('section', 'pet-species-picker');
      picker.setAttribute('aria-label', 'Выбор питомца');
      picker.append(
        element('span', 'pet-kicker', 'ТВОЙ ДОМ · ТВОЙ МАЛЕНЬКИЙ ДРУГ'),
        element('h1', '', 'Кто поселится у тебя дома?'),
        element(
          'p',
          '',
          'Выбери своего зверька. Он останется с тобой — сменить питомца после выбора нельзя.',
        ),
      );
      const cards = element('div', 'pet-species-grid');
      for (const species of PET_SPECIES) {
        const info = PET_SPECIES_INFO[species];
        const card = actionButton('', { type: 'species', species }, 'pet-species-card');
        card.setAttribute('aria-label', `Выбрать: ${info.title}`);
        card.setAttribute('aria-pressed', String(state.speciesChosen && state.species === species));
        card.append(
          toyCreature(species),
          element('strong', '', info.title),
          element('span', '', info.description),
          element(
            'small',
            '',
            state.speciesChosen && state.species === species
              ? 'Сейчас с тобой ♡'
              : 'Забрать домой →',
          ),
        );
        cards.append(card);
      }
      picker.append(cards);
      status.textContent = message;
      picker.append(status);
      if (pending) {
        const retry = button(
          'Повторить действие',
          () => void mutate(),
          'pet-button pet-button-primary',
        );
        retry.disabled = busy;
        picker.append(retry);
      }
      shell.append(picker);
      return;
    }
    const level = petLevel(state.xp);
    const heading = element('header', 'pet-heading');
    const title = element('div');
    title.append(
      element('span', 'pet-kicker', 'МАЛЕНЬКИЙ ДОМ · БОЛЬШАЯ ДРУЖБА'),
      element('h1', '', 'Хорошо, что ты здесь.'),
    );
    const badge = element('div', 'pet-level');
    badge.append(
      element('span', '', `♡ ${state.xp} дружбы`),
      element('strong', '', `${level} уровень`),
    );
    heading.append(title, badge);
    const layout = element('div', 'pet-layout');
    const home = element('section', 'pet-home');
    home.setAttribute('aria-label', 'Дом питомца');
    const roomNav = element('nav', 'pet-room-nav');
    roomNav.setAttribute('aria-label', 'Комнаты');
    for (const id of PET_ROOMS) {
      const info = PET_ROOM_INFO[id];
      const locked = level < info.level;
      const control = button(
        `${info.title}${locked ? ` · ур. ${info.level}` : ''}`,
        () => {
          room = id;
          if (!moving) selected = undefined;
          showGames = false;
          render();
        },
        `pet-room-tab ${room === id ? 'selected' : ''}`,
      );
      control.disabled = locked;
      control.setAttribute('aria-pressed', String(room === id));
      roomNav.append(control);
    }
    const scene = element('div', `pet-scene theme-${state.theme} room-${room} ${expression}`);
    scene.classList.toggle('is-decorating', decorating);
    scene.classList.toggle('is-placing', decorating && moving && selected !== undefined);
    scene.setAttribute('aria-label', `${state.name}: ${PET_ROOM_INFO[room].title}`);
    const roomWorld = room === 'living' ? livingRoom() : scene;
    if (room === 'living') scene.append(roomWorld);
    const windowFrame = element('div', 'pet-window');
    windowFrame.append(
      element('span', 'pet-sun'),
      element('span', 'pet-cloud'),
      element('span', 'pet-window-bar'),
    );
    if (room !== 'living')
      scene.append(
        element(
          'div',
          'pet-wall-art',
          room === 'bedroom' ? 'тише…\nздесь живут сны' : 'дом для\nмаленьких радостей',
        ),
        windowFrame,
        element('div', 'pet-baseboard'),
        element('div', 'pet-floor'),
        element('div', 'pet-floor-rug'),
      );
    if (room === 'bedroom') {
      const bed = state.placements.find((p) => p.room === 'bedroom' && p.item === 'bed');
      scene.style.setProperty('--sleep-left', `${bed ? 5 + bed.x * 15 : 18}%`);
      scene.style.setProperty('--sleep-bottom', `${bed ? 4 + bed.y * 10 : 7}%`);
      if (!bed) {
        const builtInBed = element('div', 'pet-built-in-bed furniture-bed');
        builtInBed.setAttribute('aria-label', 'Спальное место');
        scene.append(builtInBed);
      }
      scene.append(
        element('div', 'pet-nightlight'),
        element('div', 'pet-sleep-stars', '✦ · ✧ · ✦'),
      );
      const light = button('', toggleBedroomLight, 'pet-light-switch');
      light.setAttribute('role', 'switch');
      light.setAttribute('aria-label', 'Свет в спальне');
      scene.append(light);
    }
    const speech = element('div', 'pet-speech');
    speech.textContent = speechText();
    const mascot = button(
      '',
      () => {
        if (room === 'bedroom' && bedroomDark) toggleBedroomLight();
        else interactCare('pet');
      },
      'pet-mascot-button',
    );
    mascot.setAttribute('aria-label', `Погладить: ${state.name}`);
    mascot.append(room === 'living' ? toyCreature(state.species) : creature(state.species));
    const low = Math.min(...Object.values(state.needs)) < 40;
    if (low && !expression) scene.classList.add('wistful');
    scene.append(speech);
    roomWorld.append(mascot);
    if (room === 'living') locateLivingPet(mascot);
    const allPlacements = [...state.placements, ...state.starterPlacements];
    for (const placement of allPlacements.filter((p) => p.room === room)) {
      const item = furnishingInfo(placement.item);
      const starter = isPetStarter(item.id);
      const host = isPetSurface(item.id);
      const className = `pet-furnishing furniture-${item.id} ${starter ? 'pet-starter-furnishing' : ''} ${host ? 'pet-surface-host' : ''} ${placement.on ? 'pet-surface-child' : ''} ${room === 'living' ? 'pet-iso-furnishing' : ''} ${selected === item.id ? 'selected' : ''}`;
      const furnishing = decorating
        ? button(
            item.icon,
            () => {
              selected = item.id;
              moving = false;
              placingSurface = false;
              render();
            },
            className,
          )
        : element('div', className, item.icon);
      furnishing.style.left =
        item.id === 'bed' ? `min(${5 + placement.x * 15}%, 63%)` : `${5 + placement.x * 15}%`;
      furnishing.style.bottom = `${4 + placement.y * 10}%`;
      furnishing.style.zIndex = String(8 - placement.y);
      furnishing.dataset.item = item.id;
      if (room === 'living' || starter || host || placement.on) {
        furnishing.replaceChildren();
        const image = livingItemImage(item.id, placement.on);
        if (image) furnishing.append(image);
        if (room === 'living') locateLivingFurniture(furnishing, placement, allPlacements);
      }
      furnishing.setAttribute(
        'aria-label',
        decorating ? `${item.title}: выбрать предмет` : item.title,
      );
      roomWorld.append(furnishing);
    }
    if (decorating && moving && selected && !placingSurface) {
      const placementGrid = element('div', 'pet-placement-grid');
      if (room === 'living') placementGrid.classList.add('pet-iso-placement-grid');
      placementGrid.setAttribute('aria-label', 'Выбери место для предмета');
      for (let y = 2; y >= 0; y--)
        for (let x = 0; x < 6; x++) {
          const occupied = petCellOccupied(state, room, x, y, selected);
          const cell = actionButton(
            occupied ? '×' : '＋',
            isPetStarter(selected)
              ? { type: 'place-starter', item: selected, room, x, y }
              : { type: 'place', item: selected, room, x, y },
            'pet-placement-cell',
          );
          cell.setAttribute(
            'aria-label',
            `${occupied ? 'Занято' : 'Поставить'} ${furnishingInfo(selected).title}: ряд ${3 - y}, место ${x + 1}`,
          );
          cell.disabled ||= occupied;
          if (room === 'living') locateLivingCell(cell, x, y);
          placementGrid.append(cell);
        }
      roomWorld.append(placementGrid);
    }
    if (decorating && moving && selected && placingSurface && isPetSmallItem(selected)) {
      for (const target of petSurfaceTargets(state, selected, room)) {
        const point = actionButton(
          target.occupied ? '×' : '＋',
          {
            type: 'place-on-surface',
            item: selected,
            surface: target.parent.item,
            slot: target.slot,
          },
          'pet-surface-point',
        );
        point.disabled ||= target.occupied;
        point.setAttribute(
          'aria-label',
          `${target.occupied ? 'Занято' : 'Место'} ${target.slot + 1} на ${furnishingInfo(target.parent.item).title}`,
        );
        point.dataset.surfaceHost = target.parent.item;
        point.dataset.slot = String(target.slot);
        if (room === 'living') locateLivingSurface(point, target.parent, target.slot);
        roomWorld.append(point);
        roomWorld
          .querySelector(`[data-item="${target.parent.item}"]`)
          ?.classList.add('pet-surface-highlight');
      }
    }
    const roomActivities = element('div', 'pet-room-activities');
    if (room === 'bedroom') {
      roomActivities.append(
        element('span', '', 'Тихая комната для сна'),
        button('', toggleBedroomLight, 'pet-button pet-sleep-button'),
      );
    } else if (room === 'living') {
      roomActivities.append(
        element('span', '', 'Время перекусить и поиграть'),
        button(
          'Покормить',
          () => {
            tab = 'shop';
            shopFilter = 'food';
            render();
            shell.querySelector('.pet-aside')?.scrollIntoView({ block: 'nearest' });
          },
          'pet-button',
        ),
        button(
          'Играть',
          () => {
            showGames = !showGames;
            render();
          },
          'pet-button',
        ),
      );
      if (showGames) roomActivities.append(gameLinks(PET_GAMES));
    } else roomActivities.append(element('span', '', 'Свежий воздух и маленькие открытия'));
    const nameRow = element('div', 'pet-name-row');
    nameRow.append(
      element('h2', '', state.name),
      element('span', '', low ? 'Немного соскучился' : 'Твой маленький домашний космос'),
    );
    const care = element('div', 'pet-care-actions');
    for (const [kind, label] of [
      ['pet', '♡ Погладить'],
      ['wash', '◌ Искупать'],
      ['rest', '☾ Отдохнуть'],
    ] as const) {
      const control = button('', () => interactCare(kind), 'pet-button pet-care-button');
      control.dataset.care = kind;
      control.setAttribute('aria-label', label);
      control.setAttribute('aria-describedby', 'pet-care-hint');
      control.append(element('span', '', label), element('small'));
      care.append(control);
    }
    const careHint = element(
      'p',
      'pet-care-hint',
      'Реагирует на каждый тап. Потребности восстанавливаются раз в 15 секунд для каждого действия.',
    );
    careHint.id = 'pet-care-hint';
    const needs = element('div', 'pet-needs');
    for (const [key, label, icon] of [
      ['food', 'Сытость', '🍑'],
      ['joy', 'Радость', '♡'],
      ['energy', 'Энергия', '☀'],
      ['clean', 'Чистота', '✧'],
    ] as const) {
      const meter = element('div', `pet-need need-${key}`);
      const progress = element('progress');
      progress.max = 100;
      progress.value = state.needs[key];
      progress.setAttribute('aria-label', label);
      meter.append(
        element('span', '', `${icon} ${label}`),
        progress,
        element('small', '', `${state.needs[key]}%`),
      );
      needs.append(meter);
    }
    const furnishToggle = button(
      decorating ? 'Готово' : '✦ Обустроить',
      () => {
        decorating = !decorating;
        selected = undefined;
        moving = false;
        placingSurface = false;
        render();
        shell
          .querySelector<HTMLButtonElement>('.pet-decorate-toggle')
          ?.focus({ preventScroll: true });
      },
      'pet-button pet-decorate-toggle',
    );
    furnishToggle.setAttribute('aria-pressed', String(decorating));
    furnishToggle.setAttribute('aria-controls', 'pet-decoration');
    const decoration = element('section', 'pet-decoration');
    decoration.id = 'pet-decoration';
    decoration.hidden = !decorating;
    decoration.setAttribute('aria-label', 'Обустройство комнаты');
    decoration.append(
      element(
        'p',
        'pet-decoration-hint',
        'Выбери предмет в комнате или коллекции. Затем перемести его или убери в кладовку.',
      ),
    );
    const inventory = element('div', 'pet-inventory');
    for (const id of [...PET_STARTER_IDS, ...state.owned]) {
      const item = furnishingInfo(id);
      const placed = allPlacements.find((p) => p.item === id);
      const control = button(
        '',
        () => {
          selected = id;
          moving = false;
          placingSurface = false;
          render();
        },
        `pet-inventory-item ${selected === id ? 'selected' : ''}`,
      );
      const location = placed ? PET_ROOM_INFO[placed.room].title : 'Кладовка';
      const support = placed?.on ? ` · ${surfaceLocation(placed.on)}` : '';
      control.setAttribute('aria-label', `${item.title} · ${location}${support}`);
      const description = element('span', 'pet-inventory-description');
      description.append(element('span', '', item.title), element('small', '', location + support));
      const image = livingItemImage(id, placed?.on);
      const picture = element('span', 'pet-item-icon pet-item-picture');
      if (image) picture.append(image);
      control.append(picture, description);
      control.setAttribute('aria-pressed', String(selected === id));
      inventory.append(control);
    }
    if (selected) {
      const actions = element('div', 'pet-furniture-actions');
      const placed = allPlacements.find((p) => p.item === selected);
      actions.append(element('strong', '', furnishingInfo(selected).title));
      if (isPetSurface(selected))
        actions.append(
          element('p', '', 'Предметы сверху перемещаются и убираются вместе с мебелью.'),
        );
      if (moving)
        actions.append(
          element(
            'p',
            '',
            placingSurface
              ? 'Выбери свободное место на мебели или в списке ниже. Занятые места отмечены ×.'
              : 'Нажми на ＋ на полу. Для переноса выбери другую комнату. Занятые места отмечены ×.',
          ),
        );
      else {
        const move = button(
          placed ? 'Переместить' : 'Поставить',
          () => {
            moving = true;
            placingSurface = false;
            render();
          },
          'pet-button pet-button-primary',
        );
        move.disabled = busy || pending !== undefined;
        actions.append(move);
        if (placed)
          actions.append(
            actionButton(
              'Убрать',
              isPetStarter(selected)
                ? { type: 'store-starter', item: selected }
                : { type: 'store', item: selected },
            ),
          );
      }
      if (isPetSmallItem(selected)) {
        const smallItem = selected;
        const chooseSurface = button(
          'На поверхность',
          () => {
            moving = true;
            placingSurface = true;
            render();
          },
          'pet-button',
        );
        chooseSurface.disabled = busy || pending !== undefined;
        chooseSurface.setAttribute('aria-pressed', String(moving && placingSurface));
        actions.append(chooseSurface);
        if (moving && placingSurface) {
          actions.append(
            button(
              'На пол',
              () => {
                placingSurface = false;
                render();
              },
              'pet-button',
            ),
          );
          const destinations = element('div', 'pet-surface-destinations');
          const targets = petSurfaceTargets(state, smallItem, room);
          if (!targets.length)
            destinations.append(
              element(
                'p',
                '',
                'Сначала поставь в комнату мебель с подходящей поверхностью или выбери другую комнату.',
              ),
            );
          if (targets.length && targets.every((target) => target.occupied))
            destinations.append(
              element('p', '', 'Все места заняты. Освободи одно или выбери другую комнату.'),
            );
          for (const target of targets) {
            const control = actionButton(
              `${furnishingInfo(target.parent.item).title} · место ${target.slot + 1}${target.occupied ? ' · занято' : ''}`,
              {
                type: 'place-on-surface',
                item: smallItem,
                surface: target.parent.item,
                slot: target.slot,
              },
              'pet-button',
            );
            control.disabled ||= target.occupied;
            control.setAttribute(
              'aria-label',
              `Поставить ${furnishingInfo(smallItem).title} на ${furnishingInfo(target.parent.item).title}: место ${target.slot + 1}${target.occupied ? ' · занято' : ''}`,
            );
            destinations.append(control);
          }
          actions.append(destinations);
        }
      }
      actions.append(button('Отмена', cancelPlacement, 'pet-button'));
      decoration.append(actions);
    }
    decoration.append(inventory);
    const preferences = element('details', 'pet-preferences');
    preferences.append(element('summary', '', 'Палитра и имя питомца'));
    const themes = element('div', 'pet-themes');
    for (const [theme, label] of [
      ['peach', 'Персик'],
      ['mint', 'Мята'],
      ['lavender', 'Лаванда'],
    ] as const) {
      const swatch = actionButton(
        label,
        { type: 'theme', theme },
        `pet-theme-swatch theme-${theme}`,
      );
      swatch.setAttribute('aria-pressed', String(state.theme === theme));
      themes.append(swatch);
    }
    const rename = element('form', 'pet-rename');
    const name = element('input');
    name.value = state.name;
    name.maxLength = 24;
    name.required = true;
    name.setAttribute('aria-label', 'Имя питомца');
    const renameButton = element('button', 'pet-button', 'Назвать');
    renameButton.type = 'submit';
    renameButton.disabled = busy || pending !== undefined;
    rename.addEventListener('submit', (event) => {
      event.preventDefault();
      void mutate({ type: 'rename', name: name.value });
    });
    rename.append(name, renameButton);
    preferences.append(themes, rename);
    home.append(
      roomNav,
      scene,
      roomActivities,
      furnishToggle,
      decoration,
      nameRow,
      care,
      careHint,
      needs,
      preferences,
    );

    const aside = element('aside', 'pet-aside');
    const tabNav = element('nav', 'pet-tabs');
    tabNav.setAttribute('aria-label', 'Питомец');
    for (const [id, label] of [
      ['wishes', 'Желания'],
      ['shop', 'Магазин'],
      ['board', 'Рейтинг'],
    ] as const) {
      const control = button(
        label,
        () => {
          tab = id;
          shopFilter = 'all';
          render();
        },
        `pet-tab ${tab === id ? 'selected' : ''}`,
      );
      control.setAttribute('aria-pressed', String(tab === id));
      tabNav.append(control);
    }
    aside.append(tabNav);
    if (tab === 'wishes') {
      const intro = element('div', 'pet-wish-intro');
      const hours = Math.max(0, Math.ceil((view.refreshAt - view.serverNow) / 3_600_000));
      intro.append(
        element('span', 'pet-kicker', 'У КАЖДОГО КОМОЧКА СВОИ МЕЧТЫ'),
        element('h2', '', 'Сегодня я хочу…'),
        element(
          'p',
          '',
          `${state.completed.length}/3 желаний · новые через ${hours} ч · ${state.streak} дней заботы`,
        ),
      );
      const friendship = element('progress', 'pet-friendship');
      friendship.max = 180;
      friendship.value = state.xp % 180;
      friendship.setAttribute('aria-label', 'Дружба до следующего уровня');
      intro.append(
        friendship,
        element(
          'small',
          '',
          level < 20
            ? `Ещё ${180 - (state.xp % 180)} дружбы до уровня ${level + 1}`
            : 'Максимальный уровень — дружба продолжается',
        ),
      );
      aside.append(intro);
      for (const wish of state.wishes) {
        const item = petItem(wish.item);
        const completed = state.completed.includes(wish.id);
        const owned = item.kind === 'furniture' && state.owned.includes(item.id);
        const progress = petCostProgress(wish.cost, wallet);
        const card = element('article', `pet-wish ${completed ? 'complete' : ''}`);
        const head = element('div', 'pet-wish-head');
        head.append(
          itemPicture(item),
          element('h3', '', item.title),
          element('span', 'pet-xp', `+${wish.xp} ♡`),
        );
        card.append(head, element('p', 'pet-wish-voice', wish.text));
        if (!completed) {
          card.append(
            element('p', 'pet-price', owned ? 'Уже есть в твоей коллекции' : costLabel(wish.cost)),
          );
          const meter = element('progress');
          meter.max = wish.cost.amount;
          meter.value = owned ? wish.cost.amount : progress.total;
          meter.setAttribute('aria-label', `Прогресс: ${item.title}`);
          card.append(
            meter,
            element(
              'small',
              '',
              owned
                ? 'Осталось показать питомцу'
                : `${progress.total}/${wish.cost.amount} ${wish.cost.metric === 'sparks' ? 'искр' : 'попыток'}${wish.cost.distinct > 1 ? ` · ${Math.min(progress.distinct, wish.cost.distinct)}/${wish.cost.distinct} игр` : ''}`,
            ),
          );
          const claim = actionButton(
            'Исполнить желание ♡',
            { type: 'claim', wishId: wish.id },
            'pet-button pet-button-primary',
          );
          claim.disabled ||= !owned && !progress.ready;
          card.append(claim, gameLinks(wish.cost.games));
        } else card.append(element('div', 'pet-wish-done', '✓ Маленькая мечта сбылась'));
        aside.append(card);
      }
    } else if (tab === 'shop') {
      aside.append(
        element('span', 'pet-kicker', 'СОБЕРИ ДОМ ПО КУСОЧКАМ'),
        element('h2', '', 'Лавка маленьких радостей'),
        element(
          'p',
          'pet-shop-note',
          'Еда сразу кормит питомца. Мебель остаётся навсегда — поставь её в любую открытую комнату.',
        ),
      );
      const grid = element('div', 'pet-shop');
      if (shopFilter === 'food')
        aside.append(
          button(
            'Показать весь магазин',
            () => {
              shopFilter = 'all';
              render();
            },
            'pet-button',
          ),
        );
      for (const item of PET_ITEMS) {
        if (shopFilter === 'food' && item.kind !== 'food') continue;
        const owned = state.owned.includes(item.id);
        const locked = item.level > level;
        const card = element('article', 'pet-shop-item');
        card.append(
          itemPicture(item),
          element('h3', '', item.title),
          element('p', 'pet-price', costLabel(item.cost)),
        );
        const buy = actionButton(
          owned
            ? 'В коллекции ✓'
            : locked
              ? `Откроется на ур. ${item.level}`
              : item.kind === 'food'
                ? 'Угостить'
                : 'Забрать домой',
          { type: 'buy', item: item.id },
        );
        buy.disabled ||= owned || locked || !petCostProgress(item.cost, wallet).ready;
        card.append(buy, gameLinks(item.cost.games));
        grid.append(card);
      }
      aside.append(grid);
    } else {
      aside.append(
        element('span', 'pet-kicker', 'ДОМА, В КОТОРЫХ ЖИВЁТ ЛЮБОВЬ'),
        element('h2', '', 'Рейтинг заботы'),
        element(
          'p',
          'pet-shop-note',
          'Дружба даётся за исполненные желания: до 180 в день. Бесплатный уход и покупки не накручивают рейтинг.',
        ),
      );
      const board = element('div', 'pet-board');
      let closed = false;
      let request = 0;
      const filter = leaderboardGroups(async () => {
        const ticket = ++request;
        filter.beginUpdate();
        board.textContent = 'Загружаем соседей…';
        try {
          const result = await api.petLeaderboard('all', filter.selected());
          if (closed || disposed || ticket !== request) return;
          filter.showMembership(result);
          board.replaceChildren();
          if (!result.entries.length)
            board.append(element('p', '', 'Здесь пока тихо. Исполни первое желание!'));
          const entries = [...result.entries];
          if (result.me && !entries.some((e) => e.playerId === result.me?.playerId))
            entries.push(result.me);
          for (const entry of entries) {
            const row = element(
              'div',
              `pet-board-row ${entry.playerId === result.me?.playerId ? 'me' : ''}`,
            );
            row.append(
              element('span', '', String(entry.rank).padStart(2, '0')),
              element('strong', '', entry.name),
              element('span', '', `${entry.score} ♡`),
            );
            board.append(row);
          }
        } catch (error) {
          if (!closed && ticket === request) board.textContent = errorMessage(error);
        }
      });
      aside.append(filter.select, filter.status, filter.membershipStatus, board, filter.note);
      boardCleanup = () => {
        closed = true;
        filter.dispose();
      };
      filter.start();
    }
    layout.append(home, aside);
    const walletPanel = element('section', 'pet-wallet');
    walletPanel.append(
      element('h2', '', 'Твои игры — его маленькие радости'),
      element(
        'p',
        '',
        'Искры и попытки копятся отдельно. Получение вещи расходует только указанную цену.',
      ),
    );
    const balances = element('div', 'pet-wallet-games');
    for (const game of PET_GAMES) {
      const tile = button('', () => play(game), 'pet-wallet-game');
      tile.append(
        element('strong', '', PET_GAME_INFO[game].title),
        element('span', '', `${wallet[game].sparks} ✦ · ${wallet[game].attempts} попыток`),
        element('small', '', `${PET_GAME_INFO[game].unit} очков = 1 ✦ · играть ↗`),
      );
      balances.append(tile);
    }
    const rules = element('details', 'pet-rules');
    rules.append(
      element('summary', '', 'Как игры помогают питомцу?'),
      element(
        'p',
        '',
        'Учитываются завершённые серверные партии, начатые после знакомства с питомцем. В день от каждой игры можно получить до 100 искр и 5 попыток. Повторная отправка партии ничего не добавляет. Незавершённая партия пока не даёт награду.',
      ),
      element(
        'p',
        '',
        'Чтобы попытка засчиталась: Block Blast — от 3 ходов, 2048 — от 10, Тетрис — от 5 секунд, Змейка — от 15 шагов, Flappy — от 2 секунд. Проигрыш тоже считается. Сапёр и свободный Doodle пока не участвуют в экономике.',
      ),
      element(
        'p',
        '',
        'Новые желания приходят в 04:00 по UTC+2. За пропуски питомец не погибает; потребности опускаются только до 20%. Серия дней — память о встречах, накопленная дружба остаётся.',
      ),
    );
    walletPanel.append(balances, rules);
    status.textContent = message;
    const utilities = element('div', 'pet-utilities');
    const refresh = button('↻ Обновить прогресс', () => void load(), 'pet-button');
    refresh.disabled = busy;
    utilities.append(status, refresh);
    if (pending) {
      const retry = button(
        'Повторить действие',
        () => void mutate(),
        'pet-button pet-button-primary pet-retry',
      );
      retry.disabled = busy || careWriting !== null;
      utilities.append(retry);
    }
    shell.append(heading, utilities, layout, walletPanel);
    if (room !== 'living') {
      layoutRoomSurfaces(scene, allPlacements);
      roomResizeObserver = new ResizeObserver(() => layoutRoomSurfaces(scene, allPlacements));
      roomResizeObserver.observe(scene);
    }
    updateBedroom();
    updateCareControls();
    if (decorating && moving) {
      shell
        .querySelector<HTMLButtonElement>(
          placingSurface
            ? '.pet-surface-point:enabled, .pet-surface-destinations button:enabled, .pet-furniture-actions button:enabled'
            : '.pet-placement-cell:enabled',
        )
        ?.focus();
    } else if (decorating && selected) {
      shell.querySelector<HTMLButtonElement>('.pet-furniture-actions button:enabled')?.focus();
    }
  }
  // Refresh after returning from a game or Telegram backgrounding; no polling during play.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void load();
  };
  const onOnline = () => {
    careRetries = 0;
    void pumpCare(true);
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  const careCountdown = setInterval(updateCareControls, 1000);
  render();
  void load();
  return () => {
    disposed = true;
    roomResizeObserver?.disconnect();
    boardCleanup?.();
    clearTimeout(mutationFeedbackTimer);
    clearTimeout(careRetryTimer);
    clearInterval(careCountdown);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    shell.remove();
  };
}
