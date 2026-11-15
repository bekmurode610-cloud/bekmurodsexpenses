import { EndpointError } from 'sdk';
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
  getUserApartmentBalance,
} from '../lib/db-service.js';
import { getUztTimeInfo, formatUzDate, getPersonalSettings } from '../lib/settlement.js';
import { parseExpenseInput } from '../lib/format.js';
import {
  computePersonalStats,
  detectExpenseCategory,
  extractPaymentMethod,
  applyDebtCreationWalletImpact,
  applyDebtRepayment,
} from '../lib/individual-panel.js';

function parseLimitAmount(val) {
  if (val === '' || val === null || val === undefined || val === 0 || val === '0') return 0;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return 0;
    return val >= 10000 ? val / 1000 : val;
  }
  const parsed = parseExpenseInput(String(val));
  return parsed ? parsed.amount : 0;
}

async function buildAppState(user) {
  const userId = Number(user.id);
  const username = user.username || '';
  const session = await getAdminSession(userId);
  const ps = getPersonalSettings(session);
  const records = await getPersonalRecords(userId, { limit: 1000 });
  const stats = computePersonalStats(records);
  const debts = await getPersonalDebts(userId);
  const apt = await getUserApartmentBalance(userId, username);
  const { nowUzt } = getUztTimeInfo();

  const categories = Array.from(stats.monthByCat.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percent: stats.monthSpentUzs > 0 ? Math.round((amount / stats.monthSpentUzs) * 100) : 0,
    }));

  return {
    user: {
      id: userId,
      firstName: user.first_name || user.firstName || 'Foydalanuvchi',
      username,
    },
    dateLabel: formatUzDate(nowUzt),
    stats: {
      walletUzs: stats.walletUzs,
      cardBalanceUzs: stats.cardBalanceUzs,
      cashBalanceUzs: stats.cashBalanceUzs,
      monthIncomeUzs: stats.monthIncomeUzs,
      monthIncomeCardUzs: stats.monthIncomeCardUzs,
      monthIncomeCashUzs: stats.monthIncomeCashUzs,
      monthSpentUzs: stats.monthSpentUzs,
      monthSpentCardUzs: stats.monthSpentCardUzs,
      monthSpentCashUzs: stats.monthSpentCashUzs,
      todaySpentUzs: stats.todaySpentUzs,
      categories,
      otherCurrencies: Object.fromEntries(stats.otherCur.entries()),
    },
    settings: ps,
    records: records.slice(0, 40).map((r) => ({
      id: r.id,
      type: r.type,
      paymentMethod: r.paymentMethod === 'cash' ? 'cash' : 'card',
      amount: r.amount,
      currency: r.currency || 'UZS',
      category: r.category,
      description: r.description,
      createdAt: r.createdAt,
    })),
    debts: debts.map((d) => ({
      id: d.id,
      direction: d.direction,
      personName: d.personName,
      amount: d.amount,
      currency: d.currency || 'UZS',
      note: d.note || '',
      createdAt: d.createdAt,
    })),
    apartment: apt,
  };
}

