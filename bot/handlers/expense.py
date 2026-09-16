from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from bot.states.expense import ExpenseState
from bot.services.expense_service import add_expense
from bot.keyboards.inline import get_cancel_keyboard

router = Router()

@router.message(Command("expense"))
async def cmd_expense(message: Message, state: FSMContext):
    if message.chat.type == "private":
        await message.answer("This bot is designed to work inside Telegram groups.")
        return

    await state.set_state(ExpenseState.waiting_for_amount)
    await message.answer(
        "How much did you pay?",
        reply_markup=get_cancel_keyboard()
    )

@router.message(ExpenseState.waiting_for_amount)
async def process_amount(message: Message, state: FSMContext):
    try:
        # replace comma with dot for floats
        amount_str = message.text.replace(",", ".")
        amount = float(amount_str)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("Please enter a valid positive amount.")
        return

    await state.update_data(amount=amount)
    await state.set_state(ExpenseState.waiting_for_currency)
    await message.answer("Currency? (e.g., UZS, USD, EUR)", reply_markup=get_cancel_keyboard())

@router.message(ExpenseState.waiting_for_currency)
async def process_currency(message: Message, state: FSMContext):
    currency = message.text.strip().upper()
    if len(currency) > 5 or not currency.isalpha():
        await message.answer("Please enter a valid currency code (e.g., UZS, USD).")
        return

    await state.update_data(currency=currency)
    await state.set_state(ExpenseState.waiting_for_description)
    await message.answer("What was it for?", reply_markup=get_cancel_keyboard())

@router.message(ExpenseState.waiting_for_description)
async def process_description(message: Message, state: FSMContext):
    description = message.text.strip()
    data = await state.get_data()
    
    amount = data['amount']
    currency = data['currency']
    
    # Store expense
    expense = await add_expense(
        group_id=message.chat.id,
        payer_id=message.from_user.id,
        payer_name=message.from_user.full_name,
        amount=amount,
        currency=currency,
        description=description
    )
    
    await state.clear()
    
    formatted_amount = f"{amount:,.0f}" if amount.is_integer() else f"{amount:,.2f}"
    await message.answer(f"✅ Recorded: {formatted_amount} {currency} — {description}")
