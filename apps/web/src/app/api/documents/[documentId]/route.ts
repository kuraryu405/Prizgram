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
  documentUpdateRequestSchema,
} from "@/server/application-documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const doc = new ApplicationDocumentService(getDatabase()).getDocument(
      user.id,
      documentId,
    );
    return apiResult(doc);
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const input = await readJsonBody(innerRequest, documentUpdateRequestSchema);
    const updated = new ApplicationDocumentService(
      getDatabase(),
    ).updateDocument(user.id, documentId, input);
    return apiResult(updated);
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    new ApplicationDocumentService(getDatabase()).deleteDocument(
      user.id,
      documentId,
    );
    return new ApiNoContent();
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
