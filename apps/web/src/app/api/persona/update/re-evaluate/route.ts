import {
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import { PersonaUpdateService } from "@/server/persona-update/service";
import { ScoringService } from "@/server/scoring/service";
import { z } from "zod";

const schema = z
  .object({ personaVersionId: z.string().min(1).max(128) })
  .strict();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withNoStore(
  withApiHandler(async (request) => {
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, schema);
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.personaVersionId)) {
      throw new AppError("NOT_FOUND", "Persona not found", 404);
    }
    const audit = await new PersonaUpdateService(getDatabase()).reEvaluateAll(
      user,
      input.personaVersionId,
      {
        scoring: new ScoringService(getDatabase()),
      },
    );
    return apiResult({ audit });
  }),
);
