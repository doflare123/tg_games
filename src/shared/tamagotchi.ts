import { AppError, integer, object, oneOf, text } from './errors.ts';

export const PET_GAMES = ['block-blast', 'tetris', '2048', 'snake', 'flappy'] as const;
export type PetGame = (typeof PET_GAMES)[number];
export const PET_DAY = 86_400_000;
export const PET_GAME_INFO: Record<PetGame, { title: string; unit: number }> = {
  'block-blast': { title: 'Block Blast', unit: 500 },
  tetris: { title: 'Тетрис', unit: 3000 },
  '2048': { title: '2048', unit: 3000 },
  snake: { title: 'Змейка', unit: 200 },
  flappy: { title: 'Flappy Bird', unit: 15 },
};
export type PetWallet = Record<PetGame, { sparks: number; attempts: number }>;
export const PET_CARE_KINDS = ['pet', 'wash', 'rest'] as const;
export type PetCare = (typeof PET_CARE_KINDS)[number];
export const PET_CARE_COOLDOWN_MS = 15_000;
export type PetCareTimes = Record<PetCare, number>;
export const PET_SPECIES = ['cat', 'fox', 'rabbit', 'panda', 'dog', 'axolotl'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];
export const PET_SPECIES_INFO: Record<PetSpecies, { title: string; description: string }> = {
  cat: { title: 'Кот', description: 'Мягкие лапки и большие планы на диван' },
  fox: { title: 'Лиса', description: 'Рыжий хвост и любопытный нос' },
  rabbit: { title: 'Кролик', description: 'Длинные уши, короткие пути к сердцу' },
  panda: { title: 'Панда', description: 'Обниматься, перекусить и ещё обниматься' },
  dog: { title: 'Щенок', description: 'Висячие уши и радость каждой встрече' },
  axolotl: { title: 'Аксолотль', description: 'Розовые жабры и вечная улыбка' },
};
export const PET_ROOMS = ['living', 'bedroom', 'garden'] as const;
export type PetRoom = (typeof PET_ROOMS)[number];
export const PET_ROOM_INFO: Record<PetRoom, { title: string; level: number }> = {
  living: { title: 'Гостиная', level: 1 },
  bedroom: { title: 'Спальня', level: 2 },
  garden: { title: 'Сад', level: 4 },
};
export interface PetCost {
  metric: 'sparks' | 'attempts';
  games: PetGame[];
  amount: number;
  distinct: number;
}
export interface PetItem {
  id: string;
  title: string;
  icon: string;
  kind: 'food' | 'furniture';
  level: number;
  cost: PetCost;
  boost: number;
}
const points = (games: PetGame[], amount: number, distinct = 1): PetCost => ({
  metric: 'sparks',
  games,
  amount,
  distinct,
});
const attempts = (games: PetGame[], amount: number, distinct = 1): PetCost => ({
  metric: 'attempts',
  games,
  amount,
  distinct,
});
export const PET_ITEMS: readonly PetItem[] = [
  {
    id: 'banana',
    title: 'Банан',
    icon: '🍌',
    kind: 'food',
    level: 1,
    cost: points(['block-blast'], 10),
    boost: 35,
  },
  {
    id: 'apple',
    title: 'Яблоко',
    icon: '🍎',
    kind: 'food',
    level: 1,
    cost: points(['snake'], 3),
    boost: 25,
  },
  {
    id: 'toast',
    title: 'Тост с джемом',
    icon: '🍞',
    kind: 'food',
    level: 1,
    cost: attempts([...PET_GAMES], 2),
    boost: 25,
  },
  {
    id: 'berries',
    title: 'Ягодный боул',
    icon: '🫐',
    kind: 'food',
    level: 1,
    cost: points(['2048', 'tetris'], 8),
    boost: 40,
  },
  {
    id: 'tea',
    title: 'Тёплый чай',
    icon: '🍵',
    kind: 'food',
    level: 1,
    cost: attempts([...PET_GAMES], 3, 2),
    boost: 30,
  },
  {
    id: 'rug',
    title: 'Облачный ковёр',
    icon: '☁️',
    kind: 'furniture',
    level: 1,
    cost: attempts([...PET_GAMES], 4, 2),
    boost: 10,
  },
  {
    id: 'plant',
    title: 'Монстера',
    icon: '🪴',
    kind: 'furniture',
    level: 1,
    cost: points(['snake', 'flappy', '2048'], 12),
    boost: 12,
  },
  {
    id: 'wardrobe',
    title: 'Шкаф с секретом',
    icon: '🚪',
    kind: 'furniture',
    level: 1,
    cost: points(['block-blast', 'tetris', '2048'], 20, 2),
    boost: 20,
  },
  {
    id: 'lamp',
    title: 'Лунный светильник',
    icon: '💡',
    kind: 'furniture',
    level: 2,
    cost: points(['tetris', 'flappy'], 15),
    boost: 15,
  },
  {
    id: 'bed',
    title: 'Кровать-облако',
    icon: '🛏️',
    kind: 'furniture',
    level: 2,
    cost: points([...PET_GAMES], 30, 3),
    boost: 25,
  },
  {
    id: 'books',
    title: 'Любимые истории',
    icon: '📚',
    kind: 'furniture',
    level: 2,
    cost: attempts([...PET_GAMES], 8, 3),
    boost: 15,
  },
  {
    id: 'sofa',
    title: 'Персиковый диван',
    icon: '🛋️',
    kind: 'furniture',
    level: 3,
    cost: points([...PET_GAMES], 40, 2),
    boost: 25,
  },
  {
    id: 'art',
    title: 'Маленький шедевр',
    icon: '🖼️',
    kind: 'furniture',
    level: 3,
    cost: points(['block-blast', '2048'], 25, 2),
    boost: 20,
  },
  {
    id: 'fountain',
    title: 'Тихий фонтан',
    icon: '⛲',
    kind: 'furniture',
    level: 4,
    cost: points([...PET_GAMES], 60, 3),
    boost: 30,
  },
  {
    id: 'swing',
    title: 'Качели для мечтаний',
    icon: '🪑',
    kind: 'furniture',
    level: 4,
    cost: attempts([...PET_GAMES], 15, 3),
    boost: 30,
  },
];
export function petItem(id: string): PetItem {
  const item = PET_ITEMS.find((item) => item.id === id);
  if (!item) throw new AppError('BAD_INPUT', 'Неизвестный предмет');
  return item;
}
export interface PetWish {
  id: string;
  item: string;
  text: string;
  cost: PetCost;
  xp: number;
}
export const PET_SURFACE_IDS = ['starter-console', 'starter-table', 'wardrobe', 'books'] as const;
export type PetSurfaceId = (typeof PET_SURFACE_IDS)[number];
export type PetSurfaceSlot = 0 | 1;
export const PET_SMALL_ITEMS = ['starter-radio', 'starter-pot', 'starter-books', 'lamp'] as const;
export type PetSmallItem = (typeof PET_SMALL_ITEMS)[number];
export const PET_SURFACE_CAPACITY: Record<PetSurfaceId, 1 | 2> = {
  'starter-console': 2,
  'starter-table': 2,
  wardrobe: 1,
  books: 1,
};
export function isPetSmallItem(item: string): item is PetSmallItem {
  return PET_SMALL_ITEMS.some((id) => id === item);
}
export function isPetSurface(item: string): item is PetSurfaceId {
  return PET_SURFACE_IDS.some((id) => id === item);
}
export function petSurfaceAccepts(item: string, surface: PetSurfaceId): boolean {
  return (
    isPetSmallItem(item) &&
    (item !== 'starter-radio' || surface === 'starter-console' || surface === 'starter-table')
  );
}
export interface PetPlacement {
  item: string;
  room: PetRoom;
  x: number;
  y: number;
  on?: PetSurfaceId;
  slot?: PetSurfaceSlot;
}
export const PET_STARTER_IDS = [
  'starter-rug',
  'starter-chair',
  'starter-table',
  'starter-console',
  'starter-radio',
  'starter-pot',
  'starter-books',
  'starter-plant',
] as const;
export type PetStarterId = (typeof PET_STARTER_IDS)[number];
export const PET_STARTER_INFO: Record<
  PetStarterId,
  { id: PetStarterId; title: string; icon: string }
