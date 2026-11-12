import { api } from 'sdk';
import {
  getGroup,
  getMembers,
  setGroupDutyOffset,
  setGroupLastDutyDoneDate,
  sendAutoDeleteMessage,
} from '../lib/db-service.js';
import {
  getDutyRosterList,
  getUztTimeInfo,
  formatUzDate,
  formatMinimalDutyNotification,
  getDutyAdminKeyboard,
} from '../lib/settlement.js';

export default async function (input, ctx) {
  const chatId = input?.chatId || -1003778975985;
  const grp = await getGroup(chatId);
  if (!grp) return { error: 'Group not found' };

  const mems = await getMembers(chatId);
  const roster = getDutyRosterList(grp, mems);
  if (!roster || roster.length === 0) return { error: 'Roster empty' };

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

  await sendAutoDeleteMessage(api, chatId, {
    chat_id: chatId,
    text: `Done holati bekor qilindi.\n\n${formatMinimalDutyNotification(person, dateLabel, false)}`,
    reply_markup: getDutyAdminKeyboard(false),
  });

  return {
    ok: true,
    person,
    dutyOffset: targetOffset,
    lastDutyDoneDate: null,
  };
}
