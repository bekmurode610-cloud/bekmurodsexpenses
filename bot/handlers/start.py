from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from bot.services.expense_service import ensure_member

router = Router()

@router.message(Command("start", "help"))
async def cmd_start(message: Message):
    text = (
        "👋 Welcome to the Group Expense Tracker Bot!\n\n"
        "I track shared expenses passively using AI. Just chat normally! (e.g. 'I bought pizza for 50000 UZS').\n"
        "I will react with 👍 when I record an expense.\n\n"
        "🔹 /balance - Show current balances and who owes whom\n"
        "🔹 /report - Generate a complete expense report\n"
        "🔹 /weekly - Generate a weekly expense report\n"
        "🔹 /expenses - List recent expenses\n"
        "🔹 /members - List active participants\n"
        "🔹 /summarize - (Admins) Get a minimal total AI summary\n"
        "🔹 /detail - (Admins) Get a detailed breakdown of who spent what\n\n"
        "📝 **Note**: I only track expenses within Telegram groups. Make sure Group Privacy is OFF in BotFather."
    )
    await message.answer(text)

@router.message(Command("join"))
async def cmd_join(message: Message):
    if message.chat.type == "private":
        await message.answer("This bot is designed to work inside Telegram groups.")
        return
        
    await ensure_member(message.from_user.id, message.chat.id, message.from_user.full_name)
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
