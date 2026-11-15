(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  const state = {
    activeTab: 'wallet',
    recordType: 'expense',
    paymentMethod: 'card',
    debtDirection: 'owe_me',
    busy: false,
    data: null,
    toastTimer: null,
  };

  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#f7f7f5');
      if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#f7f7f5');
    } catch (_) {}
  }

  function haptic(type) {
    try {
      if (tg && tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred(type || 'light');
      }
    } catch (_) {}
  }

  function callApi(payload) {
    return new Promise((resolve, reject) => {
      if (tg && tg.Serverless && typeof tg.Serverless.call === 'function') {
        tg.Serverless.call('personal_app', payload, (err, res) => {
          if (err) {
            reject(new Error(err.message || err.description || 'Server xatosi'));
            return;
          }
          resolve(res);
        });
        return;
      }
      reject(new Error("Ilovani Telegram bot ichidagi tugma orqali oching."));
    });
  }

  function formatMoney(amount, currency) {
    const cur = (currency || 'UZS').toUpperCase();
    const num = Number(amount) || 0;
    const rounded = Math.round(num * 10) / 10;
    const formatted = Number.isInteger(rounded)
      ? rounded.toLocaleString('en-US')
      : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return cur === 'UZS' ? formatted + ' ming' : formatted + ' ' + cur;
  }

  function setBusy(isBusy, label) {
    state.busy = isBusy;
    const el = document.getElementById('syncStatus');
    if (el) {
      el.textContent = isBusy ? (label || 'Saqlanmoqda...') : 'Tayyor';
      el.classList.toggle('is-busy', isBusy);
    }
    const submitBtn = document.getElementById('submitRecordBtn');
    if (submitBtn) submitBtn.disabled = isBusy;
  }

  function showToast(message, isError) {
    const banner = document.getElementById('toastBanner');
    if (!banner) return;
    banner.textContent = message;
    banner.classList.toggle('is-error', Boolean(isError));
    banner.hidden = false;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      banner.hidden = true;
    }, 3200);
  }

  async function runAction(payload, busyText, successToast) {
    setBusy(true, busyText || 'Yangilanmoqda...');
    try {
      const next = await callApi(payload);
      state.data = next;
      renderAll();
      if (successToast) showToast(successToast, false);
      return true;
    } catch (err) {
      showToast(err.message || "Xatolik yuz berdi", true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderHeader() {
    if (!state.data) return;
    const nameEl = document.getElementById('userName');
    const dateEl = document.getElementById('dateLabel');
    if (nameEl) nameEl.textContent = state.data.user.firstName || 'Shaxsiy kabinet';
    if (dateEl) dateEl.textContent = state.data.dateLabel || '';
  }

  function renderWallet() {
    if (!state.data) return;
    const stats = state.data.stats;
    const walletEl = document.getElementById('walletTotal');
    walletEl.textContent = formatMoney(stats.walletUzs, 'UZS');
    walletEl.classList.toggle('is-positive', stats.walletUzs > 0);
    walletEl.classList.toggle('is-negative', stats.walletUzs < 0);

    document.getElementById('cardTotal').textContent = formatMoney(stats.cardBalanceUzs, 'UZS');
    document.getElementById('cardMonthly').textContent =
      'Oylik kirim: +' + formatMoney(stats.monthIncomeCardUzs, 'UZS');

    document.getElementById('cashTotal').textContent = formatMoney(stats.cashBalanceUzs, 'UZS');
    document.getElementById('cashMonthly').textContent =
      'Oylik kirim: +' + formatMoney(stats.monthIncomeCashUzs, 'UZS');

    const aptRow = document.getElementById('apartmentRow');
    const aptBal = document.getElementById('apartmentBalance');
    if (state.data.apartment) {
      const bal = state.data.apartment.balance || 0;
      const sign = bal > 0 ? '+' : '';
      aptRow.hidden = false;
      aptBal.textContent = sign + formatMoney(bal, state.data.apartment.currency);
      aptBal.classList.toggle('is-positive', bal > 0);
      aptBal.classList.toggle('is-negative', bal < 0);
    } else {
      aptRow.hidden = true;
    }

    document.getElementById('monthSpentTotal').textContent = '-' + formatMoney(stats.monthSpentUzs, 'UZS');

    const catContainer = document.getElementById('categoryList');
    catContainer.innerHTML = '';
    if (!stats.categories || stats.categories.length === 0) {
      catContainer.appendChild(el('div', 'empty-note', "Bu oyda hali chiqim kiritilmagan."));
    } else {
      stats.categories.forEach((cat) => {
        const row = el('div', 'category-row');
        const top = el('div', 'category-top');
        top.appendChild(el('span', 'category-name', cat.name));
        top.appendChild(el('span', 'category-val', formatMoney(cat.amount, 'UZS') + ' (' + cat.percent + '%)'));
        const track = el('div', 'bar-track');
        const fill = el('div', 'bar-fill');
        fill.style.width = Math.min(100, Math.max(4, cat.percent)) + '%';
        track.appendChild(fill);
        row.appendChild(top);
        row.appendChild(track);
        catContainer.appendChild(row);
      });
    }

    const records = state.data.records || [];
    document.getElementById('recordsCount').textContent = records.length + ' ta';
    const recContainer = document.getElementById('recordsList');
    recContainer.innerHTML = '';

    if (records.length === 0) {
      recContainer.appendChild(el('div', 'empty-note', "Hozircha yozuvlar yo'q."));
      return;
    }

    records.forEach((rec) => {
      const row = el('div', 'ledger-row');
      const main = el('div', 'row-main');
      main.appendChild(el('div', 'row-title', rec.description));
      main.appendChild(el('div', 'row-sub', rec.category));

      const actions = el('div', 'row-actions');
      const methodBtn = el(
        'button',
        'method-toggle',
        rec.paymentMethod === 'cash' ? 'Naqd' : 'Karta'
      );
      methodBtn.type = 'button';
      methodBtn.title = "Karta va Naqd o'rtasida almashtirish";
      methodBtn.addEventListener('click', () => {
        haptic('light');
        runAction({ action: 'toggle_method', recordId: rec.id }, 'Yangilanmoqda...');
      });

      const isInc = rec.type === 'income';
      const amtEl = el(
        'span',
        'row-amount' + (isInc ? ' is-income' : ''),
        (isInc ? '+' : '-') + formatMoney(rec.amount, rec.currency)
      );

      const delBtn = el('button', 'icon-btn', '×');
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', "Yozuvni o'chirish");
      delBtn.addEventListener('click', () => {
        haptic('medium');
        runAction({ action: 'delete_record', recordId: rec.id }, "O'chirilmoqda...");
      });

      actions.appendChild(methodBtn);
      actions.appendChild(amtEl);
      actions.appendChild(delBtn);
      row.appendChild(main);
      row.appendChild(actions);
      recContainer.appendChild(row);
    });
  }

  function renderDebts() {
    if (!state.data) return;
    const debts = state.data.debts || [];
    document.getElementById('debtsCount').textContent = debts.length + ' ta';
    const list = document.getElementById('debtsList');
    list.innerHTML = '';

    if (debts.length === 0) {
      list.appendChild(el('div', 'empty-note', "Hozircha ochiq qarzlar yo'q."));
      return;
    }

    debts.forEach((d) => {
      const row = el('div', 'ledger-row');
      const main = el('div', 'row-main');
      const tag = d.direction === 'owe_me' ? 'Haqqim' : 'Qarzim';
      main.appendChild(el('div', 'row-title', d.personName));
      main.appendChild(el('div', 'row-sub', d.note ? tag + ' · ' + d.note : tag));

      const actions = el('div', 'row-actions');
      actions.appendChild(
        el(
          'span',
          'row-amount' + (d.direction === 'owe_me' ? ' is-income' : ''),
          formatMoney(d.amount, d.currency)
        )
      );

      const payBtn = el('button', 'method-toggle', 'Yopish');
      payBtn.type = 'button';
      payBtn.addEventListener('click', () => {
        haptic('medium');
        runAction({ action: 'pay_debt', debtId: d.id }, 'Yopilmoqda...', 'Qarz yopildi');
      });

      actions.appendChild(payBtn);
      row.appendChild(main);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function renderTasks() {
    if (!state.data) return;
    const ps = state.data.settings || {};
    const tasks = ps.dailyTasks || [];
    const doneSet = new Set(ps.completedTaskIndices || []);

    document.getElementById('tasksProgress').textContent = doneSet.size + ' / ' + tasks.length;

    const list = document.getElementById('tasksList');
    list.innerHTML = '';

    if (tasks.length === 0) {
      list.appendChild(el('div', 'empty-note', "Hozircha kunlik vazifalar yo'q."));
    } else {
      tasks.forEach((task, idx) => {
        const isDone = doneSet.has(idx);
        const row = el('div', 'task-row' + (isDone ? ' is-done' : ''));
        const checkBtn = el('button', 'task-check-btn');
        checkBtn.type = 'button';

        const box = el('span', 'check-box', isDone ? '✓' : '');
        const label = el('span', 'task-text', task);
        checkBtn.appendChild(box);
        checkBtn.appendChild(label);

        checkBtn.addEventListener('click', () => {
          haptic('light');
          runAction({ action: 'toggle_task', index: idx }, 'Yangilanmoqda...');
        });

        const delBtn = el('button', 'icon-btn', '×');
        delBtn.type = 'button';
        delBtn.setAttribute('aria-label', "Vazifani o'chirish");
        delBtn.addEventListener('click', () => {
          haptic('medium');
          runAction({ action: 'remove_task', index: idx }, "O'chirilmoqda...");
        });

        row.appendChild(checkBtn);
        row.appendChild(delBtn);
        list.appendChild(row);
      });
    }

    const remBtn = document.getElementById('reminderToggleBtn');
    const remInput = document.getElementById('reminderTimeInput');
    const enabled = Boolean(ps.reminderEnabled);
    remBtn.setAttribute('aria-pressed', String(enabled));
    remBtn.textContent = enabled ? 'Yoqilgan' : "O'chirilgan";
    if (document.activeElement !== remInput) {
      remInput.value = ps.reminderTime || '09:00';
    }
  }

  function renderLimits() {
    if (!state.data) return;
    const stats = state.data.stats;
    const ps = state.data.settings || {};

    const dSpent = stats.todaySpentUzs || 0;
    const dLimit = ps.dailyLimit || 0;
    const dStatEl = document.getElementById('dailyLimitStat');
    const dBarEl = document.getElementById('dailyLimitBar');
    if (dLimit > 0) {
      const pct = Math.min(100, Math.round((dSpent / dLimit) * 100));
      dStatEl.textContent = formatMoney(dSpent, 'UZS') + ' / ' + formatMoney(dLimit, 'UZS');
      dBarEl.style.width = pct + '%';
      dBarEl.classList.toggle('is-over', dSpent > dLimit);
    } else {
      dStatEl.textContent = formatMoney(dSpent, 'UZS') + ' · Limit yoqilmagan';
      dBarEl.style.width = '0%';
      dBarEl.classList.remove('is-over');
    }

    const mSpent = stats.monthSpentUzs || 0;
    const mLimit = ps.monthlyLimit || 0;
    const mStatEl = document.getElementById('monthlyLimitStat');
    const mBarEl = document.getElementById('monthlyLimitBar');
    if (mLimit > 0) {
      const pct = Math.min(100, Math.round((mSpent / mLimit) * 100));
      mStatEl.textContent = formatMoney(mSpent, 'UZS') + ' / ' + formatMoney(mLimit, 'UZS');
      mBarEl.style.width = pct + '%';
      mBarEl.classList.toggle('is-over', mSpent > mLimit);
    } else {
      mStatEl.textContent = formatMoney(mSpent, 'UZS') + ' · Limit yoqilmagan';
      mBarEl.style.width = '0%';
      mBarEl.classList.remove('is-over');
    }

    const dInput = document.getElementById('dailyLimitInput');
    const mInput = document.getElementById('monthlyLimitInput');
    if (document.activeElement !== dInput) {
      dInput.value = dLimit > 0 ? dLimit + ' ming' : '';
    }
    if (document.activeElement !== mInput) {
      mInput.value = mLimit > 0 ? mLimit + ' ming' : '';
    }
  }

  function renderAll() {
    renderHeader();
    renderWallet();
    renderDebts();
    renderTasks();
    renderLimits();
  }

  function bindNavigation() {
    document.querySelectorAll('.seg-btn[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-tab');
        if (!nextTab || nextTab === state.activeTab) return;
        haptic('light');
        state.activeTab = nextTab;

        document.querySelectorAll('.seg-btn[data-tab]').forEach((b) => {
          const active = b.getAttribute('data-tab') === nextTab;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });

        document.querySelectorAll('.tab-panel').forEach((panel) => {
          const active = panel.id === 'panel-' + nextTab;
          panel.hidden = !active;
          panel.classList.toggle('is-active', active);
        });
      });
    });

    document.querySelectorAll('.pair-btn[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic('light');
        state.recordType = btn.getAttribute('data-type');
        document.querySelectorAll('.pair-btn[data-type]').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });

    document.querySelectorAll('.pair-btn[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic('light');
        state.paymentMethod = btn.getAttribute('data-method');
        document.querySelectorAll('.pair-btn[data-method]').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });

    document.querySelectorAll('.pair-btn[data-direction]').forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic('light');
        state.debtDirection = btn.getAttribute('data-direction');
        document.querySelectorAll('.pair-btn[data-direction]').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });
  }

  function bindForms() {
    document.getElementById('recordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amountEl = document.getElementById('recordAmount');
      const descEl = document.getElementById('recordDesc');
      const amountInput = amountEl.value.trim();
      const description = descEl.value.trim();
      if (!amountInput) return;

      haptic('medium');
      const ok = await runAction(
        {
          action: 'add_record',
          type: state.recordType,
          paymentMethod: state.paymentMethod,
          amountInput,
          description,
        },
        'Saqlanmoqda...',
        state.recordType === 'income' ? 'Kirim saqlandi' : 'Chiqim saqlandi'
      );
      if (ok) {
        amountEl.value = '';
        descEl.value = '';
      }
    });

    document.getElementById('debtForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const personEl = document.getElementById('debtPerson');
      const amtEl = document.getElementById('debtAmount');
      const noteEl = document.getElementById('debtNote');

      const personName = personEl.value.trim();
      const amountInput = amtEl.value.trim();
      const note = noteEl.value.trim();
      if (!personName || !amountInput) return;

      haptic('medium');
      const ok = await runAction(
        {
          action: 'add_debt',
          direction: state.debtDirection,
          personName,
          amountInput,
          note,
        },
        'Saqlanmoqda...',
        'Qarz saqlandi'
      );
      if (ok) {
        personEl.value = '';
        amtEl.value = '';
        noteEl.value = '';
      }
    });

    document.getElementById('taskForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const taskEl = document.getElementById('newTaskInput');
      const task = taskEl.value.trim();
      if (!task) return;

      haptic('light');
      const ok = await runAction(
        { action: 'add_task', task },
        "Qo'shilmoqda...",
        "Vazifa qo'shildi"
      );
      if (ok) taskEl.value = '';
    });

    document.getElementById('reminderToggleBtn').addEventListener('click', () => {
      if (!state.data) return;
      haptic('light');
      const current = Boolean(state.data.settings && state.data.settings.reminderEnabled);
      runAction(
        { action: 'save_settings', reminderEnabled: !current },
        'Saqlanmoqda...'
      );
    });

    document.getElementById('reminderForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const reminderTime = document.getElementById('reminderTimeInput').value.trim();
      if (!reminderTime) return;
      haptic('medium');
      runAction(
        { action: 'save_settings', reminderTime, reminderEnabled: true },
        'Saqlanmoqda...',
        'Eslatma vaqti saqlandi'
      );
    });

    document.getElementById('limitsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const dailyLimit = document.getElementById('dailyLimitInput').value.trim();
      const monthlyLimit = document.getElementById('monthlyLimitInput').value.trim();
      haptic('medium');
      runAction(
        { action: 'save_settings', dailyLimit, monthlyLimit },
        'Saqlanmoqda...',
        'Limitlar saqlandi'
      );
    });
  }

  bindNavigation();
  bindForms();
  runAction({ action: 'load' }, 'Yuklanmoqda...');
})();
