import { formatMoney } from './format.js';

const UZT_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

export const DEFAULT_DUTY_TASKS = [
  'Suv',
  "Musur to'kish",
  'Dasturxonni qoqish',
];

export const DEFAULT_PAYMENT_INFO = '💳 9860080393751393\nShahboz Abdusattarov';

export const DEFAULT_ADMIN_ONLY_COMMANDS = [
  '/setmembers',
  '/setduty',
  '/setdutytime',
  '/settle',
  '/reset',
];

export function getGroupSettings(group) {
  const raw = group && typeof group.settings === 'object' && group.settings ? group.settings : {};
  return {
    dutyTasks: Array.isArray(raw.dutyTasks) && raw.dutyTasks.length > 0 ? raw.dutyTasks : [...DEFAULT_DUTY_TASKS],
    autoDutyEnabled: raw.autoDutyEnabled !== undefined ? Boolean(raw.autoDutyEnabled) : true,
    disabledCommands: Array.isArray(raw.disabledCommands) ? raw.disabledCommands : [],
    adminOnlyCommands: Array.isArray(raw.adminOnlyCommands) ? raw.adminOnlyCommands : [...DEFAULT_ADMIN_ONLY_COMMANDS],
    generalDeleteSeconds: raw.generalDeleteSeconds !== undefined ? Number(raw.generalDeleteSeconds) : 120,
    deleteUserCommand: raw.deleteUserCommand !== undefined ? Boolean(raw.deleteUserCommand) : true,
    pendingDutyDeleteSeconds: raw.pendingDutyDeleteSeconds !== undefined ? Number(raw.pendingDutyDeleteSeconds) : 0,
    doneDutyDeleteSeconds: raw.doneDutyDeleteSeconds !== undefined ? Number(raw.doneDutyDeleteSeconds) : 300,
    paymentInfo: raw.paymentInfo !== undefined ? String(raw.paymentInfo) : DEFAULT_PAYMENT_INFO,
    showPaymentInfo: raw.showPaymentInfo !== undefined ? Boolean(raw.showPaymentInfo) : true,
  };
}

const MONTHS_UZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

export function toMs(val) {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
  const parsed = Date.parse(val);
  return isNaN(parsed) ? 0 : parsed;
}

function formatYmdFromUtcDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatYmdShortUz(ymd) {
  if (!ymd || typeof ymd !== 'string') return '';
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [, month, day] = parts;
  return `${day}-${MONTHS_UZ[month - 1] || month}`;
}

export function formatUztDateTime(tsVal) {
  const ms = toMs(tsVal);
  if (!ms) return '';
  const d = new Date(ms + UZT_OFFSET_MS);
  const day = d.getUTCDate();
  const month = (MONTHS_UZ[d.getUTCMonth()] || '').slice(0, 3);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}-${month} ${hh}:${mm}`;
}

export function formatWeekRangeLabel(weekStart, weekEnd) {
  return `${formatYmdShortUz(weekStart)} – ${formatYmdShortUz(weekEnd)}`;
}

export function getWeekRangeFromStart(weekStart) {
  const parts = String(weekStart || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return getWeekRangeUzt();
  const [y, m, d] = parts;
  const monUztMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const sunUztMs = monUztMs + 6 * DAY_MS;
  const sunEndUztMs = monUztMs + 7 * DAY_MS - 1000;
  const weekEnd = formatYmdFromUtcDate(new Date(sunUztMs));
  return {
    weekStart: formatYmdFromUtcDate(new Date(monUztMs)),
    weekEnd,
    label: formatWeekRangeLabel(weekStart, weekEnd),
    startSec: Math.floor((monUztMs - UZT_OFFSET_MS) / 1000),
    endSec: Math.floor((sunEndUztMs - UZT_OFFSET_MS) / 1000),
  };
}

export function getWeekRangeUzt(tsVal = null) {
  const baseMs = tsVal ? toMs(tsVal) : Date.now();
  const uztMs = baseMs + UZT_OFFSET_MS;
  const uztDate = new Date(uztMs);
  const dayOfWeek = uztDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monUztMs = Date.UTC(
    uztDate.getUTCFullYear(),
    uztDate.getUTCMonth(),
    uztDate.getUTCDate() - diffToMonday,
    0,
    0,
    0,
    0
  );
  const weekStart = formatYmdFromUtcDate(new Date(monUztMs));
  const range = getWeekRangeFromStart(weekStart);
  return {
    ...range,
    dateStr: formatYmdFromUtcDate(uztDate),
  };
}

export function getUztTimeInfo() {
  const nowUztMs = Date.now() + UZT_OFFSET_MS;
  const nowUzt = new Date(nowUztMs);
  const dateStr = formatYmdFromUtcDate(nowUzt);
  const hh = String(nowUzt.getUTCHours()).padStart(2, '0');
  const min = String(nowUzt.getUTCMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${min}`;
  const dayIndex = Math.floor(nowUztMs / DAY_MS);
  const currentWeek = getWeekRangeUzt(Date.now());
  return { nowUzt, dateStr, timeStr, dayIndex, currentWeek };
}

