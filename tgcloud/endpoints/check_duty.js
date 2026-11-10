import { api } from 'sdk';
import { getAllGroups, getMembers, checkAndAnnounceDuty } from '../lib/db-service.js';

export default async function (input, ctx) {
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
  return { ok: true, announcedCount: announced.length, announced };
}
