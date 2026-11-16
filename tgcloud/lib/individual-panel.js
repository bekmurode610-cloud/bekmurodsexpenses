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
  getPersonalDebtById,
  repayPersonalDebt,
  getUserApartmentBalance,
  touchMessageDeletion,
  cancelMessageDeletion,
} from './db-service.js';
import {
  escapeHtml,
  getUztTimeInfo,
  formatUzDate,
  formatUztDateTime,
  formatYmdShortUz,
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

async function editOrSend(api, chatId, messageId, text, replyMarkup, parseMode = 'HTML') {
  const payload = { chat_id: chatId, text, reply_markup: replyMarkup };
  if (parseMode) payload.parse_mode = parseMode;
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
  const text = "<b>Xush kelibsiz</b>\n\nQaysi bo'limdan foydalanasiz?";
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

export function formatPersonalHomeText({ stats, ps, apt, dateLabel, notice = '' }) {
  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>Shaxsiy kabinet</b> · ${escapeHtml(dateLabel)}\n\n`;
  text += `<b>Hamyon</b> · <b>${formatMoney(stats.walletUzs, 'UZS')}</b>\n`;
  text += `<blockquote>Karta — <b>${formatMoney(stats.cardBalanceUzs, 'UZS')}</b>\nNaqd — <b>${formatMoney(stats.cashBalanceUzs, 'UZS')}</b></blockquote>\n\n`;

  text += `<b>Shu oy</b>\n`;
  text += `<blockquote>Kirim — <b>+${formatMoney(stats.monthIncomeUzs, 'UZS')}</b> <i>(Karta: +${formatMoney(stats.monthIncomeCardUzs, 'UZS')} · Naqd: +${formatMoney(stats.monthIncomeCashUzs, 'UZS')})</i>\n`;
  text += `Chiqim — <b>-${formatMoney(stats.monthSpentUzs, 'UZS')}</b></blockquote>`;

  const extraLines = [];
  if (ps.dailyLimit > 0) {
    const rem = ps.dailyLimit - stats.todaySpentUzs;
    extraLines.push(
      `Bugun — <b>${formatMoney(stats.todaySpentUzs, 'UZS')}</b> / ${formatMoney(ps.dailyLimit, 'UZS')} <i>(qoldiq: ${formatMoney(rem, 'UZS')})</i>`
    );
  } else if (stats.todaySpentUzs > 0) {
    extraLines.push(`Bugungi chiqim — <b>${formatMoney(stats.todaySpentUzs, 'UZS')}</b>`);
  }

  if (ps.monthlyLimit > 0) {
    const remMon = ps.monthlyLimit - stats.monthSpentUzs;
    extraLines.push(
      `Oylik limit — <b>${formatMoney(stats.monthSpentUzs, 'UZS')}</b> / ${formatMoney(ps.monthlyLimit, 'UZS')} <i>(qoldiq: ${formatMoney(remMon, 'UZS')})</i>`
    );
  }

  if (apt) {
    const sign = apt.balance > 0 ? '+' : '';
    const wk = apt.weekLabel ? ` (${escapeHtml(apt.weekLabel)})` : '';
    extraLines.push(`Kvartira${wk} — <b>${sign}${formatMoney(apt.balance, apt.currency)}</b>`);
  }

  if (ps.dailyTasks.length > 0) {
    extraLines.push(`Vazifalar — <b>${ps.completedTaskIndices.length} / ${ps.dailyTasks.length}</b>`);
  }

  if (extraLines.length > 0) {
    text += `\n\n<b>Holat</b>\n<blockquote>${extraLines.join('\n')}</blockquote>`;
  }

  text += `\n\n<i>Tez yozish: <code>40 ming tushlik</code>, <code>+ 500 ming naqd</code>, <code>+ 2 mln karta</code></i>`;
  return text;
}

export async function renderIndividualHome(api, chatId, messageId, userId, username, notice = '') {
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);
  const records = await getPersonalRecords(userId, { limit: 1000 });
  const stats = computePersonalStats(records);
  const apt = await getUserApartmentBalance(userId, username);
  const { nowUzt } = getUztTimeInfo();

  const text = formatPersonalHomeText({
    stats,
    ps,
    apt,
    dateLabel: formatUzDate(nowUzt),
    notice,
  });

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

export function formatPersonalReportText(records, dateLabel, notice = '') {
  const stats = computePersonalStats(records);
  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>Shaxsiy hisobot</b> · ${escapeHtml(dateLabel)}\n\n`;

  text += `<b>Joriy hamyon</b> · <b>${formatMoney(stats.walletUzs, 'UZS')}</b>\n`;
  text += `<blockquote>Karta — <b>${formatMoney(stats.cardBalanceUzs, 'UZS')}</b>\nNaqd — <b>${formatMoney(stats.cashBalanceUzs, 'UZS')}</b></blockquote>\n\n`;

  text += `<b>Shu oydagi oqim</b>\n`;
  text += `<blockquote>Kirim — <b>+${formatMoney(stats.monthIncomeUzs, 'UZS')}</b> <i>(Karta: +${formatMoney(stats.monthIncomeCardUzs, 'UZS')} · Naqd: +${formatMoney(stats.monthIncomeCashUzs, 'UZS')})</i>\n`;
  text += `Chiqim — <b>-${formatMoney(stats.monthSpentUzs, 'UZS')}</b> <i>(Karta: -${formatMoney(stats.monthSpentCardUzs, 'UZS')} · Naqd: -${formatMoney(stats.monthSpentCashUzs, 'UZS')})</i>\n`;
  text += `Bugungi chiqim — <b>${formatMoney(stats.todaySpentUzs, 'UZS')}</b></blockquote>`;

  if (stats.otherCur.size > 0) {
    const curLines = [];
    for (const [cur, val] of stats.otherCur.entries()) {
      curLines.push(`${escapeHtml(cur)} — <b>${formatMoney(val, cur)}</b>`);
    }
    text += `\n\n<b>Boshqa valyutalar</b>\n<blockquote>${curLines.join('\n')}</blockquote>`;
  }

  if (stats.monthByCat.size > 0) {
    const sorted = Array.from(stats.monthByCat.entries()).sort((a, b) => b[1] - a[1]);
    const catLines = sorted.map(([cat, amt]) => {
      const pct = stats.monthSpentUzs > 0 ? Math.round((amt / stats.monthSpentUzs) * 100) : 0;
      return `${escapeHtml(cat)} — <b>${formatMoney(amt, 'UZS')}</b> <i>(${pct}%)</i>`;
    });
    text += `\n\n<b>Bo'limlar (shu oy)</b>\n<blockquote>${catLines.join('\n')}</blockquote>`;
  } else {
    text += `\n\n<i>Bu oyda hali chiqim kiritilmagan.</i>`;
  }

  return text.trim();
}

export function formatPersonalByCategoryText(records = []) {
  const { dateStr } = getUztTimeInfo();
  const monthStr = dateStr.slice(0, 7);
  const monthItems = records
    .filter((r) => getUztParts(r.createdAt).monthStr === monthStr)
    .slice()
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt) || (b.id || 0) - (a.id || 0));

  if (monthItems.length === 0) {
    return `<b>Bo'limlar bo'yicha</b> · Shu oy\n\n<i>Bu oyda hali yozuvlar yo'q.</i>`;
  }

  const byCat = new Map();
  for (const r of monthItems) {
    const key = r.type === 'income' ? 'Kirim' : r.category || 'Boshqa';
    if (!byCat.has(key)) {
      byCat.set(key, { name: key, isIncome: r.type === 'income', totals: {}, rows: [] });
    }
    const entry = byCat.get(key);
    const cur = (r.currency || 'UZS').toUpperCase();
    entry.totals[cur] = Math.round(((entry.totals[cur] || 0) + r.amount) * 10) / 10;
    entry.rows.push(r);
  }

  const sortedCats = Array.from(byCat.values()).sort((a, b) => {
    if (a.isIncome !== b.isIncome) return a.isIncome ? 1 : -1;
    const va = a.totals.UZS || Object.values(a.totals)[0] || 0;
    const vb = b.totals.UZS || Object.values(b.totals)[0] || 0;
    return vb - va;
  });

  let text = `<b>Bo'limlar bo'yicha</b> · Shu oy <i>(${monthItems.length} ta)</i>\n\n`;
  let renderedCount = 0;

  for (const g of sortedCats) {
    const sign = g.isIncome ? '+' : '-';
    const totalStr = Object.entries(g.totals)
      .map(([c, v]) => `${sign}${formatMoney(v, c)}`)
      .join(' · ');
    const header = `<b>${escapeHtml(g.name)}</b>  ·  <b>${escapeHtml(totalStr)}</b> <i>(${g.rows.length} ta)</i>\n`;
    const lines = [];

    for (const r of g.rows) {
      const dt = formatUztDateTime(r.createdAt);
      const pm = methodLabel(r.paymentMethod);
      const rSign = r.type === 'income' ? '+' : '-';
      const line = `<b>${rSign}${formatMoney(r.amount, r.currency)}</b> — ${escapeHtml(r.description)} · ${pm}  <i>(${escapeHtml(dt)})</i>`;
      const tentative = `${text}${header}<blockquote>${[...lines, line].join('\n')}</blockquote>\n\n`;
      if (tentative.length > 3850) {
        if (lines.length > 0) {
          text += `${header}<blockquote>${lines.join('\n')}</blockquote>\n\n`;
        }
        const rem = monthItems.length - renderedCount;
        text += `<i>... yana ${rem} ta yozuv sig'madi</i>`;
        return text.trim();
      }
      lines.push(line);
      renderedCount++;
    }

    text += `${header}<blockquote>${lines.join('\n')}</blockquote>\n\n`;
  }
  return text.trim();
}

