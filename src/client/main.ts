import { parseLaunch } from '../shared/launch.ts';
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
let activeDialog: HTMLDialogElement | null = null;
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
  if (game.id === 'tetris') {
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
function showCatalog(): void {
  disposeBoard?.();
  disposeBoard = null;
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
    element('p', 'hero-description', 'Тетрис. Три режима.\nСобирай линии и поднимайся в рейтинге.'),
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
    element('span', 'eyebrow', '03 MODES / ∞ ATTEMPTS'),
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
async function showLeaderboard(initialGroupId?: number): Promise<void> {
  tabs(true);
  disposeBoard?.();
  disposeBoard = mountLeaderboard(content, initialGroupId);
}
async function openGame(
  game: GameInfo | undefined,
  initialMode: TetrisMode = 'marathon',
): Promise<void> {
  if (!game?.available || activeDialog) return;
  const dialog = element('dialog', 'game-dialog');
  dialog.setAttribute('aria-label', game.title);
  activeDialog = dialog;
  const head = element('div', 'dialog-header');
  head.append(element('strong', '', game.title));
  const body = element('div', 'dialog-body');
  body.append(element('p', 'empty-state', 'Загружаем игру…'));
  let adapter: GameAdapter | null = null;
  let closed = false;
  const close = () => {
    if (!closed) dialog.close();
  };
  head.append(button('Закрыть ×', close, 'close-button'));
  dialog.append(head, body);
  document.body.append(dialog);
  const back = inTelegram ? telegram?.BackButton : undefined;
  dialog.addEventListener(
    'close',
    () => {
      if (closed) return;
      closed = true;
      adapter?.dispose();
      back?.offClick(close);
      back?.hide();
      dialog.remove();
      activeDialog = null;
    },
    { once: true },
  );
  back?.onClick(close);
  back?.show();
  dialog.showModal();
  try {
    const host = { container: body, onClose: close };
    const mount =
      game.id === 'tetris'
        ? (host: { container: HTMLElement; onClose(): void }) =>
            import('./games/tetris/controller.ts').then((module) =>
              module.mountTetris(host, initialMode),
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
const launch = parseLaunch(
  telegram?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp'),
);
if (launch.view === 'leaderboard') void showLeaderboard(launch.groupId);
else {
  showCatalog();
  if (launch.view === 'game') void openGame(CATALOG.find((game) => game.id === launch.game));
}
