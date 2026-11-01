import type { MineSize } from '../games/minesweeper/engine.ts';
import { createSnake } from '../games/snake/engine.ts';
import { snakeRenderer } from './games/snake/renderer.ts';
import './games/snake/snake.css';
import { type LaunchTarget, parseLaunch } from '../shared/launch.ts';
import { mountLeaderboard } from './ui/leaderboard.ts';
import './styles.css';
import type { TetrisMode } from '../games/tetris/types.ts';
import type { GameInfo } from '../shared/contracts.ts';
import { CATALOG } from '../shared/contracts.ts';
import type { GameAdapter } from './games/adapter.ts';
import { api, hasApi } from './platform/api.ts';
import { initializeTelegram, inTelegram, telegram } from './platform/telegram.ts';
import { button, element, errorMessage } from './ui/dom.ts';

initializeTelegram();
const root = document.getElementById('app');
if (!root) throw new Error('App mount missing');
const header = element('header', 'site-header');
const brand = element('a', 'brand');
brand.href = '#';
brand.setAttribute('aria-label', 'Arcade — главная');
brand.append(
  element('span', 'brand-symbol', '▦'),
  element('span', '', 'ARCADE'),
  element('span', 'brand-tag', 'TG / 01'),
);
const navigation = element('nav', 'navigation');
navigation.setAttribute('aria-label', 'Навигация');
const gamesTab = button('Игры', () => showCatalog(), 'nav-button active');
const boardTab = button(
  'Рекорды',
  () => {
    void showLeaderboard();
  },
  'nav-button',
);
navigation.append(gamesTab, boardTab);
const identity = element(
  'span',
  'identity',
  import.meta.env.DEV ? '● Локальный игрок' : '● PLAYER ONE',
);
header.append(brand, navigation, identity);
const content = element('main', 'main');
const footer = element('footer', 'site-footer');
footer.append(
  element('span', '', 'ИГРАЙ. ПРОБУЙ. ПРЕВОСХОДИ.'),
  element('span', '', 'NO COINS REQUIRED ↗'),
);
root.append(header, content, footer);
let disposeBoard: (() => void) | null = null;
let disposeGame: (() => void) | null = null;
let currentView: LaunchTarget = { view: 'catalog' };
const navigationSession = crypto.randomUUID();
brand.addEventListener('click', (event) => {
  event.preventDefault();
  showCatalog();
});
if (hasApi)
  void api
    .profile()
    .then((player) => {
      identity.textContent = `● ${player.name}`;
    })
    .catch(() => {
      identity.textContent = '● ГОСТЬ';
    });
