import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  PersonaUpdateService,
  approveRequestSchema,
} from "@/server/persona-update/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit human approval: inserts the next immutable persona version. */
export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, approveRequestSchema);
    const result = new PersonaUpdateService(getDatabase()).approve(user, input);
    return apiResult(result, { status: 201 });
  }),
);
