import type { TetrisMode } from '../../games/tetris/types.ts';
import type { GroupView } from '../../shared/groups.ts';
import { api, hasApi } from '../platform/api.ts';
import { mount2048Leaderboard } from './2048-leaderboard.ts';
import { button, element, errorMessage, formatTime } from './dom.ts';
import { mountMineLeaderboard } from './mine-leaderboard.ts';
import { mountSnakeLeaderboard } from './snake-leaderboard.ts';

// This single recovery was explicitly approved without a public label; its stored source stays manual.
const OWNER_APPROVED_RECOVERY = 'manual:recovery:2026-10-31:930852883:marathon:89768';
export function mountLeaderboard(host: HTMLElement, initialGroupId?: number): () => void {
  const picker = element('select', 'select');
  picker.setAttribute('aria-label', 'Игра рейтинга');
  for (const [value, label] of [
    ['tetris', 'Тетрис'],
    ['minesweeper', 'Сапёр'],
    ['2048', '2048'],
    ['snake', 'Змейка'],
  ]) {
    const option = element('option', '', label);
    option.value = value ?? 'tetris';
    picker.append(option);
  }
  const filters = element('div', 'board-game-picker');
  filters.append(picker);
  const content = element('div');
  host.replaceChildren(filters, content);
  let dispose = mountTetrisLeaderboard(content, initialGroupId);
  picker.addEventListener('change', () => {
    dispose();
    dispose =
      picker.value === 'snake'
        ? mountSnakeLeaderboard(content)
        : picker.value === '2048'
          ? mount2048Leaderboard(content)
          : picker.value === 'minesweeper'
            ? mountMineLeaderboard(content)
            : mountTetrisLeaderboard(content, initialGroupId);
  });
  return () => dispose();
}
function mountTetrisLeaderboard(host: HTMLElement, initialGroupId?: number): () => void {
  let disposed = false;
  let request = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let knownGroups: GroupView[] = [];
  const section = element('section', 'leaderboard-section');
  section.append(
    element('span', 'eyebrow', 'TETRIS / LEADERBOARD'),
    element('h1', 'board-title', 'ТАБЛИЦА\nРЕКОРДОВ.'),
  );
  const filters = element('div', 'board-filters');
  const mode = element('select', 'select');
  mode.setAttribute('aria-label', 'Режим рейтинга');
  for (const [value, label] of [
    ['marathon', 'Marathon'],
    ['sprint', 'Sprint 40'],
    ['ultra', 'Ultra 120'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    mode.append(option);
  }
  const period = element('select', 'select');
  period.setAttribute('aria-label', 'Период рейтинга');
  for (const [value, label] of [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    period.append(option);
  }
  const scope = element('select', 'select');
  scope.setAttribute('aria-label', 'Группа рейтинга');
  const global = element('option', '', 'Общий рейтинг');
  global.value = 'global';
  scope.append(global);
  filters.append(scope, mode, period);
  const notification = button(
    'Уведомления: выкл',
    () => {
      void configure();
    },
    'button secondary',
  );
  notification.hidden = true;
  const note = element(
    'p',
    'control-hint',
    'В «Мои группы» доступны группы с ботом, где подтверждено твоё участие. Для подключения вызови /games в группе. Боту нужны права администратора.',
  );
  const status = element('p', 'board-status');
  status.setAttribute('role', 'status');
  const membershipStatus = element('p', 'control-hint');
  membershipStatus.setAttribute('role', 'status');
  const results = element('div', 'board-results');
  section.append(
    filters,
    notification,
    note,
    status,
    membershipStatus,
    results,
    element(
      'p',
      'control-hint',
      'Лучший результат каждого игрока. «Вручную» — корректировка администратора без replay; ≈ — приблизительный счёт. Неделя начинается в понедельник, UTC. В группе видны лучшие результаты её участников, в том числе сыгранные до подключения бота.',
    ),
  );
  host.replaceChildren(section);
  const selected = () => (scope.value === 'global' ? undefined : Number(scope.value));
  const refreshSettings = () => {
    const group = knownGroups.find((g) => g.id === selected());
    notification.hidden = !group?.canManage;
    notification.textContent = group?.notificationsEnabled
      ? 'Уведомления: вкл'
      : 'Уведомления: выкл';
  };
  async function configure() {
    const group = knownGroups.find((g) => g.id === selected());
    if (!group?.canManage) return;
    notification.disabled = true;
    status.textContent = '';
    try {
      const updated = await api.notifications(group.id, !group.notificationsEnabled);
      if (disposed) return;
      knownGroups = knownGroups.map((g) => (g.id === updated.id ? updated : g));
      refreshSettings();
      status.textContent = updated.notificationsEnabled
        ? 'Объявления включены: первый и новый рекорд группы или обгон в её топ-10, не чаще раза за 5 минут. Глобальные места не учитываются.'
        : 'Объявления выключены.';
    } catch (error) {
      if (!disposed) status.textContent = errorMessage(error);
    } finally {
      notification.disabled = false;
    }
  }
  async function update() {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    membershipStatus.replaceChildren();
    const current = ++request;
    refreshSettings();
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой Arcade внутри Telegram, чтобы увидеть рейтинги.');
      const board = await api.leaderboard(
        mode.value as TetrisMode,
        period.value as 'all' | 'week',
        selected(),
      );
      if (disposed || current !== request) return;
      results.replaceChildren();
      if (board.membershipSync === 'pending') {
        membershipStatus.textContent =
          'Сверяем участников через Telegram. Показаны уже подтверждённые результаты; таблица обновится автоматически.';
        refreshTimer = setTimeout(() => {
          void update();
        }, 1500);
      } else if (board.membershipSync === 'failed') {
        membershipStatus.append(
          document.createTextNode(
            'Не удалось сверить часть участников. Показаны только подтверждённые результаты. ',
          ),
          button(
            'Повторить сверку',
            () => {
              void update();
            },
            'text-button',
          ),
        );
      }
      if (!board.entries.length) {
        results.append(
          element(
            'div',
            'empty-state',
            board.membershipSync === 'pending'
              ? 'Сверяем участников и загружаем их рекорды…'
              : board.membershipSync === 'failed'
                ? 'Пока нет подтверждённых результатов. Повтори сверку участников.'
                : 'Первый рекорд ещё впереди. Сыграй рейтинговую партию в Тетрис.',
          ),
        );
        return;
      }
      const table = element('table', 'leaderboard');
      const head = element('thead');
      const heading = element('tr');
      for (const label of ['МЕСТО', 'ИГРОК', board.mode === 'sprint' ? 'ВРЕМЯ' : 'ОЧКИ', 'ЛИНИИ'])
        heading.append(element('th', '', label));
      head.append(heading);
      const body = element('tbody');
      for (const entry of board.entries) {
        const row = element('tr', entry.playerId === board.me?.playerId ? 'own-record' : '');
        for (const value of [
          String(entry.rank).padStart(2, '0'),
          `${entry.name}${entry.source === 'manual' && entry.runId !== OWNER_APPROVED_RECOVERY ? ' · вручную' : ''}`,
          board.mode === 'sprint'
            ? entry.durationKnown
              ? formatTime(entry.ticks)
              : '—'
            : `${entry.approximate ? '≈' : ''}${entry.score.toLocaleString('ru-RU')}`,
          String(entry.lines),
        ])
          row.append(element('td', '', value));
        body.append(row);
      }
      table.append(head, body);
      results.append(table);
      if (board.me)
        results.append(
          element(
            'p',
            'personal-record',
            `Твоё место: ${board.me.rank} · ${board.mode === 'sprint' ? (board.me.durationKnown ? formatTime(board.me.ticks) : '—') : `${board.me.approximate ? '≈' : ''}${board.me.score.toLocaleString('ru-RU')}`}`,
          ),
        );
    } catch (error) {
      if (!disposed && current === request)
        results.replaceChildren(
          element('p', 'empty-state', errorMessage(error)),
          button(
            'Повторить',
            () => {
              void update();
            },
            'button secondary',
          ),
        );
    }
  }
  for (const control of [mode, period, scope])
    control.addEventListener('change', () => {
      status.textContent = '';
      void update();
    });
  if (hasApi)
    void api
      .groups()
      .then((groups) => {
        if (disposed) return;
        knownGroups = groups;
        for (const group of groups) {
          const option = element('option', '', group.title);
          option.value = String(group.id);
          scope.append(option);
        }
        if (initialGroupId !== undefined) {
          if (!groups.some((g) => g.id === initialGroupId)) {
            status.textContent =
              'Эта группа недоступна: вызови /games в группе и проверь права бота.';
            return;
          }
          scope.value = String(initialGroupId);
          void update();
        }
      })
      .catch((error) => {
        if (!disposed) status.textContent = errorMessage(error);
      });
  if (initialGroupId === undefined) void update();
  return () => {
    disposed = true;
    clearTimeout(refreshTimer);
    request++;
  };
}
