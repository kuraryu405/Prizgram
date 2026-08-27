"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export function PublicPasswordChangeForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (newPassword !== confirmation) {
      setFormError("新しいパスワードと確認が一致しません。");
      return;
    }
    if (pending) return;
    setPending(true);
    try {
      await apiFetch<unknown>(
        "/api/auth/password/public",
        jsonRequestInit("POST", { loginId, currentPassword, newPassword }),
      );
      router.replace("/login?passwordChanged=1");
    } catch (error) {
      setFormError(describeApiError(error));
      setPending(false);
    }
  };

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="field">
        <label htmlFor="password-change-login-id">ログインID</label>
        <input
          autoComplete="username"
          id="password-change-login-id"
          maxLength={64}
          onChange={(event) => setLoginId(event.target.value)}
          required
          value={loginId}
        />
      </div>
      <div className="field">
        <label htmlFor="password-change-current">現在のパスワード</label>
        <input
          autoComplete="current-password"
          id="password-change-current"
          maxLength={128}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </div>
      <div className="field">
        <label htmlFor="password-change-new">新しいパスワード</label>
        <input
          autoComplete="new-password"
          id="password-change-new"
          maxLength={128}
          minLength={12}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
      </div>
      <div className="field">
        <label htmlFor="password-change-confirm">
          新しいパスワード（確認）
        </label>
        <input
          autoComplete="new-password"
          id="password-change-confirm"
          maxLength={128}
          minLength={12}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={
          pending ||
          loginId.trim() === "" ||
          currentPassword === "" ||
          newPassword === "" ||
          confirmation === ""
        }
        type="submit"
      >
        {pending ? "変更中…" : "パスワードを変更"}
      </button>
    </form>
  );
}
