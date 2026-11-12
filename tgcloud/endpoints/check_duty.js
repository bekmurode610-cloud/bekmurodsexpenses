import { api } from 'sdk';
import { getAllGroups, getMembers, checkAndAnnounceDuty, cleanupPendingDeletions } from '../lib/db-service.js';

export default async function (input, ctx) {
  // Sweep expired messages (older than 2 minutes)
  const deleted = await cleanupPendingDeletions(api);

  const groupsList = await getAllGroups();
  const announced = [];
  for (const grp of groupsList) {
    try {
      const mems = await getMembers(grp.id);
      const sent = await checkAndAnnounceDuty(api, grp, mems);
      if (sent) announced.push(grp.id);
    } catch (err) {
      console.warn(`Could not check duty for group ${grp?.id}:`, err?.message || err);
    }
  }
  return { ok: true, deleted, announcedCount: announced.length, announced };
}
