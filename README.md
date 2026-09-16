# Telegram Group Expense Tracker

A simple, reliable Telegram bot for tracking shared group expenses. The bot calculates each member's share and determines who owes whom.

## Features
- **Record Expenses**: Track who paid, how much, for what, and in what currency.
- **Group Isolation**: Expenses and balances are strictly separated by Telegram group.
- **Calculations**: Automatically computes the fair share per participant and the optimal settlements (who owes whom).
- **Reports**: View current balances, all-time reports, and weekly summaries.
- **Currency Support**: Handles multiple currencies separately (e.g., UZS, USD, EUR) without automatic conversion.
- **Admin Tools**: Group administrators can delete any expense or completely reset the group's records.

## Installation

1. **Clone the repository:**
   ```bash
   git clone <your_repo_url>
   cd telegram-expense-bot
   ```

2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Environment Variables:**
   Copy `.env.example` to `.env` and configure your Telegram bot token.
   ```bash
   cp .env.example .env
   # Edit .env and set BOT_TOKEN=your_token_here
   ```

## Running the Bot

Run the main bot script:
```bash
python main.py
```
The SQLite database (`expense_bot.db`) will be created automatically in the root directory.

## Adding the Bot to a Group

1. Create a new bot using [@BotFather](https://t.me/BotFather) and get the token.
2. Disable "Group Privacy" in BotFather settings if you want the bot to see all messages (or just make sure commands start with `/`).
3. Add the bot to your Telegram group.
4. Promote the bot to an administrator if you want it to perfectly verify admin statuses, although it can usually fetch them via `get_chat_member`.

## Available Commands

- `/start` - Show help message
- `/join` - Manually opt-in to the group's expense tracking. (Creating an expense automatically joins you).
- `/expense` - Start the flow to record a new expense
- `/balance` - Show current balances and who owes whom
- `/report` - Generate a complete expense report for all time
- `/weekly` - Generate a weekly expense report (Monday to Sunday)
- `/expenses` - List recent expenses
- `/delete <ID>` - Delete an expense (Only the original payer or a group admin)
- `/members` - List active participants
- `/reset` - (Admin only) Permanently reset all expenses for the group
