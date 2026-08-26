import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { enforceLlmRateLimit, requireSessionUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { JobService, jobImportRequestSchema } from "@/server/jobs/service";
import { JOB_IMPORT_MAX_REQUEST_BYTES } from "@/server/jobs/request-limits";
import { withNoStore } from "@/server/auth";

const service = () => new JobService(getDatabase());

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(
      request,
      jobImportRequestSchema,
      JOB_IMPORT_MAX_REQUEST_BYTES,
    );
    enforceLlmRateLimit(user.id);
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
