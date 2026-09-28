from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from bot.services.expense_service import ensure_member

router = Router()

@router.message(Command("start", "help"))
async def cmd_start(message: Message):
    text = (
        "👋 **Group Expense Tracker**\n\n"
        "Add an expense using `*`:\n"
        "👉 `* 10 ming nonga`\n\n"
        "📌 **Commands:**\n"
        "🔹 /balance - Who owes whom\n"
        "🔹 /expenses - Recent history\n"
        "🔹 /weekly - Weekly report\n"
        "🔹 /report - Full report\n"
        "🔹 /settle - Mark debts as settled (Admins)\n"
        "🔹 /members - Participants"
    )
    await message.answer(text)

@router.message(Command("join"))
async def cmd_join(message: Message):
    if message.chat.type == "private":
        await message.answer("This bot is designed to work inside Telegram groups.")
        return
        
    await ensure_member(message.from_user.id, message.chat.id, message.from_user.full_name, message.chat.title or "Group")
    await message.answer(f"✅ {message.from_user.full_name} is now participating in group expenses.")

@router.message(Command("members"))
async def cmd_members(message: Message):
    if message.chat.type == "private":
        await message.answer("This bot is designed to work inside Telegram groups.")
        return
        
    from bot.services.expense_service import get_members
    members = await get_members(message.chat.id)
    if not members:
        await message.answer("No active participants found. Use /expense or /join to participate.")
        return
        
    text = "👥 **Active Participants:**\n\n"
    for idx, m in enumerate(members, 1):
        text += f"{idx}. {m.name}\n"
    await message.answer(text)

@router.callback_query(F.data == "cancel_action")
async def cancel_action(callback: CallbackQuery):
    await callback.message.edit_text("Action canceled.")
    await callback.answer()
