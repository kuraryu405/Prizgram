"use client";

import { useState, type FormEvent } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    if (newPassword !== confirmation) {
      setFormError("新しいパスワードと確認が一致しません。");
      return;
    }
    if (pending) return;
    setPending(true);
    try {
      await apiFetch<unknown>(
        "/api/auth/password",
        jsonRequestInit("POST", { currentPassword, newPassword }),
      );
      setSuccessMessage("パスワードを変更しました。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
    } catch (error) {
      setFormError(describeApiError(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="card form-stack"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      <h2>パスワード変更</h2>
      {formError !== null && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      {successMessage !== null && (
        <p className="form-success" role="status">
          {successMessage}
        </p>
      )}
      <div className="field">
        <label htmlFor="current-password">現在のパスワード</label>
        <input
          autoComplete="current-password"
          id="current-password"
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">新しいパスワード</label>
        <input
          autoComplete="new-password"
          id="new-password"
          maxLength={128}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
        <p className="hint-text">12文字以上128文字以下</p>
      </div>
      <div className="field">
        <label htmlFor="confirm-password">新しいパスワード（確認）</label>
        <input
          autoComplete="new-password"
          id="confirm-password"
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
