import { RULESET_2048, type Ruleset2048 } from '../../games/2048/engine.ts';
import type { TetrisMode } from '../../games/tetris/types.ts';
import { decodeBoard2048, decodeRun2048 } from '../../shared/2048.ts';
import type { EndpointInput, EndpointName, Player, ReplayInput } from '../../shared/contracts.ts';
import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';
import { decodeGroup } from '../../shared/groups.ts';
import { decodeMineLeaderboard, decodeMineResult } from '../../shared/minesweeper.ts';
import { decodeSnakeBoard, decodeSnakeRun } from '../../shared/snake.ts';
import { decodeLeaderboard, decodeRun } from '../../shared/validation.ts';
import { inTelegram, telegram } from './telegram.ts';
export const hasApi = inTelegram || import.meta.env.DEV;
async function call<K extends EndpointName>(name: K, input: EndpointInput<K>): Promise<unknown> {
  if (inTelegram) {
    const serverless = telegram?.Serverless;
    if (!serverless) throw new AppError('UNAVAILABLE', 'Обнови Telegram для рейтинговой игры');
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new AppError('UNAVAILABLE', 'Нет ответа. Запись сохранена до повтора.')),
        15000,
      );
      serverless.call(name, input, (error, result) => {
        clearTimeout(timer);
        if (error) {
          const code = error.parameters?.code;
          let parsed:
            | 'BAD_INPUT'
            | 'UNAUTHORIZED'
            | 'NOT_FOUND'
            | 'CONFLICT'
            | 'EXPIRED'
            | 'RATE_LIMIT'
            | 'UNAVAILABLE' = 'UNAVAILABLE';
          try {
            parsed = oneOf(code, [
              'BAD_INPUT',
              'UNAUTHORIZED',
              'NOT_FOUND',
              'CONFLICT',
              'EXPIRED',
              'RATE_LIMIT',
              'UNAVAILABLE',
            ]);
          } catch {
            /* platform failure */
          }
          reject(new AppError(parsed, error.message));
        } else resolve(result);
      });
    });
  }
  if (import.meta.env.DEV) {
    const response = await fetch(`/__dev/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
    });
    const result = object(await response.json());
    if (!result.ok) throw new AppError('UNAVAILABLE', text(result.error));
    return result.result;
  }
  throw new AppError('UNAUTHORIZED', 'Рейтинговая игра доступна внутри Telegram');
}
export const api = {
  async createSnake(requestId: string, size: number) {
    return decodeSnakeRun(await call('createSnakeRun', { requestId, size }));
  },
  async getSnake(runId: string) {
    return decodeSnakeRun(await call('getSnakeRun', { runId }));
  },
  async submitSnake(input: EndpointInput<'submitSnakeReplay'>) {
    return decodeSnakeRun(await call('submitSnakeReplay', input));
  },
  async snakeLeaderboard(size: number, period: 'all' | 'week') {
    return decodeSnakeBoard(await call('getSnakeLeaderboard', { size, period }));
  },
  async create2048(requestId: string) {
    return decodeRun2048(await call('create2048Run', { requestId, ruleset: RULESET_2048 }));
  },
  async get2048(runId: string) {
    return decodeRun2048(await call('get2048Run', { runId }));
  },
  async submit2048(input: EndpointInput<'submit2048Moves'>) {
    return decodeRun2048(await call('submit2048Moves', input));
  },
  async leaderboard2048(period: 'all' | 'week', ruleset: Ruleset2048 = RULESET_2048) {
    return decodeBoard2048(await call('get2048Leaderboard', { period, ruleset }));
  },
  async submitMine(input: EndpointInput<'submitMineResult'>) {
    return decodeMineResult(await call('submitMineResult', input));
  },
  async mineLeaderboard(input: EndpointInput<'getMineLeaderboard'>) {
    return decodeMineLeaderboard(await call('getMineLeaderboard', input));
  },
  async profile(): Promise<Player> {
    const p = object(await call('getProfile', {}));
    return { id: integer(p.id, 1, Number.MAX_SAFE_INTEGER), name: text(p.name, 1, 100) };
  },
  async create(mode: TetrisMode, requestId: string) {
    return decodeRun(await call('createRun', { mode, requestId }));
  },
  async submit(input: ReplayInput) {
    return decodeRun(await call('submitReplay', input));
  },
  async get(runId: string) {
    return decodeRun(await call('getRun', { runId }));
  },
  async abandon(runId: string) {
    return decodeRun(await call('abandonRun', { runId }));
  },
  async groups() {
    const result = await call('getGroups', {});
    if (!Array.isArray(result) || result.length > 50) throw new Error('Invalid group list');
    return result.map(decodeGroup);
  },
  async notifications(groupId: number, enabled: boolean) {
    return decodeGroup(await call('setGroupNotifications', { groupId, enabled }));
  },
  async leaderboard(mode: TetrisMode, period: 'all' | 'week', groupId?: number) {
    return decodeLeaderboard(
      await call('getLeaderboard', { mode, period, ...(groupId === undefined ? {} : { groupId }) }),
    );
  },
};
