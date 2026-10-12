import { api } from 'sdk';
import { getExpense, deleteExpense, settleGroup, resetGroup } from '../lib/db-service.js';
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
      text: 'Deleted: Expense deleted.',
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Expense deleted.' });
    return;
  }

  if (data === 'confirm_settle') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Only group admins can settle the debts.',
        show_alert: true,
      });
      return;
    }

    await settleGroup(chatId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'Success: All debts have been marked as settled. The current balance is now 0.',
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
      text: 'Success: All expense records for this group have been deleted.',
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Group reset.' });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: cbId });
}
