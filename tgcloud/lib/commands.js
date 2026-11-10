export const USER_COMMANDS = [
  { command: 'balance', description: 'Hisob-kitob (balans)' },
  { command: 'duty', description: 'Bugungi navbatchi' },
  { command: 'expenses', description: 'Yaqindagi xarajatlar' },
  { command: 'members', description: "A'zolar ro'yxati" },
  { command: 'weekly', description: 'Haftalik hisobot' },
  { command: 'detail', description: "To'liq hisobot" },
  { command: 'help', description: "Qo'llanma" },
];

export const ADMIN_COMMANDS = [
  { command: 'setmembers', description: "Xarajat a'zolarini belgilash" },
  { command: 'setduty', description: "Navbatchilarni kiritish" },
  { command: 'setdutytime', description: "Eslatma vaqtini sozlash (UZT)" },
  { command: 'duty', description: "Navbatchi va boshqaruv" },
  { command: 'balance', description: "Hisob-kitob (balans)" },
  { command: 'expenses', description: "Yaqindagi xarajatlar" },
  { command: 'members', description: "A'zolar ro'yxati" },
  { command: 'weekly', description: "Haftalik hisobot" },
  { command: 'detail', description: "To'liq hisobot" },
  { command: 'settle', description: "Qarzlarni nollash" },
  { command: 'reset', description: "Xarajatlarni o'chirish" },
  { command: 'help', description: "Qo'llanma" },
];

export const PRIVATE_COMMANDS = [
  { command: 'start', description: "Botni ishga tushirish" },
  { command: 'help', description: "Qo'llanma" },
];

export async function setupBotCommands(api) {
  // 1. Group regular members: restricted to user commands
  await api.setMyCommands({
    commands: USER_COMMANDS,
    scope: { type: 'all_group_chats' },
  });

  // 2. Group administrators: full access to admin commands
  await api.setMyCommands({
    commands: ADMIN_COMMANDS,
    scope: { type: 'all_chat_administrators' },
  });

  // 3. Private chats: basic commands
  await api.setMyCommands({
    commands: PRIVATE_COMMANDS,
    scope: { type: 'all_private_chats' },
  });

  return { ok: true };
}