export function normalizeName(str) {
  return (str || '').trim().replace(/^@/, '').toLowerCase();
}

/**
 * Returns the effective expense roster array of usernames/names if set by admin,
 * or null if unconfigured (falling back to all group members).
 */
export function getExpenseRosterList(group) {
  if (group?.expenseRoster && Array.isArray(group.expenseRoster) && group.expenseRoster.length > 0) {
    return group.expenseRoster
      .map((item) => (typeof item === 'string' ? item : item.name))
      .filter(Boolean);
  }
  return null;
}

/**
 * Zero-Sum Group Expense Balance Formula:
 * If an official expense roster is defined, only members matching the roster
 * share the total expense bill (N = |Roster|).
 * Any active payer gets credited their paid amount.
 * Fair share per person: F = T / N
 * Net balance for person i: B_i = Paid_i - (isSplitter ? F : 0)
 * Guarantees: sum(B_i) === 0
 */
export function calculateBalances(members, expenses, group = null) {
  const expensesByCurrency = {};
  for (const exp of expenses) {
    const cur = (exp.currency || 'UZS').toUpperCase();
    if (!expensesByCurrency[cur]) {
      expensesByCurrency[cur] = [];
    }
    expensesByCurrency[cur].push(exp);
  }

  const balancesByCurrency = {};
  const rosterNames = getExpenseRosterList(group);

  for (const [currency, curExpenses] of Object.entries(expensesByCurrency)) {
    const splittersIds = new Set();

    if (rosterNames && rosterNames.length > 0) {
      const normRoster = new Set(rosterNames.map((n) => normalizeName(n)));
      const seenNames = new Set();
      for (const m of members) {
        const norm = normalizeName(m.name);
        if (normRoster.has(norm) && !seenNames.has(norm)) {
          seenNames.add(norm);
          splittersIds.add(Number(m.telegramId));
        }
      }
    }

    // Fallback: if no official roster or no registered member matched roster, use all group members
    if (splittersIds.size === 0) {
      const seenNames = new Set();
      for (const m of members) {
        const norm = normalizeName(m.name);
        if (!seenNames.has(norm)) {
          seenNames.add(norm);
          splittersIds.add(Number(m.telegramId));
        }
      }
    }

    const numSplitters = splittersIds.size;
    const totalSpent = curExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const fairShare = numSplitters > 0 ? totalSpent / numSplitters : 0;

    const balances = {};
    for (const pid of splittersIds) {
      balances[pid] = -fairShare;
    }

    for (const exp of curExpenses) {
      const pid = Number(exp.payerId);
      balances[pid] = (balances[pid] || 0) + exp.amount;
    }

    balancesByCurrency[currency] = balances;
  }

  return balancesByCurrency;
}

/**
 * Returns the effective roster array of usernames/names.
 * Prefers group.dutyRoster (explicitly set by admin).
 * Falls back to active group members if no roster is set.
 */
