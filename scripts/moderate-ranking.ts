import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { moderationRequest } from '../src/server/platform/ranking-moderation.ts';
import { object, text } from '../src/shared/errors.ts';

// Explicit operator tool. Uses the authenticated management /run API without deploying
// any public endpoint. Default is a read-only snapshot; --apply installs the block.
const [raw, mode] = process.argv.slice(2);
if (!raw || (mode !== undefined && mode !== '--apply'))
  throw new Error(
    'Usage: node --experimental-transform-types scripts/moderate-ranking.ts <JSON request> [--apply]',
  );
const input = moderationRequest(JSON.parse(raw));
const token = text(
  process.env.TGCLOUD_TOKEN ??
    object(JSON.parse(await readFile('.tgcloud/credentials', 'utf8'))).token,
  1,
  1000,
);
const appId = /^app\d+(?=:)/.exec(token)?.[0];
if (!appId) throw new Error('Invalid CLI token');
const bundled = await build({
  stdin: {
    contents: `import {db} from 'sdk';
      import {object} from './src/shared/errors.ts';
      import {moderationSnapshot,blockRankingAndRemove} from './src/server/platform/ranking-moderation.ts';
      export default async function(input,context) {
        const ctx=object(context);
        if(ctx.maintenance!==true || ctx.initData!==undefined) throw new Error('CLI only');
        const result = input.apply===true
          ? await blockRankingAndRemove(db,input,Date.now()) : await moderationSnapshot(db,input);
        return JSON.stringify(result);
      }`,
    resolveDir: resolve('.'),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  external: ['sdk'],
});
const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('Missing management module');
async function run(apply: boolean): Promise<unknown> {
  const response = await fetch(`https://cloud.telegram.org/${appId}/manage/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'endpoints/moderateRanking',
      sources: { 'endpoints/moderateRanking': source },
      args: { ...input, apply },
      ctx: { maintenance: true },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const envelope = object(await response.json());
  if (!response.ok || envelope.ok !== true)
    throw new Error(JSON.stringify({ status: response.status, ...envelope }));
  // JSON transport also supports numeric object keys such as the game name "2048".
  return JSON.parse(text(object(envelope.result).result, 1, 10000000)) as unknown;
}
const snapshot = await run(false);
const directory = resolve('.cache/ranking-moderation');
await mkdir(directory, { recursive: true });
const stem = `${Date.now()}-${input.playerId}`;
const backup = resolve(directory, `${stem}-before.json`);
await writeFile(backup, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
console.log(`Snapshot: ${backup}`);
if (mode === '--apply') {
  const result = await run(true);
  await writeFile(resolve(directory, `${stem}-after.json`), JSON.stringify(result, null, 2), {
    flag: 'wx',
  });
  const summary = object(result);
  console.log(
    JSON.stringify(
      {
        playerId: summary.playerId,
        removed: summary.removed,
        suppressed: summary.suppressed,
        block: summary.block,
        triggerCount: Array.isArray(summary.triggers) ? summary.triggers.length : null,
        remaining: object(summary.remaining).records,
      },
      null,
      2,
    ),
  );
} else {
  const records = object(object(snapshot).records);
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(records).map(([game, rows]) => [
          game,
          Array.isArray(rows) ? rows.length : null,
        ]),
      ),
      null,
      2,
    ),
  );
}
