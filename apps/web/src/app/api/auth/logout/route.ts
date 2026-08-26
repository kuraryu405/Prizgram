import {
  AuthService,
  clearSessionCookie,
  sessionTokenFromRequest,
  withNoStore,
} from "@/server/auth";
import { apiNoContent, withApiHandler } from "@/server/api";
import { getDatabase } from "@/server/database";

const logout = withApiHandler((request) => {
  new AuthService(getDatabase()).logout(sessionTokenFromRequest(request));
  return apiNoContent({ "set-cookie": clearSessionCookie() });
});

export const POST = withNoStore(logout);
