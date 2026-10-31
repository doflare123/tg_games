import { db, EndpointError } from 'sdk';
import { object } from '../../shared/errors.ts';
import { decodeManualResult } from '../domain/manual-result.ts';
import { groups } from '../platform/runtime.ts';
import { SqlManualResultRepository } from '../platform/sql-manual-results.ts';
export default async function record(input: unknown, context: unknown) {
  const ctx = object(context);
  if (ctx.maintenance !== true || ctx.initData !== undefined)
    throw new EndpointError('Только служебный CLI-вызов', { code: 'UNAUTHORIZED' });
  const result = decodeManualResult(input);
  for (const id of result.groupIds) await groups.access(result.player, id);
  return new SqlManualResultRepository(db).record(result, Date.now());
}
