import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { ADMIN_SCHEMA_DDL, ADMIN_TRIGGER_DDL } from '../src/server/platform/admin-ddl.ts';
import { RANKING_BLOCK_DDL } from '../src/server/platform/ranking-moderation.ts';
import { object, text } from '../src/shared/errors.ts';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(
    `Admin migration v1: ${ADMIN_SCHEMA_DDL.length} schema statements, ${ADMIN_TRIGGER_DDL.length} admin triggers, ranking protection triggers. Existing games and groups are preserved. Historical group/visit activity is not backfilled. No changes made. Run npm run admin:install -- --apply to apply explicitly.`,
  );
} else {
  if (args.length !== 1 || args[0] !== '--apply')
    throw new Error('Usage: npm run admin:install [-- --apply]');
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
      contents: `import {db} from 'sdk'; import {installAdmin} from './src/server/platform/admin-ddl.ts'; import {object} from './src/shared/errors.ts'; export default async function(input,context){const c=object(context);if(c.maintenance!==true||c.initData!==undefined)throw new Error('CLI only');await installAdmin(db,Date.now());return {installed:true};}`,
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
  if (!source) throw new Error('Missing migration module');
  const response = await fetch(`https://cloud.telegram.org/${appId}/manage/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'endpoints/installAdmin',
      sources: { 'endpoints/installAdmin': source },
      args: {},
      ctx: { maintenance: true },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const envelope = object(await response.json());
  if (!response.ok || envelope.ok !== true)
    throw new Error(
      `Admin migration failed (HTTP ${response.status}). Check the management console; no credentials were logged.`,
    );
  console.log(
    `Admin migration v1 installed. ${RANKING_BLOCK_DDL.length} ranking protection statements included. Deploy the application separately.`,
  );
}
