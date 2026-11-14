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
export interface PetPlacement {
  item: string;
  room: PetRoom;
  x: number;
  y: number;
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
  theme: 'peach' | 'mint' | 'lavender';
  wishes: PetWish[];
  completed: string[];
  lastCare: number;
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
  | { type: 'care'; care: 'pet' | 'wash' | 'rest' }
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
  return {
    item: itemId(r.item),
    room: oneOf(r.room, PET_ROOMS),
    x: integer(r.x, 0, 5),
    y: integer(r.y, 0, 2),
  };
}
export function decodePetState(value: unknown): PetState {
  const r = object(value);
  if (r.version !== 1) throw new AppError('BAD_INPUT', 'Неизвестная версия питомца');
  const needs = object(r.needs);
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
    placements: list(r.placements, 30, decodePetPlacement),
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
  ]);
  let action: PetAction;
  switch (type) {
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
      action = { type, ...decodePetPlacement(a) };
      break;
    case 'care':
      action = { type, care: oneOf(a.care, ['pet', 'wash', 'rest']) };
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
function decodeFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('BAD_INPUT', 'Некорректный выбор питомца');
  return value;
}
