import { apiResult, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { ReminderService } from "@prizgram/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists active reminders. Listing pending ones marks them sent (in-app delivery). */
export const GET = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    const rows = new ReminderService(getDatabase().db).listActive(user.id);
    return apiResult({
      urgentCount: rows.filter((row) => row.priority === "urgent").length,
      reminders: rows,
    });
  }),
);
