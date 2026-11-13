import { api } from 'sdk';
import {
  ensureMember,
  getMembers,
  addExpense,
  getExpenses,
  getExpense,
  addMemberByName,
  syncChatAdmins,
  getGroup,
  swapDutyMembers,
  setGroupDutyRoster,
  setGroupExpenseRoster,
  setGroupDutyTime,
  setGroupLastDutyDate,
  checkAndAnnounceDuty,
  sendAutoDeleteMessage,
  cleanupPendingDeletions,
  queueMessageDeletion,
} from '../lib/db-service.js';
import {
  calculateBalances,
  getDutySchedule,
  getDutyRosterList,
  getExpenseRosterList,
  getActiveDutyPerson,
  formatUzDate,
  formatMinimalDutyNotification,
  getDutyAdminKeyboard,
  getUztTimeInfo,
  getGroupSettings,
  buildDetailReportText,
} from '../lib/settlement.js';
import { isAllowed, isCreatorOrAdmin } from '../lib/auth.js';
import { formatMoney, parseExpenseInput } from '../lib/format.js';
import { handleAdminPrivateMessage } from '../lib/admin-panel.js';

function buildMemberNameMap(groupMembers, expensesList = []) {
  const map = new Map();
  for (const exp of expensesList) {
    if (exp.payerId && exp.payerName) {
      map.set(Number(exp.payerId), exp.payerName);
    }
  }
  for (const m of groupMembers) {
    map.set(Number(m.telegramId), m.name);
  }
  return map;
}

export function formatDutyMessage(schedule, group) {
  if (!schedule || schedule.length === 0) {
    return "Navbatchi ro'yxati belgilanmagan.";
  }

  const today = schedule[0];
  const tomorrow = schedule[1];
  const dutyTime = group?.dutyTime || '09:00';
  const { dutyTasks } = getGroupSettings(group);
  const tasksText = dutyTasks.map((t) => `• ${t}`).join('\n');

  let resp = `Navbatchi (${today.dateLabel}): ${today.name}${today.isDone ? ' (Done)' : ''}\n\n`;
  if (tasksText) {
    resp += `Vazifalar:\n${tasksText}\n\n`;
  }
  if (tomorrow) {
    resp += `Keyingi navbat: ${tomorrow.name}\n`;
  }
  resp += `Vaqt: ${dutyTime} (UZT)\n\n`;

  resp += 'Navbatchilik ketma-ketligi:\n';
  for (const item of schedule) {
    const tag = item.dayOffset === 0 ? (item.isDone ? ' (Bugun, Done)' : ' (Bugun)') : '';
    resp += `${item.dateLabel}: ${item.name}${tag}\n`;
  }

  return resp.trim();
}

