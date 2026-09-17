from aiogram.types import Message
from aiogram import Bot
from bot.services.auth_service import get_user_role

async def is_creator(message: Message, bot: Bot, user_id: int = None, username: str = None) -> bool:
    if user_id is None:
        user_id = message.from_user.id
    if username is None:
        username = message.from_user.username
        
    # Hardcoded superadmin
    if username and username.lower() == "bekmurodergashev":
        return True
        
    role = await get_user_role(user_id)
    return role in ['admin', 'superadmin']

async def is_allowed(message: Message, user_id: int = None) -> bool:
    if user_id is None:
        user_id = message.from_user.id
    role = await get_user_role(user_id)
    return role != 'banned'
