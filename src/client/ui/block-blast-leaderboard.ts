import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';
import { leaderboardGroups } from './leaderboard-groups.ts';

export function mountBlockLeaderboard(
  host: HTMLElement,
  initialGroupId?: number,
  onGroupChange?: (id: number | undefined) => void,
): () => void {
  let disposed = false;
  let request = 0;
  const groups = leaderboardGroups(update, initialGroupId, onGroupChange);
  const section = element('section', 'leaderboard-section');
  section.append(element('h1', 'board-title', 'BLOCK BLAST / РЕКОРДЫ'));
  const filters = element('div', 'board-filters');
  const period = element('select', 'select');
  period.setAttribute('aria-label', 'Период рейтинга Block Blast');
  for (const [value, label] of [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    period.append(option);
  }
  filters.append(groups.select, period);
  const results = element('div', 'board-results');
  results.setAttribute('aria-live', 'polite');
  section.append(
    filters,
    groups.note,
    groups.status,
    groups.membershipStatus,
    results,
    element(
      'p',
      'control-hint',
      'Лучший счёт каждого игрока. Очки за блоки, линии и очистку поля. Только завершённые партии с серверной проверкой. При равенстве выше более ранняя партия. Неделя — с понедельника, UTC.',
    ),
  );
  host.replaceChildren(section);
  async function update() {
    groups.beginUpdate();
    const token = ++request;
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой игру в Telegram, чтобы увидеть рейтинг.');
      const board = await api.blockBlastLeaderboard(
        period.value === 'week' ? 'week' : 'all',
        groups.selected(),
      );
      if (disposed || token !== request) return;
      groups.showMembership(board);
      results.replaceChildren();
      if (!board.entries.length)
        results.append(
          element('p', 'empty-state', 'Первый рекорд ещё впереди. Сыграй рейтинговую партию!'),
        );
      else {
        const table = element('table', 'leaderboard');
        const head = element('thead');
        const tr = element('tr');
        for (const label of ['#', 'ИГРОК', 'ОЧКИ']) tr.append(element('th', '', label));
        head.append(tr);
        const body = element('tbody');
        for (const entry of board.entries) {
          const row = element('tr', entry.playerId === board.me?.playerId ? 'own-record' : '');
          for (const value of [
            String(entry.rank).padStart(2, '0'),
            entry.name,
            String(entry.score),
          ])
            row.append(element('td', '', value));
          body.append(row);
        }
        table.append(head, body);
        results.append(table);
      }
      if (board.me)
        results.append(
          element('p', 'personal-record', `Твоё место: ${board.me.rank} · ${board.me.score} очков`),
        );
    } catch (error) {
      if (!disposed && token === request)
        results.replaceChildren(
          element('p', 'empty-state', errorMessage(error)),
          button(
            'Обновить',
            () => {
              void update();
            },
            'button secondary',
          ),
        );
    }
  }
  for (const control of [period])
    control.addEventListener('change', () => {
      void update();
    });
  groups.start();
  return () => {
    groups.dispose();
    disposed = true;
    request++;
  };
}
