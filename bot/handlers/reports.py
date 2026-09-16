from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from bot.services.balance_service import calculate_balances, calculate_weekly_balances
from bot.services.settlement_service import calculate_settlements
from bot.services.expense_service import get_expenses, get_members
from bot.keyboards.inline import get_delete_expense_keyboard
from datetime import datetime, timedelta

router = Router()

def format_money(amount: float) -> str:
    return f"{amount:,.0f}" if amount.is_integer() else f"{amount:,.2f}"

@router.message(Command("balance"))
async def cmd_balance(message: Message):
    if message.chat.type == "private":
        await message.answer("This bot is designed to work inside Telegram groups.")
        return

    group_id = message.chat.id
    balances_by_currency = await calculate_balances(group_id)
    
    if not balances_by_currency:
        await message.answer("There are no expenses recorded for this group yet.")
        return

    members = await get_members(group_id)
    member_names = {m.telegram_id: m.name for m in members}

    text = "📊 **Current Balance**\n\n"
    
    for currency, balances in balances_by_currency.items():
        text += f"_{currency} Balance_\n"
        for member_id, balance in sorted(balances.items(), key=lambda x: x[1], reverse=True):
            name = member_names.get(member_id, "Unknown")
            sign = "+" if balance > 0 else ""
            if abs(balance) > 0.01:
                text += f"{name}: {sign}{format_money(balance)} {currency}\n"
            else:
                text += f"{name}: 0 {currency}\n"
        
        text += f"\n_{currency} Settlements_\n"
        settlements = calculate_settlements(balances)
        if settlements:
            for debtor_id, creditor_id, amount in settlements:
                debtor_name = member_names.get(debtor_id, "Unknown")
                creditor_name = member_names.get(creditor_id, "Unknown")
                text += f"{debtor_name} ➡️ {creditor_name}: {format_money(amount)} {currency}\n"
        else:
            text += "All settled up!\n"
        text += "\n"

    await message.answer(text.strip())

