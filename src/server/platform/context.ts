import type { Player } from '../../shared/contracts.ts';
import { AppError, integer, object, text } from '../../shared/errors.ts';
export function verifiedPlayer(context: unknown): Player {
  const data = object(object(context).initData);
  if (!data.user) throw new AppError('UNAUTHORIZED', 'Открой приложение через Telegram');
  const user = object(data.user);
  const first = text(user.first_name, 1, 64);
  const last = user.last_name === undefined ? '' : text(user.last_name, 0, 64);
  return {
    id: integer(user.id, 1, Number.MAX_SAFE_INTEGER),
    name: `${first} ${last}`.trim().slice(0, 100),
  };
}