export function getDutyRosterList(group, members = []) {
  if (group?.dutyRoster && Array.isArray(group.dutyRoster) && group.dutyRoster.length > 0) {
    return group.dutyRoster.map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean);
  }

  if (members && members.length > 0) {
    const sorted = [...members].sort((a, b) => {
      const orderDiff = (a.dutyOrder || 0) - (b.dutyOrder || 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.id || 0) - (b.id || 0);
    });
    return sorted.map((m) => m.name);
  }

  return [];
}

export function formatUzDate(date = null) {
  const dObj = date || getUztTimeInfo().nowUzt;
  const months = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
  ];
  const day = dObj.getUTCDate();
  const month = months[dObj.getUTCMonth()];
  return `${day}-${month}`;
}

/**
 * Returns the current active duty person.
 * Unlike calendar days, the duty person STAYS the same until marked Done!
 * If isTodayDone is true, it returns the person who completed today's duty.
 * Otherwise, it returns the person who is currently pending duty.
 */
export function getActiveDutyPerson(roster, dutyOffset = 0, isTodayDone = false) {
  if (!roster || roster.length === 0) return null;
  const k = roster.length;
  const targetIdx = isTodayDone
    ? (((dutyOffset - 1) % k) + k) % k
    : (((dutyOffset % k) + k) % k);
  return roster[targetIdx];
}

export function getDutyPerson(roster, dutyOffset = 0, dayOffset = 0, isTodayDone = false) {
  if (!roster || roster.length === 0) return null;
  const k = roster.length;
  if (dayOffset === 0) {
    return getActiveDutyPerson(roster, dutyOffset, isTodayDone);
  }
  const base = isTodayDone ? dutyOffset : dutyOffset + 1;
  const idx = (((base + dayOffset - 1) % k) + k) % k;
  return roster[idx];
}

export function formatMinimalDutyNotification(person, dateLabel = null, isDone = false, group = null) {
  const dt = dateLabel || formatUzDate();
  const header = isDone ? `Navbatchi (${dt}): ${person} (Done)` : `Navbatchi (${dt}): ${person}`;
  const { dutyTasks } = getGroupSettings(group);
  if (!dutyTasks || dutyTasks.length === 0) {
    return header;
  }
  const tasksBlock = dutyTasks.map((t) => `• ${t}`).join('\n');
  return `${header}\n\nVazifalar:\n${tasksBlock}`;
}

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

export function getDutySchedule(group, members, daysCount = 7) {
  const roster = getDutyRosterList(group, members);
  if (!roster || roster.length === 0) return [];

  const k = roster.length;
  const { dateStr, nowUztMs } = getUztTimeInfo();
  const isTodayDone = group?.lastDutyDoneDate === dateStr;
  const dutyOffset = group?.dutyOffset || 0;

  const schedule = [];
  for (let i = 0; i < daysCount; i++) {
    const dayDateUzt = new Date(nowUztMs + i * DAY_MS);
    const dateLabel = formatUzDate(dayDateUzt);

    let memberIdx;
    if (isTodayDone) {
      memberIdx = i === 0
        ? (((dutyOffset - 1) % k) + k) % k
        : (((dutyOffset + i - 1) % k) + k) % k;
    } else {
      memberIdx = (((dutyOffset + i) % k) + k) % k;
    }

    schedule.push({
      dayOffset: i,
      dateLabel,
      name: roster[memberIdx],
      isDone: i === 0 && isTodayDone,
    });
  }

  return schedule;
}

