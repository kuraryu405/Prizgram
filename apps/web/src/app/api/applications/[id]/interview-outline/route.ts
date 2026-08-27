import {
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { enforceLlmRateLimit, requireSessionUser } from "@/server/auth";
import { withNoStore } from "@/server/auth/http";
import { getDatabase } from "@/server/database";
import {
  InterviewAiService,
  interviewOutlineRequestSchema,
} from "@/server/interview-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!idPattern.test(id)) {
        throw new AppError("NOT_FOUND", "Application not found", 404);
      }
      enforceLlmRateLimit(user.id);
      const input = await readJsonBody(
        innerRequest,
        interviewOutlineRequestSchema,
      );
      const result = await new InterviewAiService(
        getDatabase(),
      ).generateOutline(user.id, id, input);
      return apiResult(result);
    }),
  )(request);
}
