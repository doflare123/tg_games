import { EndpointError } from 'sdk';
import { object } from '../../shared/errors.ts';
import { gameBot } from '../platform/runtime.ts';
export default async function configure(_input: unknown, context: unknown) {
  const ctx = object(context);
  if (ctx.maintenance !== true || ctx.initData !== undefined)
    throw new EndpointError('Только служебный CLI-вызов', { code: 'UNAUTHORIZED' });
  await gameBot.configure();
  return { configured: true };
}
