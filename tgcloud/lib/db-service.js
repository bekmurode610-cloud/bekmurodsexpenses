import { db } from 'sdk';
import { eq, and, desc, gte, lte } from 'sdk/db';
import { groups, members, expenses, userRoles } from '../schema.js';

export async function addOrUpdateGroup(groupId, groupName) {
  const existing = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!existing) {
    await db.insert(groups).values({ id: groupId, groupName: groupName || 'Group' }).run();
  } else if (existing.groupName === 'Group' && groupName && groupName !== 'Group') {
    await db.update(groups).set({ groupName }).where(eq(groups.id, groupId)).run();
  }
}

export async function ensureMember(telegramId, groupId, name, groupName) {
  await addOrUpdateGroup(groupId, groupName);

  // Check if member exists by telegramId
  let existing = await db
    .select()
    .from(members)
    .where(and(eq(members.telegramId, telegramId), eq(members.groupId, groupId)))
    .get();

  // If not found by ID, check if there is a placeholder member with the same username
  if (!existing && name && name.startsWith('@')) {
    existing = await db
      .select()
      .from(members)
      .where(and(eq(members.name, name), eq(members.groupId, groupId)))
      .get();
    if (existing) {
      await db.update(members).set({ telegramId }).where(eq(members.id, existing.id)).run();
      return;
    }
  }

  if (!existing) {
    await db.insert(members).values({ telegramId, groupId, name }).run();
  } else if (name && existing.name !== name) {
    await db.update(members).set({ name }).where(eq(members.id, existing.id)).run();
  }
}

export async function addMemberByName(groupId, name, groupName) {
  await addOrUpdateGroup(groupId, groupName);
  const cleanName = name.trim();
  const existing = await db
    .select()
    .from(members)
    .where(and(eq(members.name, cleanName), eq(members.groupId, groupId)))
    .get();

  if (!existing) {
    const placeholderId = -(Math.floor(Date.now() % 1000000000) + Math.floor(Math.random() * 1000));
    await db.insert(members).values({ telegramId: placeholderId, groupId, name: cleanName }).run();
    return true;
  }
  return false;
}

export async function syncChatAdmins(api, chatId, groupTitle) {
  try {
    const admins = await api.getChatAdministrators({ chat_id: chatId });
    if (Array.isArray(admins)) {
      for (const admin of admins) {
        if (!admin.user.is_bot) {
          const name = admin.user.username
            ? `@${admin.user.username}`
            : [admin.user.first_name, admin.user.last_name].filter(Boolean).join(' ') || 'User';
          await ensureMember(admin.user.id, chatId, name, groupTitle);
        }
      }
    }
  } catch (err) {
    console.warn('Could not sync chat admins:', err);
  }
}

export async function getMembers(groupId) {
  return await db.select().from(members).where(eq(members.groupId, groupId)).all();
}

export async function addExpense({
  groupId,
  payerId,
  payerName,
  amount,
  currency,
  description,
  groupName,
}) {
  await ensureMember(payerId, groupId, payerName, groupName);

  const [inserted] = await db
    .insert(expenses)
    .values({
      groupId,
      payerId,
      payerName,
      amount,
      currency: currency.toUpperCase(),
      description,
      settled: 0,
    })
    .returning()
    .run();

  return inserted;
}

export async function getExpenses(groupId, { limit = 50, includeSettled = true, startDate, endDate } = {}) {
  let query = db.select().from(expenses);
  const conditions = [eq(expenses.groupId, groupId)];

  if (!includeSettled) {
    conditions.push(eq(expenses.settled, 0));
  }
  if (startDate) {
    conditions.push(gte(expenses.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(expenses.createdAt, endDate));
  }

  return await query
    .where(and(...conditions))
    .orderBy(desc(expenses.createdAt))
    .limit(limit)
    .all();
}

export async function getExpense(expenseId) {
  return await db.select().from(expenses).where(eq(expenses.id, expenseId)).get();
}

export async function deleteExpense(expenseId) {
  return await db.delete(expenses).where(eq(expenses.id, expenseId)).run();
}

export async function settleGroup(groupId) {
  return await db
    .update(expenses)
    .set({ settled: 1 })
    .where(eq(expenses.groupId, groupId))
    .run();
}

export async function resetGroup(groupId) {
  return await db.delete(expenses).where(eq(expenses.groupId, groupId)).run();
}

export async function getUserRole(telegramId) {
  const row = await db.select().from(userRoles).where(eq(userRoles.telegramId, telegramId)).get();
  return row ? row.role : 'normal';
}
