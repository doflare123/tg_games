import { DOOM_CATEGORIES, DOOM_SKILLS, DOOM_TARGETS, doomTime } from '../../shared/doom.ts';
import { oneOf } from '../../shared/errors.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';
import { leaderboardGroups } from './leaderboard-groups.ts';
export function mountDoomLeaderboard(
  host: HTMLElement,
  initialGroupId?: number,
  onGroupChange?: (id: number | undefined) => void,
): () => void {
  let disposed = false,
    request = 0;
  const groups = leaderboardGroups(update, initialGroupId, onGroupChange);
  const section = element('section', 'leaderboard-section');
  const select = (label: string, options: readonly (readonly [string, string])[]) => {
    const control = element('select', 'select');
    control.setAttribute('aria-label', label);
    for (const [value, label] of options) {
      const option = element('option', '', label);
      option.value = value;
      control.append(option);
    }
    return control;
  };
  const skill = select('Сложность Freedoom', [
    ['1', 'Очень легко'],
    ['2', 'Легко'],
    ['3', 'Средне'],
    ['4', 'Сложно'],
  ]);
  skill.value = '3';
  const target = select(
    'Эпизод или уровень Freedoom',
    DOOM_TARGETS.map(
      (value) => [value, value === 'episode' ? 'Весь первый эпизод' : value] as const,
    ),
  );
  const category = select('Категория Freedoom', [
    ['any', 'На скорость'],
    ['max', '100% монстров и секретов'],
  ]);
  const period = select('Период рейтинга Freedoom', [
    ['all', 'Всё время'],
    ['week', 'Эта неделя'],
  ]);
  const filters = element('div', 'board-filters');
  filters.append(groups.select, skill, target, category, period);
  const results = element('div', 'board-results');
  results.setAttribute('aria-live', 'polite');
  section.append(
    element('h1', 'board-title', 'FREEDOOM / РЕКОРДЫ'),
    filters,
    groups.note,
    groups.status,
    groups.membershipStatus,
    results,
    element(
      'p',
      'control-hint',
      'Лучшее время каждого игрока; только выходы с уровней, воспроизведённые сервером. Уровни считаются внутри кампании, с перенесённым оружием. Пауза/продолжение исключают текущий уровень и весь эпизод; последующие целые уровни засчитываются. Для 100% эпизода нужны все 9 карт. Неделя начинается в понедельник, UTC.',
    ),
  );
  host.replaceChildren(section);
  async function update() {
    groups.beginUpdate();
    const token = ++request;
    results.replaceChildren(element('p', 'empty-state', 'Загружаем рекорды…'));
    try {
      if (!hasApi) throw new Error('Открой игру в Telegram, чтобы увидеть рейтинг.');
      const groupId = groups.selected();
      const board = await api.doomLeaderboard({
        skill: oneOf(skill.value, DOOM_SKILLS),
        target: oneOf(target.value, DOOM_TARGETS),
        category: oneOf(category.value, DOOM_CATEGORIES),
        period: period.value === 'week' ? 'week' : 'all',
        ...(groupId === undefined ? {} : { groupId }),
      });
      if (disposed || token !== request) return;
      groups.showMembership(board);
      results.replaceChildren();
      if (!board.entries.length)
        results.append(
          element('p', 'empty-state', 'В этой категории пока нет проверенных результатов.'),
        );
      else {
        const table = element('table', 'leaderboard'),
          head = element('thead'),
          heading = element('tr');
        for (const label of ['#', 'ИГРОК', 'ВРЕМЯ']) heading.append(element('th', '', label));
        head.append(heading);
        const body = element('tbody');
        for (const entry of board.entries) {
          const row = element('tr', entry.playerId === board.me?.playerId ? 'own-record' : '');
          for (const value of [String(entry.rank), entry.name, doomTime(entry.ticks)])
            row.append(element('td', '', value));
          body.append(row);
        }
        table.append(head, body);
        results.append(table);
      }
      if (board.me)
        results.append(
          element(
            'p',
            'personal-record',
            `Твоё место: ${board.me.rank} · ${doomTime(board.me.ticks)}`,
          ),
        );
    } catch (error) {
      if (!disposed && token === request)
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
  for (const control of [skill, target, category, period])
    control.addEventListener('change', () => {
      void update();
    });
  groups.start();
  return () => {
    disposed = true;
    request++;
    groups.dispose();
  };
}
