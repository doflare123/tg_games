import { AppError } from '../../shared/errors.ts';
import {
  decodePetState,
  emptyPetWallet,
  PET_GAMES,
  PET_ITEMS,
  PET_ROOM_INFO,
  type PetAction,
  type PetCost,
  type PetGame,
  type PetState,
  type PetWallet,
  type PetWish,
  petDay,
  petItem,
  petLevel,
} from '../../shared/tamagotchi.ts';

export function petBalance(earned: PetWallet, spent: PetWallet): PetWallet {
  const wallet = emptyPetWallet();
  for (const game of PET_GAMES) {
    wallet[game].sparks = Math.max(0, earned[game].sparks - spent[game].sparks);
    wallet[game].attempts = Math.max(0, earned[game].attempts - spent[game].attempts);
  }
  return wallet;
}
export function petCostProgress(cost: PetCost, wallet: PetWallet) {
  const total = cost.games.reduce((sum, game) => sum + wallet[game][cost.metric], 0);
  const distinct = cost.games.filter((game) => wallet[game][cost.metric] > 0).length;
  return {
    total: Math.min(total, cost.amount),
    distinct,
    ready: total >= cost.amount && distinct >= cost.distinct,
  };
}
function spend(state: PetState, earned: PetWallet, cost: PetCost): void {
  const wallet = petBalance(earned, state.spent);
  if (!petCostProgress(cost, wallet).ready)
    throw new AppError('CONFLICT', 'Пока не хватает прогресса по заданию');
  let remaining = cost.amount;
  // Reserve one unit from each required game first, then drain the largest balance.
  const games = cost.games
    .filter((game) => wallet[game][cost.metric] > 0)
    .sort((a, b) => wallet[b][cost.metric] - wallet[a][cost.metric]);
  for (const game of games.slice(0, cost.distinct)) {
    state.spent[game][cost.metric]++;
    wallet[game][cost.metric]--;
    remaining--;
  }
  for (const game of games) {
    const used = Math.min(remaining, wallet[game][cost.metric]);
    state.spent[game][cost.metric] += used;
    remaining -= used;
  }
}
export function petPersonality(playerId: number): { title: string; favorite: PetGame } {
  const personalities = [
    'Любопытный мечтатель',
    'Уютный домосед',
    'Маленький авантюрист',
    'Нежный гурман',
  ];
  return {
    title: personalities[playerId % personalities.length] ?? 'Мечтатель',
    favorite: PET_GAMES[playerId % PET_GAMES.length] ?? 'block-blast',
  };
}
function wishes(state: PetState, playerId: number, earned: PetWallet): PetWish[] {
  const seed = ((playerId % 1_000_003) * 31 + state.day * 17) >>> 0;
  const foods = PET_ITEMS.filter((item) => item.kind === 'food' && item.id !== 'tea');
  const food = foods[seed % foods.length] ?? petItem('toast');
  const furniture = PET_ITEMS.filter(
    (item) =>
      item.kind === 'furniture' &&
      item.level <= petLevel(state.xp) &&
      !state.owned.includes(item.id),
  );
  const furnishing = furniture[(seed >>> 3) % Math.max(1, furniture.length)] ?? petItem('tea');
  const favorite = petPersonality(playerId).favorite;
  const other =
    PET_GAMES[(PET_GAMES.indexOf(favorite) + 1 + (seed % 4)) % PET_GAMES.length] ?? 'tetris';
  // New players get accessible goals. Established players grow towards the catalog price.
  const adapt = (cost: PetCost): PetCost => {
    const income = cost.games.reduce((sum, game) => sum + earned[game][cost.metric], 0);
    const amount =
      cost.metric === 'attempts'
        ? Math.min(4, cost.amount)
        : Math.min(cost.amount, Math.max(3, Math.floor(income / 8)));
    return { ...cost, games: [...cost.games], amount: Math.max(cost.distinct, amount) };
  };
  return [
    {
      id: `${state.day}:food`,
      item: food.id,
      text: `Мне снится ${food.title.toLowerCase()}… Устроим маленький пикник?`,
      cost: adapt(food.cost),
      xp: 45,
    },
    {
      id: `${state.day}:home`,
      item: furnishing.id,
      text:
        furnishing.kind === 'furniture'
          ? `Вот бы у нас появился ${furnishing.title.toLowerCase()}. С ним дома будет уютнее!`
          : 'Давай заварим чай и просто побудем вместе?',
      cost: adapt(furnishing.cost),
      xp: 75,
    },
    {
      id: `${state.day}:adventure`,
      item: 'tea',
      text: 'Хочу приключение в двух разных играх! Даже неудачные попытки — наши истории.',
      cost: { metric: 'attempts', games: [favorite, other], amount: 3, distinct: 2 },
      xp: 60,
    },
  ];
}
export function newPet(playerId: number, now: number): PetState {
  const state: PetState = {
    version: 1,
    species: 'cat',
    speciesChosen: false,
    name: ['Моти', 'Плюш', 'Юки', 'Боба'][playerId % 4] ?? 'Моти',
    bornAt: now,
    updatedAt: now,
    day: petDay(now),
    xp: 0,
    streak: 0,
    lastCompletedDay: -1,
    needs: { food: 75, joy: 80, energy: 85, clean: 90 },
    spent: emptyPetWallet(),
    owned: [],
    placements: [],
    theme: 'peach',
    wishes: [],
    completed: [],
    lastCare: 0,
  };
  state.wishes = wishes(state, playerId, emptyPetWallet());
  return state;
}
export function refreshPet(
  state: PetState,
  playerId: number,
  earned: PetWallet,
  now: number,
): PetState {
  const next = decodePetState(state);
  const hours = Math.max(0, now - state.updatedAt) / 3_600_000;
  // Needs stop at 20: returning after a break is always recoverable.
  for (const [key, rate] of [
    ['food', 3],
    ['joy', 2],
    ['energy', 1.5],
    ['clean', 1],
  ] as const)
    next.needs[key] = Math.max(20, state.needs[key] - Math.floor(hours * rate));
  if (petDay(now) !== state.day) {
    next.day = petDay(now);
    next.completed = [];
    next.wishes = wishes(next, playerId, earned);
  }
  return next;
}
export function applyPetAction(
  state: PetState,
  action: PetAction,
  earned: PetWallet,
  now: number,
): PetState {
  const next = decodePetState(state);
  const boost = (key: keyof PetState['needs'], amount: number) => {
    next.needs[key] = Math.min(100, next.needs[key] + amount);
  };
  const receive = (id: string) => {
    const item = petItem(id);
    if (item.kind === 'food') {
      boost('food', item.boost);
      boost('joy', 8);
    } else if (!next.owned.includes(id)) {
      next.owned.push(id);
      boost('joy', item.boost);
    }
  };
  switch (action.type) {
    case 'species':
      if (next.speciesChosen)
        throw new AppError('CONFLICT', 'Питомец уже выбран. Сменить его нельзя');
      next.species = action.species;
      next.speciesChosen = true;
      break;
    case 'claim': {
      const wish = next.wishes.find((wish) => wish.id === action.wishId);
      if (!wish || next.completed.includes(wish.id))
        throw new AppError('CONFLICT', 'Желание уже исполнено или сменилось');
      if (!(petItem(wish.item).kind === 'furniture' && next.owned.includes(wish.item)))
        spend(next, earned, wish.cost);
      receive(wish.item);
      next.completed.push(wish.id);
      next.xp += wish.xp;
      boost('joy', 15);
      if (next.completed.length === 3) {
        next.streak = next.lastCompletedDay === next.day - 1 ? next.streak + 1 : 1;
        next.lastCompletedDay = next.day;
      }
      break;
    }
    case 'buy': {
      const item = petItem(action.item);
      if (item.level > petLevel(next.xp))
        throw new AppError('CONFLICT', 'Подружитесь ещё немного, чтобы открыть предмет');
      if (item.kind === 'furniture' && next.owned.includes(item.id))
        throw new AppError('CONFLICT', 'Этот предмет уже есть дома');
      spend(next, earned, item.cost);
      receive(item.id);
      break;
    }
    case 'place': {
      if (!next.owned.includes(action.item) || petItem(action.item).kind !== 'furniture')
        throw new AppError('BAD_INPUT', 'Сначала получи этот предмет');
      if (PET_ROOM_INFO[action.room].level > petLevel(next.xp))
        throw new AppError('CONFLICT', 'Комната пока закрыта');
      if (
        next.placements.some(
          (p) =>
            p.item !== action.item &&
            p.room === action.room &&
            p.x === action.x &&
            p.y === action.y,
        )
      )
        throw new AppError('CONFLICT', 'Это место уже занято');
      next.placements = [
        ...next.placements.filter((p) => p.item !== action.item),
        { item: action.item, room: action.room, x: action.x, y: action.y },
      ];
      break;
    }
    case 'store':
      next.placements = next.placements.filter((p) => p.item !== action.item);
      break;
    case 'care': {
      if (now - next.lastCare < 15_000)
        throw new AppError(
          'RATE_LIMIT',
          'Побудь со мной чуть-чуть. Следующая забота через 15 секунд',
        );
      next.lastCare = now;
      if (action.care === 'pet') boost('joy', 12);
      if (action.care === 'wash') boost('clean', 25);
      if (action.care === 'rest') boost('energy', 25);
      break;
    }
    case 'rename':
      next.name = action.name;
      break;
    case 'theme':
      next.theme = action.theme;
      break;
  }
  next.updatedAt = now;
  return next;
}
