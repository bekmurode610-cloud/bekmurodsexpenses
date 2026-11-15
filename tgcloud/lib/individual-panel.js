import {
  getAdminSession,
  setAdminSession,
  updatePersonalSettings,
  addPersonalRecord,
  getPersonalRecords,
  deletePersonalRecord,
  togglePersonalRecordMethod,
  clearPersonalRecords,
  addPersonalDebt,
  getPersonalDebts,
  markPersonalDebtPaid,
  getUserApartmentBalance,
  touchMessageDeletion,
  cancelMessageDeletion,
} from './db-service.js';
import {
  getUztTimeInfo,
  formatUzDate,
  getPersonalSettings,
  buildPersonalReminderPayload,
} from './settlement.js';
import { formatMoney, parseExpenseInput } from './format.js';

export const MINI_APP_URL = 'https://app8656629226.tgcloud.ai/';
const UZT_OFFSET_MS = 5 * 3600 * 1000;

function toMs(val) {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
  const parsed = Date.parse(val);
  return isNaN(parsed) ? 0 : parsed;
}

function getUztParts(tsVal) {
  const ms = toMs(tsVal);
  const d = new Date(ms + UZT_OFFSET_MS);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    monthStr: `${yyyy}-${mm}`,
  };
}

export function detectExpenseCategory(description) {
  const d = (description || '').toLowerCase();
  if (/(non|osh|shashlik|kafe|choy|suv|tushlik|kechki|nonushta|ovqat|somsa|lag'mon|lagmon|shaurma|burger|pizza|kola|fanta|kofe|coffee|lunch|dinner|food)/.test(d)) {
    return 'Ovqat';
  }
  if (/(taksi|taxi|yandex|metro|avtobus|bus|benzin|proezd|yo'l|yol|marshrut|poyezd|samolyot)/.test(d)) {
    return "Yo'l";
  }
  if (/(bozor|korzinka|havas|makro|do'kon|dokon|magazin|go'sht|gosht|kartoshka|piyoz|sabzi|yog'|guruch|meva|uzum|olma|sut|tuxum)/.test(d)) {
    return 'Bozorlik';
  }
  if (/(svet|elektr|gaz|internet|wifi|wi-fi|kvartira|arenda|ijara|kommunal|musur)/.test(d)) {
    return 'Kommunal';
  }
  if (/(telefon|balans|paynet|beeline|ucell|uzmobile|mobiuz|tarif)/.test(d)) {
    return 'Aloqa';
  }
  return 'Boshqa';
}

export function extractPaymentMethod(rawDescription, fallbackMethod = 'card', isIncome = false) {
  const raw = (rawDescription || '').trim();
  const cashRegex = /\b(naqd|naxt|cash|qol)\b|(?:^|\s)qo['’`]?l(?=$|\s)/i;
  const cardRegex = /\b(karta|kartaga|kartadan|card|plastik|uzcard|humo|click|payme)\b/i;

  let paymentMethod = fallbackMethod === 'cash' ? 'cash' : 'card';
  if (cashRegex.test(raw)) {
    paymentMethod = 'cash';
  } else if (cardRegex.test(raw)) {
    paymentMethod = 'card';
  }

  let description = raw
    .replace(/\b(naqd|naxt|cash|karta|kartaga|kartadan|card|plastik)\b/gi, '')
    .replace(/^[-_\s,:;]+|[-_\s,:;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!description || description === 'Expense') {
    description = isIncome ? 'Kirim' : 'Xarajat';
  }

  return { paymentMethod, description };
}

function methodLabel(method) {
  return method === 'cash' ? 'Naqd' : 'Karta';
}

async function editOrSend(api, chatId, messageId, text, replyMarkup) {
  const payload = { chat_id: chatId, text, reply_markup: replyMarkup };
  if (messageId) {
    try {
      await api.editMessageText({ ...payload, message_id: messageId });
      return;
    } catch (err) {
      const msg = String(err?.description || err?.message || '');
      if (msg.includes('message is not modified')) return;
    }
  }
  await api.sendMessage(payload);
}

function getBackKeyboard(target = 'ind:home') {
  return { inline_keyboard: [[{ text: '← Orqaga', callback_data: target }]] };
}

export async function renderModeSelector(api, chatId, messageId = null) {
  const text = "Xush kelibsiz\n\nQaysi bo'limdan foydalanasiz?";
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'Shaxsiy kabinet', callback_data: 'ind:home' },
        { text: 'Guruh boshqaruvi', callback_data: 'adm:home' },
      ],
      [
        { text: 'Ilovani ochish (Mini App)', web_app: { url: MINI_APP_URL } },
      ],
    ],
  };
  await editOrSend(api, chatId, messageId, text, replyMarkup);
}

export function computePersonalStats(records) {
  const { dateStr } = getUztTimeInfo();
  const monthStr = dateStr.slice(0, 7);

  let walletUzs = 0;
  let cardBalanceUzs = 0;
  let cashBalanceUzs = 0;
  let monthSpentUzs = 0;
  let monthSpentCardUzs = 0;
  let monthSpentCashUzs = 0;
  let monthIncomeUzs = 0;
  let monthIncomeCardUzs = 0;
  let monthIncomeCashUzs = 0;
  let todaySpentUzs = 0;
  const monthByCat = new Map();
  const otherCur = new Map();

  for (const r of records) {
    const cur = (r.currency || 'UZS').toUpperCase();
    const method = r.paymentMethod === 'cash' ? 'cash' : 'card';
    const parts = getUztParts(r.createdAt);
    const inMonth = parts.monthStr === monthStr;
    const inToday = parts.dateStr === dateStr;

    if (cur === 'UZS') {
      if (r.type === 'income') {
        walletUzs += r.amount;
        if (method === 'cash') {
          cashBalanceUzs += r.amount;
          if (inMonth) monthIncomeCashUzs += r.amount;
        } else {
          cardBalanceUzs += r.amount;
          if (inMonth) monthIncomeCardUzs += r.amount;
        }
        if (inMonth) monthIncomeUzs += r.amount;
      } else {
        walletUzs -= r.amount;
        if (method === 'cash') {
          cashBalanceUzs -= r.amount;
          if (inMonth) monthSpentCashUzs += r.amount;
        } else {
          cardBalanceUzs -= r.amount;
          if (inMonth) monthSpentCardUzs += r.amount;
        }
        if (inMonth) {
          monthSpentUzs += r.amount;
          monthByCat.set(r.category, (monthByCat.get(r.category) || 0) + r.amount);
        }
        if (inToday) todaySpentUzs += r.amount;
      }
    } else {
      const prev = otherCur.get(cur) || 0;
      otherCur.set(cur, r.type === 'income' ? prev + r.amount : prev - r.amount);
    }
  }

  return {
    walletUzs,
    cardBalanceUzs,
    cashBalanceUzs,
    monthSpentUzs,
    monthSpentCardUzs,
    monthSpentCashUzs,
    monthIncomeUzs,
    monthIncomeCardUzs,
    monthIncomeCashUzs,
    todaySpentUzs,
    monthByCat,
    otherCur,
  };
}

export async function renderIndividualHome(api, chatId, messageId, userId, username, notice = '') {
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);
  const records = await getPersonalRecords(userId, { limit: 1000 });
  const stats = computePersonalStats(records);
  const apt = await getUserApartmentBalance(userId, username);
  const { nowUzt } = getUztTimeInfo();

  let text = notice ? `${notice}\n\n` : '';
  text += `Shaxsiy kabinet · ${formatUzDate(nowUzt)}\n\n`;
  text += `Hamyon: ${formatMoney(stats.walletUzs, 'UZS')} (Karta: ${formatMoney(stats.cardBalanceUzs, 'UZS')} · Naqd: ${formatMoney(stats.cashBalanceUzs, 'UZS')})\n`;
  text += `Shu oy kirim: +${formatMoney(stats.monthIncomeUzs, 'UZS')} (Karta: +${formatMoney(stats.monthIncomeCardUzs, 'UZS')} · Naqd: +${formatMoney(stats.monthIncomeCashUzs, 'UZS')})\n`;
  text += `Shu oy chiqim: -${formatMoney(stats.monthSpentUzs, 'UZS')}\n`;

  if (ps.dailyLimit > 0) {
    const rem = ps.dailyLimit - stats.todaySpentUzs;
    text += `Bugun: ${formatMoney(stats.todaySpentUzs, 'UZS')} / ${formatMoney(ps.dailyLimit, 'UZS')} (Qoldiq: ${formatMoney(rem, 'UZS')})\n`;
  } else if (stats.todaySpentUzs > 0) {
    text += `Bugungi chiqim: ${formatMoney(stats.todaySpentUzs, 'UZS')}\n`;
  }

  if (ps.monthlyLimit > 0) {
    const remMon = ps.monthlyLimit - stats.monthSpentUzs;
    text += `Oylik limit: ${formatMoney(stats.monthSpentUzs, 'UZS')} / ${formatMoney(ps.monthlyLimit, 'UZS')} (Qoldiq: ${formatMoney(remMon, 'UZS')})\n`;
  }

  if (apt) {
    const sign = apt.balance > 0 ? '+' : '';
    text += `Kvartira balansi: ${sign}${formatMoney(apt.balance, apt.currency)}\n`;
  }

  if (ps.dailyTasks.length > 0) {
    text += `Kunlik vazifalar: ${ps.completedTaskIndices.length} / ${ps.dailyTasks.length}\n`;
  }

  text += `\nYozish: "40 ming tushlik", "+ 500 ming naqd", "+ 2 mln karta"`;

  const rows = [
    [
      { text: 'Ilovani ochish (Mini App)', web_app: { url: MINI_APP_URL } },
    ],
    [
      { text: '+ Kirim (Karta)', callback_data: 'ind:inc_card' },
      { text: '+ Kirim (Naqd)', callback_data: 'ind:inc_cash' },
    ],
    [
      { text: 'Hisobot', callback_data: 'ind:report' },
      { text: 'Yozuvlar', callback_data: 'ind:records' },
    ],
    [
      { text: 'Qarz daftari', callback_data: 'ind:debts' },
      { text: 'Kunlik vazifalar', callback_data: 'ind:tasks' },
    ],
    [
      { text: 'Limitlar', callback_data: 'ind:limits' },
      { text: '⇄ Guruh', callback_data: 'adm:home' },
    ],
  ];

  await editOrSend(api, chatId, messageId, text.trim(), { inline_keyboard: rows });
}

