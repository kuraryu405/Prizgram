import {
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { ScoringService, scoringRequestSchema } from "@/server/scoring/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, scoringRequestSchema);
    const result = await new ScoringService(getDatabase()).score(user, input);
    return apiResult(result, { status: result.duplicate ? 200 : 201 });
  }),
);

export const GET = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
    if (jobId === "") {
      throw new AppError("VALIDATION_ERROR", "jobId is required", 400);
    }
    return new ScoringService(getDatabase()).latestForJob(user.id, jobId);
  }),
);
