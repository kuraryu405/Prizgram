/* eslint-disable @typescript-eslint/require-await */
import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import {
  ApplicationDocumentService,
  documentCreateRequestSchema,
} from "@/server/application-documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const docs = new ApplicationDocumentService(getDatabase()).listDocuments(
      user.id,
      id,
    );
    return apiResult(docs);
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const input = await readJsonBody(innerRequest, documentCreateRequestSchema);
    const created = new ApplicationDocumentService(
      getDatabase(),
    ).createDocument(user, id, input);
    return apiResult(created, { status: 201 });
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
