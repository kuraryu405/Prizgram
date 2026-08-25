"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ApiClientError, apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export type ApplicationAddFormProps = Readonly<{
  jobs: ReadonlyArray<{ jobId: string; company: string; role: string }>;
}>;

export function ApplicationAddForm({ jobs }: ApplicationAddFormProps) {
  const router = useRouter();
  const [jobId, setJobId] = useState(jobs[0]?.jobId ?? "");
  const [nextAction, setNextAction] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (jobs.length === 0) {
    return (
      <p className="hint-text">
        応募できる求人がありません。先に「求人」ページから求人票を取り込んでください。
      </p>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || jobId === "") return;
    setPending(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      await apiFetch<unknown>(
        "/api/applications",
        jsonRequestInit("POST", {
          jobId,
          ...(nextAction.trim() === ""
            ? {}
            : { nextAction: nextAction.trim() }),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        }),
      );
      setSuccessMessage("応募管理に追加しました。");
      setJobId("");
      setNextAction("");
      setNote("");
      router.refresh();
    } catch (error) {
      setFormError(describeApiError(error));
      if (
        error instanceof ApiClientError &&
        error.code === "APPLICATION_EXISTS"
      ) {
        setSuccessMessage(null);
      }
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
      <h2>保存済み求人から応募を追加</h2>
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
        <label htmlFor="application-job">求人</label>
        <select
          id="application-job"
          onChange={(event) => setJobId(event.target.value)}
          required
          value={jobId}
        >
          {jobs.map((job) => (
            <option key={job.jobId} value={job.jobId}>
              {job.company} — {job.role}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="application-next-action">次のアクション（任意）</label>
        <input
          id="application-next-action"
          maxLength={500}
          onChange={(event) => setNextAction(event.target.value)}
          placeholder="例: 応募書類を送る"
          type="text"
          value={nextAction}
        />
      </div>
      <div className="field">
        <label htmlFor="application-note">メモ（任意）</label>
        <textarea
          id="application-note"
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          value={note}
        />
      </div>
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending || jobId === ""}
        type="submit"
      >
        {pending ? "追加中…" : "応募管理へ追加"}
      </button>
      <p className="hint-text">
        Prizgramは応募の自動送信を行いません。実際の応募操作は必ずご自身で行ってください。
      </p>
    </form>
  );
}
