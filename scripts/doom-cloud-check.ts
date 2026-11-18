// Explicit, read-only cloud check. Never invoked by build/test or deployed.
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { object, text } from '../src/shared/errors.ts';

const names = [
  'createDoomRun',
  'getDoomProgress',
  'appendDoomCommands',
  'interruptDoomRun',
  'verifyDoomRun',
  'getDoomLeaderboard',
];
const bundled = await build({
  stdin: {
    resolveDir: resolve('.'),
    contents: `
import create from '../lib/doom-engine.js';
import {fetch as request} from 'sdk';
import {WasmDoomVerifier} from './src/server/platform/doom-verifier.ts';
import {serverDoomWad} from './src/server/platform/doom-assets.ts';
import {DOOM_PRIVATE_MESSAGE} from './src/shared/doom-policy.ts';
${names.map((name, i) => `import op${i} from './${name}.js';`).join('\n')}
import catalog from './getCatalog.js';
import profile from './getProfile.js';
import arcadeBoard from './getLeaderboard.js';
export default async function(input,context) {
  if(context.maintenance!==true || context.initData!==undefined) throw new Error('CLI only');
  if(input.network) {
    const results=[];
    for(const path of ['ranked-manifest.json','freedoom1.wad']) {
      try {
        const response=await request('https://app8745166402.tgcloud.ai/engines/doom/'+path,{headers:{Range:'bytes=0-65535'}});
        let bytes=0; for await(const chunk of response.body) bytes+=chunk.length;
        results.push({path,status:response.status,bytes});
      } catch(error) {results.push({path,error:error.message});}
    }
    return results;
  }
  const guest={initData:{user:{id:1,first_name:'Unauthorized probe'}}};
  const owner={initData:{user:{id:930852883,first_name:'Owner'}}};
  let denied=0;
  for(const operation of [${names.map((_, i) => `op${i}`).join(',')}]) {
    try { await operation({playerId:930852883,isAdmin:true},guest); }
    catch(error) { if(error.message===DOOM_PRIVATE_MESSAGE) { denied++; continue; } throw error; }
    throw new Error('Non-owner was admitted');
  }
  if((await catalog({},guest)).some(game=>game.id==='doom')) throw new Error('Guest catalog exposed Freedoom');
  if(!(await catalog({},owner)).some(game=>game.id==='doom')) throw new Error('Owner catalog missing Freedoom');
  const identity=await profile({},owner);
  const normalBoard=await arcadeBoard({mode:'marathon',period:'all'},owner);
  if(identity.id!==930852883 || !identity.isAdmin || !Array.isArray(normalBoard.entries)) throw new Error('Existing arcade API regression');
  await op1({},owner);
  const board=await op5({skill:'3',target:'episode',category:'any',period:'all'},owner);
  if(!Array.isArray(board.entries)) throw new Error('Owner leaderboard unavailable');
  if(input.runtimeOnly) {
    const engine=await create({noInitialRun:true,print:()=>{},printErr:()=>{}});
    return {denied,ownerCatalog:true,wasmInitialized:engine._arcade_get(0)===0,decompression:typeof Reflect.get(globalThis,'DecompressionStream'),atob:typeof Reflect.get(globalThis,'atob')};
  }
  const started=Date.now();
  const result=await new WasmDoomVerifier(serverDoomWad,create).verify('3',[{mask:0,ticks:350}]);
  if(result.ticks!==350 || result.complete) throw new Error('Cloud replay mismatch');
  return {denied,ownerCatalog:true,authoritativeReplayTicks:result.ticks,elapsedMs:Date.now()-started};
}`,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  external: [
    'sdk',
    '../lib/doom-engine.js',
    ...names.map((name) => `./${name}.js`),
    './getCatalog.js',
    './getProfile.js',
    './getLeaderboard.js',
  ],
});
const sources: Record<string, string> = {};
for (const file of await readdir('tgcloud', { recursive: true })) {
  if (file.endsWith('.js'))
    sources[file.replaceAll('\\', '/').slice(0, -3)] = await readFile(
      resolve('tgcloud', file),
      'utf8',
    );
}
const source = bundled.outputFiles[0]?.text;
if (!source) throw new Error('Missing cloud check module');
sources['endpoints/doomReleaseCheck'] = source;
const token = text(
  process.env.TGCLOUD_TOKEN ??
    object(JSON.parse(await readFile('.tgcloud/credentials', 'utf8'))).token,
  1,
  1000,
);
const appId = /^app\d+(?=:)/.exec(token)?.[0];
if (!appId) throw new Error('Invalid CLI token');
const response = await fetch(`https://cloud.telegram.org/${appId}/manage/run`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    module: 'endpoints/doomReleaseCheck',
    sources,
    args: {
      runtimeOnly: process.argv.includes('--runtime-only'),
      network: process.argv.includes('--network'),
    },
    ctx: { maintenance: true },
  }),
  signal: AbortSignal.timeout(360000),
});
const envelope = object(await response.json());
if (!response.ok || envelope.ok !== true) {
  console.error(JSON.stringify(envelope));
  throw new Error(`Cloud check failed (HTTP ${response.status}); no credentials logged`);
}
console.log(JSON.stringify(envelope));
