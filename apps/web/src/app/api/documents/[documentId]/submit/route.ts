/* eslint-disable @typescript-eslint/require-await */
import { apiResult, withApiHandler } from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { ApplicationDocumentService } from "@/server/application-documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const submitted = new ApplicationDocumentService(
      getDatabase(),
    ).submitDocument(user.id, documentId);
    return apiResult(submitted);
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