export function groupExpensesByWeek(allExpenses = []) {
  const weekMap = new Map();
  for (const exp of allExpenses) {
    const wr = getWeekRangeUzt(exp.createdAt);
    if (!weekMap.has(wr.weekStart)) {
      weekMap.set(wr.weekStart, {
        weekStart: wr.weekStart,
        weekEnd: wr.weekEnd,
        label: wr.label,
        startSec: wr.startSec,
        endSec: wr.endSec,
        expenses: [],
        unsettledExpenses: [],
        isSettled: true,
      });
    }
    const bucket = weekMap.get(wr.weekStart);
    bucket.expenses.push(exp);
    if (exp.settled === 0) {
      bucket.unsettledExpenses.push(exp);
      bucket.isSettled = false;
    }
  }
  return Array.from(weekMap.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

export function pickActiveTargetWeek(allExpenses = []) {
  const current = getWeekRangeUzt();
  const buckets = groupExpensesByWeek(allExpenses);
  const unsettledBuckets = buckets.filter((b) => b.unsettledExpenses.length > 0);
  if (unsettledBuckets.length > 0) {
    // Always prioritize the earliest unsettled week so older finished weeks
    // (e.g., 9-15 Nov) settle cleanly without mixing in newer weeks (16 Nov+).
    return unsettledBuckets[unsettledBuckets.length - 1];
  }
  const currentBucket = buckets.find((b) => b.weekStart === current.weekStart);
  if (currentBucket) return currentBucket;
  return {
    weekStart: current.weekStart,
    weekEnd: current.weekEnd,
    label: current.label,
    startSec: current.startSec,
    endSec: current.endSec,
    expenses: [],
    unsettledExpenses: [],
    isSettled: false,
  };
}

export function calculateSettlementTransfers(balancesByName) {
  const debtors = [];
  const creditors = [];

  for (const [name, bal] of balancesByName.entries()) {
    if (bal < -0.05) debtors.push({ name, amt: -bal });
    else if (bal > 0.05) creditors.push({ name, amt: bal });
  }

  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(d.amt, c.amt);
    const rounded = Math.round(amt * 10) / 10;
    if (rounded > 0.05) {
      transfers.push({ from: d.name, to: c.name, amount: rounded });
    }
    d.amt -= amt;
    c.amt -= amt;
    if (d.amt <= 0.05) i++;
    if (c.amt <= 0.05) j++;
  }
  return transfers;
}

export function formatWeeklyDelta(currentAmount, previousAmount, currency = 'UZS') {
  if (previousAmount === null || previousAmount === undefined || previousAmount <= 0) {
    return null;
  }
  const diff = Math.round((currentAmount - previousAmount) * 10) / 10;
  if (Math.abs(diff) <= 0.05) {
    return "O'tgan hafta bilan teng (0%)";
  }
  const pct = Math.round((diff / previousAmount) * 1000) / 10;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${formatMoney(diff, currency)} (${sign}${pct}%)`;
}

function buildMemberNameMap(groupMembers = [], expensesList = []) {
  const memberMap = new Map();
  for (const exp of expensesList) {
    if (exp.payerId && exp.payerName) {
      memberMap.set(Number(exp.payerId), exp.payerName);
    }
  }
  for (const m of groupMembers) {
    memberMap.set(Number(m.telegramId), m.name);
  }
  return memberMap;
}

export function computeWeeklyReportSnapshot(
  groupMembers,
  weekExpenses,
  grp,
  weekStart,
  weekEnd,
  previousReport = null
) {
  const settings = getGroupSettings(grp);
  const label = formatWeekRangeLabel(weekStart, weekEnd);
  const unsettled = weekExpenses.filter((e) => e.settled === 0);
  const isSettled = weekExpenses.length > 0 && unsettled.length === 0;
  const activeList = unsettled.length > 0 ? unsettled : weekExpenses;

  const memberMap = buildMemberNameMap(groupMembers, weekExpenses);
  const byCurrency = {};
  for (const exp of activeList) {
    const c = (exp.currency || 'UZS').toUpperCase();
    if (!byCurrency[c]) byCurrency[c] = [];
    byCurrency[c].push(exp);
  }

  const balancesByCur = calculateBalances(groupMembers, activeList, grp);
  const totalByCurrency = {};
  const fairShareByCurrency = {};
  const breakdownByName = new Map();
  const transfers = [];
  let participantCount = 0;

  let resp = `Hisobot · ${label}${isSettled ? ' (Yopilgan)' : ''}\n\n`;

  if (activeList.length === 0) {
    resp += `${label} haftasi uchun xarajatlar yo'q.`;
    return {
      weekStart,
      weekEnd,
      label,
      totalByCurrency,
      expenseCount: 0,
      participantCount: 0,
      fairShareByCurrency,
      memberBreakdown: [],
      transfers: [],
      reportText: resp,
      isSettled: false,
    };
  }

  for (const [cur, curExpenses] of Object.entries(byCurrency)) {
    const balances = balancesByCur[cur] || {};
    const participantIds = Object.keys(balances).map(Number);
    const numPeople = participantIds.length || groupMembers.length || 1;
    if (numPeople > participantCount) participantCount = numPeople;

    const totalSpent = Math.round(curExpenses.reduce((sum, e) => sum + e.amount, 0) * 10) / 10;
    const fairShare = Math.round((totalSpent / numPeople) * 10) / 10;

    totalByCurrency[cur] = totalSpent;
    fairShareByCurrency[cur] = fairShare;

    const spending = {};
    for (const pid of participantIds) spending[pid] = 0;
    for (const e of curExpenses) {
      const pid = Number(e.payerId);
      spending[pid] = (spending[pid] || 0) + e.amount;
    }

    resp += `Jami xarajat: ${formatMoney(totalSpent, cur)} (${curExpenses.length} ta)\n`;

    const prevTotals = previousReport?.totalByCurrency || {};
    const prevSpent = prevTotals[cur];
    const deltaText = formatWeeklyDelta(totalSpent, prevSpent, cur);
    if (deltaText) {
      resp += `O'tgan haftaga nisbatan: ${deltaText}\n`;
    }

    resp += `Har bir kishiga: ${formatMoney(fairShare, cur)}\n\n`;

    resp += "Kim qancha to'ladi:\n";
    const spendingByName = new Map();
    for (const [mid, amt] of Object.entries(spending)) {
      const name = memberMap.get(Number(mid)) || 'Unknown';
      spendingByName.set(name, (spendingByName.get(name) || 0) + amt);
    }
    const sortedSpending = Array.from(spendingByName.entries()).sort((a, b) => b[1] - a[1]);
    for (const [name, amt] of sortedSpending) {
      resp += `${name}: ${formatMoney(amt, cur)}\n`;
      if (!breakdownByName.has(name)) {
        breakdownByName.set(name, { name, paidByCurrency: {}, balanceByCurrency: {} });
      }
      breakdownByName.get(name).paidByCurrency[cur] = Math.round(amt * 10) / 10;
    }

    resp += '\nBalans:\n';
    const balancesByName = new Map();
    for (const [mid, bal] of Object.entries(balances)) {
      const name = memberMap.get(Number(mid)) || 'Unknown';
      balancesByName.set(name, (balancesByName.get(name) || 0) + bal);
    }
    const sortedBal = Array.from(balancesByName.entries()).sort((a, b) => b[1] - a[1]);
    for (const [name, bal] of sortedBal) {
      const roundedBal = Math.round(bal * 10) / 10;
      const sign = roundedBal > 0 ? '+' : '';
      resp += Math.abs(roundedBal) > 0.05 ? `${name}: ${sign}${formatMoney(roundedBal, cur)}\n` : `${name}: 0\n`;
      if (!breakdownByName.has(name)) {
        breakdownByName.set(name, { name, paidByCurrency: {}, balanceByCurrency: {} });
      }
      breakdownByName.get(name).balanceByCurrency[cur] = roundedBal;
    }

    const curTransfers = calculateSettlementTransfers(balancesByName);
    for (const tr of curTransfers) {
      transfers.push({ currency: cur, ...tr });
    }

    if (!isSettled && settings.showPaymentInfo && settings.paymentInfo) {
      resp += `\nTo'lov uchun (Pay to):\n${settings.paymentInfo}\n`;
    }
    resp += '\n';
  }

  return {
    weekStart,
    weekEnd,
    label,
    totalByCurrency,
    expenseCount: activeList.length,
    participantCount,
    fairShareByCurrency,
    memberBreakdown: Array.from(breakdownByName.values()),
    transfers,
    reportText: resp.trim(),
    isSettled,
  };
}