async function renderReport(api, chatId, messageId, userId, notice = '') {
  const records = await getPersonalRecords(userId, { limit: 1000 });
  const stats = computePersonalStats(records);
  const { nowUzt } = getUztTimeInfo();

  let text = notice ? `${notice}\n\n` : '';
  text += `Shaxsiy hisobot · ${formatUzDate(nowUzt)}\n\n`;
  text += `Joriy hamyon: ${formatMoney(stats.walletUzs, 'UZS')} (Karta: ${formatMoney(stats.cardBalanceUzs, 'UZS')} · Naqd: ${formatMoney(stats.cashBalanceUzs, 'UZS')})\n`;
  text += `Oylik kirim: +${formatMoney(stats.monthIncomeUzs, 'UZS')} (Karta: +${formatMoney(stats.monthIncomeCardUzs, 'UZS')} · Naqd: +${formatMoney(stats.monthIncomeCashUzs, 'UZS')})\n`;
  text += `Oylik chiqim: -${formatMoney(stats.monthSpentUzs, 'UZS')} (Karta: -${formatMoney(stats.monthSpentCardUzs, 'UZS')} · Naqd: -${formatMoney(stats.monthSpentCashUzs, 'UZS')})\n`;
  text += `Bugungi chiqim: ${formatMoney(stats.todaySpentUzs, 'UZS')}\n`;

  if (stats.otherCur.size > 0) {
    text += `\nBoshqa valyutalar:\n`;
    for (const [cur, val] of stats.otherCur.entries()) {
      text += `${cur}: ${formatMoney(val, cur)}\n`;
    }
  }

  if (stats.monthByCat.size > 0) {
    text += `\nShu oydagi xarajatlar (bo'limlar):\n`;
    const sorted = Array.from(stats.monthByCat.entries()).sort((a, b) => b[1] - a[1]);
    for (const [cat, amt] of sorted) {
      const pct = stats.monthSpentUzs > 0 ? Math.round((amt / stats.monthSpentUzs) * 100) : 0;
      text += `${cat}: ${formatMoney(amt, 'UZS')} (${pct}%)\n`;
    }
  } else {
    text += `\nBu oyda hali chiqim kiritilmagan.`;
  }

  const rows = [
    [
      { text: 'Yozuvlar', callback_data: 'ind:records' },
      { text: 'Tozalash', callback_data: 'ind:r_clear' },
    ],
    [{ text: '← Orqaga', callback_data: 'ind:home' }],
  ];

  await editOrSend(api, chatId, messageId, text.trim(), { inline_keyboard: rows });
}

