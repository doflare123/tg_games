// Explicit operator action; never called by build/test.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { DOOM_WAD_SHA256 } from '../src/shared/doom-content.ts';
import { object, text } from '../src/shared/errors.ts';

const args = process.argv.slice(2);
if (!args.length) {
  console.log(
    'Plan: create doom_assets if absent; upload the pinned compressed IWAD in chunks; activate its manifest last. Existing results are preserved. Use --apply.',
  );
} else {
  if (args.length !== 1 || args[0] !== '--apply')
    throw new Error('Usage: install-doom-data.ts [--apply]');
  const wad = await readFile('public/engines/doom/freedoom1.wad');
  const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
  if (hash(wad) !== DOOM_WAD_SHA256) throw new Error('IWAD checksum mismatch');
  const compressed = gzipSync(wad, { level: 9 });
  const generation = hash(compressed);
  const parts = Math.ceil(compressed.length / 262144);
  const token = text(
    process.env.TGCLOUD_TOKEN ??
      object(JSON.parse(await readFile('.tgcloud/credentials', 'utf8'))).token,
    1,
    1000,
  );
  const app = /^app\d+(?=:)/.exec(token)?.[0];
  if (!app) throw new Error('Invalid CLI token');
  const source = `import {db} from 'sdk'; export default async function(input,ctx) {
    if(ctx.maintenance!==true||ctx.initData!==undefined)throw new Error('CLI only');
    if(input.setup) {await db.run('CREATE TABLE IF NOT EXISTS doom_assets(id TEXT PRIMARY KEY,data TEXT NOT NULL)');return {ready:true};}
    if(!Array.isArray(input.rows)||input.rows.length>2)throw new Error('Invalid chunk batch');
    for(const row of input.rows) {
      if(typeof row.id!=='string'||!row.id.startsWith('${DOOM_WAD_SHA256}:')||row.id.length>180||typeof row.data!=='string'||row.data.length>350000)throw new Error('Invalid data chunk');
      const existing=await db.get('SELECT data FROM doom_assets WHERE id=:id',{':id':row.id});
      if(existing && existing.data!==row.data)throw new Error('Existing asset differs; refusing to overwrite');
      if(!existing)await db.run('INSERT INTO doom_assets(id,data) VALUES(:id,:data) ON CONFLICT(id) DO NOTHING',{':id':row.id,':data':row.data});
    }
    return {written:input.rows.length};
  }`;
  async function run(input: unknown): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`https://cloud.telegram.org/${app}/manage/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module: 'endpoints/installDoomData',
            sources: { 'endpoints/installDoomData': source },
            args: input,
            ctx: { maintenance: true },
          }),
          signal: AbortSignal.timeout(60000),
        });
        const envelope = object(await response.json());
        if (!response.ok || envelope.ok !== true)
          throw new Error(
            `Cloud data write failed: HTTP ${response.status}; ${String(envelope.description ?? '').slice(0, 300)}`,
          );
        return;
      } catch (error) {
        if (attempt >= 2) throw error;
        console.warn(`Retrying idempotent data write (${attempt + 1}/2)`);
      }
    }
  }
  await run({ setup: true });
  for (let part = 0; part < parts; part += 2) {
    const rows = [];
    for (let index = part; index < Math.min(parts, part + 2); index++)
      rows.push({
        id: `${DOOM_WAD_SHA256}:${generation}:${index}`,
        data: compressed.subarray(index * 262144, (index + 1) * 262144).toString('base64'),
      });
    await run({ rows });
    console.log(`Freedoom data: ${Math.min(parts, part + 2)}/${parts} chunks`);
  }
  await run({
    rows: [
      {
        id: `${DOOM_WAD_SHA256}:meta`,
        data: JSON.stringify({ generation, parts, bytes: compressed.length }),
      },
    ],
  });
  console.log('Pinned Freedoom data installed. Existing results and progress preserved.');
}
