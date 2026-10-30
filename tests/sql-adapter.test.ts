import { afterEach, expect, it } from 'vitest';
import { localRepository } from '../scripts/local-api.ts';
import { returnedRows } from '../src/server/platform/sql-write.ts';

const handles: ReturnType<typeof localRepository>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
it('rejects writes through read methods just like tgcloud, without changing data', async () => {
  const local = localRepository();
  handles.push(local);
  const sql = "INSERT INTO groups(id,title) VALUES(-42,'Probe') RETURNING id";
  await expect(local.db.get(sql)).rejects.toThrow();
  await expect(local.db.all(sql)).rejects.toThrow();
  expect(await local.db.get('SELECT count(*) AS total FROM groups')).toEqual({ total: 0 });
  // A rejected read must not leave the connection read-only.
  expect(returnedRows(await local.db.run(sql))).toEqual([{ id: -42 }]);
});
it('returns tgcloud write envelopes for RETURNING and an empty row list for a failed CAS', async () => {
  const local = localRepository();
  handles.push(local);
  const inserted = await local.db.run(
    "INSERT INTO groups(id,title) VALUES(-42,'Probe') RETURNING id",
  );
  expect(inserted).toMatchObject({ rowsAffected: 1, rows: [{ id: -42 }] });
  const missed = await local.db.run("UPDATE groups SET title='Changed' WHERE id=-43 RETURNING id");
  expect(missed).toMatchObject({ rowsAffected: 0, rows: [] });
});
