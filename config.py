import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN is missing! Please set it in .env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Default database URL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///expense_bot.db")

# Fix Render's default Postgres URL to work with asyncpg
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
