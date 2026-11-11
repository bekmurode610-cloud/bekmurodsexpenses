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
  setGroupDutyOffset,
  swapDutyMembers,
  assignDutyMember,
  setGroupDutyRoster,
  setGroupExpenseRoster,
  setGroupDutyTime,
  setGroupLastDutyDate,
  checkAndAnnounceDuty,
} from '../lib/db-service.js';
import {
  calculateBalances,
  calculateSettlements,
  getUzbekistanWeekBounds,
  getDutySchedule,
  getDutyRosterList,
  getExpenseRosterList,
  getDutyPerson,
  getActiveDutyPerson,
  formatUzDate,
  formatMinimalDutyNotification,
  getUztTimeInfo,
} from '../lib/settlement.js';
import { isAllowed, isCreatorOrAdmin } from '../lib/auth.js';
import { formatMoney, parseExpenseInput } from '../lib/format.js';
import { setupBotCommands } from '../lib/commands.js';

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

  resp += "Navbatchilik ketma-ketligi:\n";
  for (const item of schedule) {
    const tag = item.dayOffset === 0 ? (item.isDone ? ' (Bugun, Done)' : ' (Bugun)') : '';
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
          'Expense & Navbatchi Tracker\n\n' +
          "Xarajatlarni va xona tozalash navbatchiligini boshqarish uchun guruhga qo'shing.\n\n" +
          'Misol:\n' +
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
      const isAdmin = !isPrivate && (await isCreatorOrAdmin(chatId, userId, username));

      let helpText =
        'Expense & Navbatchi Tracker\n\n' +
        'Xarajat kiritish:\n' +
        '* 40 ming nonga\n' +
        '* 2 ta non 10 ming\n\n' +
        'Buyruqlar:\n' +
        '/expenses - Yaqindagi xarajatlar\n' +
        '/duty - Navbatchi kimligini ko\'rish\n' +
        '/detail - To\'liq hisobot\n' +
        '/members - Guruh a\'zolari ro\'yxati';

      if (isAdmin) {
        helpText +=
          '\n\nAdmin buyruqlari:\n' +
          '/setmembers @u1 @u2 - Xarajat a\'zolarini belgilash\n' +
          '/setduty @u1 @u2 - Navbatchilarni kiritish\n' +
          '/setdutytime 09:00 - Eslatma vaqtini sozlash\n' +
          '/duty undone - "Done" ni bekor qilish\n' +
          '/duty next - Keyingi kishiga o\'tkazish\n' +
          '/settle - Qarzlarni nollash\n' +
          '/reset - Xarajatlarni o\'chirish\n' +
          '/setcommands - Menyuni yangilash';
      }

      await api.sendMessage({
        chat_id: chatId,
        text: helpText,
      });
      break;
    }

    case '/setcommands': {
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can update commands.',
        });
        return;
      }
      await setupBotCommands(api);
      await api.sendMessage({
        chat_id: chatId,
        text: "Menyu buyruqlari muvaffaqiyatli yangilandi.",
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
      const parts = text.split(/\s+/).slice(1);
      const sub = (parts[0] || '').toLowerCase();

      if (sub === 'set') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({
            chat_id: chatId,
            text: 'Only group admins can set members.',
          });
          return;
        }

        const roster = parts
          .slice(1)
          .map((p) => p.replace(/,/g, '').trim())
          .filter(Boolean);
        if (roster.length === 0) {
          await api.sendMessage({
            chat_id: chatId,
            text: 'Usage: /members set @user1 @user2 @user3',
          });
          return;
        }

        await setGroupExpenseRoster(chatId, roster);
        for (const name of roster) {
          await addMemberByName(chatId, name, message.chat.title || 'Group');
        }

        await api.sendMessage({
          chat_id: chatId,
          text: `A'zolar ro'yxati: ${roster.join(', ')}`,
        });
        return;
      }

      if (sub === 'clear' || sub === 'reset') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({
            chat_id: chatId,
            text: 'Only group admins can clear members.',
          });
          return;
        }

        await setGroupExpenseRoster(chatId, null);
        await api.sendMessage({
          chat_id: chatId,
          text: "Xarajat a'zolari ro'yxati tozalandi.",
        });
        return;
      }

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
          text: 'No participants found yet.',
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
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (!isAdmin) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Only group admins can set members.',
        });
        return;
      }

      const rawParts = text.split(/\s+/).slice(1);
      if (rawParts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'Usage: /setmembers @user1 @user2 @user3',
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
        text: `A'zolar ro'yxati: ${roster.join(', ')}`,
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
        text: `Navbatchi ro'yxati: ${parts.join(', ')}`,
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
      await setGroupLastDutyDate(chatId, null);
      await api.sendMessage({
        chat_id: chatId,
        text: `Duty notice time set to ${timeArg} (UZT)`,
      });
      break;
    }

    case '/duty':
    case '/navbatchi':
    case '/clean':
    case '/navbat':
    case '/dutyswap': {
      const isDirectSwap = command === '/dutyswap';
      const rawArgs = text.split(/\s+/).slice(1);
      const sub = isDirectSwap ? 'swap' : (rawArgs[0] || '').toLowerCase();
      const args = isDirectSwap ? ['swap', ...rawArgs] : rawArgs;

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
        await api.sendMessage({ chat_id: chatId, text: `Navbatchi ro'yxati: ${roster.join(', ')}` });
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
        await setGroupLastDutyDate(chatId, null);
        await api.sendMessage({ chat_id: chatId, text: `Duty notice time set to ${timeArg} (UZT)` });
        return;
      }

      if (sub === 'manage' || sub === 'boshqaruv') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can manage duty.' });
          return;
        }

        const grp = await getGroup(chatId);
        const mems = await getMembers(chatId);
        const roster = getDutyRosterList(grp, mems);

        if (!roster || roster.length === 0) {
          await api.sendMessage({ chat_id: chatId, text: "Navbatchi ro'yxati belgilanmagan. /setduty @u1 @u2" });
          return;
        }

        const k = roster.length;
        const currentOffset = grp?.dutyOffset || 0;
        const activeIdx = ((currentOffset % k) + k) % k;

        let resp = "Navbatchilikni boshqarish:\n\n";
        roster.forEach((name, idx) => {
          const isCurrent = idx === activeIdx;
          resp += `${idx + 1}. ${name}${isCurrent ? ' 👈 (Hozirgi navbatchi)' : ''}\n`;
        });

        resp += "\nBoshqaruv buyruqlari:\n";
        resp += "/duty done — Bugungi ishni bajarildi deb hisoblash\n";
        resp += "/duty undone — 'Done' ni bekor qilish\n";
        resp += "/duty swap @user1 @user2 — O'rinlarini almashtirish\n";
        resp += "/duty assign @user — Hozirgi navbatchini belgilash\n";
        resp += "/duty next — Keyingi kishiga o'tkazish\n";
        resp += "/duty prev — Oldingi kishiga qaytarish";

        await api.sendMessage({
          chat_id: chatId,
          text: resp.trim(),
        });
        return;
      }

      if (sub === 'swap' || sub === 'almash') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can swap duty.' });
          return;
        }
        const u1 = args[1];
        const u2 = args[2];
        if (!u1 || !u2) {
          await api.sendMessage({ chat_id: chatId, text: "Usage: /duty swap @user1 @user2" });
          return;
        }
        const res = await swapDutyMembers(chatId, u1, u2);
        if (res?.error) {
          await api.sendMessage({ chat_id: chatId, text: res.error });
          return;
        }
        await api.sendMessage({
          chat_id: chatId,
          text: `Navbatchilar o'rni almashtirildi: ${res.userA} ↔ ${res.userB}\nYangi ro'yxat: ${res.roster.join(', ')}`,
        });
        return;
      }

      if (sub === 'assign' || sub === 'setactive') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can assign duty.' });
          return;
        }
        const target = args[1];
        if (!target) {
          await api.sendMessage({ chat_id: chatId, text: "Usage: /duty assign @username" });
          return;
        }
        const res = await assignDutyMember(chatId, target);
        if (res?.error) {
          await api.sendMessage({ chat_id: chatId, text: res.error });
          return;
        }
        await setGroupLastDutyDoneDate(chatId, null);
        const { nowUzt } = getUztTimeInfo();
        const dateLabel = formatUzDate(nowUzt);
        await api.sendMessage({
          chat_id: chatId,
          text: `Hozirgi navbatchi belgilandi: ${res.person}\n${formatMinimalDutyNotification(res.person, dateLabel, false)}`,
          reply_markup: {
            inline_keyboard: [[{ text: 'Done', callback_data: 'duty_confirm' }]],
          },
        });
        return;
      }

      if (sub === 'next' || sub === 'skip') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can change duty.' });
          return;
        }
        const grp = await getGroup(chatId);
        const mems = await getMembers(chatId);
        const roster = getDutyRosterList(grp, mems);
        if (!roster || roster.length === 0) return;
        const k = roster.length;
        const current = grp?.dutyOffset || 0;
        const nextIdx = ((current + 1) % k + k) % k;
        await setGroupDutyOffset(chatId, nextIdx);
        await api.sendMessage({
          chat_id: chatId,
          text: `Navbatchi keyingisiga o'tkazildi: ${roster[nextIdx]}`,
        });
        return;
      }

      if (sub === 'prev') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can change duty.' });
          return;
        }
        const grp = await getGroup(chatId);
        const mems = await getMembers(chatId);
        const roster = getDutyRosterList(grp, mems);
        if (!roster || roster.length === 0) return;
        const k = roster.length;
        const current = grp?.dutyOffset || 0;
        const prevIdx = ((current - 1) % k + k) % k;
        await setGroupDutyOffset(chatId, prevIdx);
        await api.sendMessage({
          chat_id: chatId,
          text: `Navbatchi oldingisiga qaytarildi: ${roster[prevIdx]}`,
        });
        return;
      }

      if (sub === 'undone' || sub === 'undo' || sub === 'cancel' || sub === 'unconfirm') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can undo duty.' });
          return;
        }
        const grp = await getGroup(chatId);
        const mems = await getMembers(chatId);
        const roster = getDutyRosterList(grp, mems);
        if (!roster || roster.length === 0) return;

        const { dateStr, nowUzt } = getUztTimeInfo();
        const k = roster.length;
        const current = grp?.dutyOffset || 0;

        let targetOffset = current;
        if (grp?.lastDutyDoneDate === dateStr) {
          targetOffset = ((current - 1) % k + k) % k;
          await setGroupDutyOffset(chatId, targetOffset);
        }
        await setGroupLastDutyDoneDate(chatId, null);

        const person = roster[targetOffset];
        const dateLabel = formatUzDate(nowUzt);

        await api.sendMessage({
          chat_id: chatId,
          text: `Done holati bekor qilindi.\n${formatMinimalDutyNotification(person, dateLabel, false)}`,
          reply_markup: {
            inline_keyboard: [[{ text: 'Done', callback_data: 'duty_confirm' }]],
          },
        });
        return;
      }

      if (sub === 'done' || sub === 'confirm') {
        const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
        if (!isAdmin) {
          await api.sendMessage({ chat_id: chatId, text: 'Only group admins can confirm duty.' });
          return;
        }
        const { dateStr, nowUzt } = getUztTimeInfo();
        const grp = await getGroup(chatId);
        const mems = await getMembers(chatId);
        const roster = getDutyRosterList(grp, mems);
        if (!roster || roster.length === 0) return;
        const k = roster.length;
        const current = grp?.dutyOffset || 0;
        const person = roster[((current % k) + k) % k];
        await setGroupLastDutyDoneDate(chatId, dateStr);
        const nextIdx = (current + 1) % k;
        await setGroupDutyOffset(chatId, nextIdx);
        const dateLabel = formatUzDate(nowUzt);
        await api.sendMessage({
          chat_id: chatId,
          text: `${formatMinimalDutyNotification(person, dateLabel, true)}\nKeyingi navbat: ${roster[nextIdx]}`,
          reply_markup: {
            inline_keyboard: [[{ text: 'Undo', callback_data: 'duty_undone' }]],
          },
        });
        return;
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
          text: "Navbatchi ro'yxati belgilanmagan. Admin: /setduty @user1 @user2",
        });
        return;
      }

      const { dateStr, nowUzt } = getUztTimeInfo();
      const isDone = grp?.lastDutyDoneDate === dateStr;
      const currentOffset = grp?.dutyOffset || 0;
      const activePerson = getActiveDutyPerson(roster, currentOffset, isDone);
      const dateLabel = formatUzDate(nowUzt);

      if (sub === 'schedule' || sub === 'list') {
        const schedule = getDutySchedule(grp, mems, 7);
        await api.sendMessage({
          chat_id: chatId,
          text: formatDutyMessage(schedule, grp),
        });
        return;
      }

      // Minimal response:
      // Regular users only see who is on duty with date (no buttons).
      // Admin sees the [Done] button if not yet confirmed.
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      const reply_markup = (isAdmin && !isDone)
        ? { inline_keyboard: [[{ text: 'Done', callback_data: 'duty_confirm' }]] }
        : undefined;

      await api.sendMessage({
        chat_id: chatId,
        text: formatMinimalDutyNotification(activePerson, dateLabel, isDone),
        reply_markup,
      });
      break;
    }

    case '/balance': {
      const groupMembers = await getMembers(chatId);
      const groupExpenses = await getExpenses(chatId, { limit: 10000, includeSettled: false });
      const grp = await getGroup(chatId);
      const roster = getExpenseRosterList(grp);

      if (!groupExpenses || groupExpenses.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: 'No active expenses recorded yet.',
        });
        return;
      }

      const numParticipants = roster && roster.length > 0 ? roster.length : groupMembers.length;
      if (numParticipants <= 1) {
        const onlyMember = groupMembers[0]?.name || displayName;
        const total = groupExpenses.reduce((s, e) => s + e.amount, 0);
        await api.sendMessage({
          chat_id: chatId,
          text:
            `Current Balance\n\n` +
            `${onlyMember} paid: ${formatMoney(total, 'UZS')}\n` +
            `Balance: 0 (only 1 participant registered)\n\n` +
            `Admin: /setmembers @user1 @user2`,
        });
        return;
      }

      const balancesByCurrency = calculateBalances(groupMembers, groupExpenses, grp);
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
      const grp = await getGroup(chatId);

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
      const grp = await getGroup(chatId);
      const memberMap = buildMemberNameMap(groupMembers, weekExpenses);
      const unsettledWeek = weekExpenses.filter((e) => e.settled === 0);
      const balancesByCur = calculateBalances(groupMembers, unsettledWeek, grp);

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
