/* eslint-disable @typescript-eslint/require-await */
import {
  ApiNoContent,
  apiResult,
  readJsonBody,
  withApiHandler,
} from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import {
  ApplicationDocumentService,
  documentEntryUpdateRequestSchema,
} from "@/server/application-documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entryId: string }> },
): Promise<Response> {
  const { entryId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const input = await readJsonBody(
      innerRequest,
      documentEntryUpdateRequestSchema,
    );
    const updated = new ApplicationDocumentService(getDatabase()).updateEntry(
      user.id,
      entryId,
      input,
    );
    return apiResult(updated);
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ entryId: string }> },
): Promise<Response> {
  const { entryId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    new ApplicationDocumentService(getDatabase()).deleteEntry(user.id, entryId);
    return new ApiNoContent();
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
