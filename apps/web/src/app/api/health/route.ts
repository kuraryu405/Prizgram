import { withApiHandler } from "@/server/api";
import { database } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler(() => {
  database.ready();
  return { status: "ok" as const };
});