async function renderRecords(api, chatId, messageId, userId, notice = '') {
  const recent = await getPersonalRecords(userId, { limit: 12 });
  let text = notice ? `${notice}\n\n` : '';
  text += `So'nggi yozuvlar\n\n`;
  text += recent.length === 0 ? "Hozircha yozuvlar yo'q." : "O'chirish yoki Karta/Naqd usulini almashtirish uchun bosing.";

  const rows = recent.map((r) => {
    const sign = r.type === 'income' ? '+' : '-';
    const curMethod = r.paymentMethod === 'cash' ? 'cash' : 'card';
    const nextLabel = curMethod === 'cash' ? '⇄ Karta' : '⇄ Naqd';
    return [
      {
        text: `× ${sign}${formatMoney(r.amount, r.currency)} · ${r.description} (${methodLabel(curMethod)})`,
        callback_data: `ind:r_del:${r.id}`,
      },
      {
        text: nextLabel,
        callback_data: `ind:r_pm:${r.id}`,
      },
    ];
  });
  rows.push([{ text: '← Orqaga', callback_data: 'ind:home' }]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderDebts(api, chatId, messageId, userId, notice = '') {
  const debts = await getPersonalDebts(userId);
  const oweMe = debts.filter((d) => d.direction === 'owe_me');
  const iOwe = debts.filter((d) => d.direction === 'i_owe');

  let text = notice ? `${notice}\n\n` : '';
  text += `Qarz daftari\n\n`;

  if (debts.length === 0) {
    text += "Hozircha ochiq qarzlar yo'q.";
  } else {
    if (oweMe.length > 0) {
      text += `Haqqim (menga berishadi):\n`;
      oweMe.forEach((d) => {
        text += `• ${d.personName}: ${formatMoney(d.amount, d.currency)}${d.note ? ` (${d.note})` : ''}\n`;
      });
      text += '\n';
    }
    if (iOwe.length > 0) {
      text += `Qarzim (men beraman):\n`;
      iOwe.forEach((d) => {
        text += `• ${d.personName}: ${formatMoney(d.amount, d.currency)}${d.note ? ` (${d.note})` : ''}\n`;
      });
    }
    text += `\nQaytarilganini yopish uchun pastdan bosing.`;
  }

  const rows = debts.slice(0, 10).map((d) => {
    const tag = d.direction === 'owe_me' ? 'Haqqim' : 'Qarzim';
    return [
      {
        text: `✓ ${tag}: ${d.personName} (${formatMoney(d.amount, d.currency)})`,
        callback_data: `ind:d_pay:${d.id}`,
      },
    ];
  });

  rows.push([
    { text: '+ Haqqim', callback_data: 'ind:d_add_om' },
    { text: '+ Qarzim', callback_data: 'ind:d_add_io' },
  ]);
  rows.push([{ text: '← Orqaga', callback_data: 'ind:home' }]);

  await editOrSend(api, chatId, messageId, text.trim(), { inline_keyboard: rows });
}

async function renderTasks(api, chatId, messageId, userId, editMode = false, notice = '') {
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);
  const doneSet = new Set(ps.completedTaskIndices);
  const reminderLabel = ps.reminderEnabled ? `${ps.reminderTime}` : "O'chirilgan";

  let text = notice ? `${notice}\n\n` : '';
  text += `Kunlik vazifalar\n\n`;
  text += `Bajarildi: ${doneSet.size} / ${ps.dailyTasks.length}\n`;
  text += `Kunlik eslatma: ${reminderLabel}`;
  if (editMode) {
    text += `\nO'chirish uchun vazifa ustiga bosing.`;
  }

  const rows = ps.dailyTasks.map((task, idx) => {
    const shortTask = task.length > 26 ? `${task.slice(0, 25)}…` : task;
    if (editMode) {
      return [{ text: `× ${shortTask}`, callback_data: `ind:tk_rm:${idx}` }];
    }
    const isDone = doneSet.has(idx);
    return [{ text: `${isDone ? '✓' : '☐'} ${shortTask}`, callback_data: `ind:tk_tg:${idx}` }];
  });

  rows.push([
    { text: "+ Vazifa qo'shish", callback_data: 'ind:tk_add' },
    { text: editMode ? 'Tayyor' : "O'chirish", callback_data: editMode ? 'ind:tasks' : 'ind:tk_edit' },
  ]);
  rows.push([
    { text: `Eslatma: ${reminderLabel}`, callback_data: 'ind:tk_time' },
    { text: '← Orqaga', callback_data: 'ind:home' },
  ]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderTaskTime(api, chatId, messageId, userId, notice = '') {
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);
  const statusText = ps.reminderEnabled ? 'Yoqilgan' : "O'chirilgan";

  let text = notice ? `${notice}\n\n` : '';
  text += `Shaxsiy eslatma vaqti\n\n`;
  text += `Vaqt: ${ps.reminderTime} (UZT) · Holat: ${statusText}`;

  const presets = ['07:00', '08:00', '09:00', '12:00', '18:00', '20:00', '21:00', '22:00'];
  const rows = [
    [{ text: `Eslatma: ${statusText}`, callback_data: 'ind:tk_auto' }],
    presets.slice(0, 4).map((t) => ({ text: ps.reminderTime === t ? `• ${t}` : t, callback_data: `ind:tk_tm:${t}` })),
    presets.slice(4, 8).map((t) => ({ text: ps.reminderTime === t ? `• ${t}` : t, callback_data: `ind:tk_tm:${t}` })),
    [
      { text: 'Boshqa vaqt', callback_data: 'ind:tk_tmc' },
      { text: '← Orqaga', callback_data: 'ind:tasks' },
    ],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderLimits(api, chatId, messageId, userId, notice = '') {
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);

  let text = notice ? `${notice}\n\n` : '';
  text += `Xarajat limitlari\n\n`;
  text += `Kunlik limit: ${ps.dailyLimit > 0 ? formatMoney(ps.dailyLimit, 'UZS') : "O'rnatilmagan"}\n`;
  text += `Oylik limit: ${ps.monthlyLimit > 0 ? formatMoney(ps.monthlyLimit, 'UZS') : "O'rnatilmagan"}`;

  const rows = [
    [
      { text: 'Kunlik limit', callback_data: 'ind:lim_day' },
      { text: 'Oylik limit', callback_data: 'ind:lim_mon' },
    ],
    [
      { text: "Limitni o'chirish", callback_data: 'ind:lim_off' },
      { text: '← Orqaga', callback_data: 'ind:home' },
    ],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

function parseDebtInput(rawText) {
  const parsed = parseExpenseInput(rawText);
  if (!parsed) return null;
  const desc = (parsed.description || '').trim();
  if (!desc || desc === 'Expense') return null;

  const words = desc.split(/\s+/).filter(Boolean);
  const personName = words[0];
  const note = words.slice(1).join(' ');
  return {
    personName,
    amount: parsed.amount,
    currency: parsed.currency,
    note,
  };
}

export async function handleIndividualMessage(api, message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const username = message.from?.username;
  const text = (message.text || '').trim();
  if (!userId) return;

  const session = await getAdminSession(userId);

  if (text.startsWith('/start') || text.startsWith('/mode')) {
    await setAdminSession(userId, { awaitingInput: null });
    await renderModeSelector(api, chatId, null);
    return;
  }

  if (text.startsWith('/cancel')) {
    await setAdminSession(userId, { mode: 'individual', awaitingInput: null });
    await renderIndividualHome(api, chatId, null, userId, username, 'Bekor qilindi.');
    return;
  }

  if (text.startsWith('/help')) {
    await renderIndividualHome(api, chatId, null, userId, username);
    return;
  }

  if (session?.awaitingInput?.startsWith('ind_')) {
    const mode = session.awaitingInput;
    await setAdminSession(userId, { mode: 'individual', awaitingInput: null });

    if (mode === 'ind_add_om' || mode === 'ind_add_io') {
      const parsed = parseDebtInput(text);
      if (!parsed) {
        await setAdminSession(userId, { awaitingInput: mode });
        await api.sendMessage({
          chat_id: chatId,
          text: "Ism va summani yozing (masalan: Ali 50 ming tushlik):",
          reply_markup: getBackKeyboard('ind:debts'),
        });
        return;
      }
      await addPersonalDebt({
        userId,
        direction: mode === 'ind_add_om' ? 'owe_me' : 'i_owe',
        personName: parsed.personName,
        amount: parsed.amount,
        currency: parsed.currency,
        note: parsed.note,
      });
      await renderDebts(api, chatId, null, userId, `${parsed.personName} saqlandi.`);
      return;
    }

    if (mode === 'ind_add_task') {
      const items = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const ps = getPersonalSettings(session);
      await updatePersonalSettings(userId, { dailyTasks: [...ps.dailyTasks, ...items] });
      await renderTasks(api, chatId, null, userId, false, "Vazifa qo'shildi.");
      return;
    }

    if (mode === 'ind_set_time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
        await setAdminSession(userId, { awaitingInput: 'ind_set_time' });
        await api.sendMessage({
          chat_id: chatId,
          text: "Vaqtni HH:MM formatida yuboring (masalan: 08:30):",
          reply_markup: getBackKeyboard('ind:tk_time'),
        });
        return;
      }
      await updatePersonalSettings(userId, { reminderTime: text, reminderEnabled: true, lastReminderDate: null });
      await renderTaskTime(api, chatId, null, userId, `Eslatma vaqti: ${text}`);
      return;
    }

    if (mode === 'ind_inc_card' || mode === 'ind_inc_cash') {
      const cleanInput = text.replace(/^[+*]+/, '').trim();
      const parsed = parseExpenseInput(cleanInput);
      if (!parsed) {
        await setAdminSession(userId, { awaitingInput: mode });
        const hint = mode === 'ind_inc_cash'
          ? 'Naqd kirim summasi va izohni yozing (masalan: 500 ming avans):'
          : 'Karta orqali kirim summasi va izohni yozing (masalan: 2 mln oylik):';
        await api.sendMessage({
          chat_id: chatId,
          text: hint,
          reply_markup: getBackKeyboard('ind:home'),
        });
        return;
      }
      const fallbackMethod = mode === 'ind_inc_cash' ? 'cash' : 'card';
      const { paymentMethod, description } = extractPaymentMethod(parsed.description, fallbackMethod, true);
      const inserted = await addPersonalRecord({
        userId,
        type: 'income',
        paymentMethod,
        amount: parsed.amount,
        currency: parsed.currency,
        category: 'Kirim',
        description,
      });
      const records = await getPersonalRecords(userId, { limit: 1000 });
      const stats = computePersonalStats(records);
      const ps = getPersonalSettings(session);
      const payload = buildConfirmationPayload(inserted, stats, ps);
      await api.sendMessage({ chat_id: chatId, ...payload });
      return;
    }

    if (mode === 'ind_lim_day' || mode === 'ind_lim_mon') {
      const parsed = parseExpenseInput(text);
      if (!parsed) {
        await setAdminSession(userId, { awaitingInput: mode });
        await api.sendMessage({
          chat_id: chatId,
          text: "Summani kiriting (masalan: 100 ming yoki 3 mln):",
          reply_markup: getBackKeyboard('ind:limits'),
        });
        return;
      }
      const patch = mode === 'ind_lim_day' ? { dailyLimit: parsed.amount } : { monthlyLimit: parsed.amount };
      await updatePersonalSettings(userId, patch);
      await renderLimits(api, chatId, null, userId, 'Limit saqlandi.');
      return;
    }
  }

  // Instant expense or income logging
  const isIncome = text.startsWith('+');
  const cleanInput = text.replace(/^[+*]+/, '').trim();
  const parsed = parseExpenseInput(cleanInput);

  if (!parsed) {
    await renderIndividualHome(api, chatId, null, userId, username);
    return;
  }

  if (session?.mode !== 'individual') {
    await setAdminSession(userId, { mode: 'individual' });
  }

  const type = isIncome ? 'income' : 'expense';
  const { paymentMethod, description } = extractPaymentMethod(parsed.description, 'card', isIncome);
  const category = isIncome ? 'Kirim' : detectExpenseCategory(description);
  const inserted = await addPersonalRecord({
    userId,
    type,
    paymentMethod,
    amount: parsed.amount,
    currency: parsed.currency,
    category,
    description,
  });

  const records = await getPersonalRecords(userId, { limit: 1000 });
  const stats = computePersonalStats(records);
  const ps = getPersonalSettings(session);
  const payload = buildConfirmationPayload(inserted, stats, ps);

  await api.sendMessage({
    chat_id: chatId,
    ...payload,
  });
}

function buildConfirmationPayload(record, stats, ps) {
  const isIncome = record.type === 'income';
  const method = record.paymentMethod === 'cash' ? 'cash' : 'card';
  const sign = isIncome ? '+' : '-';
  const header = isIncome
    ? `Kirim (${methodLabel(method)})`
    : `Chiqim (${record.category} · ${methodLabel(method)})`;

  let confirm = `${header}: ${sign}${formatMoney(record.amount, record.currency)} · ${record.description}\n`;
  confirm += `Hamyon: ${formatMoney(stats.walletUzs, 'UZS')} (Karta: ${formatMoney(stats.cardBalanceUzs, 'UZS')} · Naqd: ${formatMoney(stats.cashBalanceUzs, 'UZS')})`;

  if (!isIncome && ps?.dailyLimit > 0 && record.currency === 'UZS') {
    const rem = ps.dailyLimit - stats.todaySpentUzs;
    confirm += `\nBugungi limit qoldig'i: ${formatMoney(rem, 'UZS')}`;
  }

  return {
    text: confirm,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: method === 'cash' ? '⇄ Karta' : '⇄ Naqd',
            callback_data: `ind:r_pm:${record.id}`,
          },
          { text: '× Bekor qilish', callback_data: `ind:r_del:${record.id}` },
          { text: 'Kabinet', callback_data: 'ind:home' },
        ],
      ],
    },
  };
}

