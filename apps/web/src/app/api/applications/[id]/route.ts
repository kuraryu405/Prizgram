import {
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  ApplicationService,
  applicationUpdateRequestSchema,
} from "@/server/applications/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = () => new ApplicationService(getDatabase());
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function assertValidId(id: string): void {
  if (!idPattern.test(id)) {
    throw new AppError("NOT_FOUND", "Application not found", 404);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler((innerRequest) => {
      const user = requireSessionUser(innerRequest);
      assertValidId(id);
      return service().getApplicationDetail(user.id, id);
    }),
  )(request);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    assertValidId(id);
    const input = await readJsonBody(
      innerRequest,
      applicationUpdateRequestSchema,
    );
    void service().updateApplication(user, id, input);
    return apiResult({ updated: true });
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
