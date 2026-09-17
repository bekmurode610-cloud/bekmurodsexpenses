from aiogram import Router, F
from aiogram.types import Message
from bot.services.expense_service import add_expense
from config import GEMINI_API_KEY
import logging

# We will conditionally import and use gemini
try:
    from google import genai
    from google.genai import types
    from pydantic import BaseModel, Field
    import json
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

router = Router()
logger = logging.getLogger(__name__)

class ExpenseExtraction(BaseModel):
    is_expense: bool = Field(description="True if the message implies an expense. Even short phrases like '140 ming go'stga' or '10 ming for taxi' should be considered True.")
    amount: float = Field(description="The numeric amount paid. 0 if not an expense.", default=0)
    currency: str = Field(description="The 3-letter currency code (e.g. UZS, USD, EUR). Empty string if none.", default="")
    description: str = Field(description="Short description of what was paid for. Empty string if none.", default="")

from bot.utils.auth import is_creator, is_allowed

@router.message(F.text & ~F.text.startswith("/"))
async def process_natural_language_expense(message: Message):
    # Ignore private chats
    if message.chat.type == "private":
        return

    # Check if user is banned
    if not await is_allowed(message):
        return

    # FAST PRE-FILTER: If the message doesn't contain a single number, it's almost certainly not an expense.
    # This prevents the bot from burning through Gemini API rate limits on normal chat conversations!
    import re
    if not re.search(r'\d', message.text):
        return

    # If Gemini is not configured, do nothing
    if not HAS_GEMINI or not GEMINI_API_KEY:
        return

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Call Gemini to parse the message
        prompt = (
            f"Extract expense information from this chat message: '{message.text}'\n"
            "CRITICAL NUMBER INSTRUCTION: The group uses 'ming' (thousands) as their base unit. "
            "You MUST extract the numeric amount strictly in 'ming' units without any trailing zeros. "
            "For example:\n"
            "- '10 ming' -> amount: 10\n"
            "- '10000' or '10000 ming' -> amount: 10\n"
            "- '88 ming' or '88000' -> amount: 88\n"
            "- '14 ming' -> amount: 14\n"
            "YOU ARE STRICTLY FORBIDDEN FROM OUTPUTTING TRAILING ZEROS LIKE 10000 or 140000. Always output the base number (e.g. 10 or 140)."
        )
        
        response = client.models.generate_content(
            model='gemini-3.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ExpenseExtraction,
                temperature=0.0
            ),
        )
        
        data = json.loads(response.text)
        
        is_expense = data.get("is_expense", False)
        try:
            amount = float(data.get("amount", 0))
        except (ValueError, TypeError):
            amount = 0.0
            
        currency = data.get("currency", "").upper()
        
        if is_expense and amount > 0 and currency:
            description = data.get("description", "Expense")
            
            # Use username if available, otherwise full name
            display_name = f"@{message.from_user.username}" if message.from_user.username else message.from_user.full_name
            
            # Store expense
            await add_expense(
                group_id=message.chat.id,
                payer_id=message.from_user.id,
                payer_name=display_name,
                amount=amount,
                currency=currency,
                description=description
            )
            
            # React with thumbs up to confirm it was saved silently!
            try:
                from aiogram.types import ReactionTypeEmoji
                await message.react([ReactionTypeEmoji(emoji="👍")])
            except Exception as e:
                # Fallback if bot doesn't have reaction permissions
                formatted_amount = f"{amount:,.0f}" if amount.is_integer() else f"{amount:,.2f}"
                await message.reply(f"✅ Recorded: {formatted_amount} {currency} — {description}")
                
    except Exception as e:
        logger.error(f"Error processing message with Gemini: {e}")
        error_msg = str(e)
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
            await message.answer("Wait 10 seconds.")
        elif "503" in error_msg or "UNAVAILABLE" in error_msg:
            await message.answer("Servers busy, wait.")
        else:
            await message.answer(f"API Error: {error_msg}")
