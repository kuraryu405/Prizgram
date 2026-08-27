import { z } from "zod";

import { loginIdSchema, passwordSchema } from "@prizgram/shared";

import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import {
  AuthService,
  authenticateMutationRequest,
  withNoStore,
} from "@/server/auth";
import { getDatabase } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicPasswordChangeSchema = z
  .object({
    loginId: loginIdSchema,
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must be different",
    path: ["newPassword"],
  });

export const POST = withNoStore(
  withApiHandler(async (request) => {
    authenticateMutationRequest(request);
    const input = await readJsonBody(request, publicPasswordChangeSchema);
    const auth = new AuthService(getDatabase());
    const session = await auth.login({
      loginId: input.loginId,
      password: input.currentPassword,
    });
    try {
      await auth.changePassword(
        session.user,
        input.currentPassword,
        input.newPassword,
      );
    } finally {
      auth.logout(session.token);
    }
    return apiResult({ updated: true });
  }),
);
