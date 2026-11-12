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
  { command: 'start', description: "Botni ishga tushirish" },
  { command: 'help', description: "Qo'llanma" },
];

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