> = {
  'starter-rug': { id: 'starter-rug', title: 'Домашний ковёр', icon: '' },
  'starter-chair': { id: 'starter-chair', title: 'Красное кресло', icon: '' },
  'starter-table': { id: 'starter-table', title: 'Журнальный столик', icon: '' },
  'starter-console': { id: 'starter-console', title: 'Деревянная тумба', icon: '' },
  'starter-radio': { id: 'starter-radio', title: 'Радио', icon: '' },
  'starter-pot': { id: 'starter-pot', title: 'Маленький горшок', icon: '' },
  'starter-books': { id: 'starter-books', title: 'Стопка книг', icon: '' },
  'starter-plant': { id: 'starter-plant', title: 'Домашнее растение', icon: '' },
};
export function isPetStarter(id: string): id is PetStarterId {
  return PET_STARTER_IDS.some((item) => item === id);
}
export interface PetStarterPlacement extends PetPlacement {
  item: PetStarterId;
}
export function defaultPetStarters(
  placements: readonly PetPlacement[] = [],
): PetStarterPlacement[] {
  const result: PetStarterPlacement[] = [];
  const defaults = [
    ['starter-rug', 4, 0],
    ['starter-chair', 1, 0],
    ['starter-table', 2, 0],
    ['starter-console', 4, 2],
    ['starter-books', 5, 0],
    ['starter-plant', 0, 1],
  ] as const;
  for (const [item, x, y] of defaults) {
    const cells: { x: number; y: number }[] = [{ x, y }];
    for (let row = 2; row >= 0; row--)
      for (let column = 0; column < 6; column++) cells.push({ x: column, y: row });
    const cell = cells.find(
      (cell) =>
        ![...placements, ...result].some(
          (p) => p.room === 'living' && p.x === cell.x && p.y === cell.y,
        ),
    );
    if (cell) result.push({ item, room: 'living', ...cell });
  }
  const console = result.find((p) => p.item === 'starter-console');
  if (console)
    for (const item of ['starter-radio', 'starter-pot'] as const)
      result.push({
        ...console,
        item,
        on: 'starter-console',
        slot: item === 'starter-radio' ? 0 : 1,
      });
  return result;
}
export function petCellOccupied(
  state: Pick<PetState, 'placements' | 'starterPlacements'>,
  room: PetRoom,
  x: number,
  y: number,
  except: string,
): boolean {
  return [...state.placements, ...state.starterPlacements]
    .filter((p) => !p.on)
    .some((p) => p.item !== except && p.room === room && p.x === x && p.y === y);
}
export function petSurfaceTargets(
  state: Pick<PetState, 'placements' | 'starterPlacements'>,
  item: string,
  room: PetRoom,
): { parent: PetPlacement & { item: PetSurfaceId }; slot: PetSurfaceSlot; occupied: boolean }[] {
  const all = [...state.placements, ...state.starterPlacements];
  return all.flatMap((parent) => {
    if (
      !isPetSurface(parent.item) ||
      parent.room !== room ||
      parent.on ||
      !petSurfaceAccepts(item, parent.item)
    )
      return [];
    const surface = { ...parent, item: parent.item };
    return ([0, 1] as const)
      .filter((slot) => slot < PET_SURFACE_CAPACITY[surface.item])
      .map((slot) => ({
        parent: surface,
        slot,
        occupied: all.some((p) => p.item !== item && p.on === surface.item && p.slot === slot),
      }));
  });
}
export interface PetState {
  version: 1;
  species: PetSpecies;
  speciesChosen: boolean;
  name: string;
  bornAt: number;
  updatedAt: number;
  day: number;
  xp: number;
  streak: number;
  lastCompletedDay: number;
  needs: { food: number; joy: number; energy: number; clean: number };
  spent: PetWallet;
  owned: string[];
  placements: PetPlacement[];
  starterPlacements: PetStarterPlacement[];
  theme: 'peach' | 'mint' | 'lavender';
  wishes: PetWish[];
  completed: string[];
  lastCare: number;
  careAt: PetCareTimes;
}
export interface PetView {
  revision: number;
  state: PetState;
  wallet: PetWallet;
  serverNow: number;
  refreshAt: number;
}
export type PetWalletEntry = { game: PetGame; sparks: number; attempts: number };
export interface PetWireView extends Omit<PetView, 'state' | 'wallet'> {
  state: Omit<PetState, 'spent'> & { spent: PetWalletEntry[] };
  wallet: PetWalletEntry[];
}
// Telegram's runtime bridge rejects numeric object keys, including the game ID "2048".
// Keep maps inside the domain/storage and send entries across the endpoint boundary.
export function encodePetView(view: PetView): PetWireView {
  const entries = (wallet: PetWallet): PetWalletEntry[] =>
    PET_GAMES.map((game) => ({ game, ...wallet[game] }));
  return {
    ...view,
    state: { ...view.state, spent: entries(view.state.spent) },
    wallet: entries(view.wallet),
  };
}
export type PetAction =
  | { type: 'species'; species: PetSpecies }
  | { type: 'claim'; wishId: string }
  | { type: 'buy'; item: string }
  | { type: 'place'; item: string; room: PetRoom; x: number; y: number }
  | { type: 'store'; item: string }
  | { type: 'place-starter'; item: PetStarterId; room: PetRoom; x: number; y: number }
  | { type: 'store-starter'; item: PetStarterId }
  | { type: 'attach-starter'; item: 'starter-radio' | 'starter-pot' }
  | { type: 'place-on-surface'; item: PetSmallItem; surface: PetSurfaceId; slot: PetSurfaceSlot }
  | { type: 'care'; care: PetCare }
  | { type: 'rename'; name: string }
  | { type: 'theme'; theme: PetState['theme'] };
