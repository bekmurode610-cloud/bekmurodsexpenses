from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

def get_cancel_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Cancel", callback_data="cancel_action")]
    ])

def get_delete_expense_keyboard(expense_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Delete", callback_data=f"del_exp_{expense_id}"),
            InlineKeyboardButton(text="❌ Cancel", callback_data="cancel_action")
        ]
    ])

def get_reset_group_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="Reset group", callback_data="confirm_reset"),
            InlineKeyboardButton(text="Cancel", callback_data="cancel_action")
        ]
    ])
