import { existsSync, readFileSync } from 'node:fs';
import createDoom from 'doom-headless-engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doomTestWad } from '../scripts/doom-test-fixture.ts';
import { localRepository } from '../scripts/local-api.ts';
import { OWNER_ID } from '../src/server/domain/admin.ts';
import {
  DoomService,
  type DoomVerification,
  type DoomVerifier,
} from '../src/server/domain/doom.ts';
import { doomRecordNotification } from '../src/server/domain/doom-record-notification.ts';
import { GroupService } from '../src/server/domain/groups.ts';
import { MaintenanceService } from '../src/server/domain/maintenance.ts';
import type { TelegramGateway } from '../src/server/domain/telegram.ts';
import { WasmDoomVerifier } from '../src/server/platform/doom-verifier.ts';
import { SqlDoomRepository } from '../src/server/platform/sql-doom.ts';
import { SqlArcadeRepository } from '../src/server/platform/sql-repository.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';
import {
  type DoomCommandSpan,
  doomCommands,
  doomSamePrefix,
  doomTicks,
} from '../src/shared/doom.ts';
import * as doomPolicy from '../src/shared/doom-policy.ts';

const player = { id: OWNER_ID, name: 'Игрок' };
const other = { id: 2, name: 'Другой' };
const empty: DoomVerifier = {
  async verify(_skill, commands) {
    return { ticks: doomTicks(commands), complete: false, splits: [] };
  },
};
function setup(verifier: DoomVerifier = empty) {
  const local = localRepository();
  local.database.exec(
    'CREATE TABLE IF NOT EXISTS ranking_blocks(player_id INTEGER PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL)',
  );
  const repository = new SqlDoomRepository(local.db);
  let now = 1000000;
  const service = new DoomService(repository, verifier, () => now);
  return {
    ...local,
    repository,
    service,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
const create = (s: ReturnType<typeof setup>, requestId = 'doom_request_0001', skill = '3') =>
  s.service.create(player, { requestId, skill });

describe('Doom server recording and rankings', () => {
  afterEach(() => vi.restoreAllMocks());
  it('rejects every player API for non-owners before reading input or touching recordings', async () => {
    const s = setup();
    for (const operation of [
      'create',
      'progress',
      'append',
      'interrupt',
      'verify',
      'leaderboard',
    ] as const)
      await expect(
        s.service[operation](other, { playerId: OWNER_ID, isAdmin: true }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await create(s)).id).toContain(`${OWNER_ID}:`);
    expect(doomPolicy.canAccessDoom(false)).toBe(false);
    s.close();
  });
  it('accepts differently chunked local caches only when the acknowledged command prefix matches', () => {
    expect(
      doomSamePrefix(
        [{ mask: 1, ticks: 10 }],
        [
          { mask: 1, ticks: 4 },
          { mask: 1, ticks: 6 },
        ],
        10,
      ),
    ).toBe(true);
    expect(
      doomSamePrefix(
        [{ mask: 1, ticks: 10 }],
        [
          { mask: 1, ticks: 4 },
          { mask: 2, ticks: 6 },
        ],
        10,
      ),
    ).toBe(false);
    expect(doomSamePrefix([{ mask: 1, ticks: 4 }], [{ mask: 1, ticks: 10 }], 10)).toBe(false);
  });
  it('persists interruption markers with commands before verification and fences stale lease releases', async () => {
    const s = setup(),
      run = await create(s);
    s.advance(10000);
    await s.service.append(player, {
      runId: run.id,
      revision: 0,
      commands: [{ mask: 0, ticks: 350 }],
      interruptions: [100],
    });
    const stored = await s.repository.get(run.id);
    expect(stored?.continuous).toBe(false);
    expect(stored?.breaks).toEqual([100]);
    expect(await s.repository.claim(run.id, s.now())).toBe(true);
    const started = s.now();
    s.advance(120001);
    expect(await s.repository.claim(run.id, s.now())).toBe(true);
    await s.repository.release(run.id, started, s.now());
    expect(await s.repository.claim(run.id, s.now())).toBe(false);
    await expect(s.service.interrupt(player, { runId: run.id, atTick: 351 })).rejects.toThrow();
    await expect(
      s.service.append(player, {
        runId: run.id,
        revision: 1,
        commands: [{ mask: 0, ticks: 1 }],
        interruptions: [352],
      }),
    ).rejects.toThrow();
    s.close();
  });
  it('delivers through shared notifications with retries, deduplication, group settings and shared cooldown', async () => {
    vi.spyOn(doomPolicy, 'isDoomAdminOnly').mockReturnValue(false);
    const s = setup(),
      arcade = new SqlArcadeRepository(s.db),
      social = new SqlSocialRepository(s.db, arcade);
    let failures = 1,
      sent = 0;
    const telegram: TelegramGateway = {
      async me() {
        return { id: 99, username: 'arcade_bot', hasMainMiniApp: true };
      },
      async member() {
        return { active: true, admin: true };
      },
      async commands() {},
      async edit() {},
      async sendMedia() {
        return { messageId: 1, ephemeralId: null, date: 1 };
      },
      async send() {
        if (failures-- > 0) throw new Error('temporary');
        sent++;
        return { messageId: 1, ephemeralId: null, date: 1 };
      },
    };
    const groups = new GroupService(social, telegram, s.now);
    const maintenance = new MaintenanceService(
      social,
      arcade,
      groups,
      telegram,
      s.now,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      s.repository,
    );
    await social.upsertGroup({ id: -100, title: 'Группа', active: true, botAdmin: true });
    await social.observeMember({
      chatId: -100,
      userId: OWNER_ID,
      active: true,
      updatedAt: s.now(),
    });
    await social.notifications(-100, true, s.now() - 1);
    const run = await create(s);
    s.advance(10000);
    await s.service.append(player, {
      runId: run.id,
      revision: 0,
      commands: [{ mask: 0, ticks: 350 }],
    });
    const stored = await s.repository.get(run.id);
    if (!stored) throw new Error('Missing run');
    await s.repository.publish(
      stored,
      {
        ticks: 350,
        complete: false,
        splits: [
          { map: 1, ticks: 35, totalTicks: 35, startTick: 0, endTick: 100, max: false },
          { map: 2, ticks: 70, totalTicks: 105, startTick: 200, endTick: 300, max: false },
        ],
      },
      s.now(),
    );
    await maintenance.sweep();
    expect(sent).toBe(0);
    expect(
      s.database
        .prepare(
          "SELECT COUNT(*) AS n FROM social_jobs WHERE json_extract(payload,'$.game')='doom'",
        )
        .get()?.n,
    ).toBe(2);
    s.advance(60000);
    await maintenance.sweep();
    expect(sent).toBe(1);
    await maintenance.sweep();
    expect(sent).toBe(1);
    expect(
      s.database
        .prepare(
          "SELECT COUNT(*) AS n FROM social_jobs WHERE json_extract(payload,'$.game')='doom'",
        )
        .get()?.n,
    ).toBe(2);
    await social.notifications(-100, false, s.now());
    s.advance(300001);
    await maintenance.sweep();
    expect(sent).toBe(1);
    expect(
      s.database.prepare("SELECT COUNT(*) AS n FROM social_jobs WHERE status='suppressed'").get()
        ?.n,
    ).toBe(1);
    s.close();
  });
  it('validates input, authenticates ownership, paces uploads and makes retries idempotent', async () => {
    const s = setup();
    const run = await create(s);
    await expect(s.service.create(player, { requestId: 'bad', skill: '3' })).rejects.toThrow();
    await expect(
      s.service.append(other, { runId: run.id, revision: 0, commands: [{ mask: 1, ticks: 35 }] }),
    ).rejects.toThrow('только владельцу');
    await expect(
      s.service.append(player, { runId: run.id, revision: 0, commands: [{ mask: 1, ticks: 350 }] }),
    ).rejects.toThrow('опережает');
    expect(() => doomCommands([{ mask: 4096, ticks: 1 }])).toThrow();
    expect(() => doomCommands([{ mask: 0, ticks: 351 }])).toThrow();
    s.advance(10000);
    const input = { runId: run.id, revision: 0, commands: [{ mask: 1, ticks: 350 }] };
    expect((await s.service.append(player, input)).acceptedTicks).toBe(350);
    expect((await s.service.append(player, input)).revision).toBe(1);
    await expect(
      s.service.append(player, { ...input, commands: [{ mask: 2, ticks: 350 }] }),
    ).rejects.toThrow('обновилась');
    expect((await s.service.progress(player, {}))?.commands).toEqual(input.commands);
    expect(
      (
        await s.service.leaderboard(player, {
          skill: '3',
          target: 'E1M1',
          category: 'any',
          period: 'all',
        })
      ).entries,
    ).toEqual([]);
    s.close();
  });
  it('does not verify in the upload path; resumes from a persistent recording after restarting the service', async () => {
    let calls = 0;
    const verifier: DoomVerifier = {
      async verify(...args) {
        calls++;
        return empty.verify(...args);
      },
    };
    const s = setup(verifier),
      run = await create(s);
    s.advance(10000);
    await s.service.append(player, {
      runId: run.id,
      revision: 0,
      commands: [{ mask: 0, ticks: 350 }],
    });
    expect(calls).toBe(0);
    const restarted = new DoomService(new SqlDoomRepository(s.db), verifier, s.now);
    expect((await restarted.progress(player, {}))?.commands).toEqual([{ mask: 0, ticks: 350 }]);
    expect((await restarted.verify(player, { runId: run.id })).verifiedTicks).toBe(350);
    expect(calls).toBe(1);
    s.close();
  });
  it('publishes map and campaign categories once, separates skill, applies membership and excludes interrupted maps', async () => {
    const s = setup(),
      run = await create(s);
    s.advance(10000);
    await s.service.append(player, {
      runId: run.id,
      revision: 0,
      commands: [{ mask: 0, ticks: 350 }],
    });
    const stored = await s.repository.get(run.id);
    if (!stored) throw new Error('Missing run');
    const verification: DoomVerification = {
      ticks: 350,
      complete: true,
      splits: Array.from({ length: 9 }, (_, i) => ({
        map: i === 8 ? 8 : i === 7 ? 9 : i + 1,
        ticks: 20,
        totalTicks: (i + 1) * 20,
        startTick: i * 35,
        endTick: (i + 1) * 35,
        max: true,
      })),
    };
    await s.repository.publish(stored, verification, s.now());
    await s.repository.publish(stored, verification, s.now());
    expect(
      (await s.repository.leaderboard(player, '3', 'episode', 'any', 'all', 0)).me?.ticks,
    ).toBe(180);
    expect(
      (await s.repository.leaderboard(player, '3', 'episode', 'max', 'all', 0)).entries,
    ).toHaveLength(1);
    expect(
      (await s.repository.leaderboard(player, '4', 'E1M1', 'any', 'all', 0)).entries,
    ).toHaveLength(0);
    expect(
      (await s.repository.leaderboard(player, '3', 'E1M1', 'any', 'all', 0, { groupId: -100 }))
        .entries,
    ).toHaveLength(0);
    const second = await create(s, 'doom_request_0002');
    await s.repository.interrupt(second.id, s.now());
    s.advance(10000);
    await s.service.append(player, {
      runId: second.id,
      revision: 0,
      commands: [{ mask: 0, ticks: 350 }],
    });
    const interrupted = await s.repository.get(second.id);
    if (!interrupted) throw new Error('Missing run');
    await s.repository.publish(interrupted, verification, s.now());
    const rows = s.database
      .prepare('SELECT target FROM doom_results WHERE run_id=?')
      .all(second.id);
    expect(rows.some((r) => r.target === 'episode' || r.target === 'E1M1')).toBe(false);
    expect(rows.some((r) => r.target === 'E1M2')).toBe(true);
    s.close();
  });
  it('announces a verified record and suppresses a tied or superseded result', () => {
    const result = {
      id: 'result',
      runId: 'run',
      playerId: 1,
      playerName: 'Игрок',
      skill: '3',
      target: 'E1M1',
      category: 'any',
      ticks: 35,
      createdAt: 1,
      verifiedAt: 1,
      verifiedOrder: 1,
      socialProcessed: false,
      startTick: 0,
      endTick: 35,
    } as const;
    const before = {
      skill: '3',
      target: 'E1M1',
      category: 'any',
      period: 'all',
      entries: [],
      me: null,
    } as const;
    const after = {
      ...before,
      entries: [{ rank: 1, playerId: 1, name: 'Игрок', ticks: 35, runId: 'result' }],
      me: { rank: 1, playerId: 1, name: 'Игрок', ticks: 35, runId: 'result' },
    } as const;
    expect(
      doomRecordNotification(
        result,
        { ...before, entries: [] },
        { ...after, entries: [...after.entries] },
      ),
    ).toContain('Первый рекорд');
    expect(
      doomRecordNotification(
        result,
        { ...after, entries: [...after.entries] },
        { ...after, entries: [...after.entries] },
      ),
    ).toBeNull();
  });
});

describe.skipIf(
  !existsSync('public/engines/doom/verify.js') || !existsSync('public/engines/doom/freedoom1.wad'),
)('real Doom headless simulation', () => {
  it('derives all exits, secret routing and campaign completion from commands; deterministic replay survives fresh instances', async () => {
    const wad = doomTestWad(readFileSync('public/engines/doom/freedoom1.wad'), true);
    const engine = await createDoom({ noInitialRun: true, print: () => {}, printErr: () => {} });
    engine.FS.writeFile('/doom.wad', wad);
    engine.callMain(['-iwad', '/doom.wad', '-warp', '1', '1', '-skill', '3', '-nosound']);
    const commands: DoomCommandSpan[] = [];
    for (let tick = 0; tick < 15000 && !engine._arcade_get(4); tick++) {
      const mask = tick % 4 === 0 ? 384 : 0;
      engine._arcade_step(mask);
      commands.push({ mask, ticks: 1 });
    }
    expect(engine._arcade_get(4)).toBe(1);
    const verifier = new WasmDoomVerifier(async () => wad, createDoom);
    const first = await verifier.verify('3', commands),
      second = await verifier.verify('3', commands);
    expect(first).toEqual(second);
    expect(first.complete).toBe(true);
    expect(first.splits.map((split) => split.map)).toEqual([1, 2, 3, 9, 4, 5, 6, 7, 8]);
    expect(first.splits.every((split) => split.ticks > 0 && split.max)).toBe(true);
    await expect(verifier.verify('3', [...commands, { mask: 0, ticks: 1 }])).rejects.toThrow(
      'после конца',
    );
  });
});
