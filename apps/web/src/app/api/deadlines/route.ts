import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  DeadlineService,
  deadlineCreateRequestSchema,
} from "@/server/deadlines/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, deadlineCreateRequestSchema);
    return apiResult(new DeadlineService(getDatabase()).create(user, input), {
      status: 201,
    });
  }),
);

export const GET = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    return new DeadlineService(getDatabase()).list(user.id);
  }),
);
