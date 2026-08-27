import {
  apiResult,
  readJsonBody,
  withApiHandler,
  apiNoContent,
} from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { withNoStore } from "@/server/auth/http";
import { getDatabase } from "@/server/database";
import {
  InterviewAiService,
  interviewReflectionUpdateSchema,
} from "@/server/interview-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ reflectionId: string }> },
): Promise<Response> {
  const { reflectionId } = await context.params;
  if (!idPattern.test(reflectionId)) {
    const { AppError } = await import("@/server/api");
    throw new AppError("NOT_FOUND", "Reflection not found", 404);
  }
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      const input = await readJsonBody(
        innerRequest,
        interviewReflectionUpdateSchema,
      );
      const updated = new InterviewAiService(getDatabase()).updateReflection(
        user.id,
        reflectionId,
        input,
      );
      return apiResult(updated);
    }),
  )(request);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ reflectionId: string }> },
): Promise<Response> {
  const { reflectionId } = await context.params;
  if (!idPattern.test(reflectionId)) {
    const { AppError } = await import("@/server/api");
    throw new AppError("NOT_FOUND", "Reflection not found", 404);
  }
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      new InterviewAiService(getDatabase()).deleteReflection(
        user.id,
        reflectionId,
      );
      return apiNoContent();
    }),
  )(request);
}
