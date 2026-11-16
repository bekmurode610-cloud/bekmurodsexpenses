(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  const state = {
    activeTab: 'wallet',
    recordType: 'expense',
    paymentMethod: 'card',
    debtDirection: 'owe_me',
    debtWalletMethod: 'none',
    repayWalletMethod: 'card',
    activeDebt: null,
    busy: false,
    data: null,
    toastTimer: null,
    confirmTimer: null,
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

  function closeConfirmDialog() {
    if (state.confirmTimer) {
      clearTimeout(state.confirmTimer);
      state.confirmTimer = null;
    }
    const backdrop = document.getElementById('confirmBackdrop');
    if (backdrop) backdrop.hidden = true;
  }

  function openConfirmDialog(opts) {
    const backdrop = document.getElementById('confirmBackdrop');
    const titleEl = document.getElementById('confirmTitle');
    const descEl = document.getElementById('confirmDesc');
    const actionsEl = document.getElementById('confirmActions');
    if (!backdrop || !titleEl || !descEl || !actionsEl) return;

    function renderStepTwo() {
      haptic('light');
      titleEl.textContent = opts.title2;
      descEl.textContent = opts.desc2;
      actionsEl.innerHTML = '';

      // Place final danger action on the left while keep/cancel takes the spot
      // that was just tapped in step 1, blocking accidental double-taps.
      const finalBtn = el('button', 'danger-solid-btn', opts.confirmLabel2 || "Ha, o'chirish (2/2)");
      finalBtn.type = 'button';
      finalBtn.disabled = true;

      const keepBtn = el('button', 'secondary-btn', "Yo'q, qolsin");
      keepBtn.type = 'button';
      keepBtn.addEventListener('click', closeConfirmDialog);

      finalBtn.addEventListener('click', () => {
        haptic('heavy');
        closeConfirmDialog();
        opts.onConfirm();
      });

      actionsEl.appendChild(finalBtn);
      actionsEl.appendChild(keepBtn);

      if (state.confirmTimer) clearTimeout(state.confirmTimer);
      state.confirmTimer = setTimeout(() => {
        finalBtn.disabled = false;
      }, 500);
    }

    titleEl.textContent = opts.title1;
    descEl.textContent = opts.desc1;
    actionsEl.innerHTML = '';

    const cancelBtn = el('button', 'secondary-btn', "Bekor qilish");
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', closeConfirmDialog);

    const stepOneBtn = el(
      'button',
      opts.twoStep ? 'danger-outline-btn' : 'danger-solid-btn',
      opts.confirmLabel1 || "Ha, o'chirish"
    );
    stepOneBtn.type = 'button';
    stepOneBtn.addEventListener('click', () => {
      if (opts.twoStep) {
        renderStepTwo();
      } else {
        haptic('medium');
        closeConfirmDialog();
        opts.onConfirm();
      }
    });

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(stepOneBtn);
    backdrop.hidden = false;
  }

  function closeDebtPayDialog() {
    state.activeDebt = null;
    const backdrop = document.getElementById('debtPayBackdrop');
    if (backdrop) backdrop.hidden = true;
  }

  function openDebtPayDialog(debt) {
    state.activeDebt = debt;
    state.repayWalletMethod = 'card';

    const titleEl = document.getElementById('debtPayTitle');
    const descEl = document.getElementById('debtPayDesc');
    const amtEl = document.getElementById('debtPayAmount');
    const walletLabelEl = document.getElementById('debtPayWalletLabel');
    const backdrop = document.getElementById('debtPayBackdrop');
    if (!backdrop || !titleEl || !descEl || !amtEl || !walletLabelEl) return;

    const isOweMe = debt.direction === 'owe_me';
    titleEl.textContent = isOweMe ? 'Qarz qaytarilishi' : "Qarzni to'lash";
    descEl.textContent =
      debt.personName + ' · Joriy qoldiq: ' + formatMoney(debt.amount, debt.currency);
    walletLabelEl.textContent = isOweMe
      ? "Qaysi hamyonga tushadi? (Kirim)"
      : "Qaysi hamyondan to'lanadi?";

    const cur = (debt.currency || 'UZS').toUpperCase();
    amtEl.value = cur === 'UZS' ? String(debt.amount) + ' ming' : String(debt.amount) + ' ' + cur;

    document.querySelectorAll('.pair-btn[data-repay-wallet]').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-repay-wallet') === 'card');
    });

    backdrop.hidden = false;
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
    const aptLbl = aptRow ? aptRow.querySelector('.field-label') : null;
    if (state.data.apartment) {
      const bal = state.data.apartment.balance || 0;
      const sign = bal > 0 ? '+' : '';
      aptRow.hidden = false;
      if (aptLbl) {
        aptLbl.textContent = state.data.apartment.weekLabel
          ? 'Kvartira (' + state.data.apartment.weekLabel + ')'
          : 'Kvartira balansi';
      }
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
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic('light');
        const methodText = rec.paymentMethod === 'cash' ? 'Naqd' : 'Karta';
        const amountText = (isInc ? '+' : '-') + formatMoney(rec.amount, rec.currency);
        const itemLabel = rec.description + ' (' + amountText + ', ' + methodText + ')';
        openConfirmDialog({
          twoStep: true,
          title1: "Yozuvni o'chirasizmi? (1/2)",
          desc1: itemLabel,
          confirmLabel1: "Ha, o'chirish (1/2)",
          title2: "Aniq o'chirasizmi? (2/2)",
          desc2: itemLabel + " butunlay o'chiriladi. Ortga qaytarib bo'lmaydi.",
          confirmLabel2: "Butunlay o'chirish",
          onConfirm: () => {
            runAction({ action: 'delete_record', recordId: rec.id }, "O'chirilmoqda...", "Yozuv o'chirildi");
          },
        });
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

      const payBtn = el(
        'button',
        'method-toggle',
        d.direction === 'owe_me' ? 'Qaytarish' : "To'lash"
      );
      payBtn.type = 'button';
      payBtn.addEventListener('click', () => {
        haptic('light');
        openDebtPayDialog(d);
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
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          haptic('light');
          openConfirmDialog({
            twoStep: true,
            title1: "Vazifani o'chirasizmi? (1/2)",
            desc1: task,
            confirmLabel1: "Ha, o'chirish (1/2)",
            title2: "Aniq o'chirasizmi? (2/2)",
            desc2: '"' + task + '" ro\'yxatdan olib tashlanadi.',
            confirmLabel2: "Butunlay o'chirish",
            onConfirm: () => {
              runAction({ action: 'remove_task', index: idx }, "O'chirilmoqda...", "Vazifa o'chirildi");
            },
          });
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

  function bindSegmentedGroup(attrName, onSelect) {
    const buttons = document.querySelectorAll('.pair-btn[' + attrName + ']');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic('light');
        const val = btn.getAttribute(attrName);
        buttons.forEach((b) => b.classList.toggle('is-active', b === btn));
        onSelect(val);
      });
    });
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

    bindSegmentedGroup('data-type', (v) => {
      state.recordType = v;
    });
    bindSegmentedGroup('data-method', (v) => {
      state.paymentMethod = v;
    });
    bindSegmentedGroup('data-direction', (v) => {
      state.debtDirection = v;
      const lbl = document.getElementById('debtWalletLabel');
      if (lbl) {
        lbl.textContent = v === 'owe_me' ? "Qaysi hamyondan berildi?" : "Qaysi hamyonga olindi?";
      }
    });
    bindSegmentedGroup('data-debt-wallet', (v) => {
      state.debtWalletMethod = v;
    });
    bindSegmentedGroup('data-repay-wallet', (v) => {
      state.repayWalletMethod = v;
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
          walletMethod: state.debtWalletMethod,
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

    const debtPayForm = document.getElementById('debtPayForm');
    if (debtPayForm) {
      debtPayForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.activeDebt) return;
        const debt = state.activeDebt;
        const amountInput = document.getElementById('debtPayAmount').value.trim();
        if (!amountInput) return;

        haptic('medium');
        const ok = await runAction(
          {
            action: 'pay_debt',
            debtId: debt.id,
            amountInput,
            walletMethod: state.repayWalletMethod,
          },
          'Saqlanmoqda...'
        );
        if (ok) {
          const rep = state.data && state.data.lastRepayment;
          closeDebtPayDialog();
          if (rep) {
            const msg = rep.closed
              ? 'Qarz yopildi (' + formatMoney(rep.paid, debt.currency) + ')'
              : formatMoney(rep.paid, debt.currency) +
                ' qaytarildi · Qoldiq: ' +
                formatMoney(rep.remaining, debt.currency);
            showToast(msg, false);
          }
        }
      });
    }

    const debtPayCancelBtn = document.getElementById('debtPayCancelBtn');
    if (debtPayCancelBtn) {
      debtPayCancelBtn.addEventListener('click', closeDebtPayDialog);
    }

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

    const backdrop = document.getElementById('confirmBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeConfirmDialog();
      });
    }
    const debtPayBackdrop = document.getElementById('debtPayBackdrop');
    if (debtPayBackdrop) {
      debtPayBackdrop.addEventListener('click', (e) => {
        if (e.target === debtPayBackdrop) closeDebtPayDialog();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeConfirmDialog();
        closeDebtPayDialog();
      }
    });
  }

  bindNavigation();
  bindForms();
  runAction({ action: 'load' }, 'Yuklanmoqda...');
})();
