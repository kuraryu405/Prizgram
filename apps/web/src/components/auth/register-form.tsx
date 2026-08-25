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

export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ApiFieldErrors>({});

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const parsed = credentialsSchema.safeParse({ loginId, password });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    if (password !== confirmPassword) {
      setFieldErrors({
        password: ["パスワードが一致しません。"],
      });
      return;
    }

    setPending(true);
    try {
      await register(parsed.data);
      router.replace("/app");
    } catch (error) {
      setPending(false);
      const errors =
        error instanceof ApiClientError ? (error.fieldErrors ?? {}) : {};
      if ("password" in errors) {
        // Never echo the confirmed password mismatch back as a server rule.
        delete errors.password;
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFormError(describeApiError(error));
      }
    }
  };

  const loginIdError = fieldErrors.loginId?.[0];
  const passwordError = fieldErrors.password?.[0];

  return (
    <form
      method="post"
      action="#"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="field">
        <label htmlFor="register-login-id">ログインID</label>
        <input
          aria-describedby={
            loginIdError ? "register-login-id-error" : "register-login-id-hint"
          }
          aria-invalid={loginIdError ? true : undefined}
          autoComplete="username"
          id="register-login-id"
          name="loginId"
          onChange={(event) => setLoginId(event.target.value)}
          required
          type="text"
          value={loginId}
        />
        <p className="hint-text" id="register-login-id-hint">
          3〜64文字の半角英数字、ピリオド、アンダースコア、ハイフン。
        </p>
        {loginIdError && (
          <p className="error-text" id="register-login-id-error">
            {fieldLabels.loginId}: {loginIdError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="register-password">パスワード</label>
        <input
          aria-describedby={
            passwordError ? "register-password-error" : "register-password-hint"
          }
          aria-invalid={passwordError ? true : undefined}
          autoComplete="new-password"
          id="register-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <p className="hint-text" id="register-password-hint">
          12文字以上128文字以下。
        </p>
        {passwordError && (
          <p className="error-text" id="register-password-error">
            {fieldLabels.password}: {passwordError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="register-confirm-password">パスワード（確認）</label>
        <input
          aria-invalid={passwordError ? true : undefined}
          autoComplete="new-password"
          id="register-confirm-password"
          name="confirmPassword"
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
        />
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending}
        type="submit"
      >
        アカウントを作成
      </button>
    </form>
  );
}
