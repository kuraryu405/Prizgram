import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";
import {
  MinimalApplicationService,
  minimalApplicationCreateSchema,
} from "@/server/applications/minimal-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = () => new MinimalApplicationService(getDatabase());

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, minimalApplicationCreateSchema);
    return apiResult(service().create(user, input), { status: 201 });
  }),
);
