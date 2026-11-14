import { applyPetAction, newPet, petBalance, refreshPet } from '../../games/tamagotchi/engine.ts';
import type { BlockBoard } from '../../shared/block-blast.ts';
import type { Period, Player } from '../../shared/contracts.ts';
import { AppError, object, oneOf } from '../../shared/errors.ts';
import {
  decodePetMutation,
  type PetState,
  type PetView,
  type PetWallet,
  petDay,
  petRefreshAt,
} from '../../shared/tamagotchi.ts';
import type { BlockBoardScope } from './block-blast.ts';
import type { GroupService } from './groups.ts';
import { leaderboardScope } from './leaderboard-scope.ts';

export interface StoredPet {
  id: string;
  playerId: number;
  playerName: string;
  revision: number;
  requestId: string;
  receipt: string;
  state: PetState;
  createdAt: number;
  order: number;
  socialProcessed: boolean;
}
export interface PetRepository {
  get(playerId: number): Promise<StoredPet | null>;
  request(playerId: number, requestId: string): Promise<StoredPet | null>;
  append(event: StoredPet, previous: number): Promise<boolean>;
  earned(playerId: number, since: number, until: number): Promise<PetWallet>;
  leaderboard(
    player: Player,
    period: Period,
    since: number,
    scope?: BlockBoardScope,
  ): Promise<BlockBoard>;
  pendingResults(limit: number): Promise<StoredPet[]>;
  processed(id: string): Promise<void>;
}
export class TamagotchiService {
  constructor(
    private readonly repository: PetRepository,
    private readonly now: () => number,
    private readonly groups?: GroupService,
  ) {}
  private async current(player: Player): Promise<StoredPet> {
    let current = await this.repository.get(player.id);
    if (!current) {
      const now = this.now();
      await this.repository.append(
        {
          id: `${player.id}:pet:0`,
          playerId: player.id,
          playerName: player.name,
          revision: 0,
          requestId: 'adopt',
          receipt: '',
          state: newPet(player.id, now),
          createdAt: now,
          order: 0,
          socialProcessed: true,
        },
        -1,
      );
      current = await this.repository.get(player.id);
    }
    if (!current) throw new Error('Pet creation failed');
    if (current.state.day !== petDay(this.now())) {
      const now = this.now();
      const earned = await this.repository.earned(player.id, current.state.bornAt, now);
      const state = refreshPet(current.state, player.id, earned, now);
      state.updatedAt = now;
      await this.repository.append(
        {
          ...current,
          id: `${player.id}:pet:${current.revision + 1}`,
          revision: current.revision + 1,
          requestId: `day:${state.day}`,
          receipt: '',
          state,
          createdAt: now,
          socialProcessed: true,
        },
        current.revision,
      );
      const refreshed = await this.repository.get(player.id);
      if (refreshed) current = refreshed;
    }
    return current;
  }
  private view(event: StoredPet, earned: PetWallet, now: number): PetView {
    return {
      revision: event.revision,
      state: refreshPet(event.state, event.playerId, earned, now),
      wallet: petBalance(earned, event.state.spent),
      serverNow: now,
      refreshAt: petRefreshAt(petDay(now)),
    };
  }
  async get(player: Player): Promise<PetView> {
    const event = await this.current(player);
    const now = this.now();
    return this.view(event, await this.repository.earned(player.id, event.state.bornAt, now), now);
  }
  async act(player: Player, input: unknown): Promise<PetView> {
    const mutation = decodePetMutation(input);
    const receipt = JSON.stringify(mutation);
    const replay = async (event: StoredPet): Promise<PetView> => {
      if (event.receipt !== receipt) throw new AppError('CONFLICT', 'Ключ запроса уже использован');
      // Return the latest state, so retrying an old request cannot rewind the UI.
      return this.get(player);
    };
    const existing = await this.repository.request(player.id, mutation.requestId);
    if (existing) return replay(existing);
    const event = await this.current(player);
    if (event.revision !== mutation.revision)
      throw new AppError('CONFLICT', 'Дом уже обновился. Обнови страницу питомца');
    const now = this.now();
    const earned = await this.repository.earned(player.id, event.state.bornAt, now);
    const state = applyPetAction(
      refreshPet(event.state, player.id, earned, now),
      mutation.action,
      earned,
      now,
    );
    const revision = event.revision + 1;
    const next: StoredPet = {
      id: `${player.id}:pet:${revision}`,
      playerId: player.id,
      playerName: player.name,
      revision,
      requestId: mutation.requestId,
      receipt,
      state,
      createdAt: now,
      order: 0,
      socialProcessed: true,
    };
    if (!(await this.repository.append(next, event.revision))) {
      const retry = await this.repository.request(player.id, mutation.requestId);
      if (retry) return replay(retry);
      throw new AppError('CONFLICT', 'Другой запрос уже изменил дом. Обнови питомца');
    }
    return this.view(next, earned, now);
  }
  async leaderboard(player: Player, input: unknown): Promise<BlockBoard> {
    const data = object(input);
    const period = oneOf(data.period, ['all', 'week']);
    const { scope, state } = await leaderboardScope(player, data.groupId, this.groups);
    const date = new Date(this.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return {
      ...(await this.repository.leaderboard(
        player,
        period,
        period === 'all' ? 0 : date.getTime(),
        scope,
      )),
      ...state,
    };
  }
}