function tabs(board: boolean): void {
  gamesTab.classList.toggle('active', !board);
  boardTab.classList.toggle('active', board);
}
function preview(game: GameInfo): HTMLElement {
  const visual = element('div', `game-preview ${game.id}-preview`);
  visual.setAttribute('aria-hidden', 'true');
  if (game.id === 'snake') {
    const canvas = element('canvas');
    const state = createSnake(12, 123);
    state.body = [45, 44, 43, 55, 67, 79, 78, 77, 76, 64, 52, 40, 28, 29, 30];
    state.food = 69;
    snakeRenderer(canvas)(state);
    visual.append(canvas, element('span', 'preview-watermark', 'GROW YOUR RECORD'));
  } else if (game.id === 'tetris') {
    const blocks = element('div', 'block-scene');
    const occupied = [
      [0, 8],
      [1, 8],
      [2, 8],
      [3, 8],
      [4, 8],
      [5, 8],
      [0, 7],
      [1, 7],
      [4, 7],
      [5, 7],
      [0, 6],
      [5, 6],
      [5, 5],
      [2, 3],
      [3, 3],
      [3, 2],
      [4, 3],
    ];
    occupied.forEach(([x = 0, y = 0], i) => {
      const block = element('i', 'pixel-block');
      block.style.gridColumn = String(x + 1);
      block.style.gridRow = String(y + 1);
      block.style.background =
        ['#a4c981', '#c1a5df', '#f4c775', '#d18762'][Math.floor(i / 4) % 4] ?? '#a4c981';
      blocks.append(block);
    });
    visual.append(blocks, element('span', 'preview-watermark', '40 LINES'));
  } else if (game.id === '2048') {
    const blocks = element('div', 'puzzle-preview-grid');
    for (const value of [2, 4, 0, 0, 4, 8, 16, 0, 8, 32, 64, 2, 16, 64, 128, 2048])
      blocks.append(element('span', value >= 128 ? 'bright' : '', value ? String(value) : ''));
    visual.append(blocks, element('span', 'preview-watermark', 'MERGE / REPEAT'));
  } else if (game.id === 'minesweeper') {
    const blocks = element('div', 'mine-preview-grid');
    for (const value of [
      '1',
      '',
      '⚑',
      '',
      '',
      '2',
      '1',
      '',
      '',
      '1',
      '',
      '',
      '⚑',
      '2',
      '',
      '',
      '',
      '',
      '1',
      '',
    ])
      blocks.append(element('span', value ? 'open' : '', value));
    visual.append(blocks, element('span', 'preview-watermark', 'CLEAR THE FIELD'));
  } else if (game.id === 'mario') {
    visual.append(
      element('div', 'pixel-cloud cloud-one'),
      element('div', 'pixel-cloud cloud-two'),
      element('div', 'pixel-hill'),
      element('div', 'question-block', '?'),
      element('div', 'brick-line'),
      element('span', 'preview-watermark', 'WORLD 1–1'),
    );
  } else {
    const corridor = element('div', 'doom-corridor');
    corridor.append(element('div', 'doom-door'), element('div', 'doom-light'));
    visual.append(
      corridor,
      element('span', 'doom-word', 'DOOM'),
      element('span', 'preview-watermark', 'KNEE-DEEP'),
    );
  }
  return visual;
}
function renderCatalog(): void {
  tabs(false);
  content.replaceChildren();
  const hero = element('section', 'hero');
  const intro = element('div', 'hero-copy');
  intro.append(
    element('span', 'eyebrow', 'ТВОЙ КАРМАННЫЙ ИГРОВОЙ ЗАЛ'),
    element('h1', '', 'ЕЩЁ ОДНА\nПАРТИЯ.'),
  );
  const title = intro.querySelector('h1');
  if (title) {
    title.replaceChildren(
      document.createTextNode('ЕЩЁ ОДНА'),
      element('br'),
      element('span', '', 'ПАРТИЯ.'),
    );
  }
  intro.append(
    element(
      'p',
      'hero-description',
      'Тетрис, Сапёр, 2048 и Змейка.\nВыбирай игру и вырасти свой рекорд.',
    ),
  );
  const actions = element('div', 'hero-actions');
  actions.append(
    button(
      'Начать с Тетриса ↗',
      () => {
        void openGame(CATALOG[0]);
      },
      'button primary',
    ),
    element('span', 'hero-note', 'БЕЗ УСТАНОВКИ\nПРЯМО В TELEGRAM'),
  );
  intro.append(actions);
  const ticket = element('aside', 'hero-ticket');
  ticket.append(
    element('span', 'eyebrow', 'СЕГОДНЯ В ПРОГРАММЕ'),
    element('strong', '', 'ИГРА ЗА\nРЕКОРД'),
    element('span', 'ticket-rule'),
    element('p', '', '40 линий. Ни секунды лишней.'),
    button(
      'SPRINT →',
      () => {
        void openGame(CATALOG[0], 'sprint');
      },
      'ticket-link',
    ),
  );
  hero.append(intro, ticket);
  const section = element('section', 'games-section');
  const sectionHead = element('div', 'section-heading');
  sectionHead.append(
    element('h2', '', 'ВЫБИРАЙ СВОЮ ИГРУ'),
    element('span', 'eyebrow', '04 GAMES / ∞ ATTEMPTS'),
  );
  const grid = element('div', 'games-grid');
  CATALOG.forEach((game, index) => {
    const card = element('article', 'game-card');
    const cardTop = element('div', 'card-top');
    cardTop.append(
      element('span', 'eyebrow', `0${index + 1} / ${game.id.toUpperCase()}`),
      element('span', `pill ${game.ranked ? 'ranked' : ''}`, game.ranked ? 'РЕЙТИНГ' : 'СВОБОДНО'),
    );
    const image = preview(game);
    const info = element('div', 'card-info');
    info.append(element('h3', '', game.title), element('p', '', game.subtitle));
    const launch = button(
      'Играть ↗',
      () => {
        void openGame(game);
      },
      'card-launch',
    );
    launch.setAttribute('aria-label', `Играть: ${game.title}`);
    card.append(cardTop, image, info, launch);
    grid.append(card);
  });
  section.append(sectionHead, grid);
  const note = element('section', 'bottom-strip');
  note.append(
    element('span', 'strip-icon', '↗'),
    element('div', '', 'ТВОЙ РЕКОРД — НЕ ПОСЛЕДНИЙ.'),
    button(
      'Посмотреть таблицу →',
      () => {
        void showLeaderboard();
      },
      'text-button',
    ),
  );
  content.append(hero, section, note);
}
function routeHash(target: LaunchTarget): string {
  if (target.view === 'game') {
    const variant =
      target.game === 'tetris'
        ? `_${target.mode ?? 'marathon'}`
        : target.game === 'minesweeper' && target.size
          ? `_${target.size}`
          : target.game === 'snake' && target.snakeSize
            ? `_${target.snakeSize}`
            : '';
    return `#game_${target.game}${variant}`;
  }
  if (target.view === 'leaderboard')
    return target.groupId ? `#board_${target.groupId}` : '#leaderboard';
  return '#games';
}
function navigate(target: LaunchTarget, replace = false): void {
  const fromGame = currentView.view === 'game';
  if (!replace && location.hash === routeHash(target)) return;
  const state = { arcadeSession: navigationSession, fromArcade: !replace };
  if (replace) history.replaceState(state, '', routeHash(target));
  else history.pushState(state, '', routeHash(target));
  renderPage(target, fromGame);
}
function showCatalog(): void {
  navigate({ view: 'catalog' });
}
function showLeaderboard(groupId?: number): void {
  navigate({ view: 'leaderboard', ...(groupId === undefined ? {} : { groupId }) });
}
function openGame(game: GameInfo | undefined, initialMode: TetrisMode = 'marathon'): void {
  if (game?.available) navigate({ view: 'game', game: game.id, mode: initialMode });
}
function renderPage(target: LaunchTarget, restoreFocus = false): void {
  const previousGame = currentView.view === 'game' ? currentView.game : undefined;
  disposeGame?.();
  disposeGame = null;
  disposeBoard?.();
  disposeBoard = null;
  currentView = target;
  content.replaceChildren();
  document.body.classList.toggle('playing-game', target.view === 'game');
  content.classList.toggle('game-main', target.view === 'game');
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = 'Arcade — игры в Telegram';
  if (target.view === 'game') {
    const game = CATALOG.find((game) => game.id === target.game && game.available);
    if (game)
      void mountGamePage(
        game,
        target.mode ?? 'marathon',
        target.size ?? '9x9',
        target.snakeSize ?? 16,
      );
    else navigate({ view: 'catalog' }, true);
  } else if (target.view === 'leaderboard') {
    tabs(true);
    disposeBoard = mountLeaderboard(content, target.groupId);
  } else {
    renderCatalog();
    if (restoreFocus && previousGame)
      content
        .querySelector<HTMLButtonElement>(
          `[aria-label="Играть: ${CATALOG.find((game) => game.id === previousGame)?.title}"]`,
        )
        ?.focus({ preventScroll: true });
  }
}
async function mountGamePage(
  game: GameInfo,
  initialMode: TetrisMode,
  initialSize: MineSize,
  initialSnakeSize: number,
): Promise<void> {
  tabs(false);
  document.title = `${game.title} — Arcade`;
  const page = element('section', 'game-page');
  page.setAttribute('aria-label', game.title);
  const head = element('header', 'game-page-header');
  const title = element('h1', '', game.title);
  title.tabIndex = -1;
  const body = element('div', 'game-page-body');
  body.append(element('p', 'empty-state', 'Загружаем игру…'));
  let adapter: GameAdapter | null = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    const state: unknown = history.state;
    if (
      state &&
      typeof state === 'object' &&
      'arcadeSession' in state &&
      state.arcadeSession === navigationSession &&
      'fromArcade' in state &&
      state.fromArcade === true
    )
      history.back();
    else navigate({ view: 'catalog' }, true);
  };
  head.append(
    button('← Назад', close, 'back-button'),
    title,
    element('span', 'eyebrow', 'ARCADE / PLAY'),
  );
  page.append(head, body);
  content.append(page);
  const back = inTelegram ? telegram?.BackButton : undefined;
  disposeGame = () => {
    if (closed) return;
    closed = true;
    adapter?.dispose();
    back?.offClick(close);
    back?.hide();
    page.remove();
  };
  back?.onClick(close);
  back?.show();
  title.focus({ preventScroll: true });
  try {
    const host = { container: body, onClose: close };
    const mount =
      game.id === 'tetris'
        ? (host: { container: HTMLElement; onClose(): void }) =>
            import('./games/tetris/controller.ts').then((module) =>
              module.mountTetris(host, initialMode),
            )
        : game.id === 'snake'
          ? (host: { container: HTMLElement; onClose(): void }) =>
              import('./games/snake/controller.ts').then((module) =>
                module.mountSnake(host, initialSnakeSize),
              )
          : game.id === '2048'
            ? (host: { container: HTMLElement; onClose(): void }) =>
                import('./games/2048/controller.ts').then((module) => module.mount2048(host))
            : game.id === 'minesweeper'
              ? (host: { container: HTMLElement; onClose(): void }) =>
                  import('./games/minesweeper/controller.ts').then((module) =>
                    module.mountMinesweeper(host, initialSize),
                  )
              : game.id === 'mario'
                ? (await import('./games/mario/adapter.ts')).mountMario
                : (await import('./games/doom/adapter.ts')).mountDoom;
    if (closed) return;
    body.replaceChildren();
    adapter = await mount(host);
    if (closed) adapter.dispose();
  } catch (error) {
    if (!closed) body.replaceChildren(element('p', 'empty-state', errorMessage(error)));
  }
}
window.addEventListener('popstate', () => renderPage(parseLaunch(location.hash.slice(1)), true));
const launch = location.hash
  ? parseLaunch(location.hash.slice(1))
  : parseLaunch(
      telegram?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp'),
    );
navigate(launch, true);
