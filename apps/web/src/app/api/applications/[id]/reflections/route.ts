import {
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { withNoStore } from "@/server/auth/http";
import { getDatabase } from "@/server/database";
import { InterviewReflectionService } from "@/server/interview-ai/reflections";
import { interviewReflectionCreateSchema } from "@/server/interview-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!idPattern.test(id)) {
        throw new AppError("NOT_FOUND", "Application not found", 404);
      }
      return apiResult(
        new InterviewReflectionService(getDatabase()).list(user.id, id),
      );
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
      if (!idPattern.test(id)) {
        throw new AppError("NOT_FOUND", "Application not found", 404);
      }
      const input = await readJsonBody(
        innerRequest,
        interviewReflectionCreateSchema,
      );
      const created = new InterviewReflectionService(getDatabase()).create(
        user.id,
        id,
        input,
      );
      return apiResult(created, { status: 201 });
    }),
  )(request);
}
