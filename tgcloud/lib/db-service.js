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
  const existing = await db
    .select()
    .from(members)
    .where(and(eq(members.telegramId, telegramId), eq(members.groupId, groupId)))
    .get();

  if (!existing) {
    await db.insert(members).values({ telegramId, groupId, name }).run();
  } else if (name && existing.name !== name) {
    await db.update(members).set({ name }).where(eq(members.id, existing.id)).run();
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
