import { RULESET } from '../../games/tetris/types.ts';
import { AppError, object } from '../../shared/errors.ts';
import type { ManualResult } from '../domain/manual-result.ts';
import { NEXT_RESULT_ORDER } from './manual-results-ddl.ts';
import type { SqlDatabase } from './sql-repository.ts';
export class SqlManualResultRepository {
  constructor(private readonly db: SqlDatabase) {}
  async record(result: ManualResult, now: number) {
    const expected = {
      id: result.id,
      player_id: result.player.id,
      player_name: result.player.name,
      mode: result.mode,
      ruleset: RULESET,
      score: result.score,
      ticks: result.ticks,
      lines: result.lines,
      group_ids_json: JSON.stringify(result.groupIds),
      reason: result.reason,
      operator: result.operator,
      approximate: Number(result.approximate),
    };
    await this.db.run(
      `INSERT INTO manual_results
      (id,player_id,player_name,mode,ruleset,score,ticks,lines,group_ids_json,created_at,verified_order,reason,operator,approximate)
      VALUES(:id,:player_id,:player_name,:mode,:ruleset,:score,:ticks,:lines,:group_ids_json,:now,${NEXT_RESULT_ORDER},:reason,:operator,:approximate)
      ON CONFLICT(id) DO NOTHING`,
      Object.fromEntries([
        ...Object.entries(expected).map(([key, value]) => [`:${key}`, value]),
        [':now', now],
      ]),
    );
    const stored = object(
      await this.db.get('SELECT * FROM manual_results WHERE id=:id', { ':id': result.id }),
    );
    for (const [key, value] of Object.entries(expected))
      if (stored[key] !== value)
        throw new AppError('CONFLICT', 'Этот id уже занят другой корректировкой');
    return {
      id: result.id,
      source: 'manual' as const,
      score: result.score,
      lines: result.lines,
      ticks: result.ticks,
      approximate: result.approximate,
    };
  }
}
