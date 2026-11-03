import {
  ADMIN_TABLES,
  type AdminAction,
  type AdminCell,
  type AdminMutation,
  type AdminPage,
  type AdminStats,
  type AdminTable,
} from '../../shared/admin.ts';
import { api, hasApi } from '../platform/api.ts';
import { button, element, errorMessage } from './dom.ts';
import './admin.css';

const TABLE_NAMES: Record<AdminTable, string> = {
  players: 'Игроки и посетители',
  groups: 'Группы',
  runs: 'Тетрис — партии',
  puzzle2048_runs: '2048 — партии',
  snake_runs: 'Змейка — партии',
  flappy_runs: 'Flappy Bird — партии',
  block_blast_runs: 'Block Blast — партии',
  minesweeper_runs: 'Сапёр — результаты',
  manual_results: 'Ручные исправления',
  group_memberships: 'Участие в группах',
  social_jobs: 'Очередь уведомлений',
  ranking_blocks: 'Блокировки рейтинга',
  admin_visits: 'Посещения по дням',
  admin_group_events: 'История групп',
  admin_audit: 'Журнал изменений',
};
const ACTION_NAMES: Record<AdminAction, string> = {
  disable_notifications: 'Отключить уведомления',
  cancel_job: 'Отменить отправку',
  block_player: 'Запретить новые результаты',
  unblock_player: 'Снять запрет',
  revoke_tetris: 'Снять результат',
  revoke_2048: 'Снять результат',
  revoke_snake: 'Снять результат',
  revoke_flappy: 'Снять результат',
  revoke_block_blast: 'Снять результат',
  revoke_minesweeper: 'Снять результат',
  remove_manual: 'Удалить ручное исправление',
};
const number = (n: number) => n.toLocaleString('ru-RU');
const date = (n: number) =>
  new Date(n).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
