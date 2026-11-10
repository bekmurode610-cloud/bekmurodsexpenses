import { api } from 'sdk';
import {
  getExpense,
  deleteExpense,
  settleGroup,
  resetGroup,
  getMembers,
  getGroup,
  shiftGroupDutyOffset,
  setGroupDutyOffset,
  setGroupLastDutyDoneDate,
} from '../lib/db-service.js';
import {
  getDutyRosterList,
  getDutyPerson,
  formatUzDate,
  formatMinimalDutyNotification,
  getUztTimeInfo,
} from '../lib/settlement.js';
import { isCreatorOrAdmin } from '../lib/auth.js';

export default async function (callbackQuery, ctx) {
  if (!callbackQuery) return;

  const data = callbackQuery.data;
  const cbId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const userId = callbackQuery.from?.id;
  const username = callbackQuery.from?.username;

  if (!chatId || !messageId) {
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (data === 'cancel_action') {
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'Action canceled.',
    });
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // Admin confirmation of duty
  if (data === 'duty_confirm') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Only admin can confirm duty.',
        show_alert: true,
      });
      return;
    }

    const { dateStr, nowUzt } = getUztTimeInfo();
    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const roster = getDutyRosterList(grp, mems);
    if (!roster || roster.length === 0) {
      await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Roster empty' });
      return;
    }

    const k = roster.length;
    const currentOffset = grp?.dutyOffset || 0;
    const person = roster[((currentOffset % k) + k) % k];

    // 1. Mark done for today
    await setGroupLastDutyDoneDate(chatId, dateStr);

    // 2. Advance rotation to the next person!
    const nextOffset = (currentOffset + 1) % k;
    await setGroupDutyOffset(chatId, nextOffset);

    // 3. Edit message in-place with date
    const dateLabel = formatUzDate(nowUzt);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatMinimalDutyNotification(person, dateLabel, true),
    });

    await api.answerCallbackQuery({
      callback_query_id: cbId,
      text: `Bajarildi. Keyingi navbat: ${roster[nextOffset]}`,
    });
    return;
  }

  // Admin skipping/shifting duty
  if (data === 'duty_next') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Only admin can change duty.',
        show_alert: true,
      });
      return;
    }

    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const roster = getDutyRosterList(grp, mems);
    if (!roster || roster.length === 0) return;
    const k = roster.length;
    const current = grp?.dutyOffset || 0;
    const nextOffset = (current + 1) % k;
    await setGroupDutyOffset(chatId, nextOffset);

    const { nowUzt } = getUztTimeInfo();
    const person = roster[nextOffset];
    const dateLabel = formatUzDate(nowUzt);

    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatMinimalDutyNotification(person, dateLabel, false),
      reply_markup: {
        inline_keyboard: [[{ text: 'Done', callback_data: 'duty_confirm' }]],
      },
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: `Shifted to ${person}` });
    return;
  }

  if (data.startsWith('del_exp_')) {
    const expId = parseInt(data.replace('del_exp_', ''), 10);
    const expense = await getExpense(expId);

    if (!expense) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: 'Expense not found or already deleted.',
      });
      await api.answerCallbackQuery({ callback_query_id: cbId });
      return;
    }

    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (expense.payerId !== userId && !isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'You are not authorized to delete this.',
        show_alert: true,
      });
      return;
    }

    await deleteExpense(expId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'Expense deleted.',
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Expense deleted.' });
    return;
  }

  if (data === 'confirm_settle') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Only group admins can settle debts.',
        show_alert: true,
      });
      return;
    }

    await settleGroup(chatId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'All debts marked as settled. Current balance is now 0.',
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Settled!' });
    return;
  }

  if (data === 'confirm_reset') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Only group admins can reset the group.',
        show_alert: true,
      });
      return;
    }

    await resetGroup(chatId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'All expense records for this group have been deleted.',
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Group reset.' });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: cbId });
}
