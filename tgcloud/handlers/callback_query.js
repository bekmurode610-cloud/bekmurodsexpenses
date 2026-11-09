import { api } from 'sdk';
import {
  getExpense,
  deleteExpense,
  settleGroup,
  resetGroup,
  getMembers,
  getGroup,
  shiftGroupDutyOffset,
} from '../lib/db-service.js';
import { getDutySchedule, getDutyRosterList, getDutyPerson } from '../lib/settlement.js';
import { isCreatorOrAdmin } from '../lib/auth.js';
import { formatDutyMessage } from './message.js';

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

  if (data === 'duty_next') {
    await shiftGroupDutyOffset(chatId, 1);
    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const roster = getDutyRosterList(grp, mems);
    const person = getDutyPerson(roster, grp?.dutyOffset || 0, 0);

    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `Duty: ${person}`,
      reply_markup:
        roster.length > 1
          ? {
              inline_keyboard: [
                [
                  { text: 'Next (Skip)', callback_data: 'duty_next' },
                  { text: 'Full Schedule', callback_data: 'duty_schedule' },
                ],
              ],
            }
          : undefined,
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: `Shifted to ${person}` });
    return;
  }

  if (data === 'duty_schedule') {
    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const schedule = getDutySchedule(grp, mems, 7);

    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatDutyMessage(schedule, grp),
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Next (Skip)', callback_data: 'duty_next' },
            { text: 'Back', callback_data: 'duty_minimal' },
          ],
        ],
      },
    });
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (data === 'duty_minimal') {
    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const roster = getDutyRosterList(grp, mems);
    const person = getDutyPerson(roster, grp?.dutyOffset || 0, 0);

    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `Duty: ${person}`,
      reply_markup:
        roster.length > 1
          ? {
              inline_keyboard: [
                [
                  { text: 'Next (Skip)', callback_data: 'duty_next' },
                  { text: 'Full Schedule', callback_data: 'duty_schedule' },
                ],
              ],
            }
          : undefined,
    });
    await api.answerCallbackQuery({ callback_query_id: cbId });
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
