import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import {
  authSessions,
  type DatabaseConnection,
  userCredentials,
  users,
} from "@prizgram/db";
import type { AuthenticatedUser, Credentials } from "@prizgram/shared";

import { AppError } from "../api";
import { hashPassword, verifyPassword } from "./password";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1_000;
const dummyPasswordHash = hashPassword("dummy-password-for-timing-only");

export type AuthSession = Readonly<{
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
}>;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const LOGIN_ID_UNIQUE_VIOLATION =
  /unique constraint failed: user_credentials\.login_id(?:,|\s|$)/i;

/**
 * Matches only a unique violation on user_credentials.login_id. Every other
 * constraint failure (primary key, check, foreign key, ...) is a server
 * defect and must surface instead of being reported as a login conflict.
 */
export function isLoginIdUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    typeof code === "string" &&
    code.startsWith("SQLITE_CONSTRAINT") &&
    typeof message === "string" &&
    LOGIN_ID_UNIQUE_VIOLATION.test(message)
  );
}

export class AuthService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(credentials: Credentials): Promise<AuthSession> {
    const passwordHash = await hashPassword(credentials.password);
    const userId = randomUUID();
    const session = this.newSession(userId, credentials.loginId);

    try {
      this.connection.db.transaction((transaction) => {
        transaction
          .delete(authSessions)
          .where(lte(authSessions.expiresAt, this.now()))
          .run();
        transaction.insert(users).values({ id: userId }).run();
        transaction
          .insert(userCredentials)
          .values({
            userId,
            loginId: credentials.loginId,
            passwordHash,
          })
          .run();
        transaction
          .insert(authSessions)
          .values({
            tokenHash: tokenHash(session.token),
            userId,
            expiresAt: session.expiresAt,
          })
          .run();
      });
    } catch (error) {
      if (isLoginIdUniqueViolation(error)) {
        throw new AppError("LOGIN_ID_TAKEN", "Login ID is unavailable", 409);
      }
      throw error;
    }
    return session;
  }

  async login(credentials: Credentials): Promise<AuthSession> {
    const credential = this.connection.db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.loginId, credentials.loginId))
      .get();
    const validPassword = await verifyPassword(
      credentials.password,
      credential?.passwordHash ?? (await dummyPasswordHash),
    );
    const now = this.now();

    if (credential === undefined || !validPassword) {
      if (credential !== undefined)
        this.recordFailedAttempt(credential.userId, now);
      throw new AppError(
        "AUTHENTICATION_FAILED",
        "Login ID or password is incorrect",
        401,
      );
    }

    const session = this.newSession(credential.userId, credential.loginId);
    this.connection.db.transaction((transaction) => {
      const reset = transaction
        .update(userCredentials)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(
          and(
            eq(userCredentials.userId, credential.userId),
            or(
              isNull(userCredentials.lockedUntil),
              lte(userCredentials.lockedUntil, now),
            ),
          ),
        )
        .run();
      if (reset.changes !== 1) {
        throw new AppError(
          "AUTHENTICATION_FAILED",
          "Login ID or password is incorrect",
          401,
        );
      }
      transaction
        .delete(authSessions)
        .where(lte(authSessions.expiresAt, now))
        .run();
      transaction
        .insert(authSessions)
        .values({
          tokenHash: tokenHash(session.token),
          userId: credential.userId,
          expiresAt: session.expiresAt,
        })
        .run();
    });
    return session;
  }

  authenticate(token: string | undefined): AuthenticatedUser | undefined {
    if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return undefined;
    const row = this.connection.db
      .select({ userId: authSessions.userId, loginId: userCredentials.loginId })
      .from(authSessions)
      .innerJoin(
        userCredentials,
        eq(userCredentials.userId, authSessions.userId),
      )
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash(token)),
          gt(authSessions.expiresAt, this.now()),
        ),
      )
      .get();
    return row === undefined
      ? undefined
      : { id: row.userId, loginId: row.loginId };
  }

  requireUser(token: string | undefined): AuthenticatedUser {
    const user = this.authenticate(token);
    if (user === undefined) {
      throw new AppError(
        "AUTHENTICATION_REQUIRED",
        "Authentication required",
        401,
      );
    }
    return user;
  }

  logout(token: string | undefined): void {
    if (token === undefined || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    this.connection.db
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash(token)))
      .run();
  }

  private newSession(userId: string, loginId: string): AuthSession {
    const now = this.now();
    return {
      token: randomBytes(32).toString("base64url"),
      expiresAt: new Date(now.getTime() + SESSION_DURATION_MS),
      user: { id: userId, loginId },
    };
  }

  private recordFailedAttempt(userId: string, now: Date): void {
    const nowMs = now.getTime();
    const lockedUntil = nowMs + LOCK_DURATION_MS;
    // The increment and lock decision are one SQLite statement, so parallel
    // attempts cannot overwrite each other with stale counters.
    this.connection.sqlite
      .prepare(
        `update user_credentials
         set failed_attempts = case
               when locked_until is not null and locked_until <= @now then 1
               else failed_attempts + 1
             end,
             locked_until = case
               when locked_until is not null and locked_until > @now then locked_until
               when (case
                 when locked_until is not null and locked_until <= @now then 1
                 else failed_attempts + 1
               end) >= @maximumAttempts then @lockedUntil
               else null
             end
         where user_id = @userId
           and (locked_until is null or locked_until <= @now)`,
      )
      .run({
        lockedUntil,
        maximumAttempts: MAX_FAILED_ATTEMPTS,
        now: nowMs,
        userId,
      });
  }
}