export default async function (message, ctx) {
  if (!message || !message.text) return;

  // Sweep expired messages on incoming message
  await cleanupPendingDeletions(api);

  const text = message.text.trim();
  const chatId = message.chat.id;
  const isPrivate = message.chat.type === 'private';
  const userId = message.from?.id;
  const username = message.from?.username;
  const displayName = username
    ? `@${username}`
    : [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'User';

  if (!userId || !(await isAllowed(userId))) {
    return;
  }

  // 1. Private chat handling — Bot Admin Control Center
  if (isPrivate) {
    await handleAdminPrivateMessage(api, message);
    return;
  }

  // Record/ensure group exists first so settings are always available
  const existingGroup = await getGroup(chatId);
  const groupSettings = getGroupSettings(existingGroup);

  const sendReply = async (params) => {
    return await sendAutoDeleteMessage(
      api,
      chatId,
      params,
      message.message_id,
      groupSettings.generalDeleteSeconds,
      groupSettings.deleteUserCommand
    );
  };

  const isStarExpense = text.startsWith('*');
  const isCommand = text.startsWith('/');

  // Passive daily duty check if not yet announced today (skip for duty configuration/trigger commands)
  const lowerText = text.toLowerCase();
  const isDutyCommand =
    lowerText.startsWith('/setdutytime') ||
    lowerText.startsWith('/setduty') ||
    lowerText.startsWith('/duty') ||
    lowerText.startsWith('/navbatchi');

  if (!isDutyCommand && existingGroup && groupSettings.autoDutyEnabled) {
    const { dateStr, timeStr } = getUztTimeInfo();
    const scheduledTime = existingGroup.dutyTime || '09:00';
    if (timeStr >= scheduledTime && existingGroup.lastDutyDate !== dateStr) {
      const currentMembers = await getMembers(chatId);
      await checkAndAnnounceDuty(api, existingGroup, currentMembers);
    }
  }

  // Ignore regular chat messages that are neither expenses nor bot commands
  if (!isStarExpense && !isCommand) {
    return;
  }

  // Record member activity when interacting with the bot
  await ensureMember(userId, chatId, displayName, message.chat.title || 'Group');

  // 2. Expense entry: starts with '*'
  if (isStarExpense) {
    if (groupSettings.disabledCommands.includes('*')) {
      return;
    }
    if (groupSettings.adminOnlyCommands.includes('*')) {
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await sendReply({ chat_id: chatId, text: "Xarajat qo'shish faqat guruh adminlari uchun." });
        return;
      }
    }
    const cleanText = text.slice(1);
    const parsed = parseExpenseInput(cleanText);
    if (!parsed) {
      return;
    }

    try {
      const { amount, currency, description } = parsed;

      await addExpense({
        groupId: chatId,
        payerId: userId,
        payerName: displayName,
        amount,
        currency,
        description,
        messageId: message.message_id,
        groupName: message.chat.title || 'Group',
      });

      if (message.message_id) {
        try {
          await api.setMessageReaction({
            chat_id: chatId,
            message_id: message.message_id,
            reaction: [{ type: 'emoji', emoji: '👍' }],
          });
        } catch (reactErr) {
          await sendReply({
            chat_id: chatId,
            text: `Qo'shildi: ${formatMoney(amount, currency)} - ${description}`,
            reply_parameters: { message_id: message.message_id },
          });
        }
      }
    } catch (err) {
      console.error('Error adding expense:', err);
    }
    return;
  }

  // 3. Command handling
  const command = text.split(/\s+/)[0].toLowerCase().split('@')[0];
  const cmdKey = command === '/navbatchi' ? '/duty' : command === '/start' ? '/help' : command;

  if (groupSettings.disabledCommands.includes(cmdKey)) {
    return;
  }

  if (groupSettings.adminOnlyCommands.includes(cmdKey)) {
    await syncChatAdmins(api, chatId, message.chat.title || 'Group');
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (!isAdmin) {
      await sendReply({
        chat_id: chatId,
        text: 'Bu buyruq faqat guruh adminlari uchun.',
      });
      return;
    }
  }

  switch (command) {
    case '/start':
    case '/help': {
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);

      let helpText =
        'Xarajat kiritish:\n' +
        '* 40 ming nonga\n' +
        '* 2 ta non 10 ming\n\n' +
        'Buyruqlar:\n' +
        '/expenses - Yaqindagi xarajatlar\n' +
        "/duty - Bugungi navbatchi\n" +
        "/detail - To'liq hisobot\n" +
        "/members - A'zolar ro'yxati";

      if (isAdmin) {
        helpText +=
          '\n\nAdmin buyruqlari:\n' +
          "/setmembers @u1 @u2 - Xarajat a'zolarini belgilash\n" +
          '/setduty @u1 @u2 - Navbatchilarni kiritish\n' +
          '/setdutytime 09:00 - Eslatma vaqtini sozlash\n' +
          '/settle - Qarzlarni nollash\n' +
          "/reset - Xarajatlarni o'chirish";
      }

      await sendReply({
        chat_id: chatId,
        text: helpText,
      });
      break;
    }

    case '/members': {
      const grp = await getGroup(chatId);
      const roster = getExpenseRosterList(grp);

      if (roster && roster.length > 0) {
        let resp = "A'zolar:\n";
        roster.forEach((name, idx) => {
          resp += `${idx + 1}. ${name}\n`;
        });
        await sendReply({
          chat_id: chatId,
          text: resp.trim(),
        });
        return;
      }

      const allMembers = await getMembers(chatId);
      if (!allMembers || allMembers.length === 0) {
        await sendReply({
          chat_id: chatId,
          text: "A'zolar ro'yxati bo'sh. Admin: /setmembers @user1 @user2",
        });
        return;
      }

      let resp = "A'zolar:\n";
      allMembers.forEach((m, idx) => {
        resp += `${idx + 1}. ${m.name}\n`;
      });

      await sendReply({
        chat_id: chatId,
        text: resp.trim(),
      });
      break;
    }

    case '/setmembers': {
      const rawParts = text.split(/\s+/).slice(1);
      if (rawParts.length === 0) {
        await sendReply({
          chat_id: chatId,
          text: 'Namuna: /setmembers @user1 @user2 @user3',
        });
        return;
      }

      if (rawParts[0].toLowerCase() === 'clear' || rawParts[0].toLowerCase() === 'reset') {
        await setGroupExpenseRoster(chatId, null);
        await sendReply({
          chat_id: chatId,
          text: "Xarajat a'zolari ro'yxati tozalandi.",
        });
        return;
      }

      const roster = rawParts
        .map((p) => p.replace(/,/g, '').trim())
        .filter(Boolean);
      await setGroupExpenseRoster(chatId, roster);
      for (const name of roster) {
        await addMemberByName(chatId, name, message.chat.title || 'Group');
      }

      await sendReply({
        chat_id: chatId,
        text: `A'zolar ro'yxati saqlandi: ${roster.join(', ')}`,
      });
      break;
    }

    case '/setduty': {
      const parts = text.split(/\s+/).slice(1).map((p) => p.replace(/,/g, '').trim()).filter(Boolean);
      if (parts.length === 0) {
        await sendReply({
          chat_id: chatId,
          text: 'Namuna: /setduty @user1 @user2 @user3',
        });
        return;
      }

      await setGroupDutyRoster(chatId, parts);
      await sendReply({
        chat_id: chatId,
        text: `Navbatchi ro'yxati: ${parts.join(', ')}`,
      });
      break;
    }

    case '/setdutytime': {
      const timeArg = text.split(/\s+/)[1];
      if (!timeArg || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeArg)) {
        await sendReply({
          chat_id: chatId,
          text: 'Namuna: /setdutytime 09:00',
        });
        return;
      }

      await setGroupDutyTime(chatId, timeArg);
      await setGroupLastDutyDate(chatId, null);
      await sendReply({
        chat_id: chatId,
        text: `Eslatma vaqti: ${timeArg} (UZT)`,
      });
      break;
    }

    case '/duty':
    case '/navbatchi': {
      const rawArgs = text.split(/\s+/).slice(1);
      const sub = (rawArgs[0] || '').toLowerCase();

      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);

      if (sub === 'swap' || sub === 'almash') {
        if (!isAdmin) {
          await sendReply({ chat_id: chatId, text: "Faqat admin navbatni almashtirishi mumkin." });
          return;
        }
        const u1 = rawArgs[1];
        const u2 = rawArgs[2];
        if (!u1 || !u2) {
          await sendReply({ chat_id: chatId, text: 'Namuna: /duty swap @user1 @user2' });
          return;
        }
        const res = await swapDutyMembers(chatId, u1, u2);
        if (res?.error) {
          await sendReply({ chat_id: chatId, text: res.error });
          return;
        }
        await sendReply({
          chat_id: chatId,
          text: `O'rin almashtirildi: ${res.userA} ↔ ${res.userB}\nRo'yxat: ${res.roster.join(', ')}`,
        });
        return;
      }

      const grp = await getGroup(chatId);
      const mems = await getMembers(chatId);
      const roster = getDutyRosterList(grp, mems);

      if (!roster || roster.length === 0) {
        await sendReply({
          chat_id: chatId,
          text: "Navbatchi ro'yxati belgilanmagan. Admin: /setduty @user1 @user2",
        });
        return;
      }

      if (sub === 'list' || sub === 'schedule') {
        const schedule = getDutySchedule(grp, mems, 7);
        await sendReply({
          chat_id: chatId,
          text: formatDutyMessage(schedule, grp),
        });
        return;
      }

      const { dateStr, nowUzt } = getUztTimeInfo();
      const isDone = grp?.lastDutyDoneDate === dateStr;
      const currentOffset = grp?.dutyOffset || 0;
      const activePerson = getActiveDutyPerson(roster, currentOffset, isDone);
      const dateLabel = formatUzDate(nowUzt);

      const reply_markup = isAdmin ? getDutyAdminKeyboard(isDone) : undefined;

      if (chatId < 0 && message.message_id && groupSettings.deleteUserCommand) {
        await queueMessageDeletion(chatId, message.message_id, 120);
      }
      const dutyMsgParams = {
        chat_id: chatId,
        text: formatMinimalDutyNotification(activePerson, dateLabel, isDone, grp),
        reply_markup,
      };
      const dutyDelay = isDone ? groupSettings.doneDutyDeleteSeconds : groupSettings.pendingDutyDeleteSeconds;
      if (dutyDelay > 0) {
        await sendAutoDeleteMessage(api, chatId, dutyMsgParams, null, dutyDelay);
      } else {
        await api.sendMessage(dutyMsgParams);
      }
      break;
    }

    case '/detail': {
      const groupMembers = await getMembers(chatId);
      const allExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: true });
      const grp = await getGroup(chatId);

      await sendReply({
        chat_id: chatId,
        text: buildDetailReportText(groupMembers, allExpenses, grp),
      });
      break;
    }

    case '/expenses': {
      const recent = await getExpenses(chatId, { limit: 20, includeSettled: false });
      const listToShow = recent.length > 0 ? recent : await getExpenses(chatId, { limit: 20, includeSettled: true });

      if (!listToShow || listToShow.length === 0) {
        await sendReply({
          chat_id: chatId,
          text: "Hozircha xarajatlar yo'q.",
        });
        return;
      }

      const allMembers = await getMembers(chatId);
      const memberMap = buildMemberNameMap(allMembers, listToShow);

      let resp = recent.length > 0 ? 'Yaqindagi xarajatlar:\n\n' : 'Nollangan xarajatlar:\n\n';
      listToShow.forEach((exp, idx) => {
        const name = memberMap.get(Number(exp.payerId)) || exp.payerName;
        resp += `${idx + 1}. ${name}: ${formatMoney(exp.amount, exp.currency)} - ${exp.description} (ID: ${exp.id})\n`;
      });
      resp += "\nO'chirish: /delete <ID>";

      await sendReply({
        chat_id: chatId,
        text: resp,
      });
      break;
    }

    case '/delete': {
      const args = text.split(/\s+/);
      if (args.length < 2) {
        await sendReply({
          chat_id: chatId,
          text: 'Namuna: /delete <ID> (ID ni /expenses orqali ko\'ring)',
        });
        return;
      }

      const expId = parseInt(args[1], 10);
      if (isNaN(expId)) {
        await sendReply({ chat_id: chatId, text: "Noto'g'ri ID." });
        return;
      }

      const expense = await getExpense(expId);
      if (!expense || expense.groupId !== chatId) {
        await sendReply({ chat_id: chatId, text: 'Xarajat topilmadi.' });
        return;
      }

      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (expense.payerId !== userId && !isAdmin) {
        await sendReply({
          chat_id: chatId,
          text: "Faqat o'z xarajatingizni o'chira olasiz.",
        });
        return;
      }

      await sendReply({
        chat_id: chatId,
        text:
          `Xarajat o'chirilsinmi?\n` +
          `${expense.payerName}: ${formatMoney(expense.amount, expense.currency)} - ${expense.description}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "O'chirish", callback_data: `del_exp_${expId}` },
              { text: 'Bekor qilish', callback_data: 'cancel_action' },
            ],
          ],
        },
      });
      break;
    }

    case '/settle': {
      await sendReply({
        chat_id: chatId,
        text: 'Barcha joriy hisob-kitoblarni nollaysizmi?',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Tasdiqlash', callback_data: 'confirm_settle' },
              { text: 'Bekor qilish', callback_data: 'cancel_action' },
            ],
          ],
        },
      });
      break;
    }

    case '/reset': {
      await sendReply({
        chat_id: chatId,
        text: "Diqqat: Guruhdagi barcha xarajatlar tarixini butunlay o'chirasizmi?",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Hammasini o'chirish", callback_data: 'confirm_reset' },
              { text: 'Bekor qilish', callback_data: 'cancel_action' },
            ],
          ],
        },
      });
      break;
    }
  }
}
