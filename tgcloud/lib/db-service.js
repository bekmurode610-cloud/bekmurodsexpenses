import { db } from 'sdk';
import { eq, and, desc, gte, lte, asc } from 'sdk/db';
import { groups, members, expenses, userRoles } from '../schema.js';
import {
  getUztTimeInfo,
  getDutyRosterList,
  getDutyPerson,
  formatMinimalDutyNotification,
} from './settlement.js';

function normalizeName(str) {
  return (str || '').trim().replace(/^@/, '').toLowerCase();
}

export async function addOrUpdateGroup(groupId, groupName) {
  const existing = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!existing) {
    await db
      .insert(groups)
      .values({
        id: groupId,
        groupName: groupName || 'Group',
        dutyOffset: 0,
        dutyTime: '09:00',
      })
      .run();
  } else if (existing.groupName === 'Group' && groupName && groupName !== 'Group') {
    await db.update(groups).set({ groupName }).where(eq(groups.id, groupId)).run();
  }
}

export async function getGroup(groupId) {
  return await db.select().from(groups).where(eq(groups.id, groupId)).get();
}

export async function getAllGroups() {
  return await db.select().from(groups).all();
}

export async function setGroupDutyRoster(groupId, rosterList) {
  await db.update(groups).set({ dutyRoster: rosterList }).where(eq(groups.id, groupId)).run();
}

export async function setGroupDutyTime(groupId, dutyTime) {
  await db.update(groups).set({ dutyTime }).where(eq(groups.id, groupId)).run();
}

export async function setGroupLastDutyDate(groupId, dateStr) {
  await db.update(groups).set({ lastDutyDate: dateStr }).where(eq(groups.id, groupId)).run();
}

export async function shiftGroupDutyOffset(groupId, delta = 1) {
  const grp = await getGroup(groupId);
  const current = grp?.dutyOffset || 0;
  const nextOffset = current + delta;
  await db.update(groups).set({ dutyOffset: nextOffset }).where(eq(groups.id, groupId)).run();
  return nextOffset;
}

export async function checkAndAnnounceDuty(api, group, members, force = false) {
  if (!group) return false;
  const roster = getDutyRosterList(group, members);
  if (!roster || roster.length === 0) return false;

  const { dateStr, timeStr } = getUztTimeInfo();
  const scheduledTime = group.dutyTime || '09:00';

  if (force || (timeStr >= scheduledTime && group.lastDutyDate !== dateStr)) {
    const person = getDutyPerson(roster, group.dutyOffset || 0, 0);
    if (person) {
      try {
        await api.sendMessage({
          chat_id: group.id,
          text: formatMinimalDutyNotification(person),
        });
        await setGroupLastDutyDate(group.id, dateStr);
        return true;
      } catch (err) {
        console.error('Error sending duty announcement:', err);
        return false;
      }
    }
  }
  return false;
}

export async function ensureMember(telegramId, groupId, name, groupName) {
  await addOrUpdateGroup(groupId, groupName);

  // 1. Check if member exists by real telegramId
  const existingById = await db
    .select()
    .from(members)
    .where(and(eq(members.telegramId, telegramId), eq(members.groupId, groupId)))
    .get();

  if (existingById) {
    if (name && existingById.name !== name) {
      await db.update(members).set({ name }).where(eq(members.id, existingById.id)).run();
    }
    return;
  }

  // 2. Check if there is a placeholder member (telegramId < 0) with the same normalized name/username
  if (name) {
    const allGroupMembers = await getMembers(groupId);
    const normTarget = normalizeName(name);
    const placeholder = allGroupMembers.find(
      (m) => m.telegramId < 0 && normalizeName(m.name) === normTarget
    );

    if (placeholder) {
      const oldId = placeholder.telegramId;
      await db
        .update(members)
        .set({ telegramId, name })
        .where(eq(members.id, placeholder.id))
        .run();
      await db
        .update(expenses)
        .set({ payerId: telegramId, payerName: name })
        .where(and(eq(expenses.groupId, groupId), eq(expenses.payerId, oldId)))
        .run();
      return;
    }
  }

  await db.insert(members).values({ telegramId, groupId, name, dutyOrder: 0 }).run();
}

export async function addMemberByName(groupId, name, groupName) {
  await addOrUpdateGroup(groupId, groupName);
  const cleanName = name.trim();
  const normTarget = normalizeName(cleanName);

  const allGroupMembers = await getMembers(groupId);
  const existing = allGroupMembers.find((m) => normalizeName(m.name) === normTarget);

  if (!existing) {
    const placeholderId = -(Math.floor(Date.now() % 1000000000) + Math.floor(Math.random() * 1000));
    await db
      .insert(members)
      .values({ telegramId: placeholderId, groupId, name: cleanName, dutyOrder: allGroupMembers.length })
      .run();
    return true;
  }
  return false;
}

export async function removeMemberByName(groupId, name) {
  const normTarget = normalizeName(name);
  if (!normTarget) return null;

  const allGroupMembers = await getMembers(groupId);
  const target = allGroupMembers.find((m) => normalizeName(m.name) === normTarget);
  if (!target) return null;

  await db.delete(members).where(eq(members.id, target.id)).run();
  return target.name;
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
  return await db
    .select()
    .from(members)
    .where(eq(members.groupId, groupId))
    .orderBy(asc(members.dutyOrder), asc(members.id))
    .all();
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

export async function getExpenses(
  groupId,
  { limit = 50, includeSettled = true, startDate, endDate } = {}
) {
  const query = db.select().from(expenses);
  const conditions = [eq(expenses.groupId, groupId)];

  if (!includeSettled) {
    conditions.push(eq(expenses.settled, 0));
  }
  if (startDate !== undefined && startDate !== null) {
    const startSec =
      startDate instanceof Date ? Math.floor(startDate.getTime() / 1000) : Number(startDate);
    conditions.push(gte(expenses.createdAt, startSec));
  }
  if (endDate !== undefined && endDate !== null) {
    const endSec =
      endDate instanceof Date ? Math.floor(endDate.getTime() / 1000) : Number(endDate);
    conditions.push(lte(expenses.createdAt, endSec));
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
  return await db.update(expenses).set({ settled: 1 }).where(eq(expenses.groupId, groupId)).run();
}

export async function resetGroup(groupId) {
  return await db.delete(expenses).where(eq(expenses.groupId, groupId)).run();
}

export async function getUserRole(telegramId) {
  const row = await db.select().from(userRoles).where(eq(userRoles.telegramId, telegramId)).get();
  return row ? row.role : 'normal';
}
