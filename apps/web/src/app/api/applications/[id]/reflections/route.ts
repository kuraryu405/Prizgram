import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { withNoStore } from "@/server/auth/http";
import { getDatabase } from "@/server/database";
import {
  InterviewAiService,
  interviewReflectionCreateSchema,
} from "@/server/interview-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idPattern.test(id)) {
    const { AppError } = await import("@/server/api");
    throw new AppError("NOT_FOUND", "Application not found", 404);
  }
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      const list = new InterviewAiService(getDatabase()).listReflections(
        user.id,
        id,
      );
      return apiResult(list);
    }),
  )(request);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idPattern.test(id)) {
    const { AppError } = await import("@/server/api");
    throw new AppError("NOT_FOUND", "Application not found", 404);
  }
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      const input = await readJsonBody(
        innerRequest,
        interviewReflectionCreateSchema,
      );
      const created = new InterviewAiService(getDatabase()).createReflection(
        user.id,
        id,
        input,
      );
      return apiResult(created, { status: 201 });
    }),
  )(request);
}
