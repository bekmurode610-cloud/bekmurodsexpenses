import { api } from 'sdk';
import { setupBotCommands } from '../lib/commands.js';

export default async function (input, ctx) {
  await setupBotCommands(api);
  return { ok: true, message: 'Bot commands configured successfully for all scopes.' };
}