export interface PetMutation {
  requestId: string;
  revision: number;
  action: PetAction;
}
export function emptyPetWallet(): PetWallet {
  return {
    'block-blast': { sparks: 0, attempts: 0 },
    tetris: { sparks: 0, attempts: 0 },
    '2048': { sparks: 0, attempts: 0 },
    snake: { sparks: 0, attempts: 0 },
    flappy: { sparks: 0, attempts: 0 },
  };
}
export const petLevel = (xp: number): number => Math.min(20, 1 + Math.floor(xp / 180));
// Days turn over at 04:00 in UTC+2, giving late-night sessions one continuous day.
export const petDay = (now: number): number => Math.floor((now - 2 * 3_600_000) / PET_DAY);
export const petRefreshAt = (day: number): number => (day + 1) * PET_DAY + 2 * 3_600_000;

function list<T>(value: unknown, limit: number, decode: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new AppError('BAD_INPUT', 'Некорректный список');
  return value.map(decode);
}
function counter(value: unknown): number {
  return integer(value, 0, Number.MAX_SAFE_INTEGER);
}
export function decodePetWallet(value: unknown): PetWallet {
  if (Array.isArray(value)) {
    if (value.length !== PET_GAMES.length)
      throw new AppError('BAD_INPUT', 'Неполный кошелёк питомца');
    const result = emptyPetWallet();
    const seen = new Set<PetGame>();
    for (const entry of value) {
      const r = object(entry);
      const game = oneOf(r.game, PET_GAMES);
      if (seen.has(game)) throw new AppError('BAD_INPUT', 'Повтор игры в кошельке');
      seen.add(game);
      result[game] = { sparks: counter(r.sparks), attempts: counter(r.attempts) };
    }
    return result;
  }
  const r = object(value);
  const result = emptyPetWallet();
  for (const game of PET_GAMES) {
    const entry = object(r[game]);
    result[game] = { sparks: counter(entry.sparks), attempts: counter(entry.attempts) };
  }
  return result;
}
function decodeCost(value: unknown): PetCost {
  const r = object(value);
  const games = list(r.games, 5, (v) => oneOf(v, PET_GAMES));
  if (games.length === 0 || new Set(games).size !== games.length)
    throw new AppError('BAD_INPUT', 'Некорректный пул игр');
  const amount = integer(r.amount, 1, 1000);
  return {
    games,
    metric: oneOf(r.metric, ['sparks', 'attempts']),
    amount,
    distinct: integer(r.distinct, 1, Math.min(games.length, amount)),
  };
}
function itemId(value: unknown): string {
  return petItem(text(value, 1, 40)).id;
}
export function decodePetPlacement(value: unknown): PetPlacement {
  const r = object(value);
  const placement: PetPlacement = {
    item: itemId(r.item),
    room: oneOf(r.room, PET_ROOMS),
    x: integer(r.x, 0, 5),
    y: integer(r.y, 0, 2),
  };
  decodeSurface(placement, r);
  return placement;
}
export function decodePetState(value: unknown): PetState {
  const r = object(value);
  if (r.version !== 1) throw new AppError('BAD_INPUT', 'Неизвестная версия питомца');
  const needs = object(r.needs);
  const placements = list(r.placements, 30, decodePetPlacement);
  const starterPlacements =
    r.starterPlacements === undefined
      ? defaultPetStarters(placements)
      : list(r.starterPlacements, PET_STARTER_IDS.length, decodePetStarterPlacement);
  if (new Set(starterPlacements.map((p) => p.item)).size !== starterPlacements.length)
    throw new AppError('BAD_INPUT', 'Повтор стартового предмета');
  const allPlacements = [...placements, ...starterPlacements];
  const occupiedSurfaces = new Set<string>();
  for (const placement of allPlacements) {
    if (!placement.on) continue;
    if (
      !allPlacements.some(
        (p) =>
          p.item === placement.on &&
          !p.on &&
          p.room === placement.room &&
          p.x === placement.x &&
          p.y === placement.y,
      )
    )
      throw new AppError('BAD_INPUT', 'Для предмета нужна подходящая поверхность');
    const key = `${placement.on}:${placement.slot}`;
    if (occupiedSurfaces.has(key)) throw new AppError('BAD_INPUT', 'Место на поверхности занято');
    occupiedSurfaces.add(key);
  }
  return {
    version: 1,
    species: r.species === undefined ? 'cat' : oneOf(r.species, PET_SPECIES),
    speciesChosen: r.speciesChosen === undefined ? false : decodeFlag(r.speciesChosen),
    name: text(r.name, 1, 24),
    bornAt: counter(r.bornAt),
    updatedAt: counter(r.updatedAt),
    day: counter(r.day),
    xp: counter(r.xp),
    streak: counter(r.streak),
    lastCompletedDay: integer(r.lastCompletedDay, -1, Number.MAX_SAFE_INTEGER),
    needs: {
      food: integer(needs.food, 0, 100),
      joy: integer(needs.joy, 0, 100),
      energy: integer(needs.energy, 0, 100),
      clean: integer(needs.clean, 0, 100),
    },
    spent: decodePetWallet(r.spent),
    owned: list(r.owned, 30, itemId),
    placements,
    starterPlacements,
    theme: oneOf(r.theme, ['peach', 'mint', 'lavender']),
    wishes: list(r.wishes, 3, (value) => {
      const w = object(value);
      return {
        id: text(w.id, 1, 80),
        item: itemId(w.item),
        text: text(w.text, 1, 300),
        cost: decodeCost(w.cost),
        xp: integer(w.xp, 1, 180),
      };
    }),
    completed: list(r.completed, 3, (value) => text(value, 1, 80)),
    lastCare: counter(r.lastCare),
    careAt: r.careAt === undefined ? { pet: 0, wash: 0, rest: 0 } : decodeCareTimes(r.careAt),
  };
}
export function decodePetView(value: unknown): PetView {
  const r = object(value);
  return {
    revision: counter(r.revision),
    state: decodePetState(r.state),
    wallet: decodePetWallet(r.wallet),
    serverNow: counter(r.serverNow),
    refreshAt: counter(r.refreshAt),
  };
}
export function decodePetMutation(value: unknown): PetMutation {
  const r = object(value);
  const requestId = text(r.requestId, 16, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId))
    throw new AppError('BAD_INPUT', 'Некорректный ключ запроса');
  const a = object(r.action);
  const type = oneOf(a.type, [
    'claim',
    'buy',
    'place',
    'store',
    'care',
    'rename',
    'theme',
    'species',
    'place-starter',
    'store-starter',
    'attach-starter',
    'place-on-surface',
  ]);
  let action: PetAction;
  switch (type) {
    case 'place-on-surface':
      action = {
        type,
        item: oneOf(a.item, PET_SMALL_ITEMS),
        surface: oneOf(a.surface, PET_SURFACE_IDS),
        slot: integer(a.slot, 0, 1) as PetSurfaceSlot,
      };
      break;
    case 'place-starter':
      action = {
        type,
        item: oneOf(a.item, PET_STARTER_IDS),
        room: oneOf(a.room, PET_ROOMS),
        x: integer(a.x, 0, 5),
        y: integer(a.y, 0, 2),
      };
      break;
    case 'store-starter':
      action = { type, item: oneOf(a.item, PET_STARTER_IDS) };
      break;
    case 'attach-starter':
      action = { type, item: oneOf(a.item, ['starter-radio', 'starter-pot']) };
      break;
    case 'species':
      action = { type, species: oneOf(a.species, PET_SPECIES) };
      break;
    case 'claim':
      action = { type, wishId: text(a.wishId, 1, 80) };
      break;
    case 'buy':
    case 'store':
      action = { type, item: itemId(a.item) };
      break;
    case 'place':
      // Floor placement never accepts a client-supplied attachment.
      action = {
        type,
        item: itemId(a.item),
        room: oneOf(a.room, PET_ROOMS),
        x: integer(a.x, 0, 5),
        y: integer(a.y, 0, 2),
      };
      break;
    case 'care':
      action = { type, care: oneOf(a.care, PET_CARE_KINDS) };
      break;
    case 'rename': {
      const name = text(a.name, 1, 48).trim();
      if (!name || name.length > 24 || /[\p{Cc}\p{Cf}]/u.test(name))
        throw new AppError('BAD_INPUT', 'Имя: от 1 до 24 видимых символов');
      action = { type, name };
      break;
    }
    case 'theme':
      action = { type, theme: oneOf(a.theme, ['peach', 'mint', 'lavender']) };
      break;
  }
  return { requestId, revision: counter(r.revision), action };
}
function decodePetStarterPlacement(value: unknown): PetStarterPlacement {
  const r = object(value);
  const item = oneOf(r.item, PET_STARTER_IDS);
  const placement: PetStarterPlacement = {
    item,
    room: oneOf(r.room, PET_ROOMS),
    x: integer(r.x, 0, 5),
    y: integer(r.y, 0, 2),
  };
  decodeSurface(placement, r);
  return placement;
}
function decodeSurface(placement: PetPlacement, r: Record<string, unknown>): void {
  if (r.on === undefined) {
    if (r.slot !== undefined) throw new AppError('BAD_INPUT', 'Место требует поверхность');
    return;
  }
  const surface = oneOf(r.on, PET_SURFACE_IDS);
  if (!petSurfaceAccepts(placement.item, surface))
    throw new AppError('BAD_INPUT', 'Предмет не помещается на этой поверхности');
  // Older saves attached these two starter props to the console without slots.
  const legacySlot =
    surface === 'starter-console' && placement.item === 'starter-radio'
      ? 0
      : surface === 'starter-console' && placement.item === 'starter-pot'
        ? 1
        : undefined;
  const slot = integer(
    r.slot === undefined ? legacySlot : r.slot,
    0,
    PET_SURFACE_CAPACITY[surface] - 1,
  ) as PetSurfaceSlot;
  placement.on = surface;
  placement.slot = slot;
}
function decodeFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('BAD_INPUT', 'Некорректный выбор питомца');
  return value;
}
function decodeCareTimes(value: unknown): PetCareTimes {
  const r = object(value);
  return { pet: counter(r.pet), wash: counter(r.wash), rest: counter(r.rest) };
}
