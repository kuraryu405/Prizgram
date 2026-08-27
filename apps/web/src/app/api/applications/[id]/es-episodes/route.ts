import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { enforceLlmRateLimit, requireSessionUser } from "@/server/auth";
import { withNoStore } from "@/server/auth/http";
import { getDatabase } from "@/server/database";
import { EsAiService, episodeRequestSchema } from "@/server/es-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idPattern.test(id)) {
    const { AppError } = await import("@/server/api");
    throw new AppError("NOT_FOUND", "Application not found", 404);
  }
  return withNoStore(
    withApiHandler(async (innerRequest) => {
      const user = requireSessionUser(innerRequest);
      enforceLlmRateLimit(user.id);
      const input = await readJsonBody(innerRequest, episodeRequestSchema);
      const result = await new EsAiService(
        getDatabase(),
      ).generateEpisodeCandidates(user.id, id, input);
      return apiResult(result);
    }),
  )(request);
}
