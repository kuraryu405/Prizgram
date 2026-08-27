import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import {
  enforceLlmRateLimit,
  requireSessionUser,
  withNoStore,
} from "@/server/auth";
import { requestSourceKey } from "@/server/auth/rate-limit";
import { getDatabase } from "@/server/database";

import {
  DiscoveryService,
  jobDiscoveryRequestSchema,
} from "@/server/jobs/discovery";
import { JOB_DISCOVERY_MAX_REQUEST_BYTES } from "@/server/jobs/request-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(
      request,
      jobDiscoveryRequestSchema,
      JOB_DISCOVERY_MAX_REQUEST_BYTES,
    );
    const manualSearch =
      input.keywords !== undefined && input.keywords.trim().length > 0;

    // Persona-assisted search always needs the LLM to build the base query.
    // Manual search stays free unless the returned postings need optional
    // company-name extraction; the service calls onLlmUse only in that case.
    if (!manualSearch) enforceLlmRateLimit(user.id);
    let manualLlmBudgetConsumed = false;
    const consumeManualLlmBudget = () => {
      if (!manualSearch || manualLlmBudgetConsumed) return;
      enforceLlmRateLimit(user.id);
      manualLlmBudgetConsumed = true;
    };

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
      manualSearch ? { onLlmUse: consumeManualLlmBudget } : {},
    );
    return apiResult(result, { status: 200 });
  }),
);
