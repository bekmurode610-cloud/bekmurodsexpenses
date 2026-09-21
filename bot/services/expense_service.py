from bot.database.database import async_session
from bot.database.models import Group, Member, Expense
from sqlalchemy import select, delete

async def add_group(group_id: int, group_name: str):
    async with async_session() as session:
        result = await session.execute(select(Group).filter(Group.id == group_id))
        group = result.scalars().first()
        if not group:
            new_group = Group(id=group_id, group_name=group_name)
            session.add(new_group)
            await session.commit()
        elif group.group_name == "Group" and group_name != "Group":
            # Update legacy "Group" names to actual title
            group.group_name = group_name
            await session.commit()

async def ensure_member(telegram_id: int, group_id: int, name: str, group_name: str = "Group"):
    await add_group(group_id, group_name)
    async with async_session() as session:
        result = await session.execute(
            select(Member).filter(Member.telegram_id == telegram_id, Member.group_id == group_id)
        )
        member = result.scalars().first()
        if not member:
            new_member = Member(telegram_id=telegram_id, group_id=group_id, name=name)
            session.add(new_member)
        else:
            member.name = name
        await session.commit()

async def get_members(group_id: int):
    async with async_session() as session:
        result = await session.execute(select(Member).filter(Member.group_id == group_id))
        return result.scalars().all()

async def get_live_member_names(bot, group_id: int):
    members = await get_members(group_id)
    member_names = {}
    for m in members:
        try:
            chat_member = await bot.get_chat_member(group_id, m.telegram_id)
            user = chat_member.user
            name = f"@{user.username}" if user.username else user.full_name
            member_names[m.telegram_id] = name
            
            # Sync back to DB if different
            if m.name != name:
                async with async_session() as session:
                    db_member = await session.execute(select(Member).filter(Member.telegram_id == m.telegram_id, Member.group_id == group_id))
                    db_member = db_member.scalars().first()
                    if db_member:
                        db_member.name = name
                        await session.commit()
        except Exception:
            member_names[m.telegram_id] = m.name # Fallback to DB
    return member_names

async def add_expense(group_id: int, payer_id: int, payer_name: str, amount: float, currency: str, description: str, group_name: str = "Group"):
    await ensure_member(payer_id, group_id, payer_name, group_name)
    async with async_session() as session:
        expense = Expense(
            group_id=group_id,
            payer_id=payer_id,
            payer_name=payer_name,
            amount=amount,
            currency=currency.upper(),
            description=description
        )
        session.add(expense)
        await session.commit()
        return expense

async def get_expenses(group_id: int, limit: int = 50):
    async with async_session() as session:
        result = await session.execute(
            select(Expense).filter(Expense.group_id == group_id).order_by(Expense.created_at.desc()).limit(limit)
        )
        return result.scalars().all()

async def get_expense(expense_id: int):
    async with async_session() as session:
        result = await session.execute(select(Expense).filter(Expense.id == expense_id))
        return result.scalars().first()

async def delete_expense(expense_id: int):
    async with async_session() as session:
        await session.execute(delete(Expense).filter(Expense.id == expense_id))
        await session.commit()

async def reset_group(group_id: int):
    async with async_session() as session:
        await session.execute(delete(Expense).filter(Expense.group_id == group_id))
        await session.commit()
