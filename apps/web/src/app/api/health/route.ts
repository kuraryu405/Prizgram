import { withApiHandler } from "@/server/api";
import { getDatabase } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler(() => {
  getDatabase().ready();
  return { status: "ok" as const };
});