export default async function (input, ctx) {
  const user = ctx?.initData?.user;
  if (!user?.id) {
    throw new EndpointError('Avtorizatsiya talab qilinadi', { code: 'UNAUTHORIZED' });
  }

  const userId = Number(user.id);
  const action = input?.action || 'load';

  if (action === 'load') {
    const session = await getAdminSession(userId);
    if (!session || session.mode === 'choose') {
      await setAdminSession(userId, { mode: 'individual' });
    }
    return await buildAppState(user);
  }

  if (action === 'add_record') {
    const type = input.type === 'income' ? 'income' : 'expense';
    const requestedMethod = input.paymentMethod === 'cash' ? 'cash' : 'card';

    let amount = 0;
    let currency = (input.currency || 'UZS').toUpperCase();
    let rawDesc = (input.description || '').trim();

    if (input.amountInput !== undefined && String(input.amountInput).trim() !== '') {
      const parsed = parseExpenseInput(String(input.amountInput).trim());
      if (!parsed) {
        throw new EndpointError("Summani to'g'ri kiriting (masalan: 40 ming yoki 50000)", {
          code: 'INVALID_AMOUNT',
        });
      }
      amount = parsed.amount;
      currency = parsed.currency;
      if (!rawDesc && parsed.description !== 'Expense') {
        rawDesc = parsed.description;
      }
    } else if (input.rawInput) {
      const parsed = parseExpenseInput(String(input.rawInput).trim());
      if (!parsed) {
        throw new EndpointError("Yozuvni to'g'ri kiriting (masalan: 40 ming tushlik)", {
          code: 'INVALID_INPUT',
        });
      }
      amount = parsed.amount;
      currency = parsed.currency;
      if (!rawDesc) {
        rawDesc = parsed.description;
      }
    } else if (input.amount !== undefined) {
      const num = Number(input.amount);
      if (!Number.isFinite(num) || num <= 0) {
        throw new EndpointError("Summa musbat bo'lishi kerak", { code: 'INVALID_AMOUNT' });
      }
      amount = currency === 'UZS' && num >= 10000 ? num / 1000 : num;
    }

    if (!amount || amount <= 0) {
      throw new EndpointError("Summani kiriting", { code: 'INVALID_AMOUNT' });
    }

    const { paymentMethod, description } = extractPaymentMethod(
      rawDesc,
      requestedMethod,
      type === 'income'
    );
    const category =
      input.category && String(input.category).trim()
        ? String(input.category).trim()
        : type === 'income'
        ? 'Kirim'
        : detectExpenseCategory(description);

    await addPersonalRecord({
      userId,
      type,
      paymentMethod,
      amount,
      currency,
      category,
      description,
    });
    return await buildAppState(user);
  }

  if (action === 'delete_record') {
    const recId = parseInt(input.recordId, 10);
    if (!isNaN(recId)) {
      await deletePersonalRecord(userId, recId);
    }
    return await buildAppState(user);
  }

  if (action === 'toggle_method') {
    const recId = parseInt(input.recordId, 10);
    if (!isNaN(recId)) {
      await togglePersonalRecordMethod(userId, recId);
    }
    return await buildAppState(user);
  }

  if (action === 'clear_records') {
    await clearPersonalRecords(userId);
    return await buildAppState(user);
  }

  if (action === 'add_debt') {
    const direction = input.direction === 'i_owe' ? 'i_owe' : 'owe_me';
    const personName = String(input.personName || '').trim();
    if (!personName) {
      throw new EndpointError('Ismni kiriting', { code: 'INVALID_NAME' });
    }
    const parsed = parseExpenseInput(String(input.amountInput ?? input.amount ?? '').trim());
    if (!parsed || parsed.amount <= 0) {
      throw new EndpointError("Qarz summasini to'g'ri kiriting", { code: 'INVALID_AMOUNT' });
    }
    const note = String(input.note || '').trim();
    const walletMethod =
      input.walletMethod === 'card' || input.walletMethod === 'cash' ? input.walletMethod : 'none';

    await addPersonalDebt({
      userId,
      direction,
      personName,
      amount: parsed.amount,
      currency: parsed.currency,
      note,
    });
    await applyDebtCreationWalletImpact({
      userId,
      direction,
      personName,
      amount: parsed.amount,
      currency: parsed.currency,
      note,
      walletMethod,
    });
    return await buildAppState(user);
  }

  if (action === 'pay_debt') {
    const debtId = parseInt(input.debtId, 10);
    if (isNaN(debtId)) {
      throw new EndpointError('Qarz topilmadi', { code: 'NOT_FOUND' });
    }

    let payAmount = null;
    if (input.amountInput !== undefined && String(input.amountInput).trim() !== '') {
      const parsed = parseExpenseInput(String(input.amountInput).trim());
      if (!parsed || parsed.amount <= 0) {
        throw new EndpointError("Qaytarilgan summani to'g'ri kiriting", {
          code: 'INVALID_AMOUNT',
        });
      }
      payAmount = parsed.amount;
    } else if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
      const num = Number(input.amount);
      if (!Number.isFinite(num) || num <= 0) {
        throw new EndpointError("Summa musbat bo'lishi kerak", { code: 'INVALID_AMOUNT' });
      }
      payAmount = num >= 10000 ? num / 1000 : num;
    }

    const walletMethod =
      input.walletMethod === 'card' || input.walletMethod === 'cash' ? input.walletMethod : 'none';

    const result = await applyDebtRepayment({
      userId,
      debtId,
      payAmount,
      walletMethod,
    });
    if (!result) {
      throw new EndpointError('Qarz topilmadi', { code: 'NOT_FOUND' });
    }

    const state = await buildAppState(user);
    return { ...state, lastRepayment: { paid: result.paid, remaining: result.remaining, closed: result.closed } };
  }

  if (action === 'toggle_task') {
    const idx = parseInt(input.index, 10);
    const session = await getAdminSession(userId);
    const ps = getPersonalSettings(session);
    const { dateStr } = getUztTimeInfo();
    const set = new Set(ps.completedTaskIndices);
    if (!isNaN(idx) && idx >= 0 && idx < ps.dailyTasks.length) {
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
    }
    await updatePersonalSettings(userId, {
      completedTasksDate: dateStr,
      completedTaskIndices: Array.from(set),
    });
    return await buildAppState(user);
  }

  if (action === 'add_task') {
    const task = String(input.task || '').trim();
    if (!task) {
      throw new EndpointError('Vazifa nomini kiriting', { code: 'INVALID_TASK' });
    }
    const session = await getAdminSession(userId);
    const ps = getPersonalSettings(session);
    await updatePersonalSettings(userId, {
      dailyTasks: [...ps.dailyTasks, task],
    });
    return await buildAppState(user);
  }

  if (action === 'remove_task') {
    const idx = parseInt(input.index, 10);
    const session = await getAdminSession(userId);
    const ps = getPersonalSettings(session);
    const tasks = [...ps.dailyTasks];
    if (!isNaN(idx) && idx >= 0 && idx < tasks.length) {
      tasks.splice(idx, 1);
      const nextCompleted = ps.completedTaskIndices
        .filter((i) => i !== idx)
        .map((i) => (i > idx ? i - 1 : i));
      await updatePersonalSettings(userId, {
        dailyTasks: tasks,
        completedTaskIndices: nextCompleted,
      });
    }
    return await buildAppState(user);
  }

  if (action === 'save_settings' || action === 'save_limits' || action === 'save_reminder') {
    const patch = {};
    if (input.dailyLimit !== undefined) {
      patch.dailyLimit = parseLimitAmount(input.dailyLimit);
    }
    if (input.monthlyLimit !== undefined) {
      patch.monthlyLimit = parseLimitAmount(input.monthlyLimit);
    }
    if (input.reminderEnabled !== undefined) {
      patch.reminderEnabled = Boolean(input.reminderEnabled);
    }
    if (input.reminderTime !== undefined) {
      const t = String(input.reminderTime).trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
        throw new EndpointError('Vaqtni HH:MM formatida kiriting (masalan: 09:00)', {
          code: 'INVALID_TIME',
        });
      }
      patch.reminderTime = t;
      patch.lastReminderDate = null;
    }
    await updatePersonalSettings(userId, patch);
    return await buildAppState(user);
  }

  throw new EndpointError("Noma'lum amal", { code: 'UNKNOWN_ACTION' });
}
