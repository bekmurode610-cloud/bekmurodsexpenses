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
} from '../lib/db-service.js';
import {
  calculateBalances,
  getDutySchedule,
  getDutyRosterList,
  getExpenseRosterList,
  getActiveDutyPerson,
  formatUzDate,
  formatMinimalDutyNotification,
  getUztTimeInfo,
} from '../lib/settlement.js';
import { isAllowed, isCreatorOrAdmin } from '../lib/auth.js';
import { formatMoney, parseExpenseInput } from '../lib/format.js';

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

  let resp = `Navbatchi (${today.dateLabel}): ${today.name}${today.isDone ? ' (Done)' : ''}\n`;
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

function getDutyAdminKeyboard(isDone) {
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

export default async function (message, ctx) {
  if (!message || !message.text) return;

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

  // 1. Private chat handling
  if (isPrivate) {
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await api.sendMessage({
        chat_id: chatId,
        text:
          'Expense & Navbatchi Tracker\n\n' +
          "Xarajatlarni va navbatchilikni boshqarish uchun botni guruhga qo'shing.\n\n" +
          'Xarajat yozish misoli:\n' +
          '* 40 ming nonga',
      });
    }
    return;
  }

  const isStarExpense = text.startsWith('*');
  const isCommand = text.startsWith('/');

  // Passive daily duty check if not yet announced today
  const currentGroup = await getGroup(chatId);
  if (currentGroup) {
    const { dateStr, timeStr } = getUztTimeInfo();
    const scheduledTime = currentGroup.dutyTime || '09:00';
    if (timeStr >= scheduledTime && currentGroup.lastDutyDate !== dateStr) {
      const currentMembers = await getMembers(chatId);
      await checkAndAnnounceDuty(api, currentGroup, currentMembers);
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
          await api.sendMessage({
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

      await api.sendMessage({
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
        await api.sendMessage({
          chat_id: chatId,
          text: resp.trim(),
        });
        return;
      }

      const allMembers = await getMembers(chatId);
      if (!allMembers || allMembers.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: "A'zolar ro'yxati bo'sh. Admin: /setmembers @user1 @user2",
        });
        return;
      }

      let resp = "A'zolar:\n";
      allMembers.forEach((m, idx) => {
        resp += `${idx + 1}. ${m.name}\n`;
      });

      await api.sendMessage({
        chat_id: chatId,
        text: resp.trim(),
      });
      break;
    }

    case '/setmembers': {
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: "Faqat guruh admini a'zolarni belgilashi mumkin.",
        });
        return;
      }

      const rawParts = text.split(/\s+/).slice(1);
      if (rawParts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Namuna: /setmembers @user1 @user2 @user3',
        });
        return;
      }

      if (rawParts[0].toLowerCase() === 'clear' || rawParts[0].toLowerCase() === 'reset') {
        await setGroupExpenseRoster(chatId, null);
        await api.sendMessage({
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

      await api.sendMessage({
        chat_id: chatId,
        text: `A'zolar ro'yxati saqlandi: ${roster.join(', ')}`,
      });
      break;
    }

    case '/setduty': {
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Faqat guruh admini navbatchilarni belgilashi mumkin.',
        });
        return;
      }

      const parts = text.split(/\s+/).slice(1).map((p) => p.replace(/,/g, '').trim()).filter(Boolean);
      if (parts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Namuna: /setduty @user1 @user2 @user3',
        });
        return;
      }

      await setGroupDutyRoster(chatId, parts);
      await api.sendMessage({
        chat_id: chatId,
        text: `Navbatchi ro'yxati: ${parts.join(', ')}`,
      });
      break;
    }

    case '/setdutytime': {
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Faqat guruh admini vaqtni belgilashi mumkin.',
        });
        return;
      }

      const timeArg = text.split(/\s+/)[1];
      if (!timeArg || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeArg)) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Namuna: /setdutytime 09:00',
        });
        return;
      }

      await setGroupDutyTime(chatId, timeArg);
      await setGroupLastDutyDate(chatId, null);
      await api.sendMessage({
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
          await api.sendMessage({ chat_id: chatId, text: "Faqat admin navbatni almashtirishi mumkin." });
          return;
        }
        const u1 = rawArgs[1];
        const u2 = rawArgs[2];
        if (!u1 || !u2) {
          await api.sendMessage({ chat_id: chatId, text: 'Namuna: /duty swap @user1 @user2' });
          return;
        }
        const res = await swapDutyMembers(chatId, u1, u2);
        if (res?.error) {
          await api.sendMessage({ chat_id: chatId, text: res.error });
          return;
        }
        await api.sendMessage({
          chat_id: chatId,
          text: `O'rin almashtirildi: ${res.userA} ↔ ${res.userB}\nRo'yxat: ${res.roster.join(', ')}`,
        });
        return;
      }

      const grp = await getGroup(chatId);
      const mems = await getMembers(chatId);
      const roster = getDutyRosterList(grp, mems);

      if (!roster || roster.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: "Navbatchi ro'yxati belgilanmagan. Admin: /setduty @user1 @user2",
        });
        return;
      }

      if (sub === 'list' || sub === 'schedule') {
        const schedule = getDutySchedule(grp, mems, 7);
        await api.sendMessage({
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

      await api.sendMessage({
        chat_id: chatId,
        text: formatMinimalDutyNotification(activePerson, dateLabel, isDone),
        reply_markup,
      });
      break;
    }

    case '/detail': {
      const groupMembers = await getMembers(chatId);
      const allExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: true });
      const grp = await getGroup(chatId);

      if (!allExpenses || allExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: "Hozircha xarajatlar yo'q.",
        });
        return;
      }

      const unsettledExpenses = allExpenses.filter((e) => e.settled === 0);
      const activeList = unsettledExpenses.length > 0 ? unsettledExpenses : allExpenses;
      const isShowingSettled = unsettledExpenses.length === 0;

      const memberMap = buildMemberNameMap(groupMembers, allExpenses);

      const byCurrency = {};
      for (const exp of activeList) {
        const c = (exp.currency || 'UZS').toUpperCase();
        if (!byCurrency[c]) byCurrency[c] = [];
        byCurrency[c].push(exp);
      }

      let resp = isShowingSettled ? "Hisobot (Nollangan tarix)\n\n" : "Hisobot\n\n";

      const balancesByCur = calculateBalances(groupMembers, activeList, grp);

      for (const [cur, curExpenses] of Object.entries(byCurrency)) {
        const balances = balancesByCur[cur] || {};
        const participantIds = Object.keys(balances).map(Number);
        const numPeople = participantIds.length || groupMembers.length || 1;
        const totalSpent = curExpenses.reduce((sum, e) => sum + e.amount, 0);
        const fairShare = totalSpent / numPeople;

        const spending = {};
        for (const pid of participantIds) spending[pid] = 0;
        for (const e of curExpenses) {
          const pid = Number(e.payerId);
          spending[pid] = (spending[pid] || 0) + e.amount;
        }

        resp += `Jami xarajat: ${formatMoney(totalSpent, cur)} (${curExpenses.length} ta)\n`;
        resp += `Har bir kishiga: ${formatMoney(fairShare, cur)}\n\n`;

        resp += "Kim qancha to'ladi:\n";
        const sortedSpending = Object.entries(spending).sort((a, b) => b[1] - a[1]);
        for (const [mid, amt] of sortedSpending) {
          const name = memberMap.get(Number(mid)) || 'Unknown';
          resp += `${name}: ${formatMoney(amt, cur)}\n`;
        }

        if (!isShowingSettled) {
          resp += '\nBalans:\n';
          const sortedBal = Object.entries(balances).sort((a, b) => b[1] - a[1]);
          for (const [mid, bal] of sortedBal) {
            const name = memberMap.get(Number(mid)) || 'Unknown';
            const sign = bal > 0 ? '+' : '';
            if (Math.abs(bal) > 0.05) {
              resp += `${name}: ${sign}${formatMoney(bal, cur)}\n`;
            } else {
              resp += `${name}: 0\n`;
            }
          }

          resp += "\nTo'lov uchun (Pay to):\n💳 9860080393751393\nShahboz Abdusattarov\n";
        }
        resp += '\n';
      }

      await api.sendMessage({
        chat_id: chatId,
        text: resp.trim(),
      });
      break;
    }

    case '/expenses': {
      const recent = await getExpenses(chatId, { limit: 20, includeSettled: false });
      const listToShow = recent.length > 0 ? recent : await getExpenses(chatId, { limit: 20, includeSettled: true });

      if (!listToShow || listToShow.length === 0) {
        await api.sendMessage({
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

      await api.sendMessage({
        chat_id: chatId,
        text: resp,
      });
      break;
    }

    case '/delete': {
      const args = text.split(/\s+/);
      if (args.length < 2) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Namuna: /delete <ID> (ID ni /expenses orqali ko\'ring)',
        });
        return;
      }

      const expId = parseInt(args[1], 10);
      if (isNaN(expId)) {
        await api.sendMessage({ chat_id: chatId, text: "Noto'g'ri ID." });
        return;
      }

      const expense = await getExpense(expId);
      if (!expense || expense.groupId !== chatId) {
        await api.sendMessage({ chat_id: chatId, text: 'Xarajat topilmadi.' });
        return;
      }

      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (expense.payerId !== userId && !isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: "Faqat o'z xarajatingizni o'chira olasiz.",
        });
        return;
      }

      await api.sendMessage({
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
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Faqat guruh admini qarzlarni nollashi mumkin.',
        });
        return;
      }

      await api.sendMessage({
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
      await syncChatAdmins(api, chatId, message.chat.title || 'Group');
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: "Faqat guruh admini xarajatlarni o'chirishi mumkin.",
        });
        return;
      }

      await api.sendMessage({
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
