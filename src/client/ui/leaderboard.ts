import type { TetrisMode } from '../../games/tetris/types.ts';
import type { GroupView } from '../../shared/groups.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage, formatTime } from './dom.ts';
export function mountLeaderboard(host: HTMLElement, initialGroupId?: number): () => void {
  let disposed = false;
  let request = 0;
  let knownGroups: GroupView[] = [];
  const section = element('section', 'leaderboard-section');
  section.append(
    element('span', 'eyebrow', 'TETRIS / VERIFIED RUNS'),
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
  const results = element('div', 'board-results');
  section.append(
    filters,
    notification,
    note,
    status,
    results,
    element(
      'p',
      'control-hint',
      'Лучшая проверенная попытка каждого игрока. Неделя начинается в понедельник, UTC. Новые партии учитываются в группах, подключённых на момент старта.',
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
        ? 'Объявления включены: обгон соперника и улучшение места в топ-10, не чаще раза за 5 минут.'
        : 'Объявления выключены.';
    } catch (error) {
      if (!disposed) status.textContent = errorMessage(error);
    } finally {
      notification.disabled = false;
    }
  }
  async function update() {
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
      if (!board.entries.length) {
        results.append(
          element(
            'div',
            'empty-state',
            'Первый рекорд ещё впереди. Сыграй рейтинговую партию в Тетрис.',
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
          entry.name,
          board.mode === 'sprint' ? formatTime(entry.ticks) : entry.score.toLocaleString('ru-RU'),
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
            `Твоё место: ${board.me.rank} · ${board.mode === 'sprint' ? formatTime(board.me.ticks) : board.me.score.toLocaleString('ru-RU')}`,
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
    request++;
  };
}
