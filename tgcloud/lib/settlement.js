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

export function getUztTimeInfo() {
  const nowUztMs = Date.now() + UZT_OFFSET_MS;
  const nowUzt = new Date(nowUztMs);
  const yyyy = nowUzt.getUTCFullYear();
  const mm = String(nowUzt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nowUzt.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const hh = String(nowUzt.getUTCHours()).padStart(2, '0');
  const min = String(nowUzt.getUTCMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${min}`;
  const dayIndex = Math.floor(nowUztMs / DAY_MS);
  return { nowUzt, dateStr, timeStr, dayIndex };
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

export function buildDetailReportText(groupMembers, allExpenses, grp) {
  if (!allExpenses || allExpenses.length === 0) {
    return "Hozircha xarajatlar yo'q.";
  }

  const settings = getGroupSettings(grp);
  const unsettledExpenses = allExpenses.filter((e) => e.settled === 0);
  const activeList = unsettledExpenses.length > 0 ? unsettledExpenses : allExpenses;
  const isShowingSettled = unsettledExpenses.length === 0;

  const memberMap = new Map();
  for (const exp of allExpenses) {
    if (exp.payerId && exp.payerName) {
      memberMap.set(Number(exp.payerId), exp.payerName);
    }
  }
  for (const m of groupMembers) {
    memberMap.set(Number(m.telegramId), m.name);
  }

  const byCurrency = {};
  for (const exp of activeList) {
    const c = (exp.currency || 'UZS').toUpperCase();
    if (!byCurrency[c]) byCurrency[c] = [];
    byCurrency[c].push(exp);
  }

  let resp = isShowingSettled ? 'Hisobot (Nollangan tarix)\n\n' : 'Hisobot\n\n';
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
    const spendingByName = new Map();
    for (const [mid, amt] of Object.entries(spending)) {
      const name = memberMap.get(Number(mid)) || 'Unknown';
      spendingByName.set(name, (spendingByName.get(name) || 0) + amt);
    }
    const sortedSpending = Array.from(spendingByName.entries()).sort((a, b) => b[1] - a[1]);
    for (const [name, amt] of sortedSpending) {
      resp += `${name}: ${formatMoney(amt, cur)}\n`;
    }

    if (!isShowingSettled) {
      resp += '\nBalans:\n';
      const balancesByName = new Map();
      for (const [mid, bal] of Object.entries(balances)) {
        const name = memberMap.get(Number(mid)) || 'Unknown';
        balancesByName.set(name, (balancesByName.get(name) || 0) + bal);
      }
      const sortedBal = Array.from(balancesByName.entries()).sort((a, b) => b[1] - a[1]);
      for (const [name, bal] of sortedBal) {
        const sign = bal > 0 ? '+' : '';
        if (Math.abs(bal) > 0.05) {
          resp += `${name}: ${sign}${formatMoney(bal, cur)}\n`;
        } else {
          resp += `${name}: 0\n`;
        }
      }

      if (settings.showPaymentInfo && settings.paymentInfo) {
        resp += `\nTo'lov uchun (Pay to):\n${settings.paymentInfo}\n`;
      }
    }
    resp += '\n';
  }

  return resp.trim();
}
