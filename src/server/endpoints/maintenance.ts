import { EndpointError } from 'sdk';
import { object } from '../../shared/errors.ts';
import { maintenance } from '../platform/runtime.ts';
export default async function execute(_input: unknown, context: unknown) {
  const ctx = object(context);
  if (ctx.maintenance !== true || ctx.initData !== undefined)
    throw new EndpointError('Только служебный CLI-вызов', { code: 'UNAUTHORIZED' });
  return maintenance.sweep();
}
