import { z } from "zod";

export const loginIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/)
  .transform((value) => value.toLowerCase());

export const passwordSchema = z.string().min(12).max(128);

export const credentialsSchema = z
  .object({
    loginId: loginIdSchema,
    password: passwordSchema,
  })
  .strict();

export type Credentials = z.output<typeof credentialsSchema>;

export const authenticatedUserSchema = z
  .object({ id: z.string().min(1), loginId: loginIdSchema })
  .strict();

export type AuthenticatedUser = z.output<typeof authenticatedUserSchema>;
