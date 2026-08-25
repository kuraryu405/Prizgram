"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export type ApplicationUpdateFormProps = Readonly<{
  applicationId: string;
  currentStatus: string;
  allowedNextStatuses: readonly string[];
  statusLabels: Readonly<Record<string, string>>;
}>;

export function ApplicationUpdateForm({
  applicationId,
  currentStatus,
  allowedNextStatuses,
  statusLabels,
}: ApplicationUpdateFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      await apiFetch<unknown>(
        `/api/applications/${encodeURIComponent(applicationId)}`,
        {
          ...jsonRequestInit("PATCH", {
            ...(status !== "" ? { status } : {}),
            ...(nextAction.trim() === ""
              ? {}
              : { nextAction: nextAction.trim() }),
            ...(note.trim() === "" ? {} : { note: note.trim() }),
          }),
          method: "PATCH",
        },
      );
      setStatus("");
      setNote("");
      setSuccessMessage("更新しました。");
      router.refresh();
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
      onSubmit={(e) => void onSubmit(e)}
    >
      <h2>更新</h2>
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
        <label htmlFor="application-status">ステータス変更（任意）</label>
        <select
          id="application-status"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">変更しない</option>
          {allowedNextStatuses.map((nextStatus) => (
            <option key={nextStatus} value={nextStatus}>
              {currentStatus} → {statusLabels[nextStatus] ?? nextStatus}
            </option>
          ))}
        </select>
        {allowedNextStatuses.length === 0 && (
          <p className="hint-text">
            現在のステータスは完了済みのため、遷移できるステータスがありません。
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="application-next-action-input">次のアクション</label>
        <input
          id="application-next-action-input"
          maxLength={500}
          onChange={(event) => setNextAction(event.target.value)}
          placeholder="空欄なら変更しません"
          type="text"
          value={nextAction}
        />
      </div>
      <div className="field">
        <label htmlFor="application-note-input">
          メモ（ステータス変更時の履歴に記録）
        </label>
        <textarea
          id="application-note-input"
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          value={note}
        />
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={
          pending ||
          (status === "" && nextAction.trim() === "" && note.trim() === "")
        }
        type="submit"
      >
        {pending ? "更新中…" : "更新する"}
      </button>
    </form>
  );
}
