import {
  AuthService,
  sessionTokenFromRequest,
  withNoStore,
} from "@/server/auth";
import { withApiHandler } from "@/server/api";
import { getDatabase } from "@/server/database";

const me = withApiHandler((request) => ({
  user: new AuthService(getDatabase()).requireUser(
    sessionTokenFromRequest(request),
  ),
}));

export const GET = withNoStore(me);
