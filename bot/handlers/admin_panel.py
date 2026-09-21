from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from bot.utils.auth import is_creator
from bot.services.auth_service import set_user_role, get_all_users_by_role
from bot.services.stats_service import get_bot_statistics

router = Router()

user_states = {} # user_id -> state string ('waiting_admin', 'waiting_ban')

def get_admin_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text='👥 Add Admin', callback_data='panel_add_admin'), InlineKeyboardButton(text='➖ Remove Admin', callback_data='panel_rm_admin')],
        [InlineKeyboardButton(text='🚫 Ban User', callback_data='panel_add_ban'), InlineKeyboardButton(text='✅ Unban User', callback_data='panel_rm_ban')],
        [InlineKeyboardButton(text='📊 View Statistics & Groups', callback_data='panel_view_stats')]
    ])

@router.message(Command('admin'))
async def cmd_admin(message: Message):
    if message.chat.type != 'private':
        return
    if not await is_creator(message, message.bot):
        return await message.answer('You are not authorized to use the admin panel.')
    await message.answer('🛡️ *Admin Panel*\n\nSelect an action:', parse_mode='Markdown', reply_markup=get_admin_keyboard())

@router.callback_query(F.data.startswith('panel_'))
async def process_panel_cb(callback: CallbackQuery):
    if not await is_creator(callback.message, callback.bot, callback.from_user.id, callback.from_user.username):
        return await callback.answer('Not authorized.', show_alert=True)
    action = callback.data.split('_')[1:]
    
    if action == ['view', 'stats']:
        stats = await get_bot_statistics()
        text = (
            f'📊 *Bot Statistics*\n\n'
            f'📈 *Usage Flow:*\n'
            f'👥 Total Tracked Members: {stats["members_count"]}\n'
            f'💬 Total Expenses Processed: {stats["expenses_count"]}\n'
            f'🏢 Total Groups Joined: {stats["groups_count"]}\n\n'
            f'🏢 *Recent Groups:*\n'
        )
        if stats['recent_groups']:
            for g in stats['recent_groups']:
                name = g.group_name or f'Group {g.id}'
                text += f'• {name}\n'
        else:
            text += 'No groups yet.\n'
            
        await callback.message.edit_text(text, parse_mode='Markdown', reply_markup=get_admin_keyboard())
        return await callback.answer()
        
    if action == ['add', 'admin']:
        user_states[callback.from_user.id] = 'waiting_admin'
        await callback.message.edit_text('Please forward a message from the user you want to make an Admin, or send their Telegram ID.')
    elif action == ['rm', 'admin']:
        user_states[callback.from_user.id] = 'waiting_rm_admin'
        await callback.message.edit_text('Please forward a message from the admin you want to remove, or send their Telegram ID.')
    elif action == ['add', 'ban']:
        user_states[callback.from_user.id] = 'waiting_ban'
        await callback.message.edit_text('Please forward a message from the user you want to BAN from adding expenses.')
    elif action == ['rm', 'ban']:
        user_states[callback.from_user.id] = 'waiting_rm_ban'
        await callback.message.edit_text('Please forward a message from the user you want to UNBAN.')
    await callback.answer()

@router.message(F.chat.type == 'private')
async def handle_forward(message: Message):
    if not await is_creator(message, message.bot): return
    state = user_states.get(message.from_user.id)
    if not state: return
    
    target_id = None
    target_name = 'Unknown'
    if message.forward_from:
        target_id = message.forward_from.id
        target_name = message.forward_from.username or message.forward_from.first_name
    elif message.text and message.text.isdigit():
        target_id = int(message.text)
        target_name = str(target_id)
    else:
        return await message.answer('Could not extract user. Please forward a message from the user directly.')
    
    if state == 'waiting_admin':
        await set_user_role(target_id, target_name, 'admin')
        await message.answer(f'✅ User {target_name} is now an Admin.')
    elif state == 'waiting_rm_admin':
        await set_user_role(target_id, target_name, 'normal')
        await message.answer(f'✅ User {target_name} is no longer an admin.')
    elif state == 'waiting_ban':
        await set_user_role(target_id, target_name, 'banned')
        await message.answer(f'🚫 User {target_name} has been BANNED from adding expenses.')
    elif state == 'waiting_rm_ban':
        await set_user_role(target_id, target_name, 'normal')
        await message.answer(f'✅ User {target_name} has been unbanned.')
    
    user_states.pop(message.from_user.id, None)
    await message.answer('🛡️ *Admin Panel*', parse_mode='Markdown', reply_markup=get_admin_keyboard())
