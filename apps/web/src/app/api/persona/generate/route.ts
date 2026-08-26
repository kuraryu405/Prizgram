import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import {
  enforceLlmRateLimit,
  requireSessionUser,
  withNoStore,
} from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  PersonaService,
  personaGenerateRequestSchema,
} from "@/server/persona/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, personaGenerateRequestSchema);
    enforceLlmRateLimit(user.id);
    const result = await new PersonaService(getDatabase()).generatePersona(
      user,
      input,
    );
    return apiResult(result, { status: result.duplicate ? 200 : 201 });
  }),
);