export function buildDetailReportText(groupMembers, allExpenses, grp, options = {}) {
  const { weekStart = null, savedReports = [], showOtherWeekNotice = true } = options;
  const buckets = groupExpensesByWeek(allExpenses || []);
  const target = weekStart
    ? buckets.find((b) => b.weekStart === weekStart) || getWeekRangeFromStart(weekStart)
    : pickActiveTargetWeek(allExpenses || []);

  const targetBucket = {
    weekStart: target.weekStart,
    weekEnd: target.weekEnd,
    label: target.label || formatWeekRangeLabel(target.weekStart, target.weekEnd),
    expenses: target.expenses || [],
  };

  const previousReport =
    savedReports.find((r) => r.weekStart < targetBucket.weekStart && (r.expenseCount || 0) > 0) || null;
  const archivedReport =
    targetBucket.expenses.length === 0
      ? savedReports.find((r) => r.weekStart === targetBucket.weekStart && (r.expenseCount || 0) > 0)
      : null;

  if (archivedReport?.reportText) {
    return archivedReport.reportText;
  }

  const snap = computeWeeklyReportSnapshot(
    groupMembers,
    targetBucket.expenses,
    grp,
    targetBucket.weekStart,
    targetBucket.weekEnd,
    previousReport
  );

  let text = snap.reportText;

  if (showOtherWeekNotice) {
    const newerUnsettled = buckets.filter(
      (b) => b.weekStart > targetBucket.weekStart && b.unsettledExpenses.length > 0
    );
    if (newerUnsettled.length > 0) {
      const totalNewer = newerUnsettled.reduce((s, b) => s + b.unsettledExpenses.length, 0);
      const newest = newerUnsettled[0];
      text += `\n\nEslatma: ${newest.label} haftasida ${totalNewer} ta yangi xarajat alohida saqlanmoqda (/weeks).`;
    }
  }

  return text;
}

