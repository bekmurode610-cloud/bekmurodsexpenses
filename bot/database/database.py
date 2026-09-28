from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from config import DATABASE_URL
from bot.database.models import Base

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    # Automatic migration: Add 'settled' column to expenses table if it doesn't exist
    # Run in a separate block so if it fails (column exists), it doesn't abort the previous transaction
    from sqlalchemy import text
    try:
        async with engine.begin() as conn:
            if 'sqlite' in str(engine.url):
                await conn.execute(text("ALTER TABLE expenses ADD COLUMN settled INTEGER DEFAULT 0"))
            else:
                await conn.execute(text("ALTER TABLE expenses ADD COLUMN settled INTEGER DEFAULT 0"))
    except Exception as e:
        # Column likely already exists
        pass
