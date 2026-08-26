"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export type ApplicationUpdateFormProps = Readonly<{
  applicationId: string;
  currentStatus: string;
  allowedNextStatuses: readonly string[];
  statusLabels: Readonly<Record<string, string>>;
  initialNextAction?: string;
  initialNote?: string;
}>;

export function ApplicationUpdateForm({
  applicationId,
  currentStatus,
  allowedNextStatuses,
  statusLabels,
  initialNextAction,
  initialNote,
}: ApplicationUpdateFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [nextAction, setNextAction] = useState(initialNextAction ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Keep form in sync when the server-provided initial values change after refresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing controlled form from server props
    setNextAction(initialNextAction ?? "");
  }, [initialNextAction]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing controlled form from server props
    setNote(initialNote ?? "");
  }, [initialNote]);

  const hasStatusChange = status !== "";
  const nextActionTrimmed = nextAction.trim();
  const noteTrimmed = note.trim();
  const initialNextActionTrimmed = (initialNextAction ?? "").trim();
  const initialNoteTrimmed = (initialNote ?? "").trim();
  const nextActionDirty = nextActionTrimmed !== initialNextActionTrimmed;
  const noteDirty = noteTrimmed !== initialNoteTrimmed;
  const canSubmit = hasStatusChange || nextActionDirty || noteDirty;

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
            ...(nextActionDirty
              ? {
                  nextAction:
                    nextActionTrimmed === "" ? null : nextActionTrimmed,
                }
              : {}),
            ...(noteDirty
              ? { note: noteTrimmed === "" ? null : noteTrimmed }
              : {}),
          }),
          method: "PATCH",
        },
      );
      setStatus("");
      // Keep form in sync with server after successful mutation.
      // If the field was cleared (sent null), the server will have null,
      // otherwise it will have the new trimmed value.
      if (nextActionDirty) setNextAction(nextActionTrimmed);
      if (noteDirty) setNote(noteTrimmed);
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
          placeholder={
            initialNextAction === undefined
              ? "例: ESを書く"
              : "空にすると削除されます"
          }
          type="text"
          value={nextAction}
        />
        {initialNextAction !== undefined && (
          <p className="hint-text">現在: {initialNextAction}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="application-note-input">
          メモ（ステータス変更時の履歴に記録）
        </label>
        <textarea
          id="application-note-input"
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            initialNote === undefined ? "任意" : "空にすると削除されます"
          }
          rows={3}
          value={note}
        />
        {initialNote !== undefined && (
          <p className="hint-text">現在のメモがあります</p>
        )}
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending || !canSubmit}
        type="submit"
      >
        {pending ? "更新中…" : "更新する"}
      </button>
    </form>
  );
}
