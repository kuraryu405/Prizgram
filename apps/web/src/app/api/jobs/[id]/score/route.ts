import { AppError, apiResult, withApiHandler } from "@/server/api";
import { requireSessionUser } from "@/server/auth/session";
import { getDatabase } from "@/server/database";

import { ScoringService } from "@/server/scoring/service";
import { withNoStore } from "@/server/auth";

const service = () => new ScoringService(getDatabase());

const jobIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireJobId(id: string): string {
  if (!jobIdPattern.test(id)) {
    throw new AppError("NOT_FOUND", "Job not found", 404);
  }
  return id;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      return service().listScores(user.id, requireJobId(id));
    }),
  )(request);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      const result = await service().evaluateJob(user.id, requireJobId(id));
      return apiResult(result, { status: result.duplicate ? 200 : 201 });
    }),
  )(request);
}
