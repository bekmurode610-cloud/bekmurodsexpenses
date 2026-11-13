import { db } from 'sdk';
import { eq, and, desc, gte, lte, asc } from 'sdk/db';
import { groups, members, expenses, userRoles, pendingDeletions, adminSessions } from '../schema.js';
import {
  getUztTimeInfo,
  getDutyRosterList,
  getDutyPerson,
  getActiveDutyPerson,
  formatUzDate,
  formatMinimalDutyNotification,
  getDutyAdminKeyboard,
  getGroupSettings,
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

export async function setGroupExpenseRoster(groupId, rosterList) {
  await db.update(groups).set({ expenseRoster: rosterList }).where(eq(groups.id, groupId)).run();
}

export async function updateGroupSettings(groupId, partialSettings) {
  const grp = await getGroup(groupId);
  if (!grp) return null;
  const current = grp.settings && typeof grp.settings === 'object' ? grp.settings : {};
  const next = { ...current, ...partialSettings };
  await db.update(groups).set({ settings: next }).where(eq(groups.id, groupId)).run();
  return getGroupSettings({ ...grp, settings: next });
}

export async function getAdminSession(userId) {
  let row = await db.select().from(adminSessions).where(eq(adminSessions.userId, userId)).get();
  if (!row) {
    const allGroups = await getAllGroups();
    const defaultGroupId = allGroups.length > 0 ? allGroups[0].id : null;
    await db
      .insert(adminSessions)
      .values({ userId, groupId: defaultGroupId, awaitingInput: null })
      .run();
    row = await db.select().from(adminSessions).where(eq(adminSessions.userId, userId)).get();
  }
  return row;
}

export async function setAdminSession(userId, updates) {
  const existing = await db.select().from(adminSessions).where(eq(adminSessions.userId, userId)).get();
  if (existing) {
    await db
      .update(adminSessions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(adminSessions.userId, userId))
      .run();
  } else {
    await db
      .insert(adminSessions)
      .values({ userId, ...updates })
      .run();
  }
  return await getAdminSession(userId);
}

export async function setGroupDutyTime(groupId, dutyTime) {
  await db.update(groups).set({ dutyTime }).where(eq(groups.id, groupId)).run();
}

export async function setGroupLastDutyDate(groupId, dateStr) {
  await db.update(groups).set({ lastDutyDate: dateStr }).where(eq(groups.id, groupId)).run();
}

export async function setGroupLastDutyDoneDate(groupId, dateStr) {
  await db.update(groups).set({ lastDutyDoneDate: dateStr }).where(eq(groups.id, groupId)).run();
}

export async function shiftGroupDutyOffset(groupId, delta = 1) {
  const grp = await getGroup(groupId);
  const current = grp?.dutyOffset || 0;
  const nextOffset = current + delta;
  await db.update(groups).set({ dutyOffset: nextOffset }).where(eq(groups.id, groupId)).run();
  return nextOffset;
}

export async function setGroupDutyOffset(groupId, offset) {
  await db.update(groups).set({ dutyOffset: offset }).where(eq(groups.id, groupId)).run();
}

export async function swapDutyMembers(groupId, userA, userB) {
  const grp = await getGroup(groupId);
  const mems = await getMembers(groupId);
  const roster = [...getDutyRosterList(grp, mems)];
  if (roster.length < 2) return { error: "Navbatchilar ro'yxatida kamida 2 kishi bo'lishi kerak." };

  const normA = normalizeName(userA);
  const normB = normalizeName(userB);

  const idxA = roster.findIndex((n) => normalizeName(n) === normA);
  const idxB = roster.findIndex((n) => normalizeName(n) === normB);

  if (idxA === -1 || idxB === -1) {
    const missing = [];
    if (idxA === -1) missing.push(userA);
    if (idxB === -1) missing.push(userB);
    return { error: `Topilmadi: ${missing.join(', ')} (navbatchilar ro'yxatida mavjud emas)` };
  }

  const temp = roster[idxA];
  roster[idxA] = roster[idxB];
  roster[idxB] = temp;

  await setGroupDutyRoster(groupId, roster);
  return { roster, userA: roster[idxA], userB: roster[idxB] };
}

export async function assignDutyMember(groupId, user) {
  const grp = await getGroup(groupId);
  const mems = await getMembers(groupId);
  const roster = getDutyRosterList(grp, mems);
  if (!roster || roster.length === 0) return { error: "Navbatchilar ro'yxati bo'sh." };

  const normUser = normalizeName(user);
  const idx = roster.findIndex((n) => normalizeName(n) === normUser);
  if (idx === -1) {
    return { error: `${user} navbatchilar ro'yxatida topilmadi.` };
  }

  await setGroupDutyOffset(groupId, idx);
  return { roster, person: roster[idx], index: idx };
}

export async function checkAndAnnounceDuty(api, group, members, force = false) {
  if (!group) return false;
  const settings = getGroupSettings(group);
  if (!force && !settings.autoDutyEnabled) return false;

  const roster = getDutyRosterList(group, members);
  if (!roster || roster.length === 0) return false;

  const { dateStr, timeStr, nowUzt } = getUztTimeInfo();
  const scheduledTime = group.dutyTime || '09:00';

  if (force || (timeStr >= scheduledTime && group.lastDutyDate !== dateStr)) {
    const isDone = group.lastDutyDoneDate === dateStr;
    const person = getActiveDutyPerson(roster, group.dutyOffset || 0, isDone);
    if (person) {
      try {
        const dateLabel = formatUzDate(nowUzt);
        const msgParams = {
          chat_id: group.id,
          text: formatMinimalDutyNotification(person, dateLabel, isDone, group),
          reply_markup: getDutyAdminKeyboard(isDone),
        };
        const delaySec = isDone ? settings.doneDutyDeleteSeconds : settings.pendingDutyDeleteSeconds;
        if (delaySec > 0) {
          await sendAutoDeleteMessage(api, group.id, msgParams, null, delaySec);
        } else {
          await api.sendMessage(msgParams);
        }
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

  // 2. Check if there is an existing member with the same normalized name/username
  if (name) {
    const allGroupMembers = await getMembers(groupId);
    const normTarget = normalizeName(name);
    const existingByName = allGroupMembers.find(
      (m) => normalizeName(m.name) === normTarget
    );

    if (existingByName) {
      const oldId = existingByName.telegramId;
      await db
        .update(members)
        .set({ telegramId, name })
        .where(eq(members.id, existingByName.id))
        .run();
      if (oldId !== telegramId) {
        await db
          .update(expenses)
          .set({ payerId: telegramId, payerName: name })
          .where(and(eq(expenses.groupId, groupId), eq(expenses.payerId, oldId)))
          .run();
      }
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
  messageId = null,
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
      messageId: messageId || null,
      settled: 0,
    })
    .returning()
    .run();

  return inserted;
}

export async function getExpenseByMessageId(groupId, messageId) {
  if (!messageId) return null;
  return await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), eq(expenses.messageId, messageId)))
    .get();
}

export async function updateExpense(expenseId, updates) {
  return await db.update(expenses).set(updates).where(eq(expenses.id, expenseId)).run();
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

export async function queueMessageDeletion(chatId, messageId, delaySeconds = 120) {
  if (!chatId || !messageId) return;
  const deleteAt = Math.floor(Date.now() / 1000) + delaySeconds;
  await db
    .insert(pendingDeletions)
    .values({
      chatId,
      messageId,
      deleteAt,
    })
    .run();
}

export async function touchMessageDeletion(chatId, messageId, delaySeconds = 120) {
  if (!chatId || !messageId) return;
  const newDeleteAt = Math.floor(Date.now() / 1000) + delaySeconds;
  const existing = await db
    .select()
    .from(pendingDeletions)
    .where(and(eq(pendingDeletions.chatId, chatId), eq(pendingDeletions.messageId, messageId)))
    .get();

  if (existing) {
    await db
      .update(pendingDeletions)
      .set({ deleteAt: newDeleteAt })
      .where(eq(pendingDeletions.id, existing.id))
      .run();
  } else {
    await db
      .insert(pendingDeletions)
      .values({
        chatId,
        messageId,
        deleteAt: newDeleteAt,
      })
      .run();
  }
}

export async function cancelMessageDeletion(chatId, messageId) {
  if (!chatId || !messageId) return;
  await db
    .delete(pendingDeletions)
    .where(and(eq(pendingDeletions.chatId, chatId), eq(pendingDeletions.messageId, messageId)))
    .run();
}

export async function cleanupPendingDeletions(api) {
  if (!api) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const expired = await db
      .select()
      .from(pendingDeletions)
      .where(lte(pendingDeletions.deleteAt, nowSec))
      .limit(50)
      .all();

    if (!expired || expired.length === 0) return 0;

    let deletedCount = 0;
    for (const item of expired) {
      try {
        await api.deleteMessage({
          chat_id: item.chatId,
          message_id: item.messageId,
        });
        deletedCount++;
      } catch (delErr) {
        // Message might already be deleted or bot lacks delete permission
      }
      await db.delete(pendingDeletions).where(eq(pendingDeletions.id, item.id)).run();
    }
    return deletedCount;
  } catch (err) {
    console.warn('Error in cleanupPendingDeletions:', err?.message || err);
    return 0;
  }
}

export async function sendAutoDeleteMessage(
  api,
  chatId,
  msgParams,
  userMsgId = null,
  delaySeconds = 120,
  deleteUserMsg = true
) {
  const sent = await api.sendMessage(msgParams);
  // Auto-deletion timer applies to group chats (chatId < 0)
  if (chatId < 0) {
    if (sent?.message_id && delaySeconds > 0) {
      await queueMessageDeletion(chatId, sent.message_id, delaySeconds);
      if (typeof setTimeout !== 'undefined') {
        setTimeout(async () => {
          try {
            await api.deleteMessage({ chat_id: chatId, message_id: sent.message_id });
            await db
              .delete(pendingDeletions)
              .where(and(eq(pendingDeletions.chatId, chatId), eq(pendingDeletions.messageId, sent.message_id)))
              .run();
          } catch (_) {}
        }, delaySeconds * 1000);
      }
    }

    if (userMsgId && deleteUserMsg) {
      const userDelay = delaySeconds > 0 ? delaySeconds : 120;
      await queueMessageDeletion(chatId, userMsgId, userDelay);
      if (typeof setTimeout !== 'undefined') {
        setTimeout(async () => {
          try {
            await api.deleteMessage({ chat_id: chatId, message_id: userMsgId });
            await db
              .delete(pendingDeletions)
              .where(and(eq(pendingDeletions.chatId, chatId), eq(pendingDeletions.messageId, userMsgId)))
              .run();
          } catch (_) {}
        }, userDelay * 1000);
      }
    }
  }
  return sent;
}
