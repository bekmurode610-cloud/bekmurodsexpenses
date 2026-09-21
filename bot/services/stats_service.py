from sqlalchemy import select, func
from bot.database.database import async_session
from bot.database.models import Group, Member, Expense

async def get_bot_statistics() -> dict:
    async with async_session() as session:
        groups_count = await session.scalar(select(func.count()).select_from(Group))
        members_count = await session.scalar(select(func.count()).select_from(Member))
        expenses_count = await session.scalar(select(func.count()).select_from(Expense))
        
        # Get groups list
        groups = await session.execute(select(Group).order_by(Group.created_at.desc()).limit(20))
        groups_list = groups.scalars().all()
        
        # Get total volume of expenses by currency?
        # Maybe too complex, just count is fine.
        
        return {
            'groups_count': groups_count or 0,
            'members_count': members_count or 0,
            'expenses_count': expenses_count or 0,
            'recent_groups': groups_list
        }
