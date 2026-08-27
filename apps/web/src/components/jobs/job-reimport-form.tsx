"use client";

import { useState } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

export function JobReimportForm({ jobId }: Readonly<{ jobId: string }>) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (body.trim().length < 40) {
      setError("本文は40文字以上で入力してください");
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch<{
        jobId: string;
        version: number;
        duplicate: boolean;
      }>("/api/jobs", jsonRequestInit("POST", { body: body.trim(), jobId }));
      setMessage(
        result.duplicate
          ? `既存バージョンが返されました (v${result.version})`
          : `新しいバージョン v${result.version} を追加しました`,
      );
      setBody("");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="job-reimport" className="card form-stack">
      <h2 id="job-reimport">この求人に再取り込み（新バージョン追加）</h2>
      <p className="hint-text">
        手動で更新された求人本文を貼り付けて、既存Jobへ新バージョンを追加できます（#205）。
      </p>
      {error !== null && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {message !== null && (
        <p className="hint-text" role="status">
          {message}
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} className="form-stack">
        <div className="field">
          <label htmlFor="reimport-body">求人本文</label>
          <textarea
            id="reimport-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={20000}
            placeholder="更新後の求人本文を貼り付け（40文字以上）"
          />
        </div>
        <button
          type="submit"
          className="button button-secondary"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "取り込み中…" : "新バージョンとして追加"}
        </button>
      </form>
    </section>
  );
}
