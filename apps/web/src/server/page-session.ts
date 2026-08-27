import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthenticatedUser } from "@prizgram/shared";

import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";

/**
 * Server-component variant of requireSessionUser: redirects to the login
 * page instead of throwing an API error.
 * Preserves the current app path as ?next= for post-login return (#183).
 */
export async function requireSessionUserPage(): Promise<AuthenticatedUser> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).authenticate(token);
  if (user === undefined) {
    const h = await headers();
    const candidate =
      h.get("x-invoke-path") ??
      h.get("x-matched-path") ??
      h.get("next-url") ??
      null;
    if (
      candidate !== null &&
      candidate.startsWith("/app") &&
      !candidate.startsWith("//")
    ) {
      redirect(`/login?next=${encodeURIComponent(candidate)}`);
    }
    redirect("/login");
  }
  return user;
}
