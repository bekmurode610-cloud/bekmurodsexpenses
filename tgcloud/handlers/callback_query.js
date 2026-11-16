import { api } from 'sdk';
import {
  getExpense,
  getExpenses,
  deleteExpense,
  settleGroup,
  resetGroup,
  getMembers,
  getGroup,
  setGroupDutyOffset,
  setGroupLastDutyDoneDate,
  touchMessageDeletion,
  cancelMessageDeletion,
  cleanupPendingDeletions,
  syncGroupWeeklyReports,
} from '../lib/db-service.js';
import {
  getDutyRosterList,
  getActiveDutyPerson,
  formatUzDate,
  formatMinimalDutyNotification,
  getUztTimeInfo,
  getGroupSettings,
  buildDetailReportText,
  buildExpensesByMemberText,
  buildExpensesByTimeText,
  formatWeeklyHistoryText,
  buildWeekReportKeyboard,
  buildWeeklyHistoryKeyboard,
  getWeekRangeFromStart,
} from '../lib/settlement.js';
import { isCreatorOrAdmin } from '../lib/auth.js';
import { handleAdminCallback } from '../lib/admin-panel.js';
import { handleIndividualCallback } from '../lib/individual-panel.js';

export function getDutyAdminKeyboard(isDone) {
  if (isDone) {
    return {
      inline_keyboard: [[{ text: 'Undo', callback_data: 'duty_undone' }]],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: '⬅️', callback_data: 'duty_prev' },
        { text: 'Done', callback_data: 'duty_confirm' },
        { text: '➡️', callback_data: 'duty_next' },
      ],
    ],
  };
}

