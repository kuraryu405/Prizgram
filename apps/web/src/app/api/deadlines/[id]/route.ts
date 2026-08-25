import {
  ApiNoContent,
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  DeadlineService,
  deadlineUpdateRequestSchema,
} from "@/server/deadlines/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    if (!idPattern.test(id))
      throw new AppError("NOT_FOUND", "Deadline not found", 404);
    const input = await readJsonBody(innerRequest, deadlineUpdateRequestSchema);
    return apiResult(
      new DeadlineService(getDatabase()).update(user, id, input),
    );
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const handler = withApiHandler((innerRequest) => {
    const user = requireSessionUser(innerRequest);
    if (!idPattern.test(id))
      throw new AppError("NOT_FOUND", "Deadline not found", 404);
    new DeadlineService(getDatabase()).remove(user, id);
    return new ApiNoContent();
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
