import { table, integer, real, text, sql, index, json } from 'sdk/db';

export const groups = table('groups', {
  id: integer('id').primaryKey(), // Telegram chat.id
  groupName: text('group_name'),
  dutyOffset: integer('duty_offset').default(0),
  dutyTime: text('duty_time').default('09:00'),
  dutyRoster: json('duty_roster'),
  lastDutyDate: text('last_duty_date'),
  lastDutyDoneDate: text('last_duty_done_date'),
  expenseRoster: json('expense_roster'),
  settings: json('settings'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const members = table('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull(),
  groupId: integer('group_id').notNull(),
  name: text('name').notNull(),
  dutyOrder: integer('duty_order').default(0),
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
  messageId: integer('message_id'),
  settled: integer('settled').default(0), // 0: unsettled, 1: settled
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  expenseGroupIdx: index('idx_expenses_group').on(t.groupId),
  expenseSettledIdx: index('idx_expenses_settled').on(t.settled),
  expenseMsgIdx: index('idx_expenses_msg').on(t.groupId, t.messageId),
}));

export const userRoles = table('user_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').unique().notNull(),
  username: text('username'),
  role: text('role').default('normal'), // 'superadmin', 'admin', 'banned', 'normal'
  addedAt: integer('added_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const pendingDeletions = table('pending_deletions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  messageId: integer('message_id').notNull(),
  deleteAt: integer('delete_at').notNull(),
}, (t) => ({
  deleteAtIdx: index('idx_pending_del_at').on(t.deleteAt),
}));

export const adminSessions = table('admin_sessions', {
  userId: integer('user_id').primaryKey(),
  groupId: integer('group_id'),
  mode: text('mode').default('choose'),
  awaitingInput: text('awaiting_input'),
  personalSettings: json('personal_settings'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const personalRecords = table('personal_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  type: text('type').notNull(), // 'expense' | 'income'
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  personalUserIdx: index('idx_personal_records_user').on(t.userId),
}));

export const personalDebts = table('personal_debts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  direction: text('direction').notNull(), // 'owe_me' | 'i_owe'
  personName: text('person_name').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  note: text('note'),
  isPaid: integer('is_paid').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  personalDebtUserIdx: index('idx_personal_debts_user').on(t.userId),
}));
