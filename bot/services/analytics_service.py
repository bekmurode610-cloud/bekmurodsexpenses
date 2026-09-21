from datetime import datetime, timedelta
from typing import List, Dict, Any
from sqlalchemy import select
from bot.database.database import async_session
from bot.database.models import Expense, Group

async def get_group_analytics_data(group_id: int) -> Dict[str, Any]:
    async with async_session() as session:
        # Check if group exists
        group = await session.get(Group, group_id)
        if not group:
            return None
            
        result = await session.execute(
            select(Expense).filter_by(group_id=group_id).order_by(Expense.created_at.asc())
        )
        expenses = result.scalars().all()
        
    if not expenses:
        return {'group_name': group.group_name or f"Group {group_id}", 'expenses': [], 'primary_currency': ''}
        
    # Determine primary currency
    currency_counts = {}
    for e in expenses:
        curr = e.currency.upper()
        currency_counts[curr] = currency_counts.get(curr, 0) + 1
    primary_currency = max(currency_counts, key=currency_counts.get)
    
    # Filter expenses to primary currency only for charting (we keep all for raw data if needed)
    chart_expenses = [e for e in expenses if e.currency.upper() == primary_currency]
    
    # Grouping
    weekly_group = {}   # "YYYY-WXX" -> total
    monthly_group = {}  # "YYYY-MM" -> total
    
    weekly_members = {}  # "YYYY-WXX" -> { member_name: total }
    monthly_members = {} # "YYYY-MM" -> { member_name: total }
    
    members_set = set()
    raw_data = []
    
    for e in chart_expenses:
        members_set.add(e.payer_name)
        
        # ISO calendar for week
        iso_year, iso_week, _ = e.created_at.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        
        # Month key
        month_key = e.created_at.strftime("%Y-%m")
        
        # Group totals
        weekly_group[week_key] = weekly_group.get(week_key, 0) + e.amount
        monthly_group[month_key] = monthly_group.get(month_key, 0) + e.amount
        
        # Member weekly totals
        if week_key not in weekly_members:
            weekly_members[week_key] = {}
        weekly_members[week_key][e.payer_name] = weekly_members[week_key].get(e.payer_name, 0) + e.amount
        
        # Member monthly totals
        if month_key not in monthly_members:
            monthly_members[month_key] = {}
        monthly_members[month_key][e.payer_name] = monthly_members[month_key].get(e.payer_name, 0) + e.amount
        
    # Format raw data (include ALL expenses, not just primary currency)
    for e in expenses:
        raw_data.append({
            'date': e.created_at.strftime("%Y-%m-%d %H:%M"),
            'payer': e.payer_name,
            'amount': e.amount,
            'currency': e.currency.upper(),
            'description': e.description
        })
        
    return {
        'group_name': group.group_name or f"Group {group_id}",
        'primary_currency': primary_currency,
        'members': list(members_set),
        'weekly_group': weekly_group,
        'monthly_group': monthly_group,
        'weekly_members': weekly_members,
        'monthly_members': monthly_members,
        'raw_data': raw_data
    }
