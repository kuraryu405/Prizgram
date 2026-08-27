"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError, apiFetch, jsonRequestInit } from "@/lib/api-client";
import { describeApiError } from "@/lib/error-messages";

type Props = Readonly<{
  jobId: string;
  alreadyApplied?: boolean;
  applicationId?: string;
}>;

export function JobApplyButton({
  jobId,
  alreadyApplied,
  applicationId,
}: Props) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (alreadyApplied && applicationId !== undefined) {
    return (
      <a
        className="button button-secondary"
        href={`/app/applications/${applicationId}`}
      >
        応募済み — 詳細を見る
      </a>
    );
  }

  const onApply = async () => {
    if (applying) return;
    setError(null);
    setApplying(true);
    try {
      const result = await apiFetch<{ applicationId: string }>(
        "/api/applications",
        jsonRequestInit("POST", { jobId }),
      );
      const appId = result.applicationId;
      if (appId !== undefined) {
        router.push(`/app/applications/${appId}`);
        router.refresh();
      } else {
        router.push("/app/applications");
        router.refresh();
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "APPLICATION_EXISTS") {
        setError("この求人は既に応募済みです。応募一覧から確認してください。");
      } else {
        setError(describeApiError(e));
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="job-apply">
      <button
        aria-busy={applying}
        className="button button-primary"
        disabled={applying}
        onClick={() => void onApply()}
        type="button"
      >
        {applying ? "応募を作成中…" : "応募する"}
      </button>
      {error !== null && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      <p className="hint-text">
        求人情報は応募時の内容が固定されます。企業名・職種の再入力は不要です。
      </p>
    </div>
  );
}
