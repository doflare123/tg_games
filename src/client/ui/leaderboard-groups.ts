import type { GroupLeaderboardState } from '../../shared/groups.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';

export function leaderboardGroups(
  update: () => Promise<void>,
  initialGroupId?: number,
  onGroupChange?: (id: number | undefined) => void,
) {
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const select = element('select', 'select');
  select.setAttribute('aria-label', 'Группа рейтинга');
  const global = element('option', '', 'Общий рейтинг');
  global.value = 'global';
  select.append(global);
  const status = element('p', 'control-hint');
  status.setAttribute('role', 'status');
  const membershipStatus = element('p', 'control-hint');
  membershipStatus.setAttribute('role', 'status');
  const note = element(
    'p',
    'control-hint',
    'Доступны группы с ботом, где подтверждено твоё участие. Для подключения вызови /games в группе. Боту нужны права администратора. Рейтинг группы включает лучшие результаты её участников, в том числе сыгранные до подключения бота.',
  );
  const selected = () => (select.value === 'global' ? undefined : Number(select.value));
  select.addEventListener('change', () => {
    onGroupChange?.(selected());
    void update();
  });
  return {
    select,
    status,
    membershipStatus,
    note,
    selected,
    beginUpdate() {
      clearTimeout(refreshTimer);
      membershipStatus.replaceChildren();
    },
    showMembership(board: GroupLeaderboardState) {
      if (board.membershipSync === 'pending') {
        membershipStatus.textContent =
          'Сверяем участников через Telegram. Показаны уже подтверждённые результаты; таблица обновится автоматически.';
        refreshTimer = setTimeout(() => {
          if (!disposed) void update();
        }, 1500);
      } else if (board.membershipSync === 'failed') {
        membershipStatus.append(
          document.createTextNode(
            'Не удалось сверить часть участников. Показаны только подтверждённые результаты. ',
          ),
          button('Повторить сверку', () => void update(), 'text-button'),
        );
      }
    },
    start() {
      if (initialGroupId === undefined) void update();
      if (!hasApi) {
        if (initialGroupId !== undefined) void update();
        return;
      }
      void api
        .groups()
        .then((groups) => {
          if (disposed) return;
          for (const group of groups) {
            const option = element('option', '', group.title);
            option.value = String(group.id);
            select.append(option);
          }
          if (initialGroupId !== undefined) {
            if (!groups.some((group) => group.id === initialGroupId)) {
              status.textContent =
                'Эта группа недоступна: вызови /games в группе и проверь права бота.';
              return;
            }
            select.value = String(initialGroupId);
            void update();
          }
        })
        .catch((error: unknown) => {
          if (!disposed) status.textContent = errorMessage(error);
        });
    },
    dispose() {
      disposed = true;
      clearTimeout(refreshTimer);
    },
  };
}
