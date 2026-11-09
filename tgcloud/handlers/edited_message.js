import { api } from 'sdk';
import {
  ensureMember,
  getExpenseByMessageId,
  updateExpense,
  deleteExpense,
  addExpense,
} from '../lib/db-service.js';
import { isAllowed, isCreatorOrAdmin } from '../lib/auth.js';
import { parseExpenseInput } from '../lib/format.js';

export default async function (editedMessage, ctx) {
  if (!editedMessage || !editedMessage.text) return;

  const chatId = editedMessage.chat?.id;
  const isPrivate = editedMessage.chat?.type === 'private';
  if (isPrivate || !chatId) return;

  const userId = editedMessage.from?.id;
  const username = editedMessage.from?.username;
  const displayName = username
    ? `@${username}`
    : [editedMessage.from?.first_name, editedMessage.from?.last_name].filter(Boolean).join(' ') || 'User';

  if (!userId || !(await isAllowed(userId))) {
    return;
  }

  const messageId = editedMessage.message_id;
  const text = editedMessage.text.trim();

  // Check if an expense was previously recorded for this specific message
  const existing = await getExpenseByMessageId(chatId, messageId);

  // If already settled, do not alter historical closed balances
  if (existing && existing.settled === 1) {
    return;
  }

  const isStarExpense = text.startsWith('*');
  const isAddCommand = /^\/add(?:@[a-zA-Z0-9_]+)?(?:\s+|$)/i.test(text);

  if (isStarExpense || isAddCommand) {
    let cleanText = text;
    if (isAddCommand) {
      cleanText = cleanText.replace(/^\/add(?:@[a-zA-Z0-9_]+)?\s*/i, '');
    } else {
      cleanText = cleanText.slice(1);
    }

    const parsed = parseExpenseInput(cleanText);
    if (!parsed) {
      return;
    }

    const { amount, currency, description } = parsed;

    if (existing) {
      // Permission check: only the original payer or group admin can edit
      const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
      if (existing.payerId !== userId && !isAdmin) {
        return;
      }

      await updateExpense(existing.id, {
        amount,
        currency: currency.toUpperCase(),
        description,
        payerName: displayName,
      });

      if (messageId) {
        try {
          await api.setMessageReaction({
            chat_id: chatId,
            message_id: messageId,
            reaction: [{ type: 'emoji', emoji: '👍' }],
          });
        } catch (reactErr) {
          console.warn('Could not set reaction on edited expense:', reactErr);
        }
      }
    } else {
      // Message was not an expense previously, but edited into one
      await ensureMember(userId, chatId, displayName, editedMessage.chat.title || 'Group');

      await addExpense({
        groupId: chatId,
        payerId: userId,
        payerName: displayName,
        amount,
        currency,
        description,
        messageId,
        groupName: editedMessage.chat.title || 'Group',
      });

      if (messageId) {
        try {
          await api.setMessageReaction({
            chat_id: chatId,
            message_id: messageId,
            reaction: [{ type: 'emoji', emoji: '👍' }],
          });
        } catch (reactErr) {
          console.warn('Could not set reaction on new edited expense:', reactErr);
        }
      }
    }
  } else if (existing) {
    // User edited the message into non-expense text: remove the expense from DB
    const isAdmin = await isCreatorOrAdmin(chatId, userId, username);
    if (existing.payerId === userId || isAdmin) {
      await deleteExpense(existing.id);

      if (messageId) {
        try {
          await api.setMessageReaction({
            chat_id: chatId,
            message_id: messageId,
            reaction: [],
          });
        } catch (reactErr) {
          console.warn('Could not clear reaction on edited expense removal:', reactErr);
        }
      }
    }
  }
}
