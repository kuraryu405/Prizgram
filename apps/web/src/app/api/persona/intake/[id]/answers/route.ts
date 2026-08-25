import {
  AppError,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";

import {
  PersonaService,
  personaAnswerRequestSchema,
} from "@/server/persona/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = () => new PersonaService(getDatabase());
const intakeIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      if (!intakeIdPattern.test(id)) {
        throw new AppError("NOT_FOUND", "Intake not found", 404);
      }
      const input = await readJsonBody(
        innerRequest,
        personaAnswerRequestSchema,
      );
      service().saveAnswer(user, id, input);
      return apiResult({
        intakeId: id,
        questionId: input.questionId,
        saved: true,
      });
    }),
  )(request);
}
