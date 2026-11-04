import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import {
  COMMUNICATION_SCHEMA,
  COMMUNICATION_TRIGGERS,
} from '../src/server/platform/communications-ddl.ts';
import { object, text } from '../src/shared/errors.ts';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(
    `Communications v4 (separate support cases): ${COMMUNICATION_SCHEMA.length} table/index statements, legacy thread migration, message columns (thread_id, player_name), ${COMMUNICATION_TRIGGERS.length} delivery/activity triggers. Existing history and delivery jobs are preserved. No messages sent or database changes made. Explicit installation: npm run communications:install -- --apply`,
  );
} else {
  if (args.length !== 1 || args[0] !== '--apply')
    throw new Error('Usage: npm run communications:install [-- --apply]');
  const token = text(
    process.env.TGCLOUD_TOKEN ??
      object(JSON.parse(await readFile('.tgcloud/credentials', 'utf8'))).token,
    1,
    1000,
  );
  const appId = /^app\d+(?=:)/.exec(token)?.[0];
  if (!appId) throw new Error('Invalid CLI token');
  const result = await build({
    stdin: {
      resolveDir: resolve('.'),
      contents: `import {db} from 'sdk';import {object} from './src/shared/errors.ts';import {installCommunications} from './src/server/platform/communications-ddl.ts';export default async function(input,context){const c=object(context);if(c.maintenance!==true||c.initData!==undefined)throw new Error('CLI only');await installCommunications(db);return {installed:true}}`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    external: ['sdk'],
  });
  const source = result.outputFiles[0]?.text;
  if (!source) throw new Error('Missing installer');
  const response = await fetch(`https://cloud.telegram.org/${appId}/manage/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'endpoints/installCommunications',
      sources: { 'endpoints/installCommunications': source },
      args: {},
      ctx: { maintenance: true },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const envelope = object(await response.json());
  if (!response.ok || envelope.ok !== true)
    throw new Error(
      `Communications installation failed (HTTP ${response.status}). No credentials logged.`,
    );
  console.log(
    'Communications schema and delivery triggers installed. No messages sent. Publish the code and configure the bot menu separately.',
  );
}
