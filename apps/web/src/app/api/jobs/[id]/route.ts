import { AppError, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { JobService } from "@/server/jobs/service";

const service = () => new JobService(getDatabase());

const jobIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!jobIdPattern.test(id)) {
        throw new AppError("NOT_FOUND", "Job not found", 404);
      }
      return service().getJobDetail(user.id, id);
    }),
  )(request);
}
