import { AppError, apiResult, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { ReminderService } from "@prizgram/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!idPattern.test(id)) {
        throw new AppError("NOT_FOUND", "Reminder not found", 404);
      }
      const dismissed = new ReminderService(getDatabase().db).dismiss(
        user.id,
        id,
      );
      if (!dismissed) {
        throw new AppError("NOT_FOUND", "Reminder not found", 404);
      }
      return apiResult({ dismissed: true });
    }),
  )(request);
}
