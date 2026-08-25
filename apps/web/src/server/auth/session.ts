import "server-only";

import type { AuthenticatedUser } from "@prizgram/shared";

import { AuthService, sessionTokenFromRequest } from "@/server/auth";
import { getDatabase } from "@/server/database";

/**
 * Resolves the authenticated user for a route handler from the session
 * cookie. Ownership boundaries start here: every feature service receives
 * this user id instead of any client-supplied identity.
 */
export function requireSessionUser(request: Request): AuthenticatedUser {
  return new AuthService(getDatabase()).requireUser(
    sessionTokenFromRequest(request),
  );
}