export function formatPersonalByTimeText(records = []) {
  const items = records
    .slice()
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt) || (b.id || 0) - (a.id || 0))
    .slice(0, 60);

  if (items.length === 0) {
    return `<b>Vaqt bo'yicha</b>\n\n<i>Hozircha yozuvlar yo'q.</i>`;
  }

  const daysMap = new Map();
  for (const r of items) {
    const dayKey = getUztParts(r.createdAt).dateStr;
    if (!daysMap.has(dayKey)) {
      daysMap.set(dayKey, { dayLabel: formatYmdShortUz(dayKey), rows: [] });
    }
    daysMap.get(dayKey).rows.push(r);
  }

  let text = `<b>Vaqt bo'yicha</b> · So'nggi <i>(${items.length} ta)</i>\n\n`;
  let renderedCount = 0;

  for (const dayGroup of daysMap.values()) {
    const header = `<b>${escapeHtml(dayGroup.dayLabel)}</b>\n`;
    const lines = [];

    for (const r of dayGroup.rows) {
      const ms = toMs(r.createdAt);
      const uzt = new Date(ms + UZT_OFFSET_MS);
      const hhmm = `${String(uzt.getUTCHours()).padStart(2, '0')}:${String(uzt.getUTCMinutes()).padStart(2, '0')}`;
      const pm = methodLabel(r.paymentMethod);
      const sign = r.type === 'income' ? '+' : '-';
      const catTag = r.type === 'income' ? 'Kirim' : r.category;
      const line = `<code>${hhmm}</code> · ${pm} · <b>${sign}${formatMoney(r.amount, r.currency)}</b> — ${escapeHtml(r.description)} <i>(${escapeHtml(catTag)})</i>`;

      const tentative = `${text}${header}<blockquote>${[...lines, line].join('\n')}</blockquote>\n\n`;
      if (tentative.length > 3850) {
        if (lines.length > 0) {
          text += `${header}<blockquote>${lines.join('\n')}</blockquote>\n\n`;
        }
        const rem = items.length - renderedCount;
        text += `<i>... yana ${rem} ta yozuv sig'madi</i>`;
        return text.trim();
      }
      lines.push(line);
      renderedCount++;
    }

    text += `${header}<blockquote>${lines.join('\n')}</blockquote>\n\n`;
  }
  return text.trim();
}

