import { api } from 'sdk';
import {
  getAllGroups,
  getMembers,
  checkAndAnnounceDuty,
  cleanupPendingDeletions,
  cleanupTrialGroup,
  checkPersonalReminders,
  checkPersonalDailySummaries,
  syncGroupWeeklyReports,
  syncAllPersonalDailyLogs,
} from '../lib/db-service.js';

export default async function (input, ctx) {
  if (input?.cleanupTrial) {
    const res = await cleanupTrialGroup();
    return { ok: true, cleanup: res };
  }

  if (input?.backfillPersonalLogs) {
    const synced = await syncAllPersonalDailyLogs();
    return { ok: true, personalLogsSynced: synced };
  }

  if (input?.backfillWeeks || input?.inspectWeeks) {
    const groupsList = await getAllGroups();
    const summary = [];
    for (const grp of groupsList) {
      const reports = await syncGroupWeeklyReports(grp.id);
      summary.push({
        groupId: grp.id,
        groupName: grp.groupName,
        weeks: reports.map((r) => ({
          weekStart: r.weekStart,
          weekEnd: r.weekEnd,
          expenseCount: r.expenseCount,
          totalByCurrency: r.totalByCurrency,
          isSettled: Boolean(r.isSettled),
          transfers: r.transfers,
        })),
      });
    }
    return { ok: true, groups: summary };
  }

  // Sweep expired messages
  const deleted = await cleanupPendingDeletions(api);

  const groupsList = await getAllGroups();
  const announced = [];
  for (const grp of groupsList) {
    try {
      const mems = await getMembers(grp.id);
      const sent = await checkAndAnnounceDuty(api, grp, mems);
      if (sent) announced.push(grp.id);
      await syncGroupWeeklyReports(grp.id);
    } catch (err) {
      console.warn(`Could not check duty for group ${grp?.id}:`, err?.message || err);
    }
  }
  const personalReminded = await checkPersonalReminders(api);
  const personalSummariesSent = await checkPersonalDailySummaries(api);
  return {
    ok: true,
    deleted,
    announcedCount: announced.length,
    announced,
    personalReminded,
    personalSummariesSent,
  };
}
