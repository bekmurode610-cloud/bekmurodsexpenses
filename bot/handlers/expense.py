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
    is_expense: bool = Field(description="True if the user is explicitly stating they paid for something for the group.")
    amount: float = Field(description="The numeric amount paid. 0 if not an expense.", default=0)
    currency: str = Field(description="The 3-letter currency code (e.g. UZS, USD, EUR). Empty string if none.", default="")
    description: str = Field(description="Short description of what was paid for. Empty string if none.", default="")

@router.message(F.text & ~F.text.startswith("/"))
async def process_natural_language_expense(message: Message):
    # Ignore private chats
    if message.chat.type == "private":
        return

    # If Gemini is not configured, do nothing
    if not HAS_GEMINI or not GEMINI_API_KEY:
        return

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Call Gemini to parse the message
        response = client.models.generate_content(
            model='gemini-3.6-flash',
            contents=f"Extract expense information from this chat message: '{message.text}'",
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
            
            # Store expense
            await add_expense(
                group_id=message.chat.id,
                payer_id=message.from_user.id,
                payer_name=message.from_user.full_name,
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
        logger.error(f"Error parsing message with Gemini: {e}")