export function formatWeeklyHistoryText(reports = []) {
  if (!reports || reports.length === 0) {
    return "Hozircha saqlangan haftalik hisobotlar yo'q.";
  }

  const ordered = [...reports].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  let text = "Haftalik hisobotlar tarixi\n\n";

  for (let i = 0; i < ordered.length; i++) {
    const rep = ordered[i];
    const prev = ordered.slice(i + 1).find((p) => (p.expenseCount || 0) > 0) || null;
    const label = formatWeekRangeLabel(rep.weekStart, rep.weekEnd);
    const status = rep.isSettled ? 'Yopilgan' : 'Ochiq';
    const totals = rep.totalByCurrency || {};
    const curs = Object.keys(totals);
    const summary =
      curs.length > 0
        ? curs.map((c) => formatMoney(totals[c], c)).join(' · ')
        : '0 ming';

    text += `${i + 1}. ${label} (${status})\n`;
    text += `   Jami: ${summary} (${rep.expenseCount || 0} ta)`;

    if (prev && curs.length > 0) {
      const mainCur = curs.includes('UZS') ? 'UZS' : curs[0];
      const delta = formatWeeklyDelta(totals[mainCur], prev.totalByCurrency?.[mainCur], mainCur);
      if (delta) {
        text += ` · ${delta}`;
      }
    }
    text += '\n\n';
  }

  return text.trim();
}

function resolveWeekItems(groupMembers, allExpenses = [], weekStart = null) {
  const buckets = groupExpensesByWeek(allExpenses || []);
  const target = weekStart
    ? buckets.find((b) => b.weekStart === weekStart) || getWeekRangeFromStart(weekStart)
    : pickActiveTargetWeek(allExpenses || []);

  const rawList = target.expenses || [];
  const unsettled = rawList.filter((e) => e.settled === 0);
  const items = (unsettled.length > 0 ? unsettled : rawList)
    .slice()
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt) || (b.id || 0) - (a.id || 0));

  const memberMap = buildMemberNameMap(groupMembers, allExpenses || []);
  const label = target.label || formatWeekRangeLabel(target.weekStart, target.weekEnd);
  return { weekStart: target.weekStart, weekEnd: target.weekEnd, label, items, memberMap };
}

