import { apiResult, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { PersonaService } from "@/server/persona/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = () => new PersonaService(getDatabase());

/** Starts (or resumes) the single in-progress intake for the session user. */
export const POST = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    return apiResult(service().startIntake(user.id));
  }),
);

export const GET = withNoStore(
  withApiHandler((request) => {
    const user = requireSessionUser(request);
    return service().latestPersona(user.id);
  }),
);
