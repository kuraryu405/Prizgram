import { applicationStatuses, type ApplicationStatus } from "@prizgram/shared";

import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  ApplicationService,
  applicationCreateRequestSchema,
} from "@/server/applications/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = () => new ApplicationService(getDatabase());

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, applicationCreateRequestSchema);
    return apiResult(service().createFromJob(user, input), { status: 201 });
  }),
);

export const GET = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    const statusParam = new URL(request.url).searchParams.get("status");
    const validStatuses = new Set(applicationStatuses);
    const status =
      statusParam !== null && validStatuses.has(statusParam as never)
        ? (statusParam as ApplicationStatus)
        : undefined;
    return service().listApplications(user.id, { status });
  }),
);