export function buildExpensesByMemberText(groupMembers, allExpenses = [], weekStart = null) {
  const { label, items, memberMap } = resolveWeekItems(groupMembers, allExpenses, weekStart);
  if (items.length === 0) {
    return `Kishilar bo'yicha · ${label}\n\nXarajatlar yo'q.`;
  }

  const byMember = new Map();
  for (const exp of items) {
    const name = memberMap.get(Number(exp.payerId)) || exp.payerName || 'Unknown';
    if (!byMember.has(name)) {
      byMember.set(name, { name, totals: {}, rows: [] });
    }
    const entry = byMember.get(name);
    const cur = (exp.currency || 'UZS').toUpperCase();
    entry.totals[cur] = Math.round(((entry.totals[cur] || 0) + exp.amount) * 10) / 10;
    entry.rows.push(exp);
  }

  const sortedMembers = Array.from(byMember.values()).sort(
    (a, b) => (b.totals.UZS || Object.values(b.totals)[0] || 0) - (a.totals.UZS || Object.values(a.totals)[0] || 0)
  );

  let text = `Kishilar bo'yicha · ${label} (${items.length} ta)\n\n`;
  for (const m of sortedMembers) {
    const totalStr = Object.entries(m.totals)
      .map(([c, v]) => formatMoney(v, c))
      .join(' · ');
    text += `${m.name} · ${totalStr} (${m.rows.length} ta):\n`;
    for (const exp of m.rows) {
      const dt = formatUztDateTime(exp.createdAt);
      const line = `• [${dt}] ${formatMoney(exp.amount, exp.currency)} · ${exp.description}\n`;
      if (text.length + line.length > 3850) {
        text += '... qolgan yozuvlar sig\'madi\n';
        return text.trim();
      }
      text += line;
    }
    text += '\n';
  }
  return text.trim();
}

export function buildExpensesByTimeText(groupMembers, allExpenses = [], weekStart = null) {
  const { label, items, memberMap } = resolveWeekItems(groupMembers, allExpenses, weekStart);
  if (items.length === 0) {
    return `Vaqt bo'yicha · ${label}\n\nXarajatlar yo'q.`;
  }

  let text = `Vaqt bo'yicha · ${label} (${items.length} ta)\n\n`;
  for (let i = 0; i < items.length; i++) {
    const exp = items[i];
    const name = memberMap.get(Number(exp.payerId)) || exp.payerName || 'Unknown';
    const dt = formatUztDateTime(exp.createdAt);
    const line = `${i + 1}. [${dt}] ${name} · ${formatMoney(exp.amount, exp.currency)} · ${exp.description} (ID: ${exp.id})\n`;
    if (text.length + line.length > 3850) {
      text += `... yana ${items.length - i} ta xarajat bor`;
      break;
    }
    text += line;
  }
  return text.trim();
}