export async function handleIndividualCallback(api, callbackQuery) {
  const data = callbackQuery.data || '';
  const cbId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const userId = callbackQuery.from?.id;
  const username = callbackQuery.from?.username;

  if (!userId || !chatId) {
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  const parts = data.split(':');
  const action = parts[1];
  const arg = parts.slice(2).join(':');

  if (action === 'mode') {
    await setAdminSession(userId, { awaitingInput: null });
    await renderModeSelector(api, chatId, messageId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'home') {
    await setAdminSession(userId, { mode: 'individual', awaitingInput: null });
    await renderIndividualHome(api, chatId, messageId, userId, username);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'inc_card' || action === 'inc_cash') {
    const inputKey = action === 'inc_cash' ? 'ind_inc_cash' : 'ind_inc_card';
    await setAdminSession(userId, { mode: 'individual', awaitingInput: inputKey });
    const prompt = action === 'inc_cash'
      ? "Naqd kirim summasi va izohni yozing (masalan: 500 ming avans):"
      : "Karta orqali kirim summasi va izohni yozing (masalan: 2 mln oylik):";
    await editOrSend(api, chatId, messageId, prompt, getBackKeyboard('ind:home'));
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'report') {
    await renderReport(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'records') {
    await renderRecords(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'r_del') {
    const recId = parseInt(arg, 10);
    if (!isNaN(recId)) {
      await deletePersonalRecord(userId, recId);
    }
    await renderRecords(api, chatId, messageId, userId, "Yozuv o'chirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId, text: "O'chirildi" });
    return;
  }

  if (action === 'r_pm') {
    const recId = parseInt(arg, 10);
    const updated = !isNaN(recId) ? await togglePersonalRecordMethod(userId, recId) : null;
    const msgText = callbackQuery.message?.text || '';
    if (updated && (msgText.startsWith('Kirim') || msgText.startsWith('Chiqim'))) {
      const session = await getAdminSession(userId);
      const records = await getPersonalRecords(userId, { limit: 1000 });
      const stats = computePersonalStats(records);
      const ps = getPersonalSettings(session);
      const payload = buildConfirmationPayload(updated, stats, ps);
      await editOrSend(api, chatId, messageId, payload.text, payload.reply_markup);
    } else {
      await renderRecords(api, chatId, messageId, userId, updated ? `Usul: ${methodLabel(updated.paymentMethod)}` : '');
    }
    await api.answerCallbackQuery({ callback_query_id: cbId, text: "Usul o'zgartirildi" });
    return;
  }

  if (action === 'r_clear') {
    await editOrSend(
      api,
      chatId,
      messageId,
      "Barcha shaxsiy kirim va chiqim yozuvlarini o'chirasizmi?",
      {
        inline_keyboard: [
          [
            { text: "Ha, o'chirish", callback_data: 'ind:r_clear_ok' },
            { text: 'Bekor qilish', callback_data: 'ind:report' },
          ],
        ],
      }
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'r_clear_ok') {
    await clearPersonalRecords(userId);
    await renderReport(api, chatId, messageId, userId, 'Barcha yozuvlar tozalandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Debts ---
  if (action === 'debts') {
    await renderDebts(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_pay') {
    const debtId = parseInt(arg, 10);
    if (!isNaN(debtId)) {
      await markPersonalDebtPaid(userId, debtId);
    }
    await renderDebts(api, chatId, messageId, userId, 'Qarz yopildi.');
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Yopildi' });
    return;
  }

  if (action === 'd_add_om' || action === 'd_add_io') {
    const inputKey = action === 'd_add_om' ? 'ind_add_om' : 'ind_add_io';
    await setAdminSession(userId, { mode: 'individual', awaitingInput: inputKey });
    const prompt = action === 'd_add_om'
      ? "Kimga qarz berdingiz? Ism va summani yozing (masalan: Ali 50 ming):"
      : "Kimdan qarz oldingiz? Ism va summani yozing (masalan: Vali 100 ming):";
    await editOrSend(api, chatId, messageId, prompt, getBackKeyboard('ind:debts'));
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Personal Tasks ---
  if (action === 'tasks') {
    await renderTasks(api, chatId, messageId, userId, false);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_edit') {
    await renderTasks(api, chatId, messageId, userId, true);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_tg' || action === 'tk_rtg') {
    const idx = parseInt(arg, 10);
    const session = await getAdminSession(userId);
    const ps = getPersonalSettings(session);
    const { dateStr, nowUzt } = getUztTimeInfo();
    const set = new Set(ps.completedTaskIndices);
    if (!isNaN(idx) && idx >= 0 && idx < ps.dailyTasks.length) {
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
    }
    const nextIndices = Array.from(set);
    await updatePersonalSettings(userId, {
      completedTasksDate: dateStr,
      completedTaskIndices: nextIndices,
    });

    if (action === 'tk_rtg') {
      const payload = buildPersonalReminderPayload(ps.dailyTasks, nextIndices, formatUzDate(nowUzt));
      await editOrSend(api, chatId, messageId, payload.text, payload.reply_markup);
      if (payload.allDone) {
        await touchMessageDeletion(chatId, messageId, 300);
      } else {
        await cancelMessageDeletion(chatId, messageId);
      }
    } else {
      await renderTasks(api, chatId, messageId, userId, false);
    }
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_rm') {
    const idx = parseInt(arg, 10);
    const session = await getAdminSession(userId);
    const ps = getPersonalSettings(session);
    const tasks = [...ps.dailyTasks];
    if (!isNaN(idx) && idx >= 0 && idx < tasks.length) {
      tasks.splice(idx, 1);
      await updatePersonalSettings(userId, { dailyTasks: tasks, completedTaskIndices: [] });
    }
    await renderTasks(api, chatId, messageId, userId, true);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_add') {
    await setAdminSession(userId, { mode: 'individual', awaitingInput: 'ind_add_task' });
    await editOrSend(api, chatId, messageId, "Yangi kunlik vazifani yozing:", getBackKeyboard('ind:tasks'));
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_time') {
    await renderTaskTime(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_auto') {
    const session = await getAdminSession(userId);
    const ps = getPersonalSettings(session);
    await updatePersonalSettings(userId, { reminderEnabled: !ps.reminderEnabled });
    await renderTaskTime(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_tm') {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(arg)) {
      await updatePersonalSettings(userId, { reminderTime: arg, reminderEnabled: true, lastReminderDate: null });
    }
    await renderTaskTime(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tk_tmc') {
    await setAdminSession(userId, { mode: 'individual', awaitingInput: 'ind_set_time' });
    await editOrSend(api, chatId, messageId, "Vaqtni HH:MM formatida yozing (masalan: 08:30):", getBackKeyboard('ind:tk_time'));
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Limits ---
  if (action === 'limits') {
    await renderLimits(api, chatId, messageId, userId);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'lim_day' || action === 'lim_mon') {
    await setAdminSession(userId, {
      mode: 'individual',
      awaitingInput: action === 'lim_day' ? 'ind_lim_day' : 'ind_lim_mon',
    });
    const prompt = action === 'lim_day'
      ? "Kunlik limitni kiriting (masalan: 100 ming):"
      : "Oylik limitni kiriting (masalan: 3 mln):";
    await editOrSend(api, chatId, messageId, prompt, getBackKeyboard('ind:limits'));
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'lim_off') {
    await updatePersonalSettings(userId, { dailyLimit: 0, monthlyLimit: 0 });
    await renderLimits(api, chatId, messageId, userId, "Limitlar o'chirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: cbId });
}
