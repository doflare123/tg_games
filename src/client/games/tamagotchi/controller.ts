import { petCostProgress } from '../../../games/tamagotchi/engine.ts';
import {
  decodePetMutation,
  PET_GAME_INFO,
  PET_GAMES,
  PET_ITEMS,
  PET_ROOM_INFO,
  PET_ROOMS,
  PET_SPECIES,
  PET_SPECIES_INFO,
  type PetAction,
  type PetCost,
  type PetGame,
  type PetMutation,
  type PetRoom,
  type PetSpecies,
  type PetView,
  petItem,
  petLevel,
} from '../../../shared/tamagotchi.ts';
import { api, hasApi } from '../../platform/api.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import { leaderboardGroups } from '../../ui/leaderboard-groups.ts';
import './tamagotchi.css';

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
  let message = '';
  let expression = '';
  let pending: PetMutation | undefined;
  let boardCleanup: (() => void) | undefined;
  let mutationFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const shell = element('div', 'pet-app');
  host.append(shell);
  const storageKey = () => `arcade:pet:pending:${view?.state.bornAt ?? 0}`;
  const status = element('p', 'pet-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  async function load(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const result = await api.pet();
      if (disposed) return;
      view = result;
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
    }
  }
  async function mutate(action?: PetAction): Promise<void> {
    if (!view || busy) return;
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
      view = result;
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
        care: 'Хорошо, что ты рядом ♡',
        rename: 'Мне очень идёт это имя!',
        theme: 'Какой красивый свет!',
      };
      message = replies[mutation.action.type];
      clearTimeout(mutationFeedbackTimer);
      mutationFeedbackTimer = setTimeout(() => {
        expression = '';
        if (!disposed) render();
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
          view = await api.pet();
        } catch {
          /* Keep the last known state visible. */
        }
      }
    } finally {
      busy = false;
      if (!disposed) render();
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
  function gameLinks(cost: PetCost): HTMLElement {
    const links = element('div', 'pet-game-links');
    for (const game of cost.games) {
      const link = button(`${PET_GAME_INFO[game].title} ↗`, () => play(game), 'pet-game-link');
      links.append(link);
    }
    return links;
  }
  function render(): void {
    if (disposed) return;
    boardCleanup?.();
    boardCleanup = undefined;
    shell.replaceChildren();
    if (!view) {
      const loading = element('div', 'pet-loading');
      loading.append(
        creature(),
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
          creature(species),
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
          selected = undefined;
          render();
        },
        `pet-room-tab ${room === id ? 'selected' : ''}`,
      );
      control.disabled = locked;
      control.setAttribute('aria-pressed', String(room === id));
      roomNav.append(control);
    }
    const scene = element('div', `pet-scene theme-${state.theme} room-${room} ${expression}`);
    scene.setAttribute('aria-label', `${state.name}: ${PET_ROOM_INFO[room].title}`);
    const windowFrame = element('div', 'pet-window');
    windowFrame.append(
      element('span', 'pet-sun'),
      element('span', 'pet-cloud'),
      element('span', 'pet-window-bar'),
    );
    scene.append(
      element('div', 'pet-wall-art', 'make room\nfor little joys'),
      windowFrame,
      element('div', 'pet-baseboard'),
      element('div', 'pet-floor'),
      element('div', 'pet-floor-rug'),
    );
    const speech = element('div', 'pet-speech');
    const firstWish = state.wishes.find((wish) => !state.completed.includes(wish.id));
    speech.textContent = expression
      ? expression === 'sleepy'
        ? 'Пять минуточек… zzz'
        : 'С тобой так хорошо ♡'
      : (firstWish?.text ?? 'Все мечты на сегодня сбылись. Посидишь со мной?');
    const mascot = button(
      '',
      () => void mutate({ type: 'care', care: 'pet' }),
      'pet-mascot-button',
    );
    mascot.setAttribute('aria-label', `Погладить: ${state.name}`);
    mascot.disabled = busy || pending !== undefined;
    mascot.append(creature(state.species));
    const low = Math.min(...Object.values(state.needs)) < 40;
    if (low && !expression) scene.classList.add('wistful');
    scene.append(speech, mascot);
    for (const placement of state.placements.filter((p) => p.room === room)) {
      const item = petItem(placement.item);
      const furnishing = button(
        item.icon,
        () => {
          selected = item.id;
          render();
        },
        `pet-furnishing furniture-${item.id} ${selected === item.id ? 'selected' : ''}`,
      );
      furnishing.style.left = `${5 + placement.x * 15}%`;
      furnishing.style.bottom = `${4 + placement.y * 10}%`;
      furnishing.style.zIndex = String(8 - placement.y);
      furnishing.setAttribute('aria-label', `${item.title}: выбрать для перестановки`);
      scene.append(furnishing);
    }
    if (selected) {
      const placementGrid = element('div', 'pet-placement-grid');
      placementGrid.setAttribute('aria-label', 'Выбери место для предмета');
      for (let y = 2; y >= 0; y--)
        for (let x = 0; x < 6; x++) {
          const occupied = state.placements.some(
            (p) => p.item !== selected && p.room === room && p.x === x && p.y === y,
          );
          const cell = actionButton(
            '＋',
            { type: 'place', item: selected, room, x, y },
            'pet-placement-cell',
          );
          cell.setAttribute(
            'aria-label',
            `Поставить ${petItem(selected).title}: ряд ${3 - y}, место ${x + 1}`,
          );
          cell.disabled ||= occupied;
          placementGrid.append(cell);
        }
      scene.append(placementGrid);
    }
    const nameRow = element('div', 'pet-name-row');
    nameRow.append(
      element('h2', '', state.name),
      element('span', '', low ? 'Немного соскучился' : 'Твой маленький домашний космос'),
    );
    const care = element('div', 'pet-care-actions');
    care.append(
      actionButton('♡ Погладить', { type: 'care', care: 'pet' }),
      actionButton('◌ Искупать', { type: 'care', care: 'wash' }),
      actionButton('☾ Отдохнуть', { type: 'care', care: 'rest' }),
    );
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
    const decoration = element('details', 'pet-decoration');
    decoration.open = decorating;
    decoration.addEventListener('toggle', () => {
      if (decoration.isConnected) decorating = decoration.open;
    });
    decoration.append(element('summary', '', '✦ Обустроить дом и изменить имя'));
    const inventory = element('div', 'pet-inventory');
    if (state.owned.length === 0)
      inventory.append(
        element('p', '', 'Первая вещь появится за исполненное желание. Или загляни в магазин.'),
      );
    for (const id of state.owned) {
      const item = petItem(id);
      inventory.append(
        button(
          `${item.icon} ${item.title}`,
          () => {
            selected = id;
            decorating = true;
            render();
          },
          `pet-inventory-item ${selected === id ? 'selected' : ''}`,
        ),
      );
    }
    if (selected) {
      inventory.append(
        element('p', '', `${petItem(selected).title}: нажми на ＋ в комнате.`),
        actionButton('Убрать в кладовку', { type: 'store', item: selected }),
        button(
          'Закончить перестановку',
          () => {
            selected = undefined;
            render();
          },
          'pet-button',
        ),
      );
    }
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
    decoration.append(inventory, themes, rename);
    home.append(roomNav, scene, nameRow, care, needs, decoration);

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
          element('span', 'pet-item-icon', item.icon),
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
          card.append(claim, gameLinks(wish.cost));
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
      for (const item of PET_ITEMS) {
        const owned = state.owned.includes(item.id);
        const locked = item.level > level;
        const card = element('article', 'pet-shop-item');
        card.append(
          element('span', 'pet-item-icon', item.icon),
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
        card.append(buy, gameLinks(item.cost));
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
        'pet-button pet-button-primary',
      );
      retry.disabled = busy;
      utilities.append(retry);
    }
    shell.append(heading, utilities, layout, walletPanel);
  }
  // Refresh after returning from a game or Telegram backgrounding; no polling during play.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void load();
  };
  document.addEventListener('visibilitychange', onVisible);
  render();
  void load();
  return () => {
    disposed = true;
    boardCleanup?.();
    clearTimeout(mutationFeedbackTimer);
    document.removeEventListener('visibilitychange', onVisible);
    shell.remove();
  };
}
