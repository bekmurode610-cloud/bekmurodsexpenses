from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from bot.services.expense_service import get_expense, delete_expense, reset_group
from bot.keyboards.inline import get_delete_expense_keyboard, get_reset_group_keyboard

router = Router()

async def is_admin(message: Message) -> bool:
    chat_member = await message.bot.get_chat_member(message.chat.id, message.from_user.id)
    return chat_member.status in ["administrator", "creator"]

@router.message(Command("delete"))
async def cmd_delete(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")

    args = message.text.split()
    if len(args) < 2:
        return await message.answer("Please provide the expense ID. Example: /delete 123")
        
    try:
        expense_id = int(args[1])
    except ValueError:
        return await message.answer("Invalid expense ID.")
        
    expense = await get_expense(expense_id)
    if not expense:
        return await message.answer("Expense not found.")
        
    if expense.group_id != message.chat.id:
        return await message.answer("Expense not found in this group.")
        
    if expense.payer_id != message.from_user.id and not await is_admin(message):
        return await message.answer("You can only delete your own expenses, unless you are an admin.")
        
    await message.answer(
        f"Are you sure you want to delete this expense?\n"
        f"{expense.payer_name} — {expense.amount} {expense.currency} — {expense.description}",
        reply_markup=get_delete_expense_keyboard(expense_id)
    )

@router.callback_query(F.data.startswith("del_exp_"))
async def process_delete(callback: CallbackQuery):
    expense_id = int(callback.data.split("_")[2])
    expense = await get_expense(expense_id)
    
    if not expense:
        return await callback.message.edit_text("Expense not found or already deleted.")
        
    # Check permissions again
    if expense.payer_id != callback.from_user.id:
        chat_member = await callback.bot.get_chat_member(callback.message.chat.id, callback.from_user.id)
        if chat_member.status not in ["administrator", "creator"]:
            return await callback.answer("You are not authorized to delete this.", show_alert=True)
            
    await delete_expense(expense_id)
    await callback.message.edit_text("✅ Expense deleted.")
    await callback.answer()

@router.message(Command("reset"))
async def cmd_reset(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")
        
    if not await is_admin(message):
        return await message.answer("Only group administrators can reset the group data.")
        
    await message.answer(
        "⚠️ This will permanently delete all expense records for this group.",
        reply_markup=get_reset_group_keyboard()
    )

@router.callback_query(F.data == "confirm_reset")
async def process_reset(callback: CallbackQuery):
    if callback.message.chat.type == "private":
        return
        
    chat_member = await callback.bot.get_chat_member(callback.message.chat.id, callback.from_user.id)
    if chat_member.status not in ["administrator", "creator"]:
        return await callback.answer("You are not authorized to reset the group.", show_alert=True)
        
    await reset_group(callback.message.chat.id)
    await callback.message.edit_text("✅ All expense records for this group have been deleted.")
    await callback.answer()
