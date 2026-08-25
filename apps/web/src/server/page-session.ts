import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthenticatedUser } from "@prizgram/shared";

import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";

/**
 * Server-component variant of requireSessionUser: redirects to the login
 * page instead of throwing an API error.
 */
export async function requireSessionUserPage(): Promise<AuthenticatedUser> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).authenticate(token);
  if (user === undefined) redirect("/login");
  return user;
}
