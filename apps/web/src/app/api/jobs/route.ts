import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser } from "@/server/auth/session";
import { getDatabase } from "@/server/database";

import { JobService, jobImportRequestSchema } from "@/server/jobs/service";
import { withNoStore } from "@/server/auth";

const service = () => new JobService(getDatabase());

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, jobImportRequestSchema, 32_768);
    const result = await service().importJob(user, input);
    return apiResult(result, { status: result.duplicate ? 200 : 201 });
  }),
);

export const GET = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    return service().listJobs(user.id);
  }),
);
