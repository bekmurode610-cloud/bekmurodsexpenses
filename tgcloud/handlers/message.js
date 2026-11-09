import { api } from 'sdk';
import {
  ensureMember,
  getMembers,
  addExpense,
  getExpenses,
  getExpense,
  addMemberByName,
  removeMemberByName,
  syncChatAdmins,
  getGroup,
  shiftGroupDutyOffset,
  setGroupDutyRoster,
  setGroupDutyTime,
  checkAndAnnounceDuty,
} from '../lib/db-service.js';
import {
  calculateBalances,
  calculateSettlements,
  getUzbekistanWeekBounds,
  getDutySchedule,
  getDutyRosterList,
  getDutyPerson,
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
    return 'No duty roster set.';
  }

  const today = schedule[0];
  const tomorrow = schedule[1];
  const dutyTime = group?.dutyTime || '09:00';

  let resp = `Duty: ${today.name}${today.isDone ? ' (Done)' : ''}\n`;
  if (tomorrow) {
    resp += `Tomorrow: ${tomorrow.name}\n`;
  }
  resp += `Time: ${dutyTime} (UZT)\n\n`;

  resp += '7-Day Schedule:\n';
  for (const item of schedule) {
    const tag = item.dayOffset === 0 ? (item.isDone ? ' (Today, Done)' : ' (Today)') : '';
    resp += `${item.dateLabel}: ${item.name}${tag}\n`;
  }

  return resp.trim();
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
          'Expense & Duty Tracker\n\n' +
          'Add to your group to track expenses and room cleaning duty.\n\n' +
          'Example expense:\n' +
          '* 40 ming nonga',
      });
    }
    return;
  }

  // Auto-record member activity and sync chat admins
  await ensureMember(userId, chatId, displayName, message.chat.title || 'Group');
  await syncChatAdmins(api, chatId, message.chat.title || 'Group');

  // Passive automatic daily duty check: if time has passed today and not yet announced, send it!
  const currentGroup = await getGroup(chatId);
  const currentMembers = await getMembers(chatId);
  await checkAndAnnounceDuty(api, currentGroup, currentMembers);

  // 2. Parse expense entry: starts with '*' or '/add ' (not '/addmember')
  const isStarExpense = text.startsWith('*');
  const isAddCommand = /^\/add(?:@[a-zA-Z0-9_]+)?(?:\s+|$)/i.test(text);

  if (isStarExpense || isAddCommand) {
    let cleanText = text;
    if (isAddCommand) {
      cleanText = cleanText.replace(/^\/add(?:@[a-zA-Z0-9_]+)?\s*/i, '');
    } else {
      cleanText = cleanText.slice(1);
    }

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
          console.warn('Could not set message reaction:', reactErr);
          await api.sendMessage({
            chat_id: chatId,
            text: `Recorded: ${formatMoney(amount, currency)} - ${description}`,
            reply_parameters: { message_id: message.message_id },
          });
        }
      }
    } catch (err) {
      console.error('Error adding expense:', err);
      try {
        const errParams = {
          chat_id: chatId,
          text: `Error recording expense: ${err.message}`,
        };
        if (message.message_id) {
          errParams.reply_parameters = { message_id: message.message_id };
        }
        await api.sendMessage(errParams);
      } catch (sendErr) {
        console.error('Could not send error message:', sendErr);
      }
    }
    return;
  }

  // 3. Command handling
  const command = text.split(/\s+/)[0].toLowerCase().split('@')[0];

  switch (command) {
    case '/start':
    case '/help': {
      const helpText =
        'Expense & Duty Tracker\n\n' +
        'Add expense:\n' +
        '* 40 ming nonga\n' +
        '* 2 ta non 10 ming\n\n' +
        'Commands:\n' +
        '/balance - Balances\n' +
        '/duty - Who is on duty today\n' +
        '/expenses - Recent history\n' +
        '/weekly - Weekly summary\n' +
        '/detail - Full report\n\n' +
        'Admin commands:\n' +
        '/setduty @u1 @u2 - Set duty roster\n' +
        '/setdutytime 09:00 - Set duty time\n' +
        '/duty next - Shift to next person\n' +
        '/addmember @user - Add roommate\n' +
        '/removemember @user - Remove roommate\n' +
        '/settle - Settle debts\n' +
        '/delete <ID> - Delete expense';

      await api.sendMessage({
        chat_id: chatId,
        text: helpText,
      });
      break;
    }

    case '/join': {
      await ensureMember(userId, chatId, displayName, message.chat.title || 'Group');
      await api.sendMessage({
        chat_id: chatId,
        text: `${displayName} is now participating in group expenses.`,
      });
      break;
    }

    case '/members': {
      const allMembers = await getMembers(chatId);
      if (!allMembers || allMembers.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'No participants found yet.',
        });
        return;
      }

      let resp = 'Participants:\n\n';
      allMembers.forEach((m, idx) => {
        resp += `${idx + 1}. ${m.name}\n`;
      });

      await api.sendMessage({
        chat_id: chatId,
        text: resp.trim(),
      });
      break;
    }

    case '/addmember': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can add members.',
        });
        return;
      }

      const parts = text.split(/\s+/).slice(1);
      if (parts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Usage: /addmember @username',
        });
        return;
      }

      const added = [];
      for (const name of parts) {
        if (name && name.trim()) {
          await addMemberByName(chatId, name.trim(), message.chat.title || 'Group');
          added.push(name.trim());
        }
      }

      await api.sendMessage({
        chat_id: chatId,
        text: `Added: ${added.join(', ')}`,
      });
      break;
    }

    case '/removemember': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can remove members.',
        });
        return;
      }

      const targetName = text.split(/\s+/)[1];
      if (!targetName) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Usage: /removemember @username',
        });
        return;
      }

      const removed = await removeMemberByName(chatId, targetName);
      if (!removed) {
        await api.sendMessage({
          chat_id: chatId,
          text: `Member "${targetName}" not found.`,
        });
        return;
      }

      await api.sendMessage({
        chat_id: chatId,
        text: `Removed ${removed} from participants.`,
      });
      break;
    }

    case '/setduty': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can set the duty roster.',
        });
        return;
      }

      const parts = text.split(/\s+/).slice(1).map((p) => p.replace(/,/g, '').trim()).filter(Boolean);
      if (parts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Usage: /setduty @user1 @user2 @user3',
        });
        return;
      }

      await setGroupDutyRoster(chatId, parts);
      await api.sendMessage({
        chat_id: chatId,
        text: `Duty roster set: ${parts.join(', ')}`,
      });
      break;
    }

    case '/setdutytime': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can set the duty notification time.',
        });
        return;
      }

      const timeArg = text.split(/\s+/)[1];
      if (!timeArg || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeArg)) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Usage: /setdutytime 09:00 (24-hour format in UZT)',
        });
        return;
      }

      await setGroupDutyTime(chatId, timeArg);
      await api.sendMessage({
        chat_id: chatId,
        text: `Duty notice time set to ${timeArg} (UZT)`,
      });
      break;
    }

    case '/duty':
    case '/clean':
    case '/navbat': {
      const args = text.split(/\s+/).slice(1);
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'set') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can set the duty roster.' });
          return;
        }
        const roster = args.slice(1).map((p) => p.replace(/,/g, '').trim()).filter(Boolean);
        if (roster.length === 0) {
          await api.sendMessage({ chat_id: chatId, text: 'Usage: /duty set @user1 @user2 @user3' });
          return;
        }
        await setGroupDutyRoster(chatId, roster);
        await api.sendMessage({ chat_id: chatId, text: `Duty roster set: ${roster.join(', ')}` });
        return;
      }

      if (sub === 'time') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can set the duty time.' });
          return;
        }
        const timeArg = args[1];
        if (!timeArg || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeArg)) {
          await api.sendMessage({ chat_id: chatId, text: 'Usage: /duty time 09:00' });
          return;
        }
        await setGroupDutyTime(chatId, timeArg);
        await api.sendMessage({ chat_id: chatId, text: `Duty notice time set to ${timeArg} (UZT)` });
        return;
      }

      if (sub === 'next' || sub === 'skip') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can change duty.' });
          return;
        }
        await shiftGroupDutyOffset(chatId, 1);
      }

      if (sub === 'announce' || sub === 'now') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can trigger duty announcement.' });
          return;
        }
        const grp = await getGroup(chatId);
        const mems = await getMembers(chatId);
        await checkAndAnnounceDuty(api, grp, mems, true);
        return;
      }

      const grp = await getGroup(chatId);
      const mems = await getMembers(chatId);
      const roster = getDutyRosterList(grp, mems);

      if (!roster || roster.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'No duty roster set. Admin can set it with: /setduty @user1 @user2',
        });
        return;
      }

      const { dateStr } = getUztTimeInfo();
      const isDone = grp?.lastDutyDoneDate === dateStr;
      const todayPerson = getDutyPerson(roster, grp?.dutyOffset || 0, 0);

      if (sub === 'schedule' || sub === 'list') {
        const schedule = getDutySchedule(grp, mems, 7);
        await api.sendMessage({
          chat_id: chatId,
          text: formatDutyMessage(schedule, grp),
        });
        return;
      }

      // Minimal response:
      // Regular users only see who is on duty (no buttons).
      // Admin sees the [Done] button if not yet confirmed.
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      const reply_markup = (isAdmin && !isDone)
        ? { inline_keyboard: [[{ text: 'Done', callback_data: 'duty_confirm' }]] }
        : undefined;

      await api.sendMessage({
        chat_id: chatId,
        text: formatMinimalDutyNotification(todayPerson, isDone),
        reply_markup,
      });
      break;
    }

    case '/balance': {
      const groupMembers = await getMembers(chatId);
      const groupExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: false });

      if (!groupExpenses || groupExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'No active expenses recorded yet.',
        });
        return;
      }

      if (groupMembers.length <= 1) {
        const onlyMember = groupMembers[0]?.name || displayName;
        const total = groupExpenses.reduce((s, e) => s + e.amount, 0);
        await api.sendMessage({
          chat_id: chatId,
          text:
            `Current Balance\n\n` +
            `${onlyMember} paid: ${formatMoney(total, 'UZS')}\n` +
            `Balance: 0 ming (only 1 participant registered)\n\n` +
            `Add your roommates so expenses split among everyone:\n` +
            `/addmember @username`,
        });
        return;
      }

      const balancesByCurrency = calculateBalances(groupMembers, groupExpenses);
      const memberMap = buildMemberNameMap(groupMembers, groupExpenses);

      let resp = 'Current Balance\n\n';
      for (const [cur, balances] of Object.entries(balancesByCurrency)) {
        const curExpenses = groupExpenses.filter((e) => (e.currency || 'UZS').toUpperCase() === cur);
        const totalSpent = curExpenses.reduce((s, e) => s + e.amount, 0);
        const numPeople = Object.keys(balances).length;
        const fairShare = numPeople > 0 ? totalSpent / numPeople : 0;

        resp += `${cur} (Total: ${formatMoney(totalSpent, cur)} | Share: ${formatMoney(fairShare, cur)})\n`;
        const sorted = Object.entries(balances).sort((a, b) => b[1] - a[1]);
        for (const [mid, bal] of sorted) {
          const name = memberMap.get(Number(mid)) || 'Unknown';
          const sign = bal > 0 ? '+' : '';
          if (Math.abs(bal) > 0.05) {
            resp += `${name}: ${sign}${formatMoney(bal, cur)}\n`;
          } else {
            resp += `${name}: 0\n`;
          }
        }

        resp += '\nWho Owes Whom:\n';
        const settlements = calculateSettlements(balances);
        if (settlements.length > 0) {
          for (const s of settlements) {
            const debtor = memberMap.get(s.debtorId) || 'Unknown';
            const creditor = memberMap.get(s.creditorId) || 'Unknown';
            resp += `${debtor} -> ${creditor}: ${formatMoney(s.amount, cur)}\n`;
          }
        } else {
          resp += 'All settled up!\n';
        }
        resp += '\n';
      }

      await api.sendMessage({
        chat_id: chatId,
        text: resp.trim(),
      });
      break;
    }

    case '/detail':
    case '/details':
    case '/report': {
      const groupMembers = await getMembers(chatId);
      const allExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: true });

      if (!allExpenses || allExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'No expenses recorded for this group yet.',
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

      let resp = isShowingSettled
        ? 'Group Expense Report (All Settled History)\n\n'
        : 'Group Expense Report (Current Unsettled Cycle)\n\n';

      const balancesByCur = calculateBalances(groupMembers, activeList);

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

        resp += `Currency: ${cur}\n`;
        resp += `Total spent: ${formatMoney(totalSpent, cur)} (${curExpenses.length} items)\n`;
        resp += `Fair share: ${formatMoney(fairShare, cur)} per person\n\n`;

        resp += 'Paid by each member:\n';
        const sortedSpending = Object.entries(spending).sort((a, b) => b[1] - a[1]);
        for (const [mid, amt] of sortedSpending) {
          const name = memberMap.get(Number(mid)) || 'Unknown';
          resp += `${name}: ${formatMoney(amt, cur)}\n`;
        }

        if (!isShowingSettled) {
          resp += '\nNet Balance:\n';
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

          const settlements = calculateSettlements(balances);
          if (settlements.length > 0) {
            resp += '\nSettlements:\n';
            for (const s of settlements) {
              const debtor = memberMap.get(s.debtorId) || 'Unknown';
              const creditor = memberMap.get(s.creditorId) || 'Unknown';
              resp += `${debtor} -> ${creditor}: ${formatMoney(s.amount, cur)}\n`;
            }
          }
        }
        resp += '\n';
      }

      await api.sendMessage({
        chat_id: chatId,
        text: resp.trim(),
      });
      break;
    }

    case '/weekly': {
      const { startEpochSec, endEpochSec, monLabel, sunLabel } = getUzbekistanWeekBounds();

      const weekExpenses = await getExpenses(chatId, {
        limit: 10000,
        includeSettled: true,
        startDate: startEpochSec,
        endDate: endEpochSec,
      });

      if (!weekExpenses || weekExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: `No expenses recorded for this week (${monLabel} - ${sunLabel}).`,
        });
        return;
      }

      const groupMembers = await getMembers(chatId);
      const memberMap = buildMemberNameMap(groupMembers, weekExpenses);
      const unsettledWeek = weekExpenses.filter((e) => e.settled === 0);
      const balancesByCur = calculateBalances(groupMembers, unsettledWeek);

      let resp = `Weekly Report (${monLabel} - ${sunLabel})\n\n`;

      const byCur = {};
      for (const e of weekExpenses) {
        const c = (e.currency || 'UZS').toUpperCase();
        if (!byCur[c]) byCur[c] = [];
        byCur[c].push(e);
      }

      for (const [cur, exps] of Object.entries(byCur)) {
        const total = exps.reduce((s, e) => s + e.amount, 0);
        resp += `${cur} Total Spent: ${formatMoney(total, cur)}\n`;

        const spending = {};
        for (const m of groupMembers) spending[m.telegramId] = 0;
        for (const e of exps) {
          spending[e.payerId] = (spending[e.payerId] || 0) + e.amount;
        }

        const sortedSpending = Object.entries(spending).sort((a, b) => b[1] - a[1]);
        for (const [mid, amt] of sortedSpending) {
          if (amt > 0) {
            const name = memberMap.get(Number(mid)) || 'Unknown';
            resp += `${name} paid: ${formatMoney(amt, cur)}\n`;
          }
        }

        const balances = balancesByCur[cur];
        if (balances) {
          const settlements = calculateSettlements(balances);
          if (settlements.length > 0) {
            resp += '\nUnsettled This Week:\n';
            for (const s of settlements) {
              const debtor = memberMap.get(s.debtorId) || 'Unknown';
              const creditor = memberMap.get(s.creditorId) || 'Unknown';
              resp += `${debtor} -> ${creditor}: ${formatMoney(s.amount, cur)}\n`;
            }
          } else {
            resp += '\nAll settled for this week!\n';
          }
        } else {
          resp += '\nAll settled for this week!\n';
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
          text: 'No expenses recorded yet.',
        });
        return;
      }

      const allMembers = await getMembers(chatId);
      const memberMap = buildMemberNameMap(allMembers, listToShow);

      let resp = recent.length > 0 ? 'Recent Active Expenses:\n\n' : 'Recent Settled Expenses:\n\n';
      listToShow.forEach((exp, idx) => {
        const name = memberMap.get(Number(exp.payerId)) || exp.payerName;
        resp += `${idx + 1}. ${name}: ${formatMoney(exp.amount, exp.currency)} - ${exp.description} (ID: ${exp.id})\n`;
      });
      resp += '\nDelete an entry: /delete <ID>';

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
          text: 'Usage: /delete <ID> (find the ID via /expenses)',
        });
        return;
      }

      const expId = parseInt(args[1], 10);
      if (isNaN(expId)) {
        await api.sendMessage({ chat_id: chatId, text: 'Invalid expense ID.' });
        return;
      }

      const expense = await getExpense(expId);
      if (!expense || expense.groupId !== chatId) {
        await api.sendMessage({ chat_id: chatId, text: 'Expense not found in this group.' });
        return;
      }

      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (expense.payerId !== userId && !isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'You can only delete your own expenses (or ask an admin).',
        });
        return;
      }

      await api.sendMessage({
        chat_id: chatId,
        text:
          `Delete this expense?\n` +
          `${expense.payerName}: ${formatMoney(expense.amount, expense.currency)} - ${expense.description}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Delete', callback_data: `del_exp_${expId}` },
              { text: 'Cancel', callback_data: 'cancel_action' },
            ],
          ],
        },
      });
      break;
    }

    case '/settle': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can settle debts.',
        });
        return;
      }

      await api.sendMessage({
        chat_id: chatId,
        text: 'Mark all current expenses as settled and reset balances to 0?',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Confirm Settle', callback_data: 'confirm_settle' },
              { text: 'Cancel', callback_data: 'cancel_action' },
            ],
          ],
        },
      });
      break;
    }

    case '/reset': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can reset the group.',
        });
        return;
      }

      await api.sendMessage({
        chat_id: chatId,
        text: 'Warning: Permanently delete all expense records for this group?',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Reset All', callback_data: 'confirm_reset' },
              { text: 'Cancel', callback_data: 'cancel_action' },
            ],
          ],
        },
      });
      break;
    }
  }
}
