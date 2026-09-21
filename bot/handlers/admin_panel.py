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
        [InlineKeyboardButton(text='📊 View Statistics & Groups', callback_data='panel_view_stats')],
        [InlineKeyboardButton(text='📉 HTML Analytics Report', callback_data='panel_dlgraph_menu')]
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
    
    if action == ['dlgraph', 'menu']:
        stats = await get_bot_statistics()
        if not stats['recent_groups']:
            return await callback.answer('No groups joined yet.', show_alert=True)
            
        buttons = []
        for g in stats['recent_groups']:
            name = g.group_name or f'Group {g.id}'
            buttons.append([InlineKeyboardButton(text=f'📈 {name}', callback_data=f'panel_dlg_{g.id}')])
            
        buttons.append([InlineKeyboardButton(text='🔙 Back', callback_data='panel_back')])
        kb = InlineKeyboardMarkup(inline_keyboard=buttons)
        await callback.message.edit_text('Select a group to download analytics for:', reply_markup=kb)
        return await callback.answer()
        
    if action == ['back']:
        await callback.message.edit_text('🛡️ *Admin Panel*\n\nSelect an action:', parse_mode='Markdown', reply_markup=get_admin_keyboard())
        return await callback.answer()
        
    if len(action) == 2 and action[0] == 'dlg':
        group_id = int(action[1])
        await callback.answer('Generating report...')
        
        from bot.services.analytics_service import get_group_analytics_data
        from bot.utils.html_generator import generate_analytics_html
        from aiogram.types import BufferedInputFile
        
        data = await get_group_analytics_data(group_id)
        if not data:
            return await callback.answer('Could not find data for this group.', show_alert=True)
            
        html_str = generate_analytics_html(data)
        
        file_name = f'analytics_{group_id}.html'
        file_bytes = html_str.encode('utf-8')
        input_file = BufferedInputFile(file_bytes, filename=file_name)
        
        await callback.message.answer_document(
            document=input_file,
            caption=f'📊 Visual Analytics Report for {data["group_name"]}'
        )
        return
    
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
