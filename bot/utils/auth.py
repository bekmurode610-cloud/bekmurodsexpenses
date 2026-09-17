from aiogram.types import Message
from aiogram import Bot
chat_creators = {}
async def is_creator(message: Message, bot: Bot, user_id: int = None, username: str = None) -> bool:
    # Strictly limit all admin commands to this specific user
    if username is None:
        username = message.from_user.username
        
    if username and username.lower() == "bekmurodergashev":
        return True
    return False
