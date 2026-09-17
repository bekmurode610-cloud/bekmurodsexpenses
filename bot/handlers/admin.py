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

@router.message(Command("summarize"))
async def cmd_summarize(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")
        
    if not await is_admin(message):
        return await message.answer("Only group administrators can ask for an AI summary.")
        
    from bot.services.expense_service import get_expenses, get_live_member_names
    from config import GEMINI_API_KEY
    
    expenses = await get_expenses(message.chat.id, limit=200)
    if not expenses:
        return await message.answer("There are no expenses to summarize yet.")
        
    member_names = await get_live_member_names(message.bot, message.chat.id)
            
    expense_data = []
    for exp in expenses:
        name = member_names.get(exp.payer_id, exp.payer_name)
        expense_data.append(f"{name} paid {exp.amount} {exp.currency} for {exp.description} on {exp.created_at.strftime('%Y-%m-%d')}")
        
    prompt = (
        "You are an AI assistant for a group chat expense tracker.\n"
        "Here is the recent expense history for this group:\n\n"
        + "\n".join(expense_data) +
        "\n\nPlease calculate the total amount spent by each person and output ONLY a clean, minimal list like this:\n"
        "Expenses:\n"
        "Name1: 45 ming total\n"
        "Name2: 54 ming total\n"
        "CRITICAL RULE: DO NOT use ANY markdown characters (no asterisks, no hashes, no bolding, no italics, no emojis). Use pure plain text only.\n"
        "NUMBER FORMATTING RULE: Always format large amounts in 'ming'. Strip all trailing zeros. For example, if the amount is 88000000 or 88000, write EXACTLY '88 ming' (never '88000 ming'). If it is 14000, write '14 ming'."
    )
    
    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model='gemini-3.6-flash',
            contents=prompt,
        )
        await message.answer(f"Expenses Summary:\n\n{response.text}")
    except Exception as e:
        import logging
        error_msg = str(e)
        logging.error(f"Error in /summarize: {error_msg}")
        
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
            await message.answer("Wait 10 seconds.")
        else:
            await message.answer("Error, try again.")

@router.message(Command("detail"))
async def cmd_detail(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")
        
    if not await is_admin(message):
        return await message.answer("Only group administrators can ask for an AI detailed report.")
        
    from bot.services.expense_service import get_expenses, get_live_member_names
    from config import GEMINI_API_KEY
    
    expenses = await get_expenses(message.chat.id, limit=200)
    if not expenses:
        return await message.answer("There are no expenses to report yet.")
        
    member_names = await get_live_member_names(message.bot, message.chat.id)
            
    expense_data = []
    for exp in expenses:
        name = member_names.get(exp.payer_id, exp.payer_name)
        expense_data.append(f"{name} paid {exp.amount} {exp.currency} for {exp.description} on {exp.created_at.strftime('%Y-%m-%d')}")
        
    prompt = (
        "You are an AI assistant for a group chat expense tracker.\n"
        "Here is the recent expense history for this group:\n\n"
        + "\n".join(expense_data) +
        "\n\nPlease output a clean, detailed list grouped by each individual. For each person, list their expenses.\n"
        "CRITICAL RULE: DO NOT use ANY markdown characters (no *, no #, no bold, no italics, no emojis). Use pure plain text only. Do not use bullets or dashes. Just plain clean text.\n"
        "FORMATTING RULE: Do not use messy vertical lists with 'Date:', 'Amount:', or 'Description:'. Keep each expense on a single clean line!\n"
        "Example Format:\n"
        "@username\n"
        "88 ming for groceries (Sep 16)\n"
        "14 ming for taxi (Sep 16)\n\n"
        "NUMBER FORMATTING RULE: Always format large amounts in 'ming'. You MUST aggressively strip ALL trailing zeros so it reads like human slang. For example:\n"
        "- If the database amount is 88000000 or 88000, output exactly '88 ming'. NEVER output '88000 ming'.\n"
        "- If the amount is 14000, output '14 ming'.\n"
        "- If the amount is 45000, output '45 ming'."
    )
    
    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model='gemini-3.6-flash',
            contents=prompt,
        )
        
        # Check if the response was blocked by safety filters
        if not response.candidates or not response.candidates[0].content.parts:
            return await message.answer(f"Sorry, the AI blocked the response due to safety filters. Finish Reason: {response.candidates[0].finish_reason if response.candidates else 'Unknown'}")
            
        await message.answer(f"Detailed Report:\n\n{response.text}")

    except Exception as e:
        import logging
        error_msg = str(e)
        logging.error(f"Error in /detail: {error_msg}")
        
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
            await message.answer("Wait 10 seconds.")
        else:
            await message.answer("Error, try again.")
