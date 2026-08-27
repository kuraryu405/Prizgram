/* eslint-disable @typescript-eslint/require-await */
import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import {
  ApplicationDocumentService,
  documentEntryCreateRequestSchema,
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
    const entries = new ApplicationDocumentService(getDatabase()).listEntries(
      user.id,
      documentId,
    );
    return apiResult(entries);
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const handler = withApiHandler(async (innerRequest) => {
    const user = requireSessionUser(innerRequest);
    const input = await readJsonBody(
      innerRequest,
      documentEntryCreateRequestSchema,
    );
    const created = new ApplicationDocumentService(getDatabase()).createEntry(
      user.id,
      documentId,
      input,
    );
    return apiResult(created, { status: 201 });
  });
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
}
