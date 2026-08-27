import { z } from "zod";

import { passwordSchema } from "@prizgram/shared";

import { apiResult, readJsonBody, withApiHandler } from "@/server/api";
import { requireSessionUser, withNoStore } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { AuthService } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passwordChangeSchema = z
  .object({
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
    const user = requireSessionUser(request);
    const input = await readJsonBody(request, passwordChangeSchema);
    await new AuthService(getDatabase()).changePassword(
      user,
      input.currentPassword,
      input.newPassword,
    );
    return apiResult({ updated: true });
  }),
);

export const PATCH = POST;
