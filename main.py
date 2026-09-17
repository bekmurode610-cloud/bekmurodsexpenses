import asyncio
import logging
import os
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiohttp import web
from config import BOT_TOKEN
from bot.database.database import init_db
from bot.handlers import start, expense, reports, admin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def health_check(request):
    return web.Response(text="Bot is running!")

async def start_dummy_server():
    app = web.Application()
    app.router.add_get('/', health_check)
    runner = web.AppRunner(app)
    await runner.setup()
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    logger.info(f"Dummy web server started on port {port}")

async def main():
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN is missing! Please set it in .env")
        return

    # Initialize Database
    await init_db()

    bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()

    # Include routers
    dp.include_router(start.router)
    dp.include_router(expense.router)
    dp.include_router(reports.router)
    dp.include_router(admin.router)

    # Start dummy web server for Render health checks
    await start_dummy_server()

    logger.info("Starting bot...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
