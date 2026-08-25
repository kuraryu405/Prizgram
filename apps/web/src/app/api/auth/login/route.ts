import {
  AuthService,
  authenticateMutationRequest,
  readCredentials,
  sessionCookie,
  withNoStore,
} from "@/server/auth";
import { apiResult, withApiHandler } from "@/server/api";
import { getDatabase } from "@/server/database";

const login = withApiHandler(async (request) => {
  authenticateMutationRequest(request);
  const credentials = await readCredentials(request);
  const session = await new AuthService(getDatabase()).login(credentials);
  return apiResult(
    { user: session.user },
    {
      headers: {
        "set-cookie": sessionCookie(session.token, session.expiresAt),
      },
    },
  );
});

export const POST = withNoStore(login);
