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
  initialStageLabel?: string;
  initialNextAction?: string;
  initialNote?: string;
}>;

export function ApplicationUpdateForm(props: ApplicationUpdateFormProps) {
  const stateKey = JSON.stringify([
    props.applicationId,
    props.initialStageLabel ?? "",
    props.initialNextAction ?? "",
    props.initialNote ?? "",
  ]);
  return <ApplicationUpdateFormState key={stateKey} {...props} />;
}

function ApplicationUpdateFormState({
  applicationId,
  currentStatus,
  allowedNextStatuses,
  statusLabels,
  initialStageLabel,
  initialNextAction,
  initialNote,
}: ApplicationUpdateFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [stageLabel, setStageLabel] = useState(initialStageLabel ?? "");
  const [nextAction, setNextAction] = useState(initialNextAction ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [savedStageLabel, setSavedStageLabel] = useState(
    (initialStageLabel ?? "").trim(),
  );
  const [savedNextAction, setSavedNextAction] = useState(
    (initialNextAction ?? "").trim(),
  );
  const [savedNote, setSavedNote] = useState((initialNote ?? "").trim());
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const hasStatusChange = status !== "";
  const stageLabelTrimmed = stageLabel.trim();
  const nextActionTrimmed = nextAction.trim();
  const noteTrimmed = note.trim();
  const stageLabelDirty = stageLabelTrimmed !== savedStageLabel;
  const nextActionDirty = nextActionTrimmed !== savedNextAction;
  const noteDirty = noteTrimmed !== savedNote;
  const canSubmit =
    hasStatusChange || stageLabelDirty || nextActionDirty || noteDirty;

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
            ...(stageLabelDirty
              ? {
                  stageLabel:
                    stageLabelTrimmed === "" ? null : stageLabelTrimmed,
                }
              : {}),
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
      if (stageLabelDirty) {
        setSavedStageLabel(stageLabelTrimmed);
        setStageLabel(stageLabelTrimmed);
      }
      if (nextActionDirty) {
        setSavedNextAction(nextActionTrimmed);
        setNextAction(nextActionTrimmed);
      }
      if (noteDirty) {
        setSavedNote(noteTrimmed);
        setNote(noteTrimmed);
      }
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
          <p className="hint-text">完了済みの応募です。</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="application-stage-label-input">
          現在の段階（任意）
        </label>
        <input
          id="application-stage-label-input"
          maxLength={100}
          onChange={(event) => setStageLabel(event.target.value)}
          placeholder={
            initialStageLabel === undefined
              ? "例: 2次面接"
              : "空にすると削除されます"
          }
          type="text"
          value={stageLabel}
        />
        <p className="hint-text">例: Webテスト / 2次面接 / 最終面接</p>
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
        <label htmlFor="application-note-input">メモ</label>
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
