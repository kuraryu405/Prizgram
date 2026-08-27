import {
  AppError,
  apiNoContent,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { withNoStore } from "@/server/auth/http";
import { getDatabase } from "@/server/database";
import { InterviewReflectionService } from "@/server/interview-ai/reflections";
import { interviewReflectionUpdateSchema } from "@/server/interview-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ reflectionId: string }> },
): Promise<Response> {
  const { reflectionId } = await context.params;
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!idPattern.test(reflectionId)) {
        throw new AppError("NOT_FOUND", "Reflection not found", 404);
      }
      const input = await readJsonBody(
        innerRequest,
        interviewReflectionUpdateSchema,
      );
      const updated = new InterviewReflectionService(getDatabase()).update(
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
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!idPattern.test(reflectionId)) {
        throw new AppError("NOT_FOUND", "Reflection not found", 404);
      }
      new InterviewReflectionService(getDatabase()).delete(
        user.id,
        reflectionId,
      );
      return apiNoContent();
    }),
  )(request);
}
