import { getGroupSettings } from './settlement.js';

export const USER_COMMANDS = [
  { command: 'expenses', description: 'Yaqindagi xarajatlar' },
  { command: 'duty', description: 'Bugungi navbatchi' },
  { command: 'detail', description: "To'liq hisobot" },
  { command: 'members', description: "A'zolar ro'yxati" },
  { command: 'help', description: "Qo'llanma" },
];

export const ADMIN_COMMANDS = [
  { command: 'expenses', description: "Yaqindagi xarajatlar" },
  { command: 'duty', description: "Bugungi navbatchi va boshqaruv" },
  { command: 'detail', description: "To'liq hisobot" },
  { command: 'members', description: "A'zolar ro'yxati" },
  { command: 'setmembers', description: "Xarajat a'zolarini belgilash" },
  { command: 'setduty', description: "Navbatchilarni kiritish" },
  { command: 'setdutytime', description: "Eslatma vaqtini sozlash (UZT)" },
  { command: 'settle', description: "Qarzlarni nollash" },
  { command: 'reset', description: "Xarajatlarni o'chirish" },
  { command: 'help', description: "Qo'llanma" },
];

export const PRIVATE_COMMANDS = [
  { command: 'start', description: "⚙️ Boshqaruv paneli (Admin Panel)" },
  { command: 'admin', description: "⚙️ Boshqaruv panelini ochish" },
  { command: 'help', description: "Qo'llanma" },
];

export async function syncGroupCommandMenu(api, groupId, group) {
  if (!api || !groupId) return;
  const settings = getGroupSettings(group);
  const disabled = new Set(settings.disabledCommands);
  const adminOnly = new Set(settings.adminOnlyCommands);

  const visibleToMembers = ADMIN_COMMANDS.filter((c) => {
    const slash = `/${c.command}`;
    return !disabled.has(slash) && !adminOnly.has(slash);
  });

  const visibleToAdmins = ADMIN_COMMANDS.filter((c) => {
    const slash = `/${c.command}`;
    return !disabled.has(slash);
  });

  try {
    await api.setMyCommands({
      commands: visibleToMembers,
      scope: { type: 'chat', chat_id: groupId },
    });
    await api.setMyCommands({
      commands: visibleToAdmins,
      scope: { type: 'chat_administrators', chat_id: groupId },
    });
  } catch (err) {
    console.warn('Could not sync group command menu:', err?.message || err);
  }
}

export async function setupBotCommands(api) {
  await api.setMyCommands({
    commands: USER_COMMANDS,
    scope: { type: 'all_group_chats' },
  });

  await api.setMyCommands({
    commands: ADMIN_COMMANDS,
    scope: { type: 'all_chat_administrators' },
  });

  await api.setMyCommands({
    commands: PRIVATE_COMMANDS,
    scope: { type: 'all_private_chats' },
  });

  return { ok: true };
}
