import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const result = spawnSync(
  process.execPath,
  [
    resolve('node_modules/@tgcloud/cli/bin/tgcloud.js'),
    'run',
    'endpoints/configureBot',
    '{}',
    '--ctx',
    JSON.stringify({ maintenance: true }),
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
