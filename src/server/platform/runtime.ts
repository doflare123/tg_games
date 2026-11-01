import { db, EndpointError } from 'sdk';
import type { Player } from '../../shared/contracts.ts';
import { AppError } from '../../shared/errors.ts';
import { Service2048 } from '../domain/2048.ts';
import { ArcadeService } from '../domain/arcade.ts';
import { GameBotService } from '../domain/bot.ts';
import { GroupService } from '../domain/groups.ts';
import { MaintenanceService } from '../domain/maintenance.ts';
import { MinesweeperService } from '../domain/minesweeper.ts';
import { SnakeService } from '../domain/snake.ts';
import { verifiedPlayer } from './context.ts';
import { MINI_APP_URL } from './mini-app-config.ts';
import { Sql2048Repository } from './sql-2048.ts';
import { SqlMineRepository } from './sql-minesweeper.ts';
import { SqlArcadeRepository } from './sql-repository.ts';
import { SqlSnakeRepository } from './sql-snake.ts';
import { SqlSocialRepository } from './sql-social-repository.ts';
import { telegramGateway } from './telegram-gateway.ts';
export const repository = new SqlArcadeRepository(db);
export const snakeRepository = new SqlSnakeRepository(db);
export const snake = new SnakeService(snakeRepository, {
  now: () => Date.now(),
  seed: () => Math.floor(Math.random() * 0x100000000),
});
export const puzzle2048Repository = new Sql2048Repository(db);
export const puzzle2048 = new Service2048(puzzle2048Repository, {
  now: () => Date.now(),
  seed: () => Math.floor(Math.random() * 0x100000000),
});
export const mineRepository = new SqlMineRepository(db);
export const minesweeper = new MinesweeperService(mineRepository, {
  now: () => Date.now(),
});
export const socialRepository = new SqlSocialRepository(db, repository);
export const groups = new GroupService(socialRepository, telegramGateway, () => Date.now());
export const maintenance = new MaintenanceService(
  socialRepository,
  repository,
  groups,
  telegramGateway,
  () => Date.now(),
  mineRepository,
  puzzle2048Repository,
  snakeRepository,
);
export async function flushNotifications(): Promise<void> {
  try {
    await maintenance.sweep(3);
  } catch (error) {
    console.warn('notification_sweep_deferred', error instanceof Error ? error.message : 'unknown');
  }
}
export const gameBot = new GameBotService(
  socialRepository,
  groups,
  telegramGateway,
  () => Date.now(),
  MINI_APP_URL,
);
export const arcade = new ArcadeService(
  repository,
  { now: () => Date.now(), seed: () => Math.floor(Math.random() * 0x100000000) },
  groups,
);
export function endpoint<T>(operation: (player: Player, input: unknown) => Promise<T> | T) {
  return async (input: unknown, context: unknown): Promise<T> => {
    try {
      return await operation(verifiedPlayer(context), input);
    } catch (error) {
      if (error instanceof AppError) throw new EndpointError(error.message, { code: error.code });
      console.error('arcade_endpoint_failed', error instanceof Error ? error.message : 'unknown');
      throw error;
    }
  };
}