export default async function (callbackQuery, ctx) {
  if (!callbackQuery) return;

  // Sweep expired messages
  await cleanupPendingDeletions(api);

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

  // Individual Personal Mode callbacks
  if (data && data.startsWith('ind:')) {
    await handleIndividualCallback(api, callbackQuery);
    return;
  }

  // Private Admin Panel callbacks
  if (data && data.startsWith('adm:')) {
    await handleAdminCallback(api, callbackQuery);
    return;
  }

  const groupRow = chatId < 0 ? await getGroup(chatId) : null;
  const groupSettings = getGroupSettings(groupRow);

  // Refresh timer on non-duty interaction with message in group chat
  if (chatId < 0 && !data?.startsWith('duty_') && groupSettings.generalDeleteSeconds > 0) {
    await touchMessageDeletion(chatId, messageId, groupSettings.generalDeleteSeconds);
  }

  if (data === 'cancel_action') {
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'Bekor qilindi.',
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
        text: 'Faqat admin tasdiqlashi mumkin.',
        show_alert: true,
      });
      return;
    }

    const { dateStr, nowUzt } = getUztTimeInfo();
    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const roster = getDutyRosterList(grp, mems);
    if (!roster || roster.length === 0) {
      await api.answerCallbackQuery({ callback_query_id: cbId, text: "Ro'yxat bo'sh" });
      return;
    }

    const k = roster.length;
    const currentOffset = grp?.dutyOffset || 0;
    const dateLabel = formatUzDate(nowUzt);

    // Guard against double confirmation on the same day
    if (grp?.lastDutyDoneDate === dateStr) {
      const donePerson = getActiveDutyPerson(roster, currentOffset, true);
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: formatMinimalDutyNotification(donePerson, dateLabel, true, grp),
        reply_markup: getDutyAdminKeyboard(true),
      });
      if (chatId < 0) {
        if (groupSettings.doneDutyDeleteSeconds > 0) {
          await touchMessageDeletion(chatId, messageId, groupSettings.doneDutyDeleteSeconds);
        } else {
          await cancelMessageDeletion(chatId, messageId);
        }
      }
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Bugungi navbatchilik allaqachon tasdiqlangan.',
      });
      return;
    }

    const person = roster[((currentOffset % k) + k) % k];

    // 1. Mark done for today
    await setGroupLastDutyDoneDate(chatId, dateStr);

    // 2. Advance rotation to the next person
    const nextOffset = (currentOffset + 1) % k;
    await setGroupDutyOffset(chatId, nextOffset);

    // 3. Edit message in-place with Undo button & schedule configured deletion timer
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatMinimalDutyNotification(person, dateLabel, true, grp),
      reply_markup: getDutyAdminKeyboard(true),
    });
    if (chatId < 0) {
      if (groupSettings.doneDutyDeleteSeconds > 0) {
        await touchMessageDeletion(chatId, messageId, groupSettings.doneDutyDeleteSeconds);
      } else {
        await cancelMessageDeletion(chatId, messageId);
      }
    }

    await api.answerCallbackQuery({
      callback_query_id: cbId,
      text: `Bajarildi! Keyingi: ${roster[nextOffset]}`,
    });
    return;
  }

  // Admin undoing confirmation of duty
  if (data === 'duty_undone') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Faqat admin bekor qilishi mumkin.',
        show_alert: true,
      });
      return;
    }

    const { dateStr, nowUzt } = getUztTimeInfo();
    const grp = await getGroup(chatId);
    const mems = await getMembers(chatId);
    const roster = getDutyRosterList(grp, mems);
    if (!roster || roster.length === 0) {
      await api.answerCallbackQuery({ callback_query_id: cbId, text: "Ro'yxat bo'sh" });
      return;
    }

    const k = roster.length;
    const currentOffset = grp?.dutyOffset || 0;
    const dateLabel = formatUzDate(nowUzt);

    // Guard against double-undo if today wasn't marked done
    let targetOffset = ((currentOffset % k) + k) % k;
    if (grp?.lastDutyDoneDate === dateStr) {
      targetOffset = ((currentOffset - 1) % k + k) % k;
      await setGroupDutyOffset(chatId, targetOffset);
      await setGroupLastDutyDoneDate(chatId, null);
    }

    const person = roster[targetOffset];

    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatMinimalDutyNotification(person, dateLabel, false, grp),
      reply_markup: getDutyAdminKeyboard(false),
    });
    if (chatId < 0) {
      if (groupSettings.pendingDutyDeleteSeconds > 0) {
        await touchMessageDeletion(chatId, messageId, groupSettings.pendingDutyDeleteSeconds);
      } else {
        await cancelMessageDeletion(chatId, messageId);
      }
    }

    await api.answerCallbackQuery({
      callback_query_id: cbId,
      text: `Bekor qilindi. Navbatchi: ${person}`,
    });
    return;
  }

  // Admin shifting duty backward or forward
  if (data === 'duty_next' || data === 'duty_prev') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: "Faqat admin navbatni o'zgartirishi mumkin.",
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
    const delta = data === 'duty_next' ? 1 : -1;
    const newOffset = ((current + delta) % k + k) % k;

    await setGroupDutyOffset(chatId, newOffset);
    await setGroupLastDutyDoneDate(chatId, null);

    const { nowUzt } = getUztTimeInfo();
    const person = roster[newOffset];
    const dateLabel = formatUzDate(nowUzt);

    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: formatMinimalDutyNotification(person, dateLabel, false, grp),
      reply_markup: getDutyAdminKeyboard(false),
    });
    if (chatId < 0) {
      if (groupSettings.pendingDutyDeleteSeconds > 0) {
        await touchMessageDeletion(chatId, messageId, groupSettings.pendingDutyDeleteSeconds);
      } else {
        await cancelMessageDeletion(chatId, messageId);
      }
    }
    await api.answerCallbackQuery({ callback_query_id: cbId, text: `Navbatchi: ${person}` });
    return;
  }

  if (data.startsWith('del_exp_')) {
    const expId = parseInt(data.replace('del_exp_', ''), 10);
    const expense = await getExpense(expId);

    if (!expense) {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: "Xarajat topilmadi yoki allaqachon o'chirilgan.",
      });
      await api.answerCallbackQuery({ callback_query_id: cbId });
      return;
    }

    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (expense.payerId !== userId && !isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: "Faqat o'z xarajatingizni o'chira olasiz.",
        show_alert: true,
      });
      return;
    }

    await deleteExpense(expId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: "Xarajat o'chirildi.",
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: "O'chirildi" });
    return;
  }

  if (
    data === 'wk:list' ||
    (data && (data.startsWith('wk:show:') || data.startsWith('wk:mem:') || data.startsWith('wk:time:')))
  ) {
    const savedReports = await syncGroupWeeklyReports(chatId);
    let nextText;
    let nextMarkup;

    if (data === 'wk:list') {
      nextText = formatWeeklyHistoryText(savedReports);
      nextMarkup = buildWeeklyHistoryKeyboard(savedReports);
    } else {
      const mems = await getMembers(chatId);
      const allExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: true });
      const grp = await getGroup(chatId);

      if (data.startsWith('wk:mem:')) {
        const targetWeekStart = data.replace('wk:mem:', '').trim();
        nextText = buildExpensesByMemberText(mems, allExpenses, targetWeekStart);
        nextMarkup = buildWeekReportKeyboard(allExpenses, savedReports, targetWeekStart, 'mem');
      } else if (data.startsWith('wk:time:')) {
        const targetWeekStart = data.replace('wk:time:', '').trim();
        nextText = buildExpensesByTimeText(mems, allExpenses, targetWeekStart);
        nextMarkup = buildWeekReportKeyboard(allExpenses, savedReports, targetWeekStart, 'time');
      } else {
        const targetWeekStart = data.replace('wk:show:', '').trim();
        nextText = buildDetailReportText(mems, allExpenses, grp, {
          weekStart: targetWeekStart,
          savedReports,
        });
        nextMarkup = buildWeekReportKeyboard(allExpenses, savedReports, targetWeekStart, 'summary');
      }
    }

    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: nextText,
        parse_mode: 'HTML',
        reply_markup: nextMarkup,
      });
    } catch (err) {
      if (!String(err?.description || err?.message || '').includes('message is not modified')) {
        throw err;
      }
    }
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (data === 'confirm_settle' || (data && data.startsWith('confirm_settle:'))) {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: 'Faqat admin qarzlarni nollashi mumkin.',
        show_alert: true,
      });
      return;
    }

    const explicitWeekStart = data.includes(':') ? data.split(':')[1] : null;
    const res = await settleGroup(chatId, explicitWeekStart);
    const weekLabel = res?.weekStart ? getWeekRangeFromStart(res.weekStart).label : 'Joriy hafta';
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `${weekLabel} hisob-kitoblari nollandi va arxivlandi (${res?.settledCount || 0} ta xarajat). Yangi hafta alohida saqlanadi.`,
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Nollandi!' });
    return;
  }

  if (data === 'confirm_reset') {
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await api.answerCallbackQuery({
        callback_query_id: cbId,
        text: "Faqat admin xarajatlarni o'chirishi mumkin.",
        show_alert: true,
      });
      return;
    }

    await resetGroup(chatId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: "Barcha xarajatlar butunlay o'chirildi.",
    });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: "O'chirildi!" });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: cbId });
}
