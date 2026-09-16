from typing import Dict, List, Tuple
from bot.services.expense_service import get_members, get_expenses

async def calculate_balances(group_id: int) -> Dict[str, Dict[int, float]]:
    """
    Returns balances per currency per member_id.
    Format: { "UZS": { 12345: 150000, 67890: -50000 } }
    """
    members = await get_members(group_id)
    if not members:
        return {}

    expenses = await get_expenses(group_id, limit=10000) # Fetch all for now

    # group by currency
    # currency -> list of expenses
    expenses_by_currency = {}
    for exp in expenses:
        if exp.currency not in expenses_by_currency:
            expenses_by_currency[exp.currency] = []
        expenses_by_currency[exp.currency].append(exp)

    balances_by_currency = {}
    num_members = len(members)

    for currency, cur_expenses in expenses_by_currency.items():
        total_spent = sum(exp.amount for exp in cur_expenses)
        fair_share = total_spent / num_members if num_members > 0 else 0

        balances = {m.telegram_id: -fair_share for m in members}

        for exp in cur_expenses:
            if exp.payer_id in balances:
                balances[exp.payer_id] += exp.amount
            else:
                balances[exp.payer_id] = -fair_share + exp.amount
            
        balances_by_currency[currency] = balances

    return balances_by_currency

async def calculate_weekly_balances(group_id: int, start_date, end_date) -> Dict[str, Dict[int, float]]:
    # Similar to calculate_balances but filtered by date. Let's do a fast implementation
    from bot.database.database import async_session
    from bot.database.models import Expense
    from sqlalchemy import select

    members = await get_members(group_id)
    if not members:
        return {}

    async with async_session() as session:
        result = await session.execute(
            select(Expense)
            .filter(Expense.group_id == group_id)
            .filter(Expense.created_at >= start_date)
            .filter(Expense.created_at <= end_date)
        )
        expenses = result.scalars().all()

    expenses_by_currency = {}
    for exp in expenses:
        if exp.currency not in expenses_by_currency:
            expenses_by_currency[exp.currency] = []
        expenses_by_currency[exp.currency].append(exp)

    balances_by_currency = {}
    num_members = len(members)

    for currency, cur_expenses in expenses_by_currency.items():
        total_spent = sum(exp.amount for exp in cur_expenses)
        fair_share = total_spent / num_members if num_members > 0 else 0

        balances = {m.telegram_id: -fair_share for m in members}

        for exp in cur_expenses:
            if exp.payer_id in balances:
                balances[exp.payer_id] += exp.amount
            else:
                balances[exp.payer_id] = -fair_share + exp.amount
            
        balances_by_currency[currency] = balances

    return balances_by_currency
