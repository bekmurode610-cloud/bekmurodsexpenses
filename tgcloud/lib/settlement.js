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

export function calculateSettlements(balances) {
  const debtors = [];
  const creditors = [];

  for (const [memberId, balance] of Object.entries(balances)) {
    if (balance < -0.01) {
      debtors.push({ id: Number(memberId), amount: -balance });
    } else if (balance > 0.01) {
      creditors.push({ id: Number(memberId), amount: balance });
    }
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0.01) {
      settlements.push({
        debtorId: debtor.id,
        creditorId: creditor.id,
        amount,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount < 0.01) dIdx++;
    if (creditor.amount < 0.01) cIdx++;
  }

  return settlements;
}

export function getUzbekistanWeekBounds() {
  const { nowUzt, nowUztMs } = (() => {
    const ms = Date.now() + UZT_OFFSET_MS;
    return { nowUzt: new Date(ms), nowUztMs: ms };
  })();

  const day = nowUzt.getUTCDay();
  const diffToMonday = (day + 6) % 7;

  const mondayUzt = new Date(nowUztMs);
  mondayUzt.setUTCDate(nowUzt.getUTCDate() - diffToMonday);
  mondayUzt.setUTCHours(0, 0, 0, 0);

  const sundayUzt = new Date(mondayUzt.getTime());
  sundayUzt.setUTCDate(mondayUzt.getUTCDate() + 6);
  sundayUzt.setUTCHours(23, 59, 59, 999);

  const startEpochSec = Math.floor((mondayUzt.getTime() - UZT_OFFSET_MS) / 1000);
  const endEpochSec = Math.floor((sundayUzt.getTime() - UZT_OFFSET_MS) / 1000);

  const monLabel = mondayUzt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sunLabel = sundayUzt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return {
    startEpochSec,
    endEpochSec,
    monLabel,
    sunLabel,
  };
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

/**
 * Returns the person on duty for dayOffset (0 = today, 1 = tomorrow, etc.)
 */
export function getDutyPerson(roster, dutyOffset = 0, dayOffset = 0) {
  if (!roster || roster.length === 0) return null;
  const { dayIndex } = getUztTimeInfo();
  const k = roster.length;
  const targetDay = dayIndex + dayOffset;
  const idx = (((targetDay + (dutyOffset || 0)) % k) + k) % k;
  return roster[idx];
}

export function formatMinimalDutyNotification(person, isDone = false) {
  return isDone ? `Navbatchi: ${person} (Done)` : `Navbatchi: ${person}`;
}

export function getDutySchedule(group, members, daysCount = 7) {
  const roster = getDutyRosterList(group, members);
  if (!roster || roster.length === 0) return [];

  const k = roster.length;
  const { dayIndex, dateStr } = getUztTimeInfo();
  const dutyOffset = group?.dutyOffset || 0;
  const isTodayDone = group?.lastDutyDoneDate === dateStr;

  const schedule = [];
  for (let i = 0; i < daysCount; i++) {
    const targetDay = dayIndex + i;
    const memberIdx = (((targetDay + dutyOffset) % k) + k) % k;
    const dayDateUzt = new Date(targetDay * DAY_MS);
    const dateLabel = dayDateUzt.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

    schedule.push({
      dayOffset: i,
      dateLabel,
      name: roster[memberIdx],
      isDone: i === 0 && isTodayDone,
    });
  }

  return schedule;
}
