from aiogram import Router, F
from aiogram.types import Message
from bot.services.expense_service import add_expense
import logging
import re

router = Router()
logger = logging.getLogger(__name__)

from bot.utils.auth import is_creator, is_allowed

@router.message(F.text & F.text.startswith("*"))
async def process_natural_language_expense(message: Message):
    if message.chat.type == "private":
        return

    if not await is_allowed(message):
        return

    clean_text = message.text[1:].strip()
    match = re.search(r'(\d+(?:\.\d+)?)', clean_text)
    if not match:
        return

    try:
        amount_str = match.group(1)
        amount = float(amount_str)
        
        description = clean_text.replace(amount_str, '', 1).strip()
        
        if re.search(r'\b(?:ming|k|min)\b', description, re.IGNORECASE):
            description = re.sub(r'\b(?:ming|k|min)\b', '', description, count=1, flags=re.IGNORECASE).strip()
        elif amount >= 1000:
            amount = amount / 1000.0
            
        description = re.sub(r'^[-_\s,]+', '', description).strip()
        if not description:
            description = "Expense"
            
        currency = "UZS"
        curr_match = re.search(r'\b(UZS|USD|EUR|RUB)\b', description, re.IGNORECASE)
        if curr_match:
            currency = curr_match.group(1).upper()
            description = re.sub(r'\b(UZS|USD|EUR|RUB)\b', '', description, count=1, flags=re.IGNORECASE).strip()
            
        description = description.strip()
        
        if amount > 0:
            display_name = f"@{message.from_user.username}" if message.from_user.username else message.from_user.full_name
            
            await add_expense(
                group_id=message.chat.id,
                payer_id=message.from_user.id,
                payer_name=display_name,
                amount=amount,
                currency=currency,
                description=description,
                group_name=message.chat.title or "Group"
            )
            
            formatted_amount = f"{amount:,.0f}" if amount.is_integer() else f"{amount:,.2f}"
            await message.reply(f"Recorded: {formatted_amount} {currency} - {description}")
                
    except Exception as e:
        logger.error(f"Error processing rule-based expense: {e}")
        await message.answer(f"Error parsing expense: {str(e)}")
