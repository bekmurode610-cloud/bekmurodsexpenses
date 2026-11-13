import {
  getAllGroups,
  getGroup,
  getMembers,
  getExpenses,
  deleteExpense,
  settleGroup,
  resetGroup,
  addMemberByName,
  setGroupDutyRoster,
  setGroupExpenseRoster,
  setGroupDutyTime,
  setGroupDutyOffset,
  setGroupLastDutyDoneDate,
  updateGroupSettings,
  checkAndAnnounceDuty,
  getAdminSession,
  setAdminSession,
  syncChatAdmins,
  deleteGroupById,
} from './db-service.js';
import {
  DEFAULT_DUTY_TASKS,
  getGroupSettings,
  getDutyRosterList,
  getExpenseRosterList,
  getActiveDutyPerson,
  getUztTimeInfo,
  formatUzDate,
  normalizeName,
  buildDetailReportText,
} from './settlement.js';
import { syncGroupCommandMenu } from './commands.js';
import { formatMoney } from './format.js';
import { isCreatorOrAdmin } from './auth.js';

const CONTROLLABLE_COMMANDS = [
  { key: '/duty', label: '/duty (Navbatchi)' },
  { key: '/detail', label: '/detail (Hisobot)' },
  { key: '/expenses', label: '/expenses (Xarajatlar)' },
  { key: '/members', label: "/members (A'zolar)" },
  { key: '/delete', label: "/delete (O'chirish)" },
  { key: '/settle', label: '/settle (Nollash)' },
  { key: '/reset', label: '/reset (Tozalash)' },
  { key: '/setduty', label: '/setduty (Navbat sozlash)' },
  { key: '/setdutytime', label: '/setdutytime (Vaqt sozlash)' },
  { key: '/setmembers', label: "/setmembers (A'zo kiritish)" },
  { key: '/help', label: "/help (Qo'llanma)" },
  { key: '*', label: '* (Xarajat yozish)' },
];

function formatDuration(sec) {
  if (!sec || sec <= 0) return "O'chirilmaydi (Off)";
  if (sec < 60) return `${sec} soniya`;
  const mins = Math.round(sec / 60);
  return `${mins} daqiqa`;
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

async function resolveAdminContext(api, userId, username) {
  const allGroups = await getAllGroups();
  if (!allGroups || allGroups.length === 0) {
    return { error: "Bot hali birorta guruhga ulanmagan. Avval botni guruhga qo'shing va guruhda biron xabar yozing." };
  }

  let session = await getAdminSession(userId);
  let grp = allGroups.find((g) => g.id === session?.groupId) || allGroups[0];
  if (!grp) {
    return { error: "Guruh topilmadi." };
  }

  if (session?.groupId !== grp.id) {
    session = await setAdminSession(userId, { groupId: grp.id });
  }

  await syncChatAdmins(api, grp.id, grp.groupName || 'Group');
  const authorized = await isCreatorOrAdmin(grp.id, userId, username);
  if (!authorized) {
    return { error: "⛔ Sizda admin huquqi yo'q. Boshqaruv paneli faqat guruh adminlari uchun." };
  }

  const mems = await getMembers(grp.id);
  const settings = getGroupSettings(grp);
  return { allGroups, grp, mems, settings, session };
}

function getBackKeyboard(target = 'adm:home') {
  return { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: target }]] };
}

