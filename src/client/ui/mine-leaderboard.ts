import { LEVELS, type MineSize, SIZES } from '../../games/minesweeper/engine.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage, formatMineTime } from './dom.ts';

export function mountMineLeaderboard(host: HTMLElement): () => void {
  let disposed = false;
  let request = 0;
  const section = element('section', 'leaderboard-section');
  section.append(
    element('span', 'eyebrow', 'MINESWEEPER / LEADERBOARD'),
    element('h1', 'board-title', 'САПЁР\nНА ВРЕМЯ.'),
  );
  const filters = element('div', 'board-filters');
  const size = element('select', 'select');
  size.setAttribute('aria-label', 'Уровень рейтинга сапёра');
  for (const value of SIZES) {
    const option = element('option', '', LEVELS[value].title);
    option.value = value;
    size.append(option);
  }
  const period = element('select', 'select');
  period.setAttribute('aria-label', 'Период рейтинга сапёра');
  for (const [value, title] of [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ]) {
    const option = element('option', '', title);
    option.value = value ?? 'all';
    period.append(option);
  }
  filters.append(size, period);
  const results = element('div', 'board-results');
  results.setAttribute('aria-live', 'polite');
  section.append(
    filters,
    results,
    element(
      'p',
      'control-hint',
      'Лучшее время победы каждого игрока. Меньше время — выше место. Три размера поля считаются отдельно. Свободные партии не учитываются. Неделя начинается в понедельник, UTC.',
    ),
  );
  host.replaceChildren(section);
  async function update(): Promise<void> {
    const current = ++request;
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой Arcade внутри Telegram, чтобы увидеть рейтинги.');
      const board = await api.mineLeaderboard({
        size: size.value as MineSize,
        period: period.value === 'week' ? 'week' : 'all',
      });
      if (disposed || current !== request) return;
      results.replaceChildren();
      if (!board.entries.length) {
        results.append(
          element(
            'p',
            'empty-state',
            'Рекордов пока нет. Выиграй рейтинговую партию на этом уровне.',
          ),
        );
        return;
      }
      const table = element('table', 'leaderboard');
      const head = element('thead');
      const heading = element('tr');
      for (const label of ['МЕСТО', 'ИГРОК', 'ВРЕМЯ']) heading.append(element('th', '', label));
      head.append(heading);
      const body = element('tbody');
      for (const entry of board.entries) {
        const row = element('tr', entry.playerId === board.me?.playerId ? 'own-record' : '');
        for (const value of [
          String(entry.rank).padStart(2, '0'),
          entry.name,
          formatMineTime(entry.elapsedMs),
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
            `Твоё место: ${board.me.rank} · ${formatMineTime(board.me.elapsedMs)}`,
          ),
        );
    } catch (error) {
      if (disposed || current !== request) return;
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
  for (const control of [size, period])
    control.addEventListener('change', () => {
      void update();
    });
  void update();
  return () => {
    disposed = true;
    request++;
  };
}
