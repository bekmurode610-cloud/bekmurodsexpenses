export function calculateBalances(members, expenses) {
  const expensesByCurrency = {};
  for (const exp of expenses) {
    const cur = exp.currency || 'UZS';
    if (!expensesByCurrency[cur]) {
      expensesByCurrency[cur] = [];
    }
    expensesByCurrency[cur].push(exp);
  }

  const balancesByCurrency = {};
  const numMembers = members.length;

  for (const [currency, curExpenses] of Object.entries(expensesByCurrency)) {
    const totalSpent = curExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const fairShare = numMembers > 0 ? totalSpent / numMembers : 0;

    const balances = {};
    for (const m of members) {
      balances[m.telegramId] = -fairShare;
    }

    for (const exp of curExpenses) {
      if (balances[exp.payerId] !== undefined) {
        balances[exp.payerId] += exp.amount;
      } else {
        balances[exp.payerId] = -fairShare + exp.amount;
      }
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
