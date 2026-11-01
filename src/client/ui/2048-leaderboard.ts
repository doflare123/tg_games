import { LEGACY_2048_RULESET, RULESET_2048 } from '../../games/2048/engine.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';

export function mount2048Leaderboard(host: HTMLElement): () => void {
  let disposed = false;
  let request = 0;
  const section = element('section', 'leaderboard-section');
  section.append(
    element('span', 'eyebrow', '2048 / LEADERBOARD'),
    element('h1', 'board-title', '2048\nРЕКОРДЫ.'),
  );
  const period = element('select', 'select');
  period.setAttribute('aria-label', 'Период рейтинга 2048');
  for (const [value, title] of [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ] as const) {
    const option = element('option', '', title);
    option.value = value;
    period.append(option);
  }
  const filters = element('div', 'board-filters');
  const rules = element('select', 'select');
  rules.setAttribute('aria-label', 'Правила рейтинга 2048');
  for (const [value, title] of [
    [RULESET_2048, 'Рост плиток'],
    [LEGACY_2048_RULESET, 'Классика · старые рекорды'],
  ] as const) {
    const option = element('option', '', title);
    option.value = value;
    rules.append(option);
  }
  filters.append(rules, period);
  const results = element('div', 'board-results');
  results.setAttribute('aria-live', 'polite');
  section.append(
    filters,
    results,
    element(
      'p',
      'control-hint',
      'Общий рейтинг 2048: лучший счёт каждого игрока. Больше очков — выше место; при равенстве выше более ранняя партия. Очки начисляются за слияния и не суммируются между партиями. Неделя начинается в понедельник, UTC, по дате начала партии.',
    ),
  );
  host.replaceChildren(section);
  async function update(): Promise<void> {
    const current = ++request;
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой Arcade внутри Telegram, чтобы увидеть рейтинги.');
      const board = await api.leaderboard2048(
        period.value === 'week' ? 'week' : 'all',
        rules.value === LEGACY_2048_RULESET ? LEGACY_2048_RULESET : RULESET_2048,
      );
      if (disposed || current !== request) return;
      results.replaceChildren();
      if (!board.entries.length) {
        results.append(
          element('p', 'empty-state', 'Рекордов пока нет. Сыграй рейтинговую партию в 2048.'),
        );
        return;
      }
      const table = element('table', 'leaderboard');
      const head = element('thead');
      const heading = element('tr');
      for (const label of ['МЕСТО', 'ИГРОК', 'ОЧКИ', 'ПЛИТКА'])
        heading.append(element('th', '', label));
      head.append(heading);
      const body = element('tbody');
      for (const entry of board.entries) {
        const row = element('tr', entry.playerId === board.me?.playerId ? 'own-record' : '');
        for (const value of [
          String(entry.rank),
          entry.name,
          entry.score.toLocaleString('ru-RU'),
          String(entry.maxTile),
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
            `Твоё место: ${board.me.rank} · ${board.me.score.toLocaleString('ru-RU')} очков`,
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
  period.addEventListener('change', () => {
    void update();
  });
  rules.addEventListener('change', () => {
    void update();
  });
  void update();
  return () => {
    disposed = true;
    request++;
  };
}
