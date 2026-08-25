"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { credentialsSchema } from "@prizgram/shared";

import { ApiClientError, type ApiFieldErrors } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

import { useAuth } from "./auth-provider";

const fieldLabels: Readonly<Record<string, string>> = {
  loginId: "ログインID",
  password: "パスワード",
};

function safeNextPath(): string {
  if (typeof window === "undefined") return "/app";
  const next = new URLSearchParams(window.location.search).get("next");
  return next !== null && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/app";
}

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ApiFieldErrors>({});

  const applyFieldErrors = (errors: ApiFieldErrors | undefined) => {
    if (errors === undefined) {
      setFieldErrors({});
      return {};
    }
    setFieldErrors(errors);
    return errors;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const parsed = credentialsSchema.safeParse({ loginId, password });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      return;
    }

    setPending(true);
    try {
      await login(parsed.data);
      router.replace(safeNextPath());
    } catch (error) {
      setPending(false);
      const errors = applyFieldErrors(
        error instanceof ApiClientError ? error.fieldErrors : undefined,
      );
      if (Object.keys(errors).length === 0) {
        setFormError(describeApiError(error));
      }
    }
  };

  const loginIdError = fieldErrors.loginId?.[0];
  const passwordError = fieldErrors.password?.[0];

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="field">
        <label htmlFor="login-id">ログインID</label>
        <input
          aria-describedby={loginIdError ? "login-id-error" : undefined}
          aria-invalid={loginIdError ? true : undefined}
          autoComplete="username"
          id="login-id"
          name="loginId"
          onChange={(event) => setLoginId(event.target.value)}
          required
          type="text"
          value={loginId}
        />
        {loginIdError && (
          <p className="error-text" id="login-id-error">
            {fieldLabels.loginId}: {loginIdError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="password">パスワード</label>
        <input
          aria-describedby={passwordError ? "password-error" : undefined}
          aria-invalid={passwordError ? true : undefined}
          autoComplete="current-password"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        {passwordError && (
          <p className="error-text" id="password-error">
            {fieldLabels.password}: {passwordError}
          </p>
        )}
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending}
        type="submit"
      >
        ログイン
      </button>
    </form>
  );
}
