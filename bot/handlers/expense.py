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
    # Ignore private chats
    if message.chat.type == "private":
        return

    # Check if user is banned
    if not await is_allowed(message):
        return

    # Remove the * prefix and strip whitespace
    clean_text = message.text[1:].strip()

    # Find the first number in the text
    match = re.search(r'(\d+(?:\.\d+)?)', clean_text)
    if not match:
        return

    try:
        amount_str = match.group(1)
        amount = float(amount_str)
        
        # Remove the number from the description text
        description = clean_text.replace(amount_str, '', 1).strip()
        
        # Handle the "ming" logic for thousands
        if re.search(r'\b(?:ming|k|min)\b', description, re.IGNORECASE):
            # They explicitly said "ming" - remove it from description
            description = re.sub(r'\b(?:ming|k|min)\b', '', description, count=1, flags=re.IGNORECASE).strip()
        elif amount >= 1000:
            # They wrote a large number like 10000. Convert to base unit.
            amount = amount / 1000.0
            
        # Clean up any leftover punctuation or spaces at the start of the description
        description = re.sub(r'^[-_\s,]+', '', description).strip()
        if not description:
            description = "Expense"
            
        # Check for currency (UZS, USD, etc). Default to UZS
        currency = "UZS"
        curr_match = re.search(r'\b(UZS|USD|EUR|RUB)\b', description, re.IGNORECASE)
        if curr_match:
            currency = curr_match.group(1).upper()
            description = re.sub(r'\b(UZS|USD|EUR|RUB)\b', '', description, count=1, flags=re.IGNORECASE).strip()
            
        # Clean up one last time
        description = description.strip()
        
        if amount > 0:
            # Use username if available, otherwise full name
            display_name = f"@{message.from_user.username}" if message.from_user.username else message.from_user.full_name
            
            # Store expense
            await add_expense(
                group_id=message.chat.id,
                payer_id=message.from_user.id,
                payer_name=display_name,
                amount=amount,
                currency=currency,
                description=description,
                group_name=message.chat.title or "Group"
            )
            
            # React with thumbs up to confirm it was saved silently!
            try:
                from aiogram.types import ReactionTypeEmoji
                await message.react([ReactionTypeEmoji(emoji="👍")])
            except Exception as e:
                # Fallback if bot doesn't have reaction permissions
                formatted_amount = f"{amount:,.0f}" if amount.is_integer() else f"{amount:,.2f}"
                await message.reply(f"✅ Recorded: {formatted_amount} {currency} ➔ {description}")
                
    except Exception as e:
        logger.error(f"Error processing rule-based expense: {e}")
        await message.answer(f"Error parsing expense: {str(e)}")
