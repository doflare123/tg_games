import { SNAKE_SIZES } from '../../games/snake/engine.ts';
import { snakeSize } from '../../shared/snake.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';

export function mountSnakeLeaderboard(
  host: HTMLElement,
  initialSize = 16,
  compact = false,
): () => void {
  let disposed = false;
  let request = 0;
  const section = element('section', 'leaderboard-section');
  section.append(
    element(
      compact ? 'h3' : 'h1',
      compact ? '' : 'board-title',
      compact ? 'Рекорды сада' : 'ЗМЕЙКА / РЕКОРДЫ',
    ),
  );
  const filters = element('div', 'board-filters');
  const size = element('select', 'select');
  size.setAttribute('aria-label', 'Размер поля рейтинга змейки');
  for (const value of SNAKE_SIZES) {
    const option = element('option', '', `${value} × ${value}`);
    option.value = String(value);
    size.append(option);
  }
  size.value = String(initialSize);
  const period = element('select', 'select');
  period.setAttribute('aria-label', 'Период рейтинга змейки');
  for (const [value, label] of [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
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
      'Лучший счёт каждого игрока. Размеры считаются отдельно. Только завершённые партии с серверной проверкой. При равенстве выше более ранняя партия. Неделя — с понедельника, UTC.',
    ),
  );
  host.replaceChildren(section);
  async function update() {
    const token = ++request;
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой игру в Telegram, чтобы увидеть рейтинг.');
      const board = await api.snakeLeaderboard(
        snakeSize(Number(size.value)),
        period.value === 'week' ? 'week' : 'all',
      );
      if (disposed || token !== request) return;
      results.replaceChildren();
      if (!board.entries.length)
        results.append(
          element('p', 'empty-state', 'Сад ждёт первого рекорда. Сыграй рейтинговую партию!'),
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
