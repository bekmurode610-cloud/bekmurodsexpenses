import { api } from 'sdk';
import { getUserRole } from './db-service.js';

export async function isAllowed(userId) {
  const role = await getUserRole(userId);
  return role !== 'banned';
}

export async function isCreatorOrAdmin(chatId, userId, username) {
  if (username && username.toLowerCase() === 'bekmurodergashev') {
    return true;
  }

  const role = await getUserRole(userId);
  if (role === 'admin' || role === 'superadmin') {
    return true;
  }

  try {
    const member = await api.getChatMember({ chat_id: chatId, user_id: userId });
    return member.status === 'creator' || member.status === 'administrator';
  } catch {
    return false;
  }
}
