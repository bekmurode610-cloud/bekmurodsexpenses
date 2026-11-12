const UZT_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

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
      for (const m of members) {
        if (normRoster.has(normalizeName(m.name))) {
          splittersIds.add(Number(m.telegramId));
        }
      }
    }

    // Fallback: if no official roster or no registered member matched roster, use all group members
    if (splittersIds.size === 0) {
      for (const m of members) {
        splittersIds.add(Number(m.telegramId));
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

export function formatMinimalDutyNotification(person, dateLabel = null, isDone = false) {
  const dt = dateLabel || formatUzDate();
  return isDone ? `Navbatchi (${dt}): ${person} (Done)` : `Navbatchi (${dt}): ${person}`;
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
