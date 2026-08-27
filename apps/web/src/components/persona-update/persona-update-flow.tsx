"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";
import { newRequestId } from "@/lib/request-id";

type Proposed = {
  basePersonaVersionId: string;
  proposed: Record<string, unknown>;
};
type AuditEntry = {
  jobId: string;
  status: string;
  scoreId?: string;
  code?: string;
};

export function PersonaUpdateFlow({
  applications,
}: Readonly<{ applications: readonly { id: string; label: string }[] }>) {
  const router = useRouter();
  const [reflection, setReflection] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [proposed, setProposed] = useState<Proposed | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [remainingJobs, setRemainingJobs] = useState<number | null>(null);
  const [, setNewPersonaVersionId] = useState<string | null>(null);
  const [pending, setPending] = useState<
    "propose" | "approve" | "reeval" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const propose = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending !== null) return;
    if (reflection.trim().length < 10) {
      setError("振り返りを10文字以上入力してください。");
      return;
    }
    setPending("propose");
    setError(null);
    try {
      const result = await apiFetch<Proposed>(
        "/api/persona/update/propose",
        jsonRequestInit("POST", {
          ...(applicationId !== "" ? { applicationId } : {}),
          reflection: reflection.trim(),
        }),
      );
      setProposed(result);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setPending(null);
    }
  };

  const approve = async () => {
    if (pending !== null || proposed === null) return;
    setPending("approve");
    setError(null);
    try {
      const approved = await apiFetch<{ personaVersionId: string }>(
        "/api/persona/update/approve",
        jsonRequestInit("POST", {
          basePersonaVersionId: proposed.basePersonaVersionId,
          snapshot: proposed.proposed,
          requestId: newRequestId(),
          ...(applicationId !== "" ? { applicationId } : {}),
        }),
      );
      setNewPersonaVersionId(approved.personaVersionId);
      router.refresh();
      // Continue to re-evaluation with the newly approved version.
      await reEvaluate(approved.personaVersionId);
    } catch (e) {
      setError(describeApiError(e));
      setPending(null);
    }
  };

  const reEvaluate = async (targetPersonaVersionId: string) => {
    setPending("reeval");
    try {
      const result = await apiFetch<{
        audit: AuditEntry[];
        remainingJobs: number;
      }>(
        "/api/persona/update/re-evaluate",
        jsonRequestInit("POST", { personaVersionId: targetPersonaVersionId }),
      );
      setAudit(result.audit);
      setRemainingJobs(result.remainingJobs);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="page">
      <form
        className="card form-stack"
        noValidate
        onSubmit={(e) => void propose(e)}
      >
        <h2>振り返りから更新案を作成</h2>
        {error !== null && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="update-application">対象応募（任意）</label>
          <select
            id="update-application"
            onChange={(event) => setApplicationId(event.target.value)}
            value={applicationId}
          >
            <option value="">選択しない</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="update-reflection">振り返りメモ</label>
          <textarea
            id="update-reflection"
            maxLength={4000}
            onChange={(event) => setReflection(event.target.value)}
            placeholder="例: 面接でデータ基盤への興味を評価された。Next.jsの実務経験を伸ばしたい。"
            rows={5}
            value={reflection}
          />
        </div>
        <button
          aria-busy={pending === "propose"}
          className="button button-primary"
          disabled={pending !== null}
          type="submit"
        >
          {pending === "propose" ? "生成中…" : "更新案を作成"}
        </button>
        <p className="hint-text">
          提案は自動確定されません。内容を確認して承認した場合のみ更新が反映されます。
        </p>
      </form>

      {proposed !== null && (
        <section className="card form-stack" aria-labelledby="proposal-title">
          <h2 id="proposal-title">更新案の確認</h2>
          <details>
            <summary>提案JSONを確認</summary>
            <pre className="prewrap">
              {JSON.stringify(proposed.proposed, null, 2)}
            </pre>
          </details>
          <button
            aria-busy={pending === "approve"}
            className="button button-primary"
            disabled={pending !== null}
            onClick={() => void approve()}
            type="button"
          >
            {pending === "approve" ? "承認中…" : "承認して更新を反映"}
          </button>
        </section>
      )}

      {audit !== null && (
        <section className="card form-stack" aria-labelledby="audit-title">
          <h2 id="audit-title">再評価結果</h2>
          <ul>
            {audit.map((entry) => (
              <li key={entry.jobId}>
                {entry.jobId}:{" "}
                {entry.status === "scored"
                  ? "再評価済み"
                  : `失敗(${entry.code})`}
              </li>
            ))}
          </ul>
          {remainingJobs !== null && remainingJobs > 0 && (
            <p className="hint-text" role="status">
              保存求人が多いため、今回で{remainingJobs}
              件が未処理です。このページを再読み込みして再度承認・再評価を実行してください。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