@router.message(Command("report"))
async def cmd_report(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")

    group_id = message.chat.id
    members = await get_members(group_id)
    expenses = await get_expenses(group_id, limit=10000)
    
    if not expenses:
        return await message.answer("There are no expenses recorded for this group yet.")

    member_names = {m.telegram_id: m.name for m in members}
    num_members = len(members)

    expenses_by_currency = {}
    for exp in expenses:
        if exp.currency not in expenses_by_currency:
            expenses_by_currency[exp.currency] = []
        expenses_by_currency[exp.currency].append(exp)

    text = "📈 **Group Expense Report**\nPeriod: All time\n\n"
    
    for currency, cur_expenses in expenses_by_currency.items():
        total_spent = sum(exp.amount for exp in cur_expenses)
        fair_share = total_spent / num_members if num_members > 0 else 0
        
        member_spending = {m.telegram_id: 0 for m in members}
        for exp in cur_expenses:
            member_spending[exp.payer_id] += exp.amount
            
        text += f"**Currency: {currency}**\n"
        text += f"Total spent: {format_money(total_spent)} {currency}\n"
        text += f"Number of expenses: {len(cur_expenses)}\n\n"
        
        for member_id, spent in sorted(member_spending.items(), key=lambda x: x[1], reverse=True):
            name = member_names.get(member_id, "Unknown")
            if spent > 0:
                text += f"{name} paid: {format_money(spent)} {currency}\n"
            
        text += f"\nFair share per person: {format_money(fair_share)} {currency}\n\n"
        
    balances_by_currency = await calculate_balances(group_id)
    text += "**Balances & Settlements:**\n\n"
    for currency, balances in balances_by_currency.items():
        text += f"_{currency}_\n"
        for member_id, balance in sorted(balances.items(), key=lambda x: x[1], reverse=True):
            name = member_names.get(member_id, "Unknown")
            sign = "+" if balance > 0 else ""
            if abs(balance) > 0.01:
                text += f"{name}: {sign}{format_money(balance)}\n"
        
        settlements = calculate_settlements(balances)
        if settlements:
            text += "\nSettlements:\n"
            for debtor_id, creditor_id, amount in settlements:
                debtor_name = member_names.get(debtor_id, "Unknown")
                creditor_name = member_names.get(creditor_id, "Unknown")
                text += f"{debtor_name} ➡️ {creditor_name}: {format_money(amount)}\n"
        text += "\n"

    await message.answer(text.strip())

@router.message(Command("weekly"))
async def cmd_weekly(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")

    group_id = message.chat.id
    
    # Calculate Monday to Sunday
    now = datetime.utcnow()
    monday = now - timedelta(days=now.weekday())
    monday_start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    sunday_end = monday_start + timedelta(days=6, hours=23, minutes=59, seconds=59)

    balances_by_currency = await calculate_weekly_balances(group_id, monday_start, sunday_end)
    
    if not balances_by_currency:
        return await message.answer("There are no expenses recorded for this week yet.")

    members = await get_members(group_id)
    member_names = {m.telegram_id: m.name for m in members}

    text = f"📅 **Weekly Report**\n{monday_start.strftime('%B %d')}–{sunday_end.strftime('%B %d')}\n\n"
    
    for currency, balances in balances_by_currency.items():
        # To show spending, we'd need expenses again, or we can just show balances
        # We need spending. Let's fetch expenses for the week.
        from bot.database.database import async_session
        from bot.database.models import Expense
        from sqlalchemy import select
        async with async_session() as session:
            result = await session.execute(
                select(Expense)
                .filter(Expense.group_id == group_id, Expense.currency == currency)
                .filter(Expense.created_at >= monday_start)
                .filter(Expense.created_at <= sunday_end)
            )
            week_exps = result.scalars().all()
            
        total_spent = sum(e.amount for e in week_exps)
        text += f"_{currency}_\nTotal: {format_money(total_spent)}\n\n"
        
        member_spending = {m.telegram_id: 0 for m in members}
        for e in week_exps:
            member_spending[e.payer_id] += e.amount
            
        for member_id, spent in sorted(member_spending.items(), key=lambda x: x[1], reverse=True):
            if spent > 0:
                name = member_names.get(member_id, "Unknown")
                text += f"{name}: {format_money(spent)}\n"
                
        text += "\nBalances:\n"
        for member_id, balance in sorted(balances.items(), key=lambda x: x[1], reverse=True):
            name = member_names.get(member_id, "Unknown")
            sign = "+" if balance > 0 else ""
            if abs(balance) > 0.01:
                text += f"{name}: {sign}{format_money(balance)}\n"
                
        settlements = calculate_settlements(balances)
        if settlements:
            text += "\nSettlement:\n"
            for debtor_id, creditor_id, amount in settlements:
                debtor_name = member_names.get(debtor_id, "Unknown")
                creditor_name = member_names.get(creditor_id, "Unknown")
                text += f"{debtor_name} ➡️ {creditor_name}: {format_money(amount)}\n"
        text += "\n"

    await message.answer(text.strip())

@router.message(Command("expenses"))
async def cmd_expenses(message: Message):
    if message.chat.type == "private":
        return await message.answer("This bot is designed to work inside Telegram groups.")

    group_id = message.chat.id
    expenses = await get_expenses(group_id, limit=20)
    
    if not expenses:
        return await message.answer("There are no expenses recorded for this group yet.")

    text = "📜 **Recent Expenses**\n\n"
    for idx, exp in enumerate(expenses, 1):
        formatted_amount = format_money(exp.amount)
        text += f"{idx}. {exp.payer_name} — {formatted_amount} {exp.currency} — {exp.description} (ID: {exp.id})\n"
        
    text += "\nTo delete an expense, use /delete <ID>"
    await message.answer(text)