async function renderHome(api, chatId, messageId, ctxData, notice = '') {
  const { allGroups, grp, mems, settings } = ctxData;
  const roster = getDutyRosterList(grp, mems);
  const { dateStr } = getUztTimeInfo();
  const isDone = grp.lastDutyDoneDate === dateStr;
  const person = getActiveDutyPerson(roster, grp.dutyOffset || 0, isDone) || 'Belgilanmagan';

  const statusText = isDone ? '✅ Bajarilgan (Done)' : '⏳ Kutilmoqda (Pending)';
  const autoText = settings.autoDutyEnabled ? `🔔 Yoqilgan (${grp.dutyTime || '09:00'} UZT)` : "🔕 O'chirilgan";

  let text = notice ? `${notice}\n\n` : '';
  text += `⚙️ BOT BOSHQARUV PANELI\n\n`;
  text += `🏢 Guruh: ${grp.groupName || grp.id}\n`;
  text += `🧹 Bugungi navbatchi: ${person} (${statusText})\n`;
  text += `⏰ Avto-eslatma: ${autoText}\n`;
  text += `🚫 O'chirilgan buyruqlar: ${settings.disabledCommands.length} ta\n`;
  text += `⏱️ Xabar o'chirish: Umumiy ${formatDuration(settings.generalDeleteSeconds)} | Done ${formatDuration(settings.doneDutyDeleteSeconds)}\n\n`;
  text += `Boshqarish uchun bo'limni tanlang:`;

  const rows = [
    [{ text: '🧹 Navbatchilik (Duty) Boshqaruvi', callback_data: 'adm:duty' }],
    [{ text: '🎛️ Buyruqlar (Yoqish / O\'chirish / Huquqlar)', callback_data: 'adm:cmds' }],
    [{ text: "⏱️ Avto-o'chirish (Timer) Sozlamalari", callback_data: 'adm:timers' }],
    [{ text: "👥 Xarajat A'zolari va Karta", callback_data: 'adm:mems' }],
    [{ text: '💰 Xarajatlar va Hisobot', callback_data: 'adm:exps' }],
  ];
  if (allGroups.length > 1) {
    rows.push([{ text: '🔄 Guruhni almashtirish', callback_data: 'adm:groups' }]);
  }

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderGroups(api, chatId, messageId, ctxData) {
  const { allGroups, grp } = ctxData;
  const rows = [];
  allGroups.forEach((g) => {
    const active = g.id === grp.id ? '✅ ' : '';
    const row = [{ text: `${active}${g.groupName || g.id}`, callback_data: `adm:grp:${g.id}` }];
    if (allGroups.length > 1) {
      row.push({ text: '🗑️', callback_data: `adm:gdel:${g.id}` });
    }
    rows.push(row);
  });
  rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm:home' }]);

  await editOrSend(api, chatId, messageId, '🔄 Boshqariladigan guruhni tanlang (yoki ortiqchasini 🗑️ o\'chiring):', { inline_keyboard: rows });
}

async function renderDutyMenu(api, chatId, messageId, ctxData, notice = '') {
  const { grp, mems, settings } = ctxData;
  const roster = getDutyRosterList(grp, mems);
  const { dateStr, nowUzt } = getUztTimeInfo();
  const isDone = grp.lastDutyDoneDate === dateStr;
  const person = getActiveDutyPerson(roster, grp.dutyOffset || 0, isDone) || 'Belgilanmagan';
  const autoLabel = settings.autoDutyEnabled ? '🔔 Yoqilgan' : "🔕 O'chirilgan";

  let text = notice ? `${notice}\n\n` : '';
  text += `🧹 NAVBATCHILIK BOSHQARUVI\n\n`;
  text += `📅 Sana: ${formatUzDate(nowUzt)}\n`;
  text += `👤 Bugungi navbatchi: ${person}\n`;
  text += `📌 Holat: ${isDone ? '✅ Bajarildi' : '⏳ Kutilmoqda'}\n`;
  text += `⏰ Avto-eslatma: ${autoLabel} — ${grp.dutyTime || '09:00'} UZT\n`;
  text += `👥 Ro'yxat (${roster.length} kishi): ${roster.join(' → ') || "Bo'sh"}\n`;
  text += `📝 Vazifalar (${settings.dutyTasks.length} ta): ${settings.dutyTasks.join(', ')}`;

  const actionRow = isDone
    ? [{ text: '↩️ Bekor qilish (Undo)', callback_data: 'adm:d_undo' }]
    : [{ text: '✅ Bajarildi (Done)', callback_data: 'adm:d_done' }];

  const rows = [
    actionRow,
    [{ text: '📢 Hozir guruhga yuborish', callback_data: 'adm:d_send' }],
    [{ text: "👥 Odam qo'shish / o'chirish / tartib", callback_data: 'adm:d_roster' }],
    [{ text: '📝 Vazifalarni tahrirlash', callback_data: 'adm:d_tasks' }],
    [{ text: `⏰ Vaqt (${grp.dutyTime || '09:00'}) va Avto-yuborish`, callback_data: 'adm:d_time' }],
    [{ text: '⬅️ Bosh menyu', callback_data: 'adm:home' }],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderDutyRoster(api, chatId, messageId, ctxData, notice = '') {
  const { grp, mems } = ctxData;
  const roster = getDutyRosterList(grp, mems);
  const { dateStr } = getUztTimeInfo();
  const isDone = grp.lastDutyDoneDate === dateStr;
  const k = roster.length || 1;
  const activeIdx = isDone
    ? ((((grp.dutyOffset || 0) - 1) % k) + k) % k
    : (((grp.dutyOffset || 0) % k) + k) % k;

  let text = notice ? `${notice}\n\n` : '';
  text += `👥 NAVBATCHILAR RO'YXATI\n\n`;
  if (roster.length === 0) {
    text += "Ro'yxat bo'sh.\n";
  } else {
    roster.forEach((name, idx) => {
      const marker = idx === activeIdx ? (isDone ? ' ✅' : ' 👈 Navbat') : '';
      text += `${idx + 1}. ${name}${marker}\n`;
    });
  }
  text += `\n🎯 Ismga bosing — bugungi navbatchi qilish.\n⬆️ ⬇️ — o'rin almashtirish, 🗑️ — o'chirish.`;

  const rows = [];
  roster.forEach((name, i) => {
    const shortName = name.length > 16 ? `${name.slice(0, 15)}…` : name;
    const row = [{ text: `${i === activeIdx ? '🎯 ' : ''}${i + 1}. ${shortName}`, callback_data: `adm:d_act:${i}` }];
    if (i > 0) row.push({ text: '⬆️', callback_data: `adm:d_up:${i}` });
    if (i < roster.length - 1) row.push({ text: '⬇️', callback_data: `adm:d_dn:${i}` });
    row.push({ text: '🗑️', callback_data: `adm:d_rm:${i}` });
    rows.push(row);
  });

  // Quick-add buttons for known group members missing from duty roster
  const normRoster = new Set(roster.map((n) => normalizeName(n)));
  const seenCandidates = new Set();
  const candidates = [];
  mems.forEach((m) => {
    const norm = normalizeName(m.name);
    if (norm && !normRoster.has(norm) && !seenCandidates.has(norm)) {
      seenCandidates.add(norm);
      candidates.push(m.name);
    }
  });
  candidates.slice(0, 4).forEach((cand, idx) => {
    rows.push([{ text: `➕ Tez qo'shish: ${cand}`, callback_data: `adm:d_qadd:${idx}` }]);
  });

  rows.push([{ text: "➕ Yangi username / ism qo'shish", callback_data: 'adm:d_add' }]);
  rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm:duty' }]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderDutyTasks(api, chatId, messageId, ctxData, notice = '') {
  const { settings } = ctxData;
  let text = notice ? `${notice}\n\n` : '';
  text += `📝 NAVBATCHI VAZIFALARI\n\n`;
  settings.dutyTasks.forEach((task, i) => {
    text += `${i + 1}. ${task}\n`;
  });
  text += `\nVazifani o'chirish uchun 🗑️ tugmasini bosing yoki yangi vazifa qo'shing.`;

  const rows = settings.dutyTasks.map((task, i) => {
    const shortTask = task.length > 26 ? `${task.slice(0, 25)}…` : task;
    return [{ text: `🗑️ ${i + 1}. ${shortTask}`, callback_data: `adm:t_rm:${i}` }];
  });

  rows.push([{ text: "➕ Vazifa qo'shish", callback_data: 'adm:t_add' }]);
  rows.push([{ text: "✏️ Hammasini boshqatdan yozish", callback_data: 'adm:t_set' }]);
  rows.push([{ text: '🔄 Standart vazifalar', callback_data: 'adm:t_rst' }]);
  rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm:duty' }]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderDutyTime(api, chatId, messageId, ctxData, notice = '') {
  const { grp, settings } = ctxData;
  const autoText = settings.autoDutyEnabled ? '✅ YOQILGAN (ON)' : "🚫 O'CHIRILGAN (OFF)";

  let text = notice ? `${notice}\n\n` : '';
  text += `⏰ AVTOMATIK ESLATMA SOZLAMALARI\n\n`;
  text += `🔔 Holat: ${autoText}\n`;
  text += `🕘 Kunlik vaqt: ${grp.dutyTime || '09:00'} (UZT)\n\n`;
  text += `Tayyor vaqtni tanlang yoki o'zingiz kiriting:`;

  const presets = ['07:00', '08:00', '09:00', '10:00', '12:00', '14:00', '18:00', '20:00'];
  const rows = [
    [{ text: settings.autoDutyEnabled ? '🔔 Avto-eslatma: ON (Bosib o\'chirish)' : "🔕 Avto-eslatma: OFF (Bosib yoqish)", callback_data: 'adm:d_auto' }],
    presets.slice(0, 4).map((t) => ({ text: grp.dutyTime === t ? `✅ ${t}` : t, callback_data: `adm:d_tm:${t}` })),
    presets.slice(4, 8).map((t) => ({ text: grp.dutyTime === t ? `✅ ${t}` : t, callback_data: `adm:d_tm:${t}` })),
    [{ text: '✏️ Boshqa vaqt yozish (masalan: 09:30)', callback_data: 'adm:d_tmc' }],
    [{ text: '⬅️ Orqaga', callback_data: 'adm:duty' }],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderCommandsMenu(api, chatId, messageId, ctxData, notice = '') {
  const { settings } = ctxData;
  const disabled = new Set(settings.disabledCommands);
  const adminOnly = new Set(settings.adminOnlyCommands);

  let text = notice ? `${notice}\n\n` : '';
  text += `🎛️ BUYRUQLAR VA FUNKSIYALAR BOSHQARUVI\n\n`;
  text += `Har bir buyruqni butunlay o'chirib qo'yishingiz (🚫) yoki faqat adminlar uchun qilishingiz (🛡️) mumkin:\n`;
  text += `• ✅ = Ishlaydi  |  🚫 = O'chirilgan (guruhda ishlamaydi)\n`;
  text += `• 👥 Hammaga  |  🛡️ Faqat Admin`;

  const rows = CONTROLLABLE_COMMANDS.map((item) => {
    const isOff = disabled.has(item.key);
    const isAdminOnly = adminOnly.has(item.key);
    return [
      { text: `${isOff ? '🚫' : '✅'} ${item.label}`, callback_data: `adm:c_tg:${item.key}` },
      { text: isAdminOnly ? '🛡️ Faqat Admin' : '👥 Hammaga', callback_data: `adm:c_pm:${item.key}` },
    ];
  });

  rows.push([{ text: '✅ Barcha buyruqlarni yoqish', callback_data: 'adm:c_all_on' }]);
  rows.push([{ text: '⬅️ Bosh menyu', callback_data: 'adm:home' }]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderTimersMenu(api, chatId, messageId, ctxData, notice = '') {
  const { settings } = ctxData;
  let text = notice ? `${notice}\n\n` : '';
  text += `⏱️ AVTO-O'CHIRISH (TIMER) SOZLAMALARI\n\n`;
  text += `1️⃣ Umumiy bot javoblari (/detail, /expenses...): ${formatDuration(settings.generalDeleteSeconds)}\n`;
  text += `2️⃣ Foydalanuvchi yozgan buyruqni o'chirish: ${settings.deleteUserCommand ? '✅ Ha' : "❌ Yo'q"}\n`;
  text += `3️⃣ Bajarilmagan (Pending) navbatchi xabari: ${settings.pendingDutyDeleteSeconds === 0 ? "📌 Bajarilguncha o'chmaydi" : formatDuration(settings.pendingDutyDeleteSeconds)}\n`;
  text += `4️⃣ Bajarilgan (Done) navbatchi xabari: ${formatDuration(settings.doneDutyDeleteSeconds)}`;

  const genOpts = [0, 60, 120, 300, 600];
  const pendOpts = [0, 120, 300];
  const doneOpts = [60, 120, 300, 600, 0];

  const rows = [
    [{ text: "— 1. Umumiy xabarlar vaqti —", callback_data: 'adm:noop' }],
    genOpts.map((s) => ({
      text: `${settings.generalDeleteSeconds === s ? '✅ ' : ''}${s === 0 ? 'Off' : `${s / 60}m`}`,
      callback_data: `adm:tm_gen:${s}`,
    })),
    [{ text: `2. Buyruq matnini o'chirish: ${settings.deleteUserCommand ? '✅ ON' : '🚫 OFF'}`, callback_data: 'adm:tm_usr' }],
    [{ text: '— 3. Pending navbatchi xabari —', callback_data: 'adm:noop' }],
    pendOpts.map((s) => ({
      text: `${settings.pendingDutyDeleteSeconds === s ? '✅ ' : ''}${s === 0 ? "📌 O'chmasin" : `${s / 60}m`}`,
      callback_data: `adm:tm_dp:${s}`,
    })),
    [{ text: '— 4. Done bosilgandan keyingi vaqt —', callback_data: 'adm:noop' }],
    doneOpts.map((s) => ({
      text: `${settings.doneDutyDeleteSeconds === s ? '✅ ' : ''}${s === 0 ? 'Off' : `${s / 60}m`}`,
      callback_data: `adm:tm_dd:${s}`,
    })),
    [{ text: '⬅️ Bosh menyu', callback_data: 'adm:home' }],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderMembersMenu(api, chatId, messageId, ctxData, notice = '') {
  const { grp, mems, settings } = ctxData;
  const roster = getExpenseRosterList(grp) || mems.map((m) => m.name);

  let text = notice ? `${notice}\n\n` : '';
  text += `👥 XARAJAT A'ZOLARI VA TO'LOV KARTASI\n\n`;
  text += `Xarajat bo'linadigan a'zolar (${roster.length} kishi):\n`;
  roster.forEach((n, i) => {
    text += `${i + 1}. ${n}\n`;
  });
  text += `\n💳 To'lov kartasi (/detail da): ${settings.showPaymentInfo ? '✅ Yoqilgan' : "🚫 O'chirilgan"}\n`;
  text += `${settings.paymentInfo}`;

  const rows = roster.map((name, i) => [
    { text: `🗑️ Olib tashlash: ${name}`, callback_data: `adm:m_rm:${i}` },
  ]);
  rows.push([{ text: "➕ A'zo qo'shish", callback_data: 'adm:m_add' }]);
  rows.push([{ text: settings.showPaymentInfo ? "💳 Karta ko'rsatish: ON" : "💳 Karta ko'rsatish: OFF", callback_data: 'adm:pay_tg' }]);
  rows.push([{ text: '✏️ Karta ma\'lumotini o\'zgartirish', callback_data: 'adm:pay_ed' }]);
  rows.push([{ text: '⬅️ Bosh menyu', callback_data: 'adm:home' }]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderExpensesMenu(api, chatId, messageId, ctxData, notice = '') {
  const { grp, mems } = ctxData;
  const allExpenses = await getExpenses(grp.id, { limit: 10000, includeSettled: true });
  const report = buildDetailReportText(mems, allExpenses, grp);

  let text = notice ? `${notice}\n\n` : '';
  text += `💰 XARAJATLAR VA BALANS\n\n${report}`;
  if (text.length > 3900) {
    text = `${text.slice(0, 3880)}\n...`;
  }

  const rows = [
    [{ text: "📋 Xarajatlar ro'yxati va o'chirish", callback_data: 'adm:e_list' }],
    [{ text: '📢 Hisobotni guruhga yuborish', callback_data: 'adm:e_post' }],
    [
      { text: '🔄 Nollash (Settle)', callback_data: 'adm:e_settle' },
      { text: '🗑️ Tozalash (Reset)', callback_data: 'adm:e_reset' },
    ],
    [{ text: '⬅️ Bosh menyu', callback_data: 'adm:home' }],
  ];

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

async function renderExpenseList(api, chatId, messageId, ctxData, notice = '') {
  const { grp } = ctxData;
  const recent = await getExpenses(grp.id, { limit: 12, includeSettled: false });
  let text = notice ? `${notice}\n\n` : '';
  text += `📋 SO'NGGI XARAJATLAR (O'chirish uchun bosing):\n\n`;

  if (!recent || recent.length === 0) {
    text += "Hozircha nollanmagan xarajatlar yo'q.";
  } else {
    recent.forEach((exp, idx) => {
      text += `${idx + 1}. ${exp.payerName}: ${formatMoney(exp.amount, exp.currency)} — ${exp.description} (#${exp.id})\n`;
    });
  }

  const rows = recent.map((exp) => [
    {
      text: `🗑️ #${exp.id} ${exp.payerName}: ${formatMoney(exp.amount, exp.currency)}`,
      callback_data: `adm:e_del:${exp.id}`,
    },
  ]);
  rows.push([{ text: '⬅️ Orqaga', callback_data: 'adm:exps' }]);

  await editOrSend(api, chatId, messageId, text, { inline_keyboard: rows });
}

export async function handleAdminPrivateMessage(api, message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const username = message.from?.username;
  const text = (message.text || '').trim();

  if (!userId) return;

  const ctxData = await resolveAdminContext(api, userId, username);
  if (ctxData.error) {
    if (text.startsWith('/start') || text.startsWith('/admin') || text.startsWith('/help')) {
      await api.sendMessage({ chat_id: chatId, text: ctxData.error });
    }
    return;
  }

  const { grp, mems, settings, session } = ctxData;

  if (text.startsWith('/start') || text.startsWith('/admin')) {
    await setAdminSession(userId, { awaitingInput: null });
    await renderHome(api, chatId, null, ctxData);
    return;
  }

  if (text.startsWith('/cancel')) {
    await setAdminSession(userId, { awaitingInput: null });
    await renderHome(api, chatId, null, ctxData, '❌ Amaliyot bekor qilindi.');
    return;
  }

  if (session?.awaitingInput) {
    const mode = session.awaitingInput;
    await setAdminSession(userId, { awaitingInput: null });

    if (mode === 'add_duty_member') {
      const additions = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const roster = [...getDutyRosterList(grp, mems)];
      const existingNorm = new Set(roster.map((n) => normalizeName(n)));
      let addedCount = 0;
      for (const item of additions) {
        const clean = item.replace(/\s+/g, ' ').trim();
        if (clean && !existingNorm.has(normalizeName(clean))) {
          roster.push(clean);
          existingNorm.add(normalizeName(clean));
          await addMemberByName(grp.id, clean, grp.groupName || 'Group');
          addedCount++;
        }
      }
      await setGroupDutyRoster(grp.id, roster);
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderDutyRoster(api, chatId, null, refreshed, `✅ ${addedCount} ta odam navbatga qo'shildi.`);
      return;
    }

    if (mode === 'add_duty_task') {
      const newTasks = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const nextTasks = [...settings.dutyTasks, ...newTasks];
      await updateGroupSettings(grp.id, { dutyTasks: nextTasks });
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderDutyTasks(api, chatId, null, refreshed, `✅ Vazifa qo'shildi.`);
      return;
    }

    if (mode === 'set_duty_tasks') {
      const nextTasks = text.split('\n').map((s) => s.trim()).filter(Boolean);
      if (nextTasks.length === 0) {
        await renderDutyTasks(api, chatId, null, ctxData, "❌ Kamida 1 ta vazifa yozing.");
        return;
      }
      await updateGroupSettings(grp.id, { dutyTasks: nextTasks });
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderDutyTasks(api, chatId, null, refreshed, `✅ Vazifalar ro'yxati yangilandi.`);
      return;
    }

    if (mode === 'set_duty_time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
        await setAdminSession(userId, { awaitingInput: 'set_duty_time' });
        await api.sendMessage({
          chat_id: chatId,
          text: "❌ Noto'g'ri format. Masalan `09:00` yoki `21:30` ko'rinishida yuboring (bekor qilish uchun /cancel):",
          reply_markup: getBackKeyboard('adm:cancel'),
        });
        return;
      }
      await setGroupDutyTime(grp.id, text);
      await updateGroupSettings(grp.id, { autoDutyEnabled: true });
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderDutyTime(api, chatId, null, refreshed, `✅ Eslatma vaqti ${text} (UZT) ga o'zgartirildi.`);
      return;
    }

    if (mode === 'add_expense_member') {
      const additions = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const current = getExpenseRosterList(grp) || mems.map((m) => m.name);
      const nextRoster = [...current];
      const existingNorm = new Set(nextRoster.map((n) => normalizeName(n)));
      let addedCount = 0;
      for (const item of additions) {
        if (item && !existingNorm.has(normalizeName(item))) {
          nextRoster.push(item);
          existingNorm.add(normalizeName(item));
          await addMemberByName(grp.id, item, grp.groupName || 'Group');
          addedCount++;
        }
      }
      await setGroupExpenseRoster(grp.id, nextRoster);
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderMembersMenu(api, chatId, null, refreshed, `✅ ${addedCount} ta a'zo qo'shildi.`);
      return;
    }

    if (mode === 'set_payment_info') {
      await updateGroupSettings(grp.id, { paymentInfo: text, showPaymentInfo: true });
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderMembersMenu(api, chatId, null, refreshed, `✅ To'lov kartasi ma'lumoti yangilandi.`);
      return;
    }
  }

  // Fallback for /help or any random private text
  await renderHome(api, chatId, null, ctxData);
}

export async function handleAdminCallback(api, callbackQuery) {
  const data = callbackQuery.data || '';
  const cbId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const userId = callbackQuery.from?.id;
  const username = callbackQuery.from?.username;

  if (data === 'adm:noop') {
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  const ctxData = await resolveAdminContext(api, userId, username);
  if (ctxData.error) {
    await api.answerCallbackQuery({ callback_query_id: cbId, text: ctxData.error, show_alert: true });
    return;
  }

  const { grp, mems, settings } = ctxData;
  const parts = data.split(':');
  const action = parts[1];
  const arg = parts.slice(2).join(':');

  if (action === 'cancel') {
    await setAdminSession(userId, { awaitingInput: null });
    await renderHome(api, chatId, messageId, ctxData, '❌ Bekor qilindi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'home') {
    await setAdminSession(userId, { awaitingInput: null });
    await renderHome(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'groups') {
    await renderGroups(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'grp') {
    const newGroupId = Number(arg);
    await setAdminSession(userId, { groupId: newGroupId, awaitingInput: null });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderHome(api, chatId, messageId, refreshed, '✅ Guruh tanlandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'gdel') {
    const targetId = Number(arg);
    if (!isNaN(targetId)) {
      await deleteGroupById(targetId);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderHome(api, chatId, messageId, refreshed, "🗑️ Ortiqcha guruh o'chirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Duty Manager ---
  if (action === 'duty') {
    await renderDutyMenu(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_done') {
    const roster = getDutyRosterList(grp, mems);
    const k = roster.length || 1;
    const { dateStr } = getUztTimeInfo();
    if (grp.lastDutyDoneDate !== dateStr && roster.length > 0) {
      await setGroupLastDutyDoneDate(grp.id, dateStr);
      await setGroupDutyOffset(grp.id, ((grp.dutyOffset || 0) + 1) % k);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyMenu(api, chatId, messageId, refreshed, '✅ Bugungi navbatchilik bajarildi deb belgilandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId, text: '✅ Bajarildi!' });
    return;
  }

  if (action === 'd_undo') {
    const roster = getDutyRosterList(grp, mems);
    const k = roster.length || 1;
    const { dateStr } = getUztTimeInfo();
    if (grp.lastDutyDoneDate === dateStr && roster.length > 0) {
      await setGroupDutyOffset(grp.id, (((grp.dutyOffset || 0) - 1) % k + k) % k);
      await setGroupLastDutyDoneDate(grp.id, null);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyMenu(api, chatId, messageId, refreshed, '↩️ Done holati bekor qilindi.');
    await api.answerCallbackQuery({ callback_query_id: cbId, text: '↩️ Bekor qilindi!' });
    return;
  }

  if (action === 'd_send') {
    const sent = await checkAndAnnounceDuty(api, grp, mems, true);
    await api.answerCallbackQuery({
      callback_query_id: cbId,
      text: sent ? '📢 Guruhga yuborildi!' : "❌ Navbatchi ro'yxati bo'sh.",
      show_alert: !sent,
    });
    return;
  }

  if (action === 'd_roster') {
    await renderDutyRoster(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_act') {
    const idx = parseInt(arg, 10);
    const roster = getDutyRosterList(grp, mems);
    if (!isNaN(idx) && idx >= 0 && idx < roster.length) {
      await setGroupDutyOffset(grp.id, idx);
      await setGroupLastDutyDoneDate(grp.id, null);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyRoster(api, chatId, messageId, refreshed, `🎯 Bugungi navbatchi: ${roster[idx]}`);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_up' || action === 'd_dn') {
    const idx = parseInt(arg, 10);
    const roster = [...getDutyRosterList(grp, mems)];
    const k = roster.length;
    const swapIdx = action === 'd_up' ? idx - 1 : idx + 1;
    if (!isNaN(idx) && swapIdx >= 0 && swapIdx < k) {
      const tmp = roster[idx];
      roster[idx] = roster[swapIdx];
      roster[swapIdx] = tmp;

      const curOffset = ((grp.dutyOffset || 0) % k + k) % k;
      let nextOffset = curOffset;
      if (curOffset === idx) nextOffset = swapIdx;
      else if (curOffset === swapIdx) nextOffset = idx;

      await setGroupDutyRoster(grp.id, roster);
      await setGroupDutyOffset(grp.id, nextOffset);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyRoster(api, chatId, messageId, refreshed, "🔄 Tartib yangilandi.");
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_rm') {
    const idx = parseInt(arg, 10);
    const roster = [...getDutyRosterList(grp, mems)];
    if (!isNaN(idx) && idx >= 0 && idx < roster.length) {
      const removed = roster.splice(idx, 1)[0];
      const oldLen = roster.length + 1;
      const curOffset = ((grp.dutyOffset || 0) % oldLen + oldLen) % oldLen;
      let nextOffset = curOffset;
      if (roster.length === 0 || curOffset >= roster.length) {
        nextOffset = 0;
      } else if (idx < curOffset) {
        nextOffset = curOffset - 1;
      }
      await setGroupDutyRoster(grp.id, roster);
      await setGroupDutyOffset(grp.id, nextOffset);
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderDutyRoster(api, chatId, messageId, refreshed, `🗑️ ${removed} ro'yxatdan olib tashlandi.`);
    }
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_qadd') {
    const candIdx = parseInt(arg, 10);
    const roster = [...getDutyRosterList(grp, mems)];
    const normRoster = new Set(roster.map((n) => normalizeName(n)));
    const seenCandidates = new Set();
    const candidates = [];
    mems.forEach((m) => {
      const norm = normalizeName(m.name);
      if (norm && !normRoster.has(norm) && !seenCandidates.has(norm)) {
        seenCandidates.add(norm);
        candidates.push(m.name);
      }
    });
    const picked = candidates[candIdx];
    if (picked) {
      roster.push(picked);
      await setGroupDutyRoster(grp.id, roster);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyRoster(api, chatId, messageId, refreshed, picked ? `✅ ${picked} navbatga qo'shildi.` : '');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_add') {
    await setAdminSession(userId, { awaitingInput: 'add_duty_member' });
    await editOrSend(
      api,
      chatId,
      messageId,
      "➕ Navbatchilikka qo'shish uchun foydalanuvchi username yoki ismini yuboring (masalan: `@username` yoki bir nechta vergul bilan):",
      getBackKeyboard('adm:d_roster')
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Duty Tasks ---
  if (action === 'd_tasks') {
    await renderDutyTasks(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 't_rm') {
    const idx = parseInt(arg, 10);
    const tasks = [...settings.dutyTasks];
    if (!isNaN(idx) && idx >= 0 && idx < tasks.length) {
      tasks.splice(idx, 1);
      await updateGroupSettings(grp.id, { dutyTasks: tasks });
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyTasks(api, chatId, messageId, refreshed, "🗑️ Vazifa o'chirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 't_add') {
    await setAdminSession(userId, { awaitingInput: 'add_duty_task' });
    await editOrSend(
      api,
      chatId,
      messageId,
      "➕ Qo'shmoqchi bo'lgan yangi vazifangizni yozib yuboring (har bir qatorda bittadan yozish ham mumkin):",
      getBackKeyboard('adm:d_tasks')
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 't_set') {
    await setAdminSession(userId, { awaitingInput: 'set_duty_tasks' });
    await editOrSend(
      api,
      chatId,
      messageId,
      "✏️ Yangi vazifalar ro'yxatini yozib yuboring (har bir vazifani yangi qatordan yozing):",
      getBackKeyboard('adm:d_tasks')
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 't_rst') {
    await updateGroupSettings(grp.id, { dutyTasks: [...DEFAULT_DUTY_TASKS] });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyTasks(api, chatId, messageId, refreshed, '🔄 Standart vazifalar tiklandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Duty Time & Auto-Sender ---
  if (action === 'd_time') {
    await renderDutyTime(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_auto') {
    const nextVal = !settings.autoDutyEnabled;
    await updateGroupSettings(grp.id, { autoDutyEnabled: nextVal });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyTime(api, chatId, messageId, refreshed, nextVal ? '🔔 Avto-eslatma yoqildi.' : "🔕 Avto-eslatma o'chirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_tm') {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(arg)) {
      await setGroupDutyTime(grp.id, arg);
      await updateGroupSettings(grp.id, { autoDutyEnabled: true });
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderDutyTime(api, chatId, messageId, refreshed, `✅ Eslatma vaqti: ${arg} (UZT)`);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'd_tmc') {
    await setAdminSession(userId, { awaitingInput: 'set_duty_time' });
    await editOrSend(
      api,
      chatId,
      messageId,
      "⏰ Yangi eslatma vaqtini HH:MM formatida yuboring (masalan: `09:30` yoki `20:15`):",
      getBackKeyboard('adm:d_time')
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Commands & Functions Manager ---
  if (action === 'cmds') {
    await renderCommandsMenu(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'c_tg') {
    const list = new Set(settings.disabledCommands);
    if (list.has(arg)) list.delete(arg);
    else list.add(arg);
    await updateGroupSettings(grp.id, { disabledCommands: Array.from(list) });
    const refreshed = await resolveAdminContext(api, userId, username);
    await syncGroupCommandMenu(api, grp.id, refreshed.grp);
    await renderCommandsMenu(api, chatId, messageId, refreshed, `🎛️ ${arg} holati yangilandi.`);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'c_pm') {
    const list = new Set(settings.adminOnlyCommands);
    if (list.has(arg)) list.delete(arg);
    else list.add(arg);
    await updateGroupSettings(grp.id, { adminOnlyCommands: Array.from(list) });
    const refreshed = await resolveAdminContext(api, userId, username);
    await syncGroupCommandMenu(api, grp.id, refreshed.grp);
    await renderCommandsMenu(api, chatId, messageId, refreshed, `🛡️ ${arg} huquqi yangilandi.`);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'c_all_on') {
    await updateGroupSettings(grp.id, { disabledCommands: [] });
    const refreshed = await resolveAdminContext(api, userId, username);
    await syncGroupCommandMenu(api, grp.id, refreshed.grp);
    await renderCommandsMenu(api, chatId, messageId, refreshed, '✅ Barcha buyruqlar yoqildi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Timers Manager ---
  if (action === 'timers') {
    await renderTimersMenu(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tm_gen') {
    await updateGroupSettings(grp.id, { generalDeleteSeconds: parseInt(arg, 10) || 0 });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderTimersMenu(api, chatId, messageId, refreshed, '⏱️ Umumiy taymer yangilandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tm_usr') {
    await updateGroupSettings(grp.id, { deleteUserCommand: !settings.deleteUserCommand });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderTimersMenu(api, chatId, messageId, refreshed, '⏱️ Sozlama saqlandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tm_dp') {
    await updateGroupSettings(grp.id, { pendingDutyDeleteSeconds: parseInt(arg, 10) || 0 });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderTimersMenu(api, chatId, messageId, refreshed, '⏱️ Pending navbatchi taymeri yangilandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'tm_dd') {
    await updateGroupSettings(grp.id, { doneDutyDeleteSeconds: parseInt(arg, 10) || 0 });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderTimersMenu(api, chatId, messageId, refreshed, '⏱️ Done navbatchi taymeri yangilandi.');
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Expense Members & Payment Card ---
  if (action === 'mems') {
    await renderMembersMenu(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'm_rm') {
    const idx = parseInt(arg, 10);
    const current = [...(getExpenseRosterList(grp) || mems.map((m) => m.name))];
    if (!isNaN(idx) && idx >= 0 && idx < current.length) {
      const removed = current.splice(idx, 1)[0];
      await setGroupExpenseRoster(grp.id, current);
      const refreshed = await resolveAdminContext(api, userId, username);
      await renderMembersMenu(api, chatId, messageId, refreshed, `🗑️ ${removed} olib tashlandi.`);
    }
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'm_add') {
    await setAdminSession(userId, { awaitingInput: 'add_expense_member' });
    await editOrSend(
      api,
      chatId,
      messageId,
      "➕ Xarajat a'zolari ro'yxatiga qo'shish uchun `@username` yoki ism yuboring:",
      getBackKeyboard('adm:mems')
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'pay_tg') {
    await updateGroupSettings(grp.id, { showPaymentInfo: !settings.showPaymentInfo });
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderMembersMenu(api, chatId, messageId, refreshed, "💳 Karta ko'rsatish holati o'zgartirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'pay_ed') {
    await setAdminSession(userId, { awaitingInput: 'set_payment_info' });
    await editOrSend(
      api,
      chatId,
      messageId,
      "✏️ Yangi karta raqami va egasining ismini yuboring (masalan:\n💳 9860080393751393\nIsm Familiya):",
      getBackKeyboard('adm:mems')
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  // --- Expenses & Balances Manager ---
  if (action === 'exps') {
    await renderExpensesMenu(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'e_list') {
    await renderExpenseList(api, chatId, messageId, ctxData);
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'e_del') {
    const expId = parseInt(arg, 10);
    if (!isNaN(expId)) {
      await deleteExpense(expId);
    }
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderExpenseList(api, chatId, messageId, refreshed, `🗑️ #${expId} xarajat o'chirildi.`);
    await api.answerCallbackQuery({ callback_query_id: cbId, text: "O'chirildi!" });
    return;
  }

  if (action === 'e_post') {
    const allExpenses = await getExpenses(grp.id, { limit: 10000, includeSettled: true });
    const report = buildDetailReportText(mems, allExpenses, grp);
    await api.sendMessage({ chat_id: grp.id, text: report });
    await api.answerCallbackQuery({ callback_query_id: cbId, text: '📢 Hisobot guruhga yuborildi!' });
    return;
  }

  if (action === 'e_settle') {
    await editOrSend(
      api,
      chatId,
      messageId,
      '🔄 Guruhdagi barcha joriy hisob-kitoblarni (qarzlarni) nollaysizmi?',
      {
        inline_keyboard: [
          [
            { text: '✅ Ha, nollash', callback_data: 'adm:e_settle_ok' },
            { text: '❌ Bekor qilish', callback_data: 'adm:exps' },
          ],
        ],
      }
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'e_settle_ok') {
    await settleGroup(grp.id);
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderExpensesMenu(api, chatId, messageId, refreshed, '✅ Barcha hisob-kitoblar nollandi!');
    await api.answerCallbackQuery({ callback_query_id: cbId, text: 'Nollandi!' });
    return;
  }

  if (action === 'e_reset') {
    await editOrSend(
      api,
      chatId,
      messageId,
      "⚠️ DIQQAT: Guruhdagi barcha xarajatlar tarixi butunlay o'chiriladi. Tasdiqlaysizmi?",
      {
        inline_keyboard: [
          [
            { text: "🗑️ Ha, hammasini o'chirish", callback_data: 'adm:e_reset_ok' },
            { text: '❌ Bekor qilish', callback_data: 'adm:exps' },
          ],
        ],
      }
    );
    await api.answerCallbackQuery({ callback_query_id: cbId });
    return;
  }

  if (action === 'e_reset_ok') {
    await resetGroup(grp.id);
    const refreshed = await resolveAdminContext(api, userId, username);
    await renderExpensesMenu(api, chatId, messageId, refreshed, "🗑️ Barcha xarajatlar butunlay o'chirildi.");
    await api.answerCallbackQuery({ callback_query_id: cbId, text: "O'chirildi!" });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: cbId });
}
