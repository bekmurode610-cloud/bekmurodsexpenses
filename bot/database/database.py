from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from config import DATABASE_URL
from bot.database.models import Base

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Automatic migration: Add 'settled' column to expenses table if it doesn't exist
        try:
            from sqlalchemy import text
            # Try SQLite syntax first
            if 'sqlite' in str(engine.url):
                await conn.execute(text("ALTER TABLE expenses ADD COLUMN settled BOOLEAN DEFAULT 0"))
            else:
                await conn.execute(text("ALTER TABLE expenses ADD COLUMN settled BOOLEAN DEFAULT FALSE"))
        except Exception as e:
            # Column likely already exists
            pass