export function buildWeekReportKeyboard(
  allExpenses = [],
  savedReports = [],
  activeWeekStart,
  viewMode = 'summary'
) {
  const weekStarts = new Set();
  for (const r of savedReports || []) {
    if (r?.weekStart) weekStarts.add(r.weekStart);
  }
  for (const b of groupExpensesByWeek(allExpenses || [])) {
    weekStarts.add(b.weekStart);
  }
  if (activeWeekStart) weekStarts.add(activeWeekStart);

  const sorted = Array.from(weekStarts).sort((a, b) => b.localeCompare(a)).slice(0, 4);
  const viewPrefix = viewMode === 'mem' ? 'wk:mem:' : viewMode === 'time' ? 'wk:time:' : 'wk:show:';

  const rows = [
    [
      {
        text: `${viewMode === 'mem' ? '• ' : ''}Kishilar bo'yicha`,
        callback_data: `wk:mem:${activeWeekStart}`,
      },
      {
        text: `${viewMode === 'time' ? '• ' : ''}Vaqt bo'yicha`,
        callback_data: `wk:time:${activeWeekStart}`,
      },
    ],
  ];

  if (sorted.length > 1) {
    const pair = sorted.slice(0, 2).map((ws) => {
      const r = getWeekRangeFromStart(ws);
      const prefix = ws === activeWeekStart ? '• ' : '';
      return { text: `${prefix}${r.label}`, callback_data: `${viewPrefix}${ws}` };
    });
    rows.push(pair);
  }

  const bottomRow = [];
  if (viewMode !== 'summary') {
    bottomRow.push({ text: '← Hisobotga', callback_data: `wk:show:${activeWeekStart}` });
  }
  if (sorted.length > 1 || (savedReports && savedReports.length > 0)) {
    bottomRow.push({ text: 'Haftalar tarixi', callback_data: 'wk:list' });
  }
  if (bottomRow.length > 0) {
    rows.push(bottomRow);
  }

  return { inline_keyboard: rows };
}

export function buildWeeklyHistoryKeyboard(reports = []) {
  const ordered = [...(reports || [])]
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, 6);
  const rows = [];
  for (let i = 0; i < ordered.length; i += 2) {
    const pair = ordered.slice(i, i + 2).map((rep) => {
      const label = formatWeekRangeLabel(rep.weekStart, rep.weekEnd);
      return { text: label, callback_data: `wk:show:${rep.weekStart}` };
    });
    rows.push(pair);
  }
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

export const DEFAULT_PERSONAL_TASKS = ['Sport', "Kitob o'qish"];

export function getPersonalSettings(session) {
  const raw =
    session && typeof session.personalSettings === 'object' && session.personalSettings
      ? session.personalSettings
      : {};
  const { dateStr } = getUztTimeInfo();
  const dailyTasks = Array.isArray(raw.dailyTasks) ? raw.dailyTasks : [...DEFAULT_PERSONAL_TASKS];
  const sameDay = raw.completedTasksDate === dateStr;
  const completedTaskIndices = sameDay && Array.isArray(raw.completedTaskIndices)
    ? raw.completedTaskIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < dailyTasks.length)
    : [];

  return {
    dailyLimit: Number(raw.dailyLimit) > 0 ? Number(raw.dailyLimit) : 0,
    monthlyLimit: Number(raw.monthlyLimit) > 0 ? Number(raw.monthlyLimit) : 0,
    dailyTasks,
    completedTasksDate: sameDay ? dateStr : dateStr,
    completedTaskIndices,
    reminderTime: raw.reminderTime || '09:00',
    reminderEnabled: Boolean(raw.reminderEnabled),
    lastReminderDate: raw.lastReminderDate || null,
  };
}

export function buildPersonalReminderPayload(tasks, completedIndices, dateLabel) {
  const doneSet = new Set(completedIndices);
  const doneCount = doneSet.size;
  const totalCount = tasks.length;
  const allDone = totalCount > 0 && doneCount === totalCount;

  const text =
    `Kunlik vazifalar · ${dateLabel}\n\n` +
    (totalCount === 0
      ? "Vazifalar ro'yxati bo'sh."
      : `Bajarildi: ${doneCount} / ${totalCount}${allDone ? ' · Hammasi tayyor' : ''}`);

  const rows = tasks.map((task, idx) => {
    const isDone = doneSet.has(idx);
    const shortTask = task.length > 28 ? `${task.slice(0, 27)}…` : task;
    return [{ text: `${isDone ? '✓' : '☐'} ${shortTask}`, callback_data: `ind:tk_rtg:${idx}` }];
  });
  rows.push([{ text: 'Shaxsiy kabinet', callback_data: 'ind:home' }]);

  return { text, reply_markup: { inline_keyboard: rows }, allDone };
}
