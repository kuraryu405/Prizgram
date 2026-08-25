import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  PersonaUpdateService,
  proposeRequestSchema,
} from "@/server/persona-update/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, proposeRequestSchema);
    return apiResult(
      await new PersonaUpdateService(getDatabase()).propose(user, input),
    );
  }),
);
