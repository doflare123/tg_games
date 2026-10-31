import { index, integer, table, text } from 'sdk/db';
export const minesweeperRuns = table(
  'minesweeper_runs',
  {
    id: text('id').primaryKey(),
    playerId: integer('player_id').notNull(),
    playerName: text('player_name').notNull(),
    ruleset: text('ruleset').notNull(),
    size: text('size').notNull(),
    revision: integer('revision').notNull(),
    stateJson: text('state_json').notNull(),
    status: text('status').notNull(),
    firstCell: integer('first_cell').notNull(),
    startedAt: integer('started_at').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    lastAction: text('last_action'),
  },
  (t) => ({
    leaderboard: index('minesweeper_leaderboard').on(t.size, t.ruleset, t.status, t.elapsedMs),
    recent: index('minesweeper_recent').on(t.playerId, t.startedAt),
  }),
);
export const runs = table(
  'runs',
  {
    id: text('id').primaryKey(),
    playerId: integer('player_id').notNull(),
    playerName: text('player_name').notNull(),
    mode: text('mode').notNull(),
    ruleset: text('ruleset').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    stateJson: text('state_json').notNull(),
    score: integer('score').notNull(),
    ticks: integer('ticks').notNull(),
    lines: integer('lines').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    lastSubmission: text('last_submission'),
    groupIdsJson: text('group_ids_json').notNull().default('[]'),
    verifiedOrder: integer('verified_order').notNull().default(0),
    verifiedAt: integer('verified_at').notNull().default(0),
    socialProcessed: integer('social_processed').notNull().default(1),
  },
  (t) => ({
    leaderboard: index('runs_leaderboard').on(t.status, t.mode, t.ruleset, t.score, t.ticks),
    playerRecent: index('runs_player_recent').on(t.playerId, t.createdAt),
    verifiedOrder: index('runs_verified_order').on(t.verifiedOrder),
    pendingSocial: index('runs_pending_social').on(t.status, t.socialProcessed, t.verifiedOrder),
  }),
);
export const replayChunks = table(
  'replay_chunks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    revision: integer('revision').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => ({ run: index('replay_chunks_run').on(t.runId, t.revision) }),
);

export const groups = table('groups', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  active: integer('active').notNull().default(1),
  botAdmin: integer('bot_admin').notNull().default(0),
  notificationsEnabled: integer('notifications_enabled').notNull().default(0),
  enabledAt: integer('enabled_at').notNull().default(0),
  nextNotificationAt: integer('next_notification_at').notNull().default(0),
  lastNotificationJob: text('last_notification_job').notNull().default(''),
});
export const groupMemberships = table(
  'group_memberships',
  {
    id: text('id').primaryKey(),
    groupId: integer('group_id').notNull(),
    userId: integer('user_id').notNull(),
    active: integer('active').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    user: index('memberships_user').on(t.userId, t.active),
    group: index('memberships_group').on(t.groupId),
  }),
);
export const socialJobs = table(
  'social_jobs',
  {
    id: text('id').primaryKey(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    dueAt: integer('due_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    attempts: integer('attempts').notNull(),
    leaseUntil: integer('lease_until').notNull(),
    error: text('error'),
  },
  (t) => ({ due: index('social_jobs_due').on(t.status, t.dueAt, t.leaseUntil) }),
);

export const manualResults = table(
  'manual_results',
  {
    id: text('id').primaryKey(),
    playerId: integer('player_id').notNull(),
    playerName: text('player_name').notNull(),
    mode: text('mode').notNull(),
    ruleset: text('ruleset').notNull(),
    score: integer('score').notNull(),
    ticks: integer('ticks'),
    lines: integer('lines').notNull(),
    groupIdsJson: text('group_ids_json').notNull(),
    createdAt: integer('created_at').notNull(),
    verifiedOrder: integer('verified_order').notNull(),
    reason: text('reason').notNull(),
    operator: text('operator').notNull(),
    approximate: integer('approximate').notNull(),
  },
  (t) => ({
    leaderboard: index('manual_results_leaderboard').on(t.mode, t.ruleset, t.score, t.ticks),
  }),
);
