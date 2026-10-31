import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Service2048 } from '../src/server/domain/2048.ts';
import { ArcadeService } from '../src/server/domain/arcade.ts';
import { GroupService } from '../src/server/domain/groups.ts';
import { MaintenanceService } from '../src/server/domain/maintenance.ts';
import { MinesweeperService } from '../src/server/domain/minesweeper.ts';
import type { TelegramGateway } from '../src/server/domain/telegram.ts';
import {
  DDL_2048,
  SOCIAL_2048_COLUMNS,
  SOCIAL_2048_INDEXES,
} from '../src/server/platform/2048-ddl.ts';
import { MANUAL_RESULTS_DDL } from '../src/server/platform/manual-results-ddl.ts';
import { MINESWEEPER_DDL } from '../src/server/platform/minesweeper-ddl.ts';
import { RUN_SOCIAL_COLUMNS, SOCIAL_DDL } from '../src/server/platform/social-ddl.ts';
import { Sql2048Repository } from '../src/server/platform/sql-2048.ts';
import { SqlMineRepository } from '../src/server/platform/sql-minesweeper.ts';
import { SqlArcadeRepository, type SqlDatabase } from '../src/server/platform/sql-repository.ts';
import { SqlSocialRepository } from '../src/server/platform/sql-social-repository.ts';
import { AppError } from '../src/shared/errors.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,player_name TEXT NOT NULL,mode TEXT NOT NULL,ruleset TEXT NOT NULL,
 revision INTEGER NOT NULL,status TEXT NOT NULL,state_json TEXT NOT NULL,score INTEGER NOT NULL,ticks INTEGER NOT NULL,
 lines INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_submission TEXT
);
CREATE INDEX IF NOT EXISTS runs_leaderboard ON runs(status,mode,ruleset,score,ticks);
CREATE INDEX IF NOT EXISTS runs_player_recent ON runs(player_id,created_at);
CREATE TABLE IF NOT EXISTS replay_chunks(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS replay_chunks_run ON replay_chunks(run_id,revision);
`;
export function localRepository(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  database.exec(SCHEMA);
  const columns = database.prepare('PRAGMA table_info(runs)').all();
  for (const [name, definition] of Object.entries(RUN_SOCIAL_COLUMNS))
    if (!columns.some((column) => column.name === name))
      database.exec(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
  database.exec(SOCIAL_DDL);
  database.exec(MANUAL_RESULTS_DDL);
  database.exec(MINESWEEPER_DDL);
  database.exec(DDL_2048);
  const puzzleColumns = database.prepare('PRAGMA table_info(puzzle2048_runs)').all();
  for (const [name, definition] of Object.entries(SOCIAL_2048_COLUMNS))
    if (!puzzleColumns.some((column) => column.name === name))
      database.exec(`ALTER TABLE puzzle2048_runs ADD COLUMN ${name} ${definition}`);
  database.exec(SOCIAL_2048_INDEXES);
  // Match tgcloud's read/write split instead of letting SQLite accept writes in get/all.
  const read = <T>(query: () => T): T => {
    database.exec('PRAGMA query_only=ON');
    try {
      return query();
    } finally {
      database.exec('PRAGMA query_only=OFF');
    }
  };
  const db: SqlDatabase = {
    async run(sql, parameters = {}) {
      const statement = database.prepare(sql);
      if (statement.columns().length > 0) {
        const rows = statement.all(parameters);
        const metadata = database
          .prepare('SELECT changes() AS rowsAffected,last_insert_rowid() AS lastInsertRowid')
          .get();
        return { ...metadata, rows };
      }
      const result = statement.run(parameters);
      return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid, rows: [] };
    },
    async get(sql, parameters = {}) {
      return read(() => database.prepare(sql).get(parameters));
    },
    async all(sql, parameters = {}) {
      return read(() => database.prepare(sql).all(parameters));
    },
  };
  return { db, repository: new SqlArcadeRepository(db), database, close: () => database.close() };
}
export function createLocalApi(file: string) {
  const local = localRepository(file);
  const telegram: TelegramGateway = {
    async me() {
      return { id: 99, username: 'local_arcade_bot', hasMainMiniApp: false };
    },
    async member(_chat, id) {
      return { active: id === 1 || id === 99, admin: id === 1 || id === 99 };
    },
    async send() {
      return { messageId: 1, ephemeralId: null, date: Math.floor(Date.now() / 1000) };
    },
    async commands() {},
  };
  const social = new SqlSocialRepository(local.db, local.repository);
  const mineRepository = new SqlMineRepository(local.db);
  const puzzle2048Repository = new Sql2048Repository(local.db);
  const groups = new GroupService(social, telegram, () => Date.now());
  const maintenance = new MaintenanceService(
    social,
    local.repository,
    groups,
    telegram,
    () => Date.now(),
    mineRepository,
    puzzle2048Repository,
  );
  const ready = (async () => {
    await social.upsertGroup({
      id: -10001,
      title: 'Локальная тестовая группа',
      active: true,
      botAdmin: true,
    });
    await social.observeMember({ chatId: -10001, userId: 1, active: true, updatedAt: Date.now() });
  })();
  const service = new ArcadeService(
    local.repository,
    { now: () => Date.now(), seed: () => Math.floor(Math.random() * 0x100000000) },
    groups,
  );
  const player = { id: 1, name: 'Локальный игрок' };
  const puzzle2048 = new Service2048(puzzle2048Repository, {
    now: () => Date.now(),
    seed: () => Math.floor(Math.random() * 0x100000000),
  });
  const minesweeper = new MinesweeperService(mineRepository, {
    now: () => Date.now(),
  });
  return {
    close: local.close,
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) {
          res.statusCode = 403;
          res.end();
          return;
        }
        await ready;
        let body = '';
        for await (const chunk of req) {
          body += String(chunk);
          if (body.length > 256000) throw new AppError('BAD_INPUT', 'Запрос слишком большой');
        }
        const input: unknown = JSON.parse(body || '{}');
        const method = req.url?.split('?')[0]?.split('/').pop();
        let result: unknown;
        switch (method) {
          case 'create2048Run':
            result = await puzzle2048.create(player, input);
            break;
          case 'get2048Run':
            result = await puzzle2048.get(player, input);
            break;
          case 'submit2048Moves':
            {
              const outcome = await puzzle2048.submit(player, input);
              result = outcome;
              if (outcome.status === 'verified') {
                try {
                  const run = await puzzle2048Repository.get(outcome.id);
                  if (run) await maintenance.result2048(run);
                  await maintenance.sweep(3);
                } catch {
                  // Notification delivery is retried independently from saving the result.
                }
              }
            }
            break;
          case 'get2048Leaderboard':
            result = await puzzle2048.leaderboard(player, input);
            break;
          case 'submitMineResult':
            {
              const outcome = await minesweeper.submit(player, input);
              result = outcome;
              try {
                const run = await mineRepository.getStored(outcome.id);
                if (run) await maintenance.mineResult(run);
                await maintenance.sweep(3);
              } catch {
                // Delivery is retried by a later sweep; the result is already saved.
              }
            }
            break;
          case 'getMineLeaderboard':
            result = await minesweeper.leaderboard(player, input);
            break;
          case 'getGroups':
            result = await groups.list(player);
            break;
          case 'setGroupNotifications':
            result = await groups.configure(player, input);
            break;
          case 'getCatalog':
            result = service.catalog();
            break;
          case 'getProfile':
            result = player;
            break;
          case 'createRun':
            result = await service.create(player, input);
            break;
          case 'getRun':
            result = await service.get(player, input);
            break;
          case 'submitReplay':
            {
              const outcome = await service.submit(player, input);
              result = outcome;
              if (outcome.status === 'verified') {
                const run = await local.repository.get(outcome.id);
                if (run) await maintenance.result(run);
                await maintenance.sweep(3);
              }
            }
            break;
          case 'abandonRun':
            result = await service.abandon(player, input);
            break;
          case 'getLeaderboard':
            result = await service.leaderboard(player, input);
            break;
          default:
            throw new AppError('NOT_FOUND', 'Метод не найден');
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        res.statusCode = error instanceof AppError ? 400 : 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: false,
            error: error instanceof AppError ? error.message : 'Ошибка локального API',
            code: error instanceof AppError ? error.code : 'INTERNAL',
          }),
        );
      }
    },
  };
}
