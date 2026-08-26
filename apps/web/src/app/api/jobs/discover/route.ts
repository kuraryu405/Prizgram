import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { requestSourceKey } from "@/server/auth/rate-limit";
import { getDatabase } from "@/server/database";

import {
  DiscoveryService,
  jobDiscoveryRequestSchema,
} from "@/server/jobs/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, jobDiscoveryRequestSchema);
    const result = await new DiscoveryService(getDatabase()).discover(
      user,
      input,
      {
        // The provider contract requires the end-user context; the proxy
        // first hop plus the browser user agent are forwarded per call and
        // never persisted.
        userIp: requestSourceKey(request),
        userAgent: request.headers.get("user-agent") ?? "unknown",
      },
    );
    return apiResult(result, { status: 200 });
  }),
);