const GAME_NAMES: Record<string, string> = {
  tetris: 'Тетрис',
  '2048': '2048',
  snake: 'Змейка',
  flappy: 'Flappy Bird',
  'block-blast': 'Block Blast',
  minesweeper: 'Сапёр',
};
function delta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'Без изменений' : `+${number(current)} · раньше 0`;
  const difference = Math.round((current / previous - 1) * 100);
  return `${difference > 0 ? '+' : ''}${difference}% · было ${number(previous)}`;
}
function readable(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
function makeTable(
  columns: string[],
  rows: (string | HTMLElement)[][],
  caption: string,
): HTMLElement {
  const scroll = element('div', 'admin-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', caption);
  const table = element('table', 'admin-table');
  table.append(element('caption', '', caption));
  const head = element('thead');
  const titles = element('tr');
  for (const name of columns) {
    const th = element('th', '', name);
    th.scope = 'col';
    titles.append(th);
  }
  head.append(titles);
  const body = element('tbody');
  for (const cells of rows) {
    const row = element('tr');
    for (const cell of cells) {
      const td = element('td');
      td.append(typeof cell === 'string' ? document.createTextNode(cell) : cell);
      row.append(td);
    }
    body.append(row);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}
function metric(label: string, value: number, note: string): HTMLElement {
  const card = element('article', 'admin-metric');
  card.append(
    element('span', 'eyebrow', label),
    element('strong', '', number(value)),
    element('small', '', note),
  );
  return card;
}
function renderStats(host: HTMLElement, stats: AdminStats): void {
  const current = stats.weeks[0];
  if (!current) return;
  const comparison = stats.previousMatched;
  const cards = element('div', 'admin-metrics');
  for (const [label, key] of [
    ['Партии на сервере', 'attempts'],
    ['Результаты в рейтинге', 'results'],
    ['Уникальные игроки', 'players'],
    ['Посетители', 'visitors'],
  ] as const)
    cards.append(
      metric(
        label,
        current[key],
        key === 'visitors' && comparison.start < stats.trackingSince
          ? 'Недостаточно истории для сравнения'
          : delta(current[key], comparison[key]),
      ),
    );
  host.append(
    element('h2', '', 'ЭТА НЕДЕЛЯ'),
    element(
      'p',
      'admin-note',
      `С ${date(current.start)} · сравнение с тем же временем прошлой недели. Недели начинаются в понедельник, время UTC.`,
    ),
    cards,
  );
  const totals = element('div', 'admin-totals');
  totals.append(
    metric(
      'Группы с ботом',
      stats.totals.activeGroups,
      `Всего известно: ${number(stats.totals.groups)}`,
    ),
    metric('Игроки и посетители', stats.totals.players, 'За всё время в сохранённых данных'),
    metric(
      'Добавили / удалили бота',
      current.added,
      `Удалили: ${current.removed} · уникальных групп за неделю`,
    ),
    metric(
      'Ожидают отправки',
      stats.totals.pendingJobs,
      `Запретов рейтинга: ${stats.totals.blocked}`,
    ),
  );
  host.append(totals, element('h2', '', 'АКТИВНОСТЬ ПО НЕДЕЛЯМ'));
  const chart = element('div', 'admin-chart');
  chart.setAttribute('aria-label', 'Количество серверных партий по неделям');
  const max = Math.max(1, ...stats.weeks.map((w) => w.attempts));
  for (const week of [...stats.weeks].reverse()) {
    const col = element('div', 'admin-chart-column');
    const bar = element('div', 'admin-chart-bar');
    bar.style.height = `${Math.max(2, (week.attempts / max) * 120)}px`;
    bar.setAttribute('aria-hidden', 'true');
    col.append(
      element('strong', '', number(week.attempts)),
      bar,
      element('small', '', date(week.start).slice(0, 5)),
    );
    chart.append(col);
  }
  host.append(chart);
  const weekRows = stats.weeks.map((week, i) => [
    `${date(week.start)}${i === 0 ? ' · идёт' : ''}`,
    ...(
      ['attempts', 'results', 'players', 'visitors', 'newVisitors', 'added', 'removed'] as const
    ).map((key) =>
      (key === 'visitors' || key === 'newVisitors' || key === 'added' || key === 'removed') &&
      week.end <= stats.trackingSince
        ? '—'
        : number(week[key]),
    ),
  ]);
  host.append(
    makeTable(
      [
        'Неделя с',
        'Партии',
        'В рейтинге',
        'Игроки',
        'Посетители*',
        'Впервые замечены*',
        'Бота добавили*',
        'Бота удалили*',
      ],
      weekRows,
      'Недельная статистика',
    ),
  );
  host.append(
    element(
      'p',
      'admin-note',
      `* Посещения и история групп учитываются с ${date(stats.trackingSince)}. Неделя, на которую приходится начало учёта, неполная; «—» означает отсутствие истории. Первое посещение означает первое наблюдение с начала учёта.`,
    ),
  );
  host.append(element('h2', '', 'ИГРЫ ЗА ЭТУ НЕДЕЛЮ'));
  host.append(
    stats.games.length
      ? makeTable(
          ['Игра', 'Партии', 'В рейтинге', 'Игроки'],
          stats.games.map((g) => [
            GAME_NAMES[g.game] ?? g.game,
            number(g.attempts),
            number(g.results),
            number(g.players),
          ]),
          'Популярность игр',
        )
      : element('p', 'empty-state', 'На этой неделе серверных партий пока нет.'),
  );
  host.append(
    element(
      'p',
      'admin-note',
      'Партии и их результаты распределены по дате начала партии. Свободные игры на устройстве сюда не входят. Сапёр хранит отправленные победы, поэтому его строка не учитывает проигрыши. Ручные исправления не считаются сыгранными партиями. Снятые результаты остаются в количестве партий, но не в количестве результатов рейтинга.',
    ),
  );
}
function rowActions(table: AdminTable, row: Record<string, AdminCell>): AdminAction[] {
  if (table === 'players') return ['block_player'];
  if (table === 'ranking_blocks') return ['unblock_player'];
  if (table === 'groups' && row.notifications_enabled === 1) return ['disable_notifications'];
  if (table === 'social_jobs' && row.status === 'pending') return ['cancel_job'];
  if (table === 'manual_results') return ['remove_manual'];
  if (row.status === 'verified' || row.status === 'won') {
    const actions: Partial<Record<AdminTable, AdminAction>> = {
      runs: 'revoke_tetris',
      puzzle2048_runs: 'revoke_2048',
      snake_runs: 'revoke_snake',
      flappy_runs: 'revoke_flappy',
      block_blast_runs: 'revoke_block_blast',
      minesweeper_runs: 'revoke_minesweeper',
    };
    const action = actions[table];
    if (action) return [action];
  }
  return [];
}
function cellView(key: string, value: AdminCell): string | HTMLElement {
  if (value === null) return '—';
  if (typeof value === 'number' && value > 0 && /(_at|_seen)$|^day$|^at$/.test(key))
    return `${date(value)} ${new Date(value).toISOString().slice(11, 19)} UTC`;
  const string = String(value);
  if (string.length > 100 || key.endsWith('_json')) {
    const detail = element('details');
    detail.append(
      element('summary', '', key.endsWith('_json') ? 'Показать данные' : `${string.slice(0, 60)}…`),
      element('pre', '', readable(string)),
    );
    return detail;
  }
  return string;
}
export function mountAdmin(host: HTMLElement): () => void {
  let disposed = false;
  let generation = 0;
  let mode: 'stats' | 'data' = 'stats';
  let page = 0;
  let table: AdminTable = 'players';
  let search = '';
  let pending = false;
  let dialog: HTMLDialogElement | undefined;
  host.className = 'admin-page';
  const title = element('h1', '', 'КАБИНЕТ ВЛАДЕЛЬЦА');
  const heading = element('header', 'admin-heading');
  heading.append(element('span', 'eyebrow', 'ARCADE / УПРАВЛЕНИЕ'), title);
  const status = element('p', 'admin-status', 'Проверяем доступ…');
  status.setAttribute('role', 'status');
  const toolbar = element('div', 'admin-toolbar');
  const statsTab = button('Статистика', () => {
    mode = 'stats';
    void load();
  });
  const dataTab = button('Данные', () => {
    mode = 'data';
    void load();
  });
  const auditTab = button('Журнал изменений', () => {
    mode = 'data';
    table = 'admin_audit';
    page = 0;
    search = '';
    void load();
  });
  const refresh = button('Обновить ↻', () => {
    void load();
  });
  toolbar.append(statsTab, dataTab, auditTab, refresh);
  toolbar.hidden = true;
  const controls = element('form', 'admin-filters');
  controls.hidden = true;
  const select = element('select');
  select.setAttribute('aria-label', 'Таблица данных');
  for (const name of ADMIN_TABLES) {
    const option = element('option', '', TABLE_NAMES[name]);
    option.value = name;
    select.append(option);
  }
  select.addEventListener('change', () => {
    table = ADMIN_TABLES.find((t) => t === select.value) ?? 'players';
    page = 0;
    void load();
  });
  const query = element('input');
  query.type = 'search';
  query.maxLength = 100;
  query.placeholder = 'Имя, ID, статус…';
  query.setAttribute('aria-label', 'Поиск по данным');
  const find = element('button', 'button', 'Найти');
  find.type = 'submit';
  controls.append(select, query, find);
  controls.addEventListener('submit', (event) => {
    event.preventDefault();
    search = query.value.trim();
    page = 0;
    void load();
  });
  const body = element('div', 'admin-body');
  host.append(heading, toolbar, controls, status, body);

  async function openAction(action: AdminAction, target: string): Promise<void> {
    if (pending || dialog || disposed) return;
    pending = true;
    status.textContent = 'Подготавливаем изменение…';
    try {
      const preview = await api.adminPreview({ action, target });
      if (disposed) return;
      dialog = element('dialog', 'admin-dialog');
      const currentDialog = dialog;
      const form = element('form');
      const heading = element('h2', '', ACTION_NAMES[action]);
      heading.id = 'admin-dialog-title';
      currentDialog.setAttribute('aria-labelledby', heading.id);
      const description =
        action === 'block_player'
          ? 'Запрет касается новых рейтинговых результатов. Уже сохранённые результаты остаются; снять их можно отдельно. Ожидающие уведомления игрока будут подавлены.'
          : action === 'unblock_player'
            ? 'Новые результаты снова разрешены. Снятые результаты и отменённые уведомления автоматически не восстанавливаются.'
            : action === 'cancel_job'
              ? 'Ожидающая отправка будет отменена. Повторная доставка этой записи не запустится.'
              : action === 'disable_notifications'
                ? 'Уведомления группы будут выключены, ожидающие записи подавлены. Включить их обратно сможет администратор группы.'
                : 'Результат исчезнет из рейтинга. Связанные уведомления в очереди будут подавлены. Уже доставленные сообщения сохранятся.';
      const values = element('div', 'admin-diff');
      const before = element('section');
      const after = element('section');
      before.append(element('h3', '', 'Сейчас'), element('pre', '', readable(preview.before)));
      after.append(element('h3', '', 'Изменение'), element('pre', '', readable(preview.after)));
      values.append(before, after);
      const reasonLabel = element('label', 'admin-field', 'Причина изменения');
      const reason = element('textarea');
      reason.required = true;
      reason.minLength = 3;
      reason.maxLength = 300;
      reason.rows = 3;
      reasonLabel.append(reason);
      const confirmLabel = element('label', 'admin-confirm');
      const confirm = element('input');
      confirm.type = 'checkbox';
      confirm.required = true;
      confirmLabel.append(
        confirm,
        document.createTextNode('Проверил запись и подтверждаю изменение'),
      );
      const message = element('p', 'admin-status');
      message.setAttribute('role', 'status');
      const submit = element('button', 'button primary', 'Применить');
      submit.type = 'submit';
      let saving = false;
      let request: AdminMutation | undefined;
      const close = () => {
        if (!saving) {
          currentDialog.close();
          currentDialog.remove();
          dialog = undefined;
        }
      };
      const cancel = button('Отмена', close);
      currentDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
      });
      const actions = element('div', 'admin-toolbar');
      actions.append(cancel, submit);
      form.append(
        heading,
        element('p', 'admin-note', `Запись: ${target}`),
        element('p', '', description),
        values,
        reasonLabel,
        confirmLabel,
        message,
        actions,
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (saving || !form.reportValidity()) return;
        if (!request && reason.value.trim().length < 3) {
          message.textContent = 'Укажи причину: минимум три символа без пробелов по краям.';
          reason.focus();
          return;
        }
        saving = true;
        submit.disabled = true;
        cancel.disabled = true;
        reason.disabled = true;
        confirm.disabled = true;
        request ??= { ...preview, requestId: crypto.randomUUID(), reason: reason.value.trim() };
        message.textContent = 'Сохраняем изменение…';
        void api
          .adminApply(request)
          .then((result) => {
            saving = false;
            close();
            if (!disposed) {
              void load(`Изменение сохранено. Запись журнала: ${result.id}`);
            }
          })
          .catch((error) => {
            saving = false;
            submit.disabled = false;
            cancel.disabled = false;
            message.textContent = `${errorMessage(error)} Если ответ потерялся, повтори с тем же ключом операции.`;
            submit.textContent = 'Повторить';
          });
      });
      currentDialog.append(form);
      host.append(currentDialog);
      currentDialog.showModal();
      reason.focus();
      status.textContent = '';
    } catch (error) {
      if (!disposed) status.textContent = errorMessage(error);
    } finally {
      pending = false;
    }
  }
  function renderRows(result: AdminPage): void {
    if (!result.rows.length) {
      body.append(
        element(
          'p',
          'empty-state',
          search ? 'Совпадений нет. Попробуй другой запрос.' : 'Здесь пока нет записей.',
        ),
      );
    } else {
      const rows = result.rows.map((row) => {
        const actions = element('div', 'admin-row-actions');
        for (const action of rowActions(result.table, row))
          actions.append(
            button(
              ACTION_NAMES[action],
              () => {
                void openAction(action, String(row.id ?? row.player_id));
              },
              'admin-action',
            ),
          );
        return [...result.columns.map((key) => cellView(key, row[key] ?? null)), actions];
      });
      body.append(makeTable([...result.columns, 'Действия'], rows, TABLE_NAMES[result.table]));
    }
    const paging = element('div', 'admin-paging');
    const previous = button('← Назад', () => {
      page--;
      void load();
    });
    previous.disabled = result.page === 0;
    const next = button('Далее →', () => {
      page++;
      void load();
    });
    next.disabled = !result.hasMore || result.page >= 4000;
    paging.append(
      previous,
      element('span', '', `Страница ${result.page + 1} · до 25 записей`),
      next,
    );
    body.append(paging);
  }
  async function load(notice = ''): Promise<void> {
    const version = ++generation;
    const selectedMode = mode;
    body.replaceChildren();
    body.setAttribute('aria-busy', 'true');
    status.textContent = 'Загружаем…';
    controls.hidden = mode !== 'data';
    select.value = table;
    query.value = search;
    statsTab.setAttribute('aria-pressed', String(mode === 'stats'));
    dataTab.setAttribute('aria-pressed', String(mode === 'data'));
    try {
      const result =
        selectedMode === 'stats'
          ? await api.adminStats()
          : await api.adminRows({ table, page, search });
      if (disposed || version !== generation) return;
      if ('weeks' in result) renderStats(body, result);
      else renderRows(result);
      status.textContent = notice || 'Данные обновлены';
    } catch (error) {
      if (!disposed && version === generation) {
        status.textContent = errorMessage(error);
        body.append(
          button('Повторить загрузку', () => {
            void load();
          }),
        );
      }
    } finally {
      if (!disposed && version === generation) body.removeAttribute('aria-busy');
    }
  }
  void (async () => {
    try {
      if (!hasApi || !(await api.profile()).isAdmin)
        throw new Error('Кабинет доступен только владельцу через Telegram.');
      if (disposed) return;
      toolbar.hidden = false;
      await load();
    } catch (error) {
      if (!disposed) status.textContent = errorMessage(error);
    }
  })();
  return () => {
    disposed = true;
    generation++;
    dialog?.remove();
    host.replaceChildren();
  };
}
