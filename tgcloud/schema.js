import { table, integer, real, text, sql, index } from 'sdk/db';

export const groups = table('groups', {
  id: integer('id').primaryKey(), // Telegram chat.id
  groupName: text('group_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const members = table('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull(),
  groupId: integer('group_id').notNull(),
  name: text('name').notNull(),
  firstSeen: integer('first_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  memberGroupIdx: index('idx_members_group').on(t.groupId),
}));

export const expenses = table('expenses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull(),
  payerId: integer('payer_id').notNull(),
  payerName: text('payer_name').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  description: text('description').notNull(),
  settled: integer('settled').default(0), // 0: unsettled, 1: settled
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  expenseGroupIdx: index('idx_expenses_group').on(t.groupId),
  expenseSettledIdx: index('idx_expenses_settled').on(t.settled),
}));

export const userRoles = table('user_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').unique().notNull(),
  username: text('username'),
  role: text('role').default('normal'), // 'superadmin', 'admin', 'banned', 'normal'
  addedAt: integer('added_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
