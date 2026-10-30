import { object } from '../../shared/errors.ts';

// Raw db.run returns an envelope even when SQL contains RETURNING.
export function returnedRows(result: unknown): unknown[] {
  const rows = object(result).rows;
  if (!Array.isArray(rows)) throw new Error('Invalid SQL write response');
  return rows;
}
