import { api } from 'sdk';
import {
  ensureMember,
  getMembers,
  addExpense,
  getExpenses,
  getExpense,
  addMemberByName,
  syncChatAdmins,
} from '../lib/db-service.js';
import { calculateBalances, calculateSettlements } from '../lib/settlement.js';
import { isAllowed, isCreatorOrAdmin } from '../lib/auth.js';
import { formatMoney, formatAmount } from '../lib/format.js';

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
          '<b>Group Expense Tracker</b>\n\n' +
          'This bot is designed to work inside Telegram groups. Add it to your group to track shared expenses with your friends!\n\n' +
          '<b>How to track expenses in groups:</b>\n' +
          'Just send: <code>* 10 ming nonga</code> or <code>/add 10 ming nonga</code>',
        parse_mode: 'HTML',
      });
    }
    return;
  }

  // Auto-record member activity and sync chat admins
  await ensureMember(userId, chatId, displayName, message.chat.title || 'Group');
  await syncChatAdmins(api, chatId, message.chat.title || 'Group');

  // 2. Parse expense entry: starts with '*' or '/add'
  if (text.startsWith('*') || text.startsWith('/add')) {
    let cleanText = text;
    if (cleanText.startsWith('/add')) {
      cleanText = cleanText.replace(/^\/add(?:@[a-zA-Z0-9_]+)?\s*/i, '');
    } else if (cleanText.startsWith('*')) {
      cleanText = cleanText.slice(1);
    }
    cleanText = cleanText.trim();

    const numberMatch = cleanText.match(/(\d+(?:\.\d+)?)/);
    if (!numberMatch) {
      return;
    }

    try {
      const amountStr = numberMatch[1];
      let amount = parseFloat(amountStr);

      let description = cleanText.replace(amountStr, '').trim();

      // Handle "ming", "k", "min" logic
      if (/\b(?:ming|k|min)\b/i.test(description)) {
        description = description.replace(/\b(?:ming|k|min)\b/i, '').trim();
      } else if (amount >= 1000) {
        amount = amount / 1000.0;
      }

      description = description.replace(/^[-_\s,]+/, '').trim();
      if (!description) {
        description = 'Expense';
      }

      // Check currency
      let currency = 'UZS';
      const currMatch = description.match(/\b(UZS|USD|EUR|RUB)\b/i);
      if (currMatch) {
        currency = currMatch[1].toUpperCase();
        description = description.replace(/\b(UZS|USD|EUR|RUB)\b/i, '').trim();
      }

      if (amount > 0) {
        await addExpense({
          groupId: chatId,
          payerId: userId,
          payerName: displayName,
          amount,
          currency,
          description,
          groupName: message.chat.title || 'Group',
        });

        // Respond by putting a reaction on the message instead of sending a separate message
        if (message.message_id) {
          try {
            await api.setMessageReaction({
              chat_id: chatId,
              message_id: message.message_id,
              reaction: [{ type: 'emoji', emoji: '👍' }],
            });
          } catch (reactErr) {
            console.warn('Could not set message reaction:', reactErr);
            // Fallback only if reactions are disabled in the chat
            await api.sendMessage({
              chat_id: chatId,
              text: `✅ Recorded: ${formatAmount(amount)} ${currency} - ${description}`,
              reply_parameters: { message_id: message.message_id },
            });
          }
        }
      }
    } catch (err) {
      console.error('Error adding expense:', err);
      try {
        const errParams = {
          chat_id: chatId,
          text: `Error parsing expense: ${err.message}`,
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
        '<b>Group Expense Tracker</b>\n\n' +
        'Add an expense using <code>*</code>:\n' +
        '<code>* 10 ming nonga</code>\n' +
        'Or: <code>/add 10 ming nonga</code>\n\n' +
        '<b>Commands:</b>\n' +
        '/balance - Who owes whom\n' +
        '/expenses - Recent history\n' +
        '/weekly - Weekly report\n' +
        '/report - Full report\n' +
        '/settle - Mark debts as settled (Admins)\n' +
        '/members - Participants\n' +
        '/addmember - Add a friend (e.g. /addmember @user)\n\n' +
        '<i>No servers required. Running directly on Telegram Serverless.</i>';

      await api.sendMessage({
        chat_id: chatId,
        text: helpText,
        parse_mode: 'HTML',
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
          text: 'No active participants found yet. Use /join or add an expense!',
        });
        return;
      }

      let resp = '<b>Active Participants:</b>\n\n';
      allMembers.forEach((m, idx) => {
        resp += `${idx + 1}. ${m.name}\n`;
      });

      await api.sendMessage({
        chat_id: chatId,
        text: resp,
        parse_mode: 'HTML',
      });
      break;
    }

    case '/addmember': {
      const parts = text.split(/\s+/).slice(1);
      if (parts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Please specify the username or name to add. Example: <code>/addmember @username</code>',
          parse_mode: 'HTML',
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
        text: `Added ${added.join(', ')} to group participants.`,
      });
      break;
    }

    case '/balance': {
      const groupMembers = await getMembers(chatId);
      const groupExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: false });

      if (!groupExpenses || groupExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'There are no active expenses recorded for this group yet.',
        });
        return;
      }

      if (groupMembers.length <= 1) {
        const onlyMember = groupMembers[0]?.name || 'You';
        await api.sendMessage({
          chat_id: chatId,
          text:
            `<b>Current Balance</b>\n\n` +
            `UZS Balance\n${onlyMember}: 0 ming\n\n` +
            `ℹ️ <i>Notice: Only 1 person (${onlyMember}) is registered in this group so far.</i>\n` +
            `Expenses are split equally among all registered participants.\n\n` +
            `👉 <b>To add your friends to split the expense:</b>\n` +
            `• Type: <code>/addmember @username</code>\n` +
            `• Or have them send any message or type <code>/join</code> in this group!`,
          parse_mode: 'HTML',
        });
        return;
      }

      const balancesByCurrency = calculateBalances(groupMembers, groupExpenses);
      const memberMap = new Map(groupMembers.map((m) => [m.telegramId, m.name]));

      let resp = 'Current Balance\n\n';
      for (const [cur, balances] of Object.entries(balancesByCurrency)) {
        resp += `${cur} Balance\n`;
        const sorted = Object.entries(balances).sort((a, b) => b[1] - a[1]);
        for (const [mid, bal] of sorted) {
          const name = memberMap.get(Number(mid)) || 'Unknown';
          const sign = bal > 0 ? '+' : '';
          if (Math.abs(bal) > 0.01) {
            resp += `${name}: ${sign}${formatMoney(bal)}\n`;
          } else {
            resp += `${name}: 0 ming\n`;
          }
        }

        resp += '\nSettlements\n';
        const settlements = calculateSettlements(balances);
        if (settlements.length > 0) {
          for (const s of settlements) {
            const debtor = memberMap.get(s.debtorId) || 'Unknown';
            const creditor = memberMap.get(s.creditorId) || 'Unknown';
            resp += `${debtor} owes ${creditor}: ${formatMoney(s.amount)}\n`;
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
      const groupExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: true });

      if (!groupExpenses || groupExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'There are no expenses recorded for this group yet.',
        });
        return;
      }

      const memberMap = new Map(groupMembers.map((m) => [m.telegramId, m.name]));
      const numMembers = groupMembers.length;

      const byCurrency = {};
      for (const exp of groupExpenses) {
        const c = exp.currency || 'UZS';
        if (!byCurrency[c]) byCurrency[c] = [];
        byCurrency[c].push(exp);
      }

      let resp = 'Group Expense Report\nPeriod: All time\n\n';
      for (const [cur, curExpenses] of Object.entries(byCurrency)) {
        const totalSpent = curExpenses.reduce((sum, e) => sum + e.amount, 0);
        const fairShare = numMembers > 0 ? totalSpent / numMembers : 0;

        const spending = {};
        for (const m of groupMembers) spending[m.telegramId] = 0;
        for (const e of curExpenses) {
          spending[e.payerId] = (spending[e.payerId] || 0) + e.amount;
        }

        resp += `Currency: ${cur}\n`;
        resp += `Total spent: ${formatMoney(totalSpent)}\n`;
        resp += `Number of expenses: ${curExpenses.length}\n\n`;

        const sortedSpending = Object.entries(spending).sort((a, b) => b[1] - a[1]);
        for (const [mid, amt] of sortedSpending) {
          if (amt > 0) {
            const name = memberMap.get(Number(mid)) || 'Unknown';
            resp += `${name} paid: ${formatMoney(amt)}\n`;
          }
        }
        resp += `\nFair share per person: ${formatMoney(fairShare)}\n\n`;
      }

      // Balances
      const unsettled = groupExpenses.filter((e) => e.settled === 0);
      const balancesByCur = calculateBalances(groupMembers, unsettled);
      resp += 'Balances & Settlements:\n\n';

      for (const [cur, balances] of Object.entries(balancesByCur)) {
        resp += `${cur}\n`;
        const sorted = Object.entries(balances).sort((a, b) => b[1] - a[1]);
        for (const [mid, bal] of sorted) {
          const name = memberMap.get(Number(mid)) || 'Unknown';
          const sign = bal > 0 ? '+' : '';
          if (Math.abs(bal) > 0.01) {
            resp += `${name}: ${sign}${formatMoney(bal)}\n`;
          }
        }

        const settlements = calculateSettlements(balances);
        if (settlements.length > 0) {
          resp += '\nSettlements:\n';
          for (const s of settlements) {
            const debtor = memberMap.get(s.debtorId) || 'Unknown';
            const creditor = memberMap.get(s.creditorId) || 'Unknown';
            resp += `${debtor} owes ${creditor}: ${formatMoney(s.amount)}\n`;
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
      const now = new Date();
      const day = now.getUTCDay();
      const diffToMonday = (day + 6) % 7;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - diffToMonday);
      monday.setUTCHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const weekExpenses = await getExpenses(chatId, {
        limit: 10000,
        includeSettled: false,
        startDate: monday,
        endDate: sunday,
      });

      if (!weekExpenses || weekExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'There are no expenses recorded for this week yet.',
        });
        return;
      }

      const groupMembers = await getMembers(chatId);
      const memberMap = new Map(groupMembers.map((m) => [m.telegramId, m.name]));
      const balancesByCur = calculateBalances(groupMembers, weekExpenses);

      const monStr = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const sunStr = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      let resp = `Weekly Report\n${monStr} to ${sunStr}\n\n`;

      const byCur = {};
      for (const e of weekExpenses) {
        const c = e.currency || 'UZS';
        if (!byCur[c]) byCur[c] = [];
        byCur[c].push(e);
      }

      for (const [cur, exps] of Object.entries(byCur)) {
        const total = exps.reduce((s, e) => s + e.amount, 0);
        resp += `${cur}\nTotal: ${formatMoney(total)}\n\n`;

        const spending = {};
        for (const e of exps) {
          spending[e.payerId] = (spending[e.payerId] || 0) + e.amount;
        }

        const sortedSpending = Object.entries(spending).sort((a, b) => b[1] - a[1]);
        for (const [mid, amt] of sortedSpending) {
          if (amt > 0) {
            const name = memberMap.get(Number(mid)) || 'Unknown';
            resp += `${name}: ${formatMoney(amt)}\n`;
          }
        }

        resp += '\nBalances:\n';
        const balances = balancesByCur[cur] || {};
        const sortedBal = Object.entries(balances).sort((a, b) => b[1] - a[1]);
        for (const [mid, bal] of sortedBal) {
          const name = memberMap.get(Number(mid)) || 'Unknown';
          const sign = bal > 0 ? '+' : '';
          if (Math.abs(bal) > 0.01) {
            resp += `${name}: ${sign}${formatMoney(bal)}\n`;
          }
        }

        const settlements = calculateSettlements(balances);
        if (settlements.length > 0) {
          resp += '\nSettlement:\n';
          for (const s of settlements) {
            const debtor = memberMap.get(s.debtorId) || 'Unknown';
            const creditor = memberMap.get(s.creditorId) || 'Unknown';
            resp += `${debtor} owes ${creditor}: ${formatMoney(s.amount)}\n`;
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

    case '/expenses': {
      const recent = await getExpenses(chatId, { limit: 20 });
      if (!recent || recent.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'There are no expenses recorded for this group yet.',
        });
        return;
      }

      const allMembers = await getMembers(chatId);
      const memberMap = new Map(allMembers.map((m) => [m.telegramId, m.name]));

      let resp = 'Recent Expenses\n\n';
      recent.forEach((exp, idx) => {
        const name = memberMap.get(exp.payerId) || exp.payerName;
        resp += `${idx + 1}. ${name}: ${formatMoney(exp.amount)} for ${exp.description} (ID: ${exp.id})\n`;
      });
      resp += '\nTo delete an expense, use /delete <ID>';

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
          text: 'Please provide the expense ID. Example: /delete 123',
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
          text: 'You are not authorized to delete this expense.',
        });
        return;
      }

      await api.sendMessage({
        chat_id: chatId,
        text:
          `Are you sure you want to delete this expense?\n` +
          `${expense.payerName} - ${expense.amount} ${expense.currency} - ${expense.description}`,
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
        text:
          'Are you sure you want to mark all current expenses as SETTLED?\n\n' +
          'This will reset everyone`s current balance back to zero, but keep the history of expenses for reports.',
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
        text: 'Warning: This will permanently delete all expense records for this group.',
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
