import { expect, it } from 'vitest';
import { ReplayUploader } from '../src/client/games/tetris/replay-uploader.ts';
import { createTetris } from '../src/games/tetris/engine.ts';
import type { ReplayInput, RunView } from '../src/shared/contracts.ts';

it('retries the exact committed chunk after a lost response while the game advances', async () => {
  const state = createTetris(1, 'marathon');
  const run: RunView = {
    id: '1:test',
    mode: 'marathon',
    revision: 0,
    ruleset: 'tetris-arcade-v1',
    state,
    status: 'active',
    createdAt: 0,
    expiresAt: 999999,
  };
  const sent: ReplayInput[] = [];
  const uploader = new ReplayUploader(async (input) => {
    sent.push(input);
    if (sent.length === 1) throw new Error('Response lost after commit');
    return { ...run, revision: 1, state: { ...state, tick: input.untilTick } };
  });
  await expect(uploader.upload(run, 120, [{ tick: 1, action: 'left' }])).rejects.toThrow(
    'Response lost',
  );
  const acknowledged = await uploader.upload(run, 240, [
    { tick: 1, action: 'left' },
    { tick: 200, action: 'right' },
  ]);
  expect(sent[1]).toEqual(sent[0]);
  expect(acknowledged.state.tick).toBe(120);
  await uploader.upload(acknowledged, 240, [{ tick: 200, action: 'right' }]);
  expect(sent[2]?.revision).toBe(1);
  expect(sent[2]?.untilTick).toBe(240);
});
