import {
  assertSameOrigin,
  AuthService,
  enforceAuthRateLimit,
  readCredentials,
  sessionCookie,
  withNoStore,
} from "@/server/auth";
import { apiResult, withApiHandler } from "@/server/api";
import { getDatabase } from "@/server/database";

const register = withApiHandler(async (request) => {
  enforceAuthRateLimit(request);
  assertSameOrigin(request);
  const credentials = await readCredentials(request);
  const session = await new AuthService(getDatabase()).register(credentials);
  return apiResult(
    { user: session.user },
    {
      status: 201,
      headers: {
        "set-cookie": sessionCookie(session.token, session.expiresAt),
      },
    },
  );
});

export const POST = withNoStore(register);
