import {
  LEGACY_DOODLE_RULESET,
  DOODLE_RULESET as PLATFORM_RULESET,
} from '../../games/doodle/engine.ts';
import { DOODLE_RULESET, DOODLE_RULESETS } from '../../shared/doodle.ts';
import { DOODLE_RANKED_CLOSED_MESSAGE, isDoodleRankedEnabled } from '../../shared/doodle-policy.ts';
import { oneOf } from '../../shared/errors.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';
import { leaderboardGroups } from './leaderboard-groups.ts';

export function mountDoodleLeaderboard(
  host: HTMLElement,
  initialGroupId?: number,
  onGroupChange?: (id: number | undefined) => void,
): () => void {
  let disposed = false;
  let request = 0;
  const groups = leaderboardGroups(update, initialGroupId, onGroupChange);
  const section = element('section', 'leaderboard-section');
  section.append(element('h1', 'board-title', 'DOODLE JUMP / РЕКОРДЫ'));
  if (!isDoodleRankedEnabled())
    section.append(
      element(
        'p',
        'control-hint',
        `${DOODLE_RANKED_CLOSED_MESSAGE} Здесь сохранены прошлые результаты.`,
      ),
    );
  const filters = element('div', 'board-filters');
  const period = element('select', 'select');
  period.setAttribute('aria-label', 'Период рейтинга Doodle Jump');
  for (const [value, label] of [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    period.append(option);
  }
  const ruleset = element('select', 'select');
  ruleset.setAttribute('aria-label', 'Версия рейтинга Doodle Jump');
  for (const [value, label] of [
    [DOODLE_RULESET, 'Текущая игра'],
    [PLATFORM_RULESET, 'Архив: платформы'],
    [LEGACY_DOODLE_RULESET, 'Архив: первая версия'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    ruleset.append(option);
  }
  filters.append(groups.select, period, ruleset);
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
      'Лучший счёт каждого игрока. Только завершённые партии с серверной проверкой. При равенстве выше более ранняя партия. Неделя — с понедельника, UTC.',
    ),
  );
  host.replaceChildren(section);
  async function update() {
    groups.beginUpdate();
    const token = ++request;
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой игру в Telegram, чтобы увидеть рейтинг.');
      const board = await api.doodleLeaderboard(
        period.value === 'week' ? 'week' : 'all',
        groups.selected(),
        oneOf(ruleset.value, DOODLE_RULESETS),
      );
      if (disposed || token !== request) return;
      groups.showMembership(board);
      results.replaceChildren();
      if (!board.entries.length)
        results.append(
          element(
            'p',
            'empty-state',
            isDoodleRankedEnabled()
              ? 'Первая высота ждёт своего рекорда. Сыграй рейтинговую партию!'
              : 'Сохранённых результатов нет.',
          ),
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
  for (const control of [period, ruleset])
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