async function renderReport(api, chatId, messageId, userId, notice = '', viewMode = 'summary') {
  const records = await getPersonalRecords(userId, { limit: 1000 });
  const { nowUzt } = getUztTimeInfo();

  let text;
  if (viewMode === 'cat') {
    text = formatPersonalByCategoryText(records);
  } else if (viewMode === 'time') {
    text = formatPersonalByTimeText(records);
  } else {
    text = formatPersonalReportText(records, formatUzDate(nowUzt), notice);
  }

  const rows = [
    [
      {
        text: `${viewMode === 'cat' ? '• ' : ''}Bo'limlar bo'yicha`,
        callback_data: 'ind:r_cat',
      },
      {
        text: `${viewMode === 'time' ? '• ' : ''}Vaqt bo'yicha`,
        callback_data: 'ind:r_time',
      },
    ],
    [
      { text: 'Yozuvlar', callback_data: 'ind:records' },
      { text: 'Tozalash', callback_data: 'ind:r_clear' },
    ],
    [
      ...(viewMode !== 'summary' ? [{ text: '← Hisobotga', callback_data: 'ind:report' }] : []),
      { text: '← Kabinetga', callback_data: 'ind:home' },
    ],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderRecords(api, chatId, messageId, userId, notice = '') {
  const recent = await getPersonalRecords(userId, { limit: 12 });
  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>So'nggi yozuvlar</b>\n\n`;

  if (recent.length === 0) {
    text += `<i>Hozircha yozuvlar yo'q.</i>`;
  } else {
    const lines = recent.map((r) => {
      const sign = r.type === 'income' ? '+' : '-';
      const curMethod = methodLabel(r.paymentMethod);
      const dt = formatUztDateTime(r.createdAt);
      return `<code>${escapeHtml(dt)}</code> · ${curMethod} · <b>${sign}${formatMoney(r.amount, r.currency)}</b> — ${escapeHtml(r.description)}`;
    });
    text += `<blockquote>${lines.join('\n')}</blockquote>\n\n`;
    text += `<i>O'chirish yoki Karta/Naqd usulini almashtirish uchun tugmani bosing.</i>`;
  }

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

  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>Qarz daftari</b>\n\n`;

  if (debts.length === 0) {
    text += `<i>Hozircha ochiq qarzlar yo'q.</i>`;
  } else {
    if (oweMe.length > 0) {
      const lines = oweMe.map(
        (d) =>
          `<b>${escapeHtml(d.personName)}</b> — <b>${formatMoney(d.amount, d.currency)}</b>${d.note ? ` <i>(${escapeHtml(d.note)})</i>` : ''}`
      );
      text += `<b>Haqqim</b> <i>(menga berishadi)</i>\n<blockquote>${lines.join('\n')}</blockquote>\n\n`;
    }
    if (iOwe.length > 0) {
      const lines = iOwe.map(
        (d) =>
          `<b>${escapeHtml(d.personName)}</b> — <b>${formatMoney(d.amount, d.currency)}</b>${d.note ? ` <i>(${escapeHtml(d.note)})</i>` : ''}`
      );
      text += `<b>Qarzim</b> <i>(men beraman)</i>\n<blockquote>${lines.join('\n')}</blockquote>\n\n`;
    }
    text += `<i>Qaytarish yoki qisman to'lash uchun qarz ustiga bosing.</i>`;
  }

  const rows = debts.slice(0, 10).map((d) => {
    const tag = d.direction === 'owe_me' ? 'Haqqim' : 'Qarzim';
    return [
      {
        text: `${tag}: ${d.personName} (${formatMoney(d.amount, d.currency)})`,
        callback_data: `ind:d_open:${d.id}`,
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

export async function applyDebtCreationWalletImpact({
  userId,
  direction,
  personName,
  amount,
  currency = 'UZS',
  note = '',
  walletMethod = 'none',
}) {
  if (walletMethod !== 'card' && walletMethod !== 'cash') return null;
  const isOweMe = direction === 'owe_me';
  return await addPersonalRecord({
    userId,
    type: isOweMe ? 'expense' : 'income',
    paymentMethod: walletMethod,
    amount,
    currency,
    category: isOweMe ? 'Qarz' : 'Kirim',
    description: `${personName} ${isOweMe ? 'ga qarz' : 'dan qarz'}${note ? ` (${note})` : ''}`,
  });
}

export async function applyDebtRepayment({
  userId,
  debtId,
  payAmount = null,
  walletMethod = 'none',
}) {
  const res = await repayPersonalDebt(userId, debtId, payAmount);
  if (!res) return null;

  if (walletMethod === 'card' || walletMethod === 'cash') {
    const isOweMe = res.debt.direction === 'owe_me';
    const desc = isOweMe
      ? res.closed
        ? `${res.debt.personName} qarz qaytardi`
        : `${res.debt.personName} qarzdan qaytardi`
      : res.closed
      ? `${res.debt.personName} ga qarz to'landi`
      : `${res.debt.personName} ga qisman qarz`;

    await addPersonalRecord({
      userId,
      type: isOweMe ? 'income' : 'expense',
      paymentMethod: walletMethod,
      amount: res.paid,
      currency: res.debt.currency || 'UZS',
      category: isOweMe ? 'Kirim' : 'Qarz',
      description: desc,
    });
  }
  return res;
}

async function renderDebtDetail(api, chatId, messageId, userId, debtId) {
  const debt = await getPersonalDebtById(userId, debtId);
  if (!debt || debt.isPaid) {
    await renderDebts(api, chatId, messageId, userId, "Qarz topilmadi.");
    return;
  }

  const isOweMe = debt.direction === 'owe_me';
  const title = isOweMe
    ? `<b>${escapeHtml(debt.personName)}</b> · Haqqim`
    : `<b>${escapeHtml(debt.personName)}</b> · Qarzim`;
  const actionNote = isOweMe
    ? "Qaytarilgan summa hamyoningizga Kirim sifatida qo'shiladi."
    : "To'langan summa hamyoningizdan chiqim sifatida ayriladi.";

  let body = `Qoldiq — <b>${formatMoney(debt.amount, debt.currency)}</b>`;
  if (debt.note) body += `\nIzoh — <i>${escapeHtml(debt.note)}</i>`;

  const text = `${title}\n<blockquote>${body}</blockquote>\n\n<i>${actionNote}</i>`;

  const rows = [
    [
      { text: "✓ To'liq · Karta", callback_data: `ind:d_exec:${debt.id}:full:card` },
      { text: "✓ To'liq · Naqd", callback_data: `ind:d_exec:${debt.id}:full:cash` },
    ],
    [
      { text: 'Qisman qaytarish', callback_data: `ind:d_part:${debt.id}` },
      { text: 'Hamyonsiz yopish', callback_data: `ind:d_exec:${debt.id}:full:none` },
    ],
    [{ text: '← Orqaga', callback_data: 'ind:debts' }],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderTasks(api, chatId, messageId, userId, editMode = false, notice = '') {
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);
  const doneSet = new Set(ps.completedTaskIndices);
  const reminderLabel = ps.reminderEnabled ? `${ps.reminderTime}` : "O'chirilgan";

  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>Kunlik vazifalar</b>\n\n`;
  text += `<blockquote>Bajarildi — <b>${doneSet.size} / ${ps.dailyTasks.length}</b>\nKunlik eslatma — <b>${escapeHtml(reminderLabel)}</b></blockquote>`;
  if (editMode) {
    text += `\n\n<i>O'chirish uchun vazifa ustiga bosing.</i>`;
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

  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>Shaxsiy eslatma vaqti</b>\n\n`;
  text += `<blockquote>Vaqt — <b>${escapeHtml(ps.reminderTime)} (UZT)</b>\nHolat — <b>${statusText}</b></blockquote>`;

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

  let text = notice ? `<i>${escapeHtml(notice)}</i>\n\n` : '';
  text += `<b>Xarajat limitlari</b>\n\n`;
  const dailyStr = ps.dailyLimit > 0 ? formatMoney(ps.dailyLimit, 'UZS') : "O'rnatilmagan";
  const monthlyStr = ps.monthlyLimit > 0 ? formatMoney(ps.monthlyLimit, 'UZS') : "O'rnatilmagan";
  text += `<blockquote>Kunlik limit — <b>${dailyStr}</b>\nOylik limit — <b>${monthlyStr}</b></blockquote>`;

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

  let walletMethod = 'none';
  if (/\b(naqd|naxt|cash|qol)\b|(?:^|\s)qo['’`]?l(?=$|\s)/i.test(desc)) {
    walletMethod = 'cash';
  } else if (/\b(karta|kartaga|kartadan|card|plastik)\b/i.test(desc)) {
    walletMethod = 'card';
  }

  const cleanedDesc =
    walletMethod === 'none'
      ? desc
      : desc
          .replace(/\b(naqd|naxt|cash|qol|karta|kartaga|kartadan|card|plastik)\b/gi, '')
          .replace(/(?:^|\s)qo['’`]?l(?=$|\s)/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

  const words = cleanedDesc.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const personName = words[0];
  const note = words.slice(1).join(' ');
  return {
    personName,
    amount: parsed.amount,
    currency: parsed.currency,
    note,
    walletMethod,
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
          text: "Ism va summani yozing (hamyondan yechish uchun karta/naqd qo'shing, masalan: Ali 50 ming karta):",
          reply_markup: getBackKeyboard('ind:debts'),
        });
        return;
      }
      const direction = mode === 'ind_add_om' ? 'owe_me' : 'i_owe';
      await addPersonalDebt({
        userId,
        direction,
        personName: parsed.personName,
        amount: parsed.amount,
        currency: parsed.currency,
        note: parsed.note,
      });
      await applyDebtCreationWalletImpact({
        userId,
        direction,
        personName: parsed.personName,
        amount: parsed.amount,
        currency: parsed.currency,
        note: parsed.note,
        walletMethod: parsed.walletMethod,
      });
      const walletNote =
        parsed.walletMethod === 'none'
          ? ''
          : ` (${methodLabel(parsed.walletMethod)} hamyon yangilandi)`;
      await renderDebts(api, chatId, null, userId, `${parsed.personName} saqlandi${walletNote}.`);
      return;
    }

    if (mode.startsWith('ind_d_part:')) {
      const debtId = parseInt(mode.split(':')[1], 10);
      const parsed = parseExpenseInput(text.replace(/^[+*]+/, '').trim());
      if (!parsed || isNaN(debtId)) {
        await setAdminSession(userId, { awaitingInput: mode });
        await api.sendMessage({
          chat_id: chatId,
          text: "Qaytarilgan summani yozing (masalan: 50 ming yoki 50 ming naqd):",
          reply_markup: getBackKeyboard(`ind:d_open:${debtId}`),
        });
        return;
      }

      const rawDesc = text.toLowerCase();
      let explicitMethod = null;
      if (/\b(naqd|naxt|cash)\b/.test(rawDesc)) explicitMethod = 'cash';
      else if (/\b(karta|card|plastik|uzcard|humo|click|payme)\b/.test(rawDesc)) explicitMethod = 'card';

      if (explicitMethod) {
        const res = await applyDebtRepayment({
          userId,
          debtId,
          payAmount: parsed.amount,
          walletMethod: explicitMethod,
        });
        const notice = res
          ? res.closed
            ? `${res.debt.personName} qarzi yopildi (${methodLabel(explicitMethod)}).`
            : `${formatMoney(res.paid, res.debt.currency)} qabul qilindi (${methodLabel(explicitMethod)}). Qoldiq: ${formatMoney(res.remaining, res.debt.currency)}.`
          : 'Qarz topilmadi.';
        await renderDebts(api, chatId, null, userId, notice);
        return;
      }

      const debt = await getPersonalDebtById(userId, debtId);
      const label = debt ? `${debt.personName}: ${formatMoney(parsed.amount, debt.currency)}` : formatMoney(parsed.amount, parsed.currency);
      await api.sendMessage({
        chat_id: chatId,
        text: `${label}\n\nQaysi hamyonga yozilsin?`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Karta (Kirim)', callback_data: `ind:d_exec:${debtId}:${parsed.amount}:card` },
              { text: 'Naqd (Kirim)', callback_data: `ind:d_exec:${debtId}:${parsed.amount}:cash` },
            ],
            [
              { text: 'Hamyonsiz', callback_data: `ind:d_exec:${debtId}:${parsed.amount}:none` },
              { text: '← Orqaga', callback_data: `ind:d_open:${debtId}` },
            ],
          ],
        },
      });
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
    ? `<b>Kirim (${methodLabel(method)})</b>`
    : `<b>Chiqim (${escapeHtml(record.category)} · ${methodLabel(method)})</b>`;

  let body = `<b>${sign}${formatMoney(record.amount, record.currency)}</b> — ${escapeHtml(record.description)}\n`;
  body += `Hamyon — <b>${formatMoney(stats.walletUzs, 'UZS')}</b> <i>(Karta: ${formatMoney(stats.cardBalanceUzs, 'UZS')} · Naqd: ${formatMoney(stats.cashBalanceUzs, 'UZS')})</i>`;

  if (!isIncome && ps?.dailyLimit > 0 && record.currency === 'UZS') {
    const rem = ps.dailyLimit - stats.todaySpentUzs;
    body += `\nBugungi limit qoldig'i — <b>${formatMoney(rem, 'UZS')}</b>`;
  }

  return {
    text: `${header}\n<blockquote>${body}</blockquote>`,
    parse_mode: 'HTML',
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
    await renderReport(api, chatId, messageId, userId, '', 'summary');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'r_cat' || action === 'r_time') {
    await renderReport(api, chatId, messageId, userId, '', action === 'r_cat' ? 'cat' : 'time');
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
    const records = await getPersonalRecords(userId, { limit: 100 });
    const rec = !isNaN(recId) ? records.find((r) => r.id === recId) : null;
    if (!rec) {
      await renderRecords(api, chatId, messageId, userId, 'Yozuv topilmadi.');
      await api.answerCallbackQuery({ callback_query_id: cbId });
      return;
    }
    const sign = rec.type === 'income' ? '+' : '-';
    const curMethod = rec.paymentMethod === 'cash' ? 'cash' : 'card';
    const summary = `<b>${sign}${formatMoney(rec.amount, rec.currency)}</b> — ${escapeHtml(rec.description)} <i>(${methodLabel(curMethod)})</i>`;
    await editOrSend(
      api,
      chatId,
      messageId,
      `<b>1-tasdiqlash</b> · Ushbu yozuvni o'chirasizmi? <i>(1/2)</i>\n\n<blockquote>${summary}</blockquote>`,
      {
        inline_keyboard: [
          [{ text: "Yo'q, bekor qilish", callback_data: 'ind:records' }],
          [{ text: "Ha, davom etish (1/2)", callback_data: `ind:r_del1:${rec.id}` }],
        ],
      }
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'r_del1') {
    const recId = parseInt(arg, 10);
    const records = await getPersonalRecords(userId, { limit: 100 });
    const rec = !isNaN(recId) ? records.find((r) => r.id === recId) : null;
    if (!rec) {
      await renderRecords(api, chatId, messageId, userId, 'Yozuv topilmadi.');
      await api.answerCallbackQuery({ callback_query_id: cbId });
      return;
    }
    const sign = rec.type === 'income' ? '+' : '-';
    const curMethod = rec.paymentMethod === 'cash' ? 'cash' : 'card';
    const summary = `<b>${sign}${formatMoney(rec.amount, rec.currency)}</b> — ${escapeHtml(rec.description)} <i>(${methodLabel(curMethod)})</i>`;
    await editOrSend(
      api,
      chatId,
      messageId,
      `<b>2-tasdiqlash</b> · Aniq butunlay o'chirasizmi? <i>(2/2)</i>\n\n<blockquote>${summary}</blockquote>\n<i>Bu amalni ortga qaytarib bo'lmaydi.</i>`,
      {
        inline_keyboard: [
          [{ text: "← Yo'q, qolsin", callback_data: 'ind:records' }],
          [{ text: "Ha, butunlay o'chirish (2/2)", callback_data: `ind:r_del2:${rec.id}` }],
        ],
      }
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'r_del2') {
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
      "1-tasdiqlash: Barcha shaxsiy kirim va chiqim yozuvlarini o'chirasizmi? (1/2)",
      {
        inline_keyboard: [
          [{ text: 'Bekor qilish', callback_data: 'ind:report' }],
          [{ text: "Ha, davom etish (1/2)", callback_data: 'ind:r_clear1' }],
        ],
      }
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'r_clear1') {
    await editOrSend(
      api,
      chatId,
      messageId,
      "2-tasdiqlash: Barcha yozuvlar butunlay o'chiriladi. Davom etasizmi? (2/2)",
      {
        inline_keyboard: [
          [{ text: "← Yo'q, qolsin", callback_data: 'ind:report' }],
          [{ text: "Ha, hammasini o'chirish (2/2)", callback_data: 'ind:r_clear_ok' }],
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

  if (action === 'd_open' || action === 'd_pay') {
    const debtId = parseInt(arg, 10);
    if (!isNaN(debtId)) {
      await renderDebtDetail(api, chatId, messageId, userId, debtId);
    } else {
      await renderDebts(api, chatId, messageId, userId);
    }
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_part') {
    const debtId = parseInt(arg, 10);
    if (!isNaN(debtId)) {
      await setAdminSession(userId, { mode: 'individual', awaitingInput: `ind_d_part:${debtId}` });
      await editOrSend(
        api,
        chatId,
        messageId,
        "Qancha qaytarildi? Summani yozing (xohlasangiz naqd/karta qo'shing, masalan: 50 ming yoki 50 ming naqd):",
        getBackKeyboard(`ind:d_open:${debtId}`)
      );
    }
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_exec') {
    const [idStr, amtStr, methodStr] = arg.split(':');
    const debtId = parseInt(idStr, 10);
    const payAmount = amtStr === 'full' ? null : parseFloat(amtStr);
    const walletMethod = methodStr === 'card' || methodStr === 'cash' ? methodStr : 'none';
    const res = !isNaN(debtId)
      ? await applyDebtRepayment({ userId, debtId, payAmount, walletMethod })
      : null;

    let notice = 'Qarz topilmadi.';
    if (res) {
      const mText = walletMethod === 'none' ? '' : ` · ${methodLabel(walletMethod)}`;
      notice = res.closed
        ? `${res.debt.personName} qarzi yopildi (${formatMoney(res.paid, res.debt.currency)}${mText}).`
        : `${formatMoney(res.paid, res.debt.currency)} qabul qilindi${mText}. Qoldiq: ${formatMoney(res.remaining, res.debt.currency)}.`;
    }
    await renderDebts(api, chatId, messageId, userId, notice);
    await api.answerCallbackQuery({ callback_query_id: cbId, text: res?.closed ? 'Yopildi' : 'Saqlandi' });
    return;
  }

  if (action === 'd_add_om' || action === 'd_add_io') {
    const inputKey = action === 'd_add_om' ? 'ind_add_om' : 'ind_add_io';
    await setAdminSession(userId, { mode: 'individual', awaitingInput: inputKey });
    const prompt = action === 'd_add_om'
      ? "Kimga qarz berdingiz? Ism va summani yozing (hamyondan yechish uchun karta/naqd qo'shing, masalan: Ali 50 ming karta):"
      : "Kimdan qarz oldingiz? Ism va summani yozing (hamyonga qo'shish uchun karta/naqd yozing, masalan: Vali 100 ming naqd):";
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
