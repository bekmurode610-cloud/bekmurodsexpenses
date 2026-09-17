from aiogram.types import Message
from aiogram import Bot
chat_creators = {}
async def is_creator(message: Message, bot: Bot, user_id: int = None) -> bool:
    chat_id = message.chat.id
    if user_id is None:
        user_id = message.from_user.id
    if chat_id > 0:
        return True
    if chat_id not in chat_creators:
        try:
            admins = await bot.get_chat_administrators(chat_id)
            for admin in admins:
                if admin.status == 'creator':
                    chat_creators[chat_id] = admin.user.id
                    break
        except Exception as e:
            import logging
            logging.error(f'Failed to get chat administrators: {e}')
            return False
    return chat_creators.get(chat_id) == user_id
